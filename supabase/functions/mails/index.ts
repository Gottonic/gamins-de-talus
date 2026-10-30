// Gamins de Talus — relève de la boîte mail commune (Infomaniak, IMAP) → lignes mail:… dans la base.
// Appelée par l'app (utilisateur connecté et membre) et, si vous le voulez, par Supabase Cron toutes les 10 minutes
// avec l'en-tête « x-cron: <CRON_SECRET> ».
// Secrets à définir dans Supabase (Edge Functions → Secrets) : IMAP_USER, IMAP_PASSWORD
//   (facultatifs : IMAP_HOST = mail.infomaniak.com, IMAP_PORT = 993, CRON_SECRET).
// Seuls l'expéditeur, l'objet, la date et le début du texte (1500 caractères) sont copiés dans la base. La relève ne modifie
// rien dans la boîte. Le texte complet et les pièces jointes sont lus à la demande et restent chez Infomaniak.
// Envoi : { envoyer: { a, cc?, objet, texte, inReplyTo?, pieces: [{ nom, type, base64 }] } } par un membre connecté → envoyé par le SMTP
// d'Infomaniak (port 465, mêmes identifiants), et une copie est rangée dans le dossier « Envoyés » de la boîte.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import PostalMime from 'npm:postal-mime@2';
import nodemailer from 'npm:nodemailer@6.9.16';
import MailComposer from 'npm:nodemailer@6.9.16/lib/mail-composer/index.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const APP = 'https://gottonic.github.io/gamins-de-talus/';

function texteDe(m: any) {
  let t = m.text || '';
  if (!t && m.html) t = String(m.html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"');
  /* On coupe les anciens messages cités (« Le … a écrit : », lignes en >) */
  t = t.split(/\n(?:>|Le .{5,80} a écrit ?:|On .{5,80} wrote:|-{2,} ?Original|De ?: .+\n(?:Envoyé|Date) ?:)/)[0];
  return t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
}

export async function relever(sb: any, env: (k: string) => string | undefined, log = console.log) {
  const etatRow = await sb.from('rows').select('data').eq('key', 'cfg:mails:etat').maybeSingle();
  const etat = (etatRow.data && etatRow.data.data) || {};
  const client = new ImapFlow({ host: env('IMAP_HOST') || 'mail.infomaniak.com', port: Number(env('IMAP_PORT') || 993), secure: (env('IMAP_SECURE') || 'true') !== 'false', auth: { user: env('IMAP_USER')!, pass: env('IMAP_PASSWORD')! }, logger: false, tls: { rejectUnauthorized: (env('IMAP_TLS_STRICT') || 'true') !== 'false' } });
  const nouveaux: any[] = [];
  let nouvelEtat: any = {};
  await client.connect();
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const uv = String(box.uidValidity);
    let depuis = etat.uidValidity === uv ? Number(etat.dernierUid || 0) : 0;
    let uids: number[] = [];
    if (depuis > 0) uids = (await client.search({ uid: `${depuis + 1}:*` }, { uid: true })) || [];
    else { const d = new Date(Date.now() - 30 * 864e5); uids = ((await client.search({ since: d }, { uid: true })) || []).slice(-20); } // premier passage : les 20 derniers des 30 derniers jours
    uids = uids.filter((u) => u > depuis).sort((a, b) => a - b).slice(0, 50);
    for (const uid of uids) {
      const msg: any = await client.fetchOne(String(uid), { uid: true, envelope: true, internalDate: true, source: { start: 0, maxLength: 400000 } }, { uid: true });
      if (!msg) continue;
      let parsed: any = {};
      try { parsed = await PostalMime.parse(msg.source); } catch (_) { parsed = {}; }
      const env0 = msg.envelope || {}, from = (env0.from && env0.from[0]) || parsed.from || {};
      nouveaux.push({
        key: `mail:${uv}-${uid}`,
        data: { de: { nom: from.name || '', adresse: String(from.address || '').toLowerCase() }, objet: env0.subject || parsed.subject || '', date: new Date(env0.date || msg.internalDate || Date.now()).toISOString(), extrait: texteDe(parsed), uid, messageId: env0.messageId || '', statut: '', vus: {}, recuLe: new Date().toISOString() },
        deleted: false,
      });
      depuis = Math.max(depuis, uid);
    }
    nouvelEtat = { uidValidity: uv, dernierUid: depuis };
  } finally { await client.logout().catch(() => {}); }
  if (nouveaux.length) {
    const { error } = await sb.from('rows').upsert(nouveaux, { onConflict: 'key', ignoreDuplicates: true }); // ne jamais écraser un mail déjà traité
    if (error) throw error;
  }
  await sb.from('rows').upsert({ key: 'cfg:mails:etat', data: { ...etat, ...nouvelEtat, derniere: new Date().toISOString(), erreur: '', nouveaux: nouveaux.length }, deleted: false }, { onConflict: 'key' });
  /* Prévenir sur Discord ceux qui l'ont activé */
  if (nouveaux.length) {
    const { data: wh } = await sb.from('rows').select('key,data').like('key', 'cfg:discord:%').eq('deleted', false);
    for (const w of wh || []) {
      if (!w.data || !w.data.webhook) continue;
      const lignes = nouveaux.slice(0, 5).map((m) => `📧 **${m.data.de.nom || m.data.de.adresse}** : ${m.data.objet || '(sans objet)'}`).join('\n') + (nouveaux.length > 5 ? `\n… et ${nouveaux.length - 5} autres` : '');
      const fd = new FormData(); fd.append('payload_json', JSON.stringify({ username: 'Gamins de Talus', content: `[🔗](<${APP}#/mails>) ${nouveaux.length} nouveau${nouveaux.length > 1 ? 'x' : ''} mail${nouveaux.length > 1 ? 's' : ''}\n${lignes}`.slice(0, 1900), allowed_mentions: { parse: [] } }));
      await fetch(w.data.webhook, { method: 'POST', body: fd }).catch(() => {});
    }
  }
  log(`mails : ${nouveaux.length} nouveau(x)`);
  return nouveaux.length;
}

