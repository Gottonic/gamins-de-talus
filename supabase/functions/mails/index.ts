// Gamins de Talus — relève de la boîte mail commune (Infomaniak, IMAP) → lignes mail:… dans la base.
// Appelée par l'app (utilisateur connecté et membre) et, si vous le voulez, par Supabase Cron toutes les 10 minutes
// avec l'en-tête « x-cron: <CRON_SECRET> ».
// Secrets à définir dans Supabase (Edge Functions → Secrets) : IMAP_USER, IMAP_PASSWORD
//   (facultatifs : IMAP_HOST = mail.infomaniak.com, IMAP_PORT = 993, CRON_SECRET).
// Seuls l'expéditeur, l'objet, la date et le début du texte (1500 caractères) sont copiés. Rien n'est modifié dans la boîte
// (lecture seule : les mails restent « non lus » chez Infomaniak).
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