/* ---------- Gestion d'un mail de la boîte de réception (à la demande, rien n'est stocké dans Supabase) ----------
   { boite: { action: 'lire' | 'piece' | 'supprimer' | 'archiver' | 'lu' | 'nonlu', uid, uv, index? } }
   lire : texte complet + liste des pièces jointes (et marque « lu ») ; piece : une pièce jointe en base64 ;
   supprimer : vers la corbeille Infomaniak ; archiver : vers « Archives » ; lu / nonlu : drapeau « lu » chez Infomaniak. */
const imapDe = (env: (k: string) => string | undefined) => new ImapFlow({ host: env('IMAP_HOST') || 'mail.infomaniak.com', port: Number(env('IMAP_PORT') || 993), secure: (env('IMAP_SECURE') || 'true') !== 'false', auth: { user: env('IMAP_USER')!, pass: env('IMAP_PASSWORD')! }, logger: false, tls: { rejectUnauthorized: (env('IMAP_TLS_STRICT') || 'true') !== 'false' } });
function htmlVersTexte(h: string) { return String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim(); }
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export async function gererBoite(env: (k: string) => string | undefined, o: any) {
  const c = imapDe(env); await c.connect();
  try {
    const box = await c.mailboxOpen('INBOX', { readOnly: o.action === 'piece' });
    if (o.uv && String(box.uidValidity) !== String(o.uv)) throw new Error('la boîte a été réorganisée chez Infomaniak : ce mail n\'est plus retrouvable ici');
    const uid = String(Number(o.uid)); if (!(Number(uid) > 0)) throw new Error('mail inconnu');
    const dossier = async (special: string, motif: RegExp, creer: string) => {
      const l = await c.list(); const d = l.find((x: any) => x.specialUse === special) || l.find((x: any) => motif.test(x.name));
      if (d) return d.path; if (!creer) throw new Error('dossier introuvable'); await c.mailboxCreate(creer); return creer;
    };
    if (o.action === 'lire' || o.action === 'piece') {
      const msg: any = await c.fetchOne(uid, { uid: true, source: true }, { uid: true });
      if (!msg) throw new Error('ce mail n\'est plus dans la boîte de réception (déplacé ou supprimé chez Infomaniak)');
      const p: any = await PostalMime.parse(msg.source);
      const pieces = (p.attachments || []).filter((a: any) => a.disposition !== 'inline' || a.filename).map((a: any, i: number) => ({ index: i, nom: a.filename || `piece-${i + 1}`, type: a.mimeType || 'application/octet-stream', taille: (a.content && (a.content.byteLength ?? a.content.length)) || 0, a }));
      if (o.action === 'piece') {
        const x = pieces.find((y: any) => y.index === Number(o.index)); if (!x) throw new Error('pièce jointe introuvable');
        if (x.taille > 15 * 1024 * 1024) throw new Error('pièce jointe trop lourde pour passer par l\'app (plus de 15 Mo) : ouvre-la dans Infomaniak');
        const u = x.a.content instanceof ArrayBuffer ? new Uint8Array(x.a.content) : new TextEncoder().encode(String(x.a.content));
        return { nom: x.nom, type: x.type, base64: b64(u) };
      }
      await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
      const texte = (p.text && p.text.trim()) || htmlVersTexte(p.html || '');
      return { texte: texte.slice(0, 60000), de: p.from || null, a: p.to || [], cc: p.cc || [], date: p.date || '', pieces: pieces.map(({ a, ...r }: any) => r) };
    }
    if (o.action === 'lu') { await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }); return { ok: true }; }
    if (o.action === 'nonlu') { await c.messageFlagsRemove(uid, ['\\Seen'], { uid: true }); return { ok: true }; }
    if (o.action === 'supprimer') { const d = await dossier('\\Trash', /^(trash|corbeille|deleted)/i, ''); await c.messageMove(uid, d, { uid: true }); return { ok: true, dossier: d }; }
    if (o.action === 'archiver') { const d = await dossier('\\Archive', /^archive/i, 'Archives'); await c.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {}); await c.messageMove(uid, d, { uid: true }); return { ok: true, dossier: d }; }
    throw new Error('action inconnue');
  } finally { await c.logout().catch(() => {}); }
}

/* Envoi d'un mail (facture…) avec pièces jointes, puis copie dans « Envoyés » */
export async function envoyerMail(env: (k: string) => string | undefined, m: any, nomExp = 'Gamins de Talus') {
  const user = env('IMAP_USER')!, pass = env('IMAP_PASSWORD')!;
  if (!m || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m.a || '').trim())) throw new Error('adresse du destinataire invalide');
  const mail: any = { from: { name: nomExp, address: user }, to: String(m.a).trim(), cc: m.cc || undefined, subject: String(m.objet || '').slice(0, 200), text: String(m.texte || ''),
    inReplyTo: m.inReplyTo || undefined, references: m.inReplyTo ? [m.inReplyTo] : undefined,
    attachments: (m.pieces || []).slice(0, 8).map((x: any) => ({ filename: String(x.nom || 'document.pdf'), contentType: x.type || 'application/pdf', content: x.base64, encoding: 'base64' })) };
  const brut: Uint8Array = await new MailComposer(mail).compile().build();
  const port = Number(env('SMTP_PORT') || 465);
  const t = nodemailer.createTransport({ host: env('SMTP_HOST') || 'mail.infomaniak.com', port, secure: (env('SMTP_SECURE') || (port === 465 ? 'true' : 'false')) === 'true', auth: { user, pass }, tls: { rejectUnauthorized: (env('IMAP_TLS_STRICT') || 'true') !== 'false' } });
  const cc = String(m.cc || '').split(/[,;\s]+/).filter(Boolean);
  await t.sendMail({ envelope: { from: user, to: [mail.to].concat(cc) }, raw: brut });
  /* Copie dans le dossier « Envoyés » (si ça échoue, le mail est quand même parti) */
  let copie = false;
  try {
    const c = new ImapFlow({ host: env('IMAP_HOST') || 'mail.infomaniak.com', port: Number(env('IMAP_PORT') || 993), secure: (env('IMAP_SECURE') || 'true') !== 'false', auth: { user, pass }, logger: false, tls: { rejectUnauthorized: (env('IMAP_TLS_STRICT') || 'true') !== 'false' } });
    await c.connect();
    try { const l = await c.list(); const d = l.find((x: any) => x.specialUse === '\\Sent') || l.find((x: any) => /^(sent|envoy)/i.test(x.name)); if (d) { await c.append(d.path, brut, ['\\Seen']); copie = true; } }
    finally { await c.logout().catch(() => {}); }
  } catch (_) { /* pas grave */ }
  return { ok: true, copie };
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const env = (k: string) => Deno.env.get(k);
  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  /* Qui appelle ? Soit Supabase Cron (secret), soit un membre connecté de l'app */
  const cron = env('CRON_SECRET'), h = req.headers.get('x-cron');
  if (!(cron && h && h === cron)) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u || !u.user) return json({ erreur: 'non connecté' }, 401);
    const { data: m } = await sb.from('membres').select('personne').eq('user_id', u.user.id).maybeSingle();
    if (!m) return json({ erreur: 'pas membre' }, 403);
  }
  if (!env('IMAP_USER') || !env('IMAP_PASSWORD')) return json({ erreur: 'IMAP_USER et IMAP_PASSWORD manquent dans les secrets' }, 500);
  const corps = await req.json().catch(() => ({}));
  if (corps && corps.boite) {
    if (cron && h && h === cron) return json({ erreur: 'réservé aux membres' }, 403);
    try { return json(await gererBoite(env, corps.boite)); }
    catch (e) { return json({ erreur: String((e as any).responseText || (e as Error).message || e).slice(0, 300) }, 500); }
  }
  if (corps && corps.envoyer) {
    if (cron && h && h === cron) return json({ erreur: 'envoi réservé aux membres' }, 403);
    try { return json(await envoyerMail(env, corps.envoyer, corps.envoyer.nomExp || 'Gamins de Talus')); }
    catch (e) { return json({ erreur: 'Envoi impossible : ' + String((e as any).response || (e as Error).message || e).slice(0, 300) }, 500); }
  }
  try { return json({ nouveaux: await relever(sb, env) }); }
  catch (e) {
    const msg = String((e && (e as any).responseText) || (e as Error).message || e).slice(0, 300);
    const prec = await sb.from('rows').select('data').eq('key', 'cfg:mails:etat').maybeSingle().then((r: any) => (r.data && r.data.data) || {}, () => ({}));
    await sb.from('rows').upsert({ key: 'cfg:mails:etat', data: { ...prec, derniere: new Date().toISOString(), erreur: msg }, deleted: false }, { onConflict: 'key' }).then(() => {}, () => {});
    return json({ erreur: msg }, 500);
  }
});
