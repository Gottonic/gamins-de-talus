// Gamins de Talus — notifications « pop-up » sur les téléphones et ordinateurs abonnés (Web Push, sans service tiers).
// Appelée : par la base à chaque nouveau message (msg:) ou nouveau mail (mail:) ; chaque matin par Supabase Cron
// (tâches et événements du jour) ; par l'app pour une notification de test (membre connecté).
// Abonnements : lignes push:<personne>:<appareil> = { endpoint, p256dh, auth, appareil }. Préférences : cfg:notif:<personne>.
// Secrets : VAPID_PRIVATE (clé privée VAPID), CRON_SECRET. À déployer SANS « Verify JWT » : la fonction vérifie elle-même.
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC = 'BEWBqzH3etLZ-_g1_ZUOTJSyD-qECUilmuXsm9MIw6COqRTe4Ynqgu75jrlmAW3PGTVDD5VdjtL5zHWpBDUkCi0';
const APP = 'https://gottonic.github.io/gamins-de-talus/';
const CONTACT = 'mailto:info@gaminsdetalus.ch';

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}
/* Chiffrement du message (RFC 8291, aes128gcm) pour la clé publique de l'appareil */
export async function chiffrer(texte: string, p256dh: string, auth: string) {
  const ua = deB64u(p256dh), secret = deB64u(auth), salt = crypto.getRandomValues(new Uint8Array(16));
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, partage, concat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, concat(enc.encode(texte), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, chiffre);
}
/* Jeton VAPID (RFC 8292) signé avec la clé privée du serveur */
export async function jetonVapid(endpoint: string, d: string, pub = VAPID_PUBLIC) {
  const p = deB64u(pub), jwk = { kty: 'EC', crv: 'P-256', d, x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true };
  const cle = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const corps = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.' + b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, enc.encode(corps));
  return corps + '.' + b64u(sig);
}
/* La clé privée (secret) correspond-elle à la clé publique de l'app ? On signe, puis on vérifie avec la clé publique. */
export async function verifierCle(d: string, pub = VAPID_PUBLIC) {
  try {
    const p = deB64u(pub), jeton = await jetonVapid('https://exemple.org/x', d, pub), [h, c, sig] = jeton.split('.');
    const cle = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cle, deB64u(sig), enc.encode(h + '.' + c));
  } catch (_) { return false; }
}
/* Urgency « high » : sur Android, une notification « normale » attend que le téléphone se réveille (mode économie,
   « Doze ») ; « high » la fait arriver tout de suite, même écran éteint et navigateur fermé. */
async function envoyer(abo: any, message: any, d: string) {
  const corps = await chiffrer(JSON.stringify(message), abo.p256dh, abo.auth);
  return fetch(abo.endpoint, { method: 'POST', body: corps, headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: `vapid t=${await jetonVapid(abo.endpoint, d)}, k=${VAPID_PUBLIC}` } });
}

/* Jour J à Zurich, et occurrences des événements (comme la fonction calendrier) */
const aujourdhui = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(new Date());
const addDays = (s: string, n: number) => { const x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function aLieu(ev: any, jour: string) {
  if (!ev.date) return false; const ex = new Set(ev.exceptions || []); if (ex.has(jour)) return false;
  const rec = (ev.rec && ev.rec.freq) || '', fin = (ev.rec && ev.rec.jusquau) || '9999-12-31';
  const dur = ev.fin && ev.fin > ev.date ? Math.round((Date.parse(ev.fin) - Date.parse(ev.date)) / 864e5) : 0;
  if (!rec) return jour >= ev.date && jour <= addDays(ev.date, dur);
  if (jour < ev.date || jour > fin) return false;
  if (rec === 'mensuel') return Number(jour.slice(8)) === Math.min(Number(ev.date.slice(8)), new Date(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)), 0)).getUTCDate());
  const jours = Math.round((Date.parse(jour) - Date.parse(ev.date)) / 864e5);
  return jours % (rec === 'bihebdo' ? 14 : 7) === 0;
}
const court = (s: string, n: number) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));
const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const env = (k: string) => Deno.env.get(k);
  const sb = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const corps = await req.json().catch(() => ({}));
  /* Qui appelle ? La base ou le cron (secret), sinon un membre connecté (un test, ou un mail qu'il confie à quelqu'un) */
  let membre = '';
  const cron = env('CRON_SECRET'), h = req.headers.get('x-cron');
  if (!(cron && h && h === cron)) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    const { data: u } = await sb.auth.getUser(jwt); if (!u || !u.user) return json({ erreur: 'non connecté' }, 401);
    const { data: m } = await sb.from('membres').select('personne').eq('user_id', u.user.id).maybeSingle(); if (!m) return json({ erreur: 'pas membre' }, 403);
    if (!corps.test && !corps.confier) return json({ erreur: 'réservé aux tests' }, 403);
    membre = m.personne;
  }
  const d = String(env('VAPID_PRIVATE') || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  /* Sans clé VAPID valable, pas de notification sur les appareils ; Discord marche quand même */
  const pbVapid = !d ? 'Le secret VAPID_PRIVATE manque dans Supabase (Edge Functions → Secrets).' : !(await verifierCle(d)) ? 'Le secret VAPID_PRIVATE ne correspond pas à la clé de l\'app : recopie-le exactement (43 caractères, sans espace ni guillemets).' : '';
  if (pbVapid && corps.test) return json({ erreur: pbVapid }, 500);
  const lire = async (prefixe: string) => { const out: any[] = []; for (let f = 0; ; f += 1000) { const { data, error } = await sb.from('rows').select('key,data').like('key', prefixe + '%').eq('deleted', false).range(f, f + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
  const abos = (await lire('push:')).map((r) => Object.assign({ key: r.key, personne: r.key.split(':')[1] }, r.data)).filter((a) => a.endpoint && a.p256dh && a.auth);
  const prefs: Record<string, any> = {}; for (const r of await lire('cfg:notif:')) prefs[r.key.split(':')[2]] = r.data || {};
  const reglages = ((await sb.from('rows').select('data').eq('key', 'cfg:reglages').maybeSingle()).data || {}).data || {};
  const personnes: any[] = reglages.personnes || [{ k: 'nicolas', nom: 'Nicolas' }, { k: 'noe', nom: 'Noé' }];
  const nom = (k: string) => (personnes.find((p) => p.k === k) || { nom: k }).nom;
  const veut = (p: string, quoi: string) => (prefs[p] || {})[quoi] !== false;
  /* Discord (facultatif) : lignes cfg:discord:<personne> = { webhook, texte }. Les messages de la discussion y sont postés
     par l'app elle-même (avec les photos) ; ici : les mails et la journée, si la personne l'a coché (d_mails, d_jour). */
  const discord: Record<string, any> = {}; for (const r of await lire('cfg:discord:')) discord[r.key.split(':')[2]] = r.data || {};
  const surDiscord = (p: string, quoi: string) => !!(discord[p] && discord[p].webhook) && (prefs[p] || {})['d_' + quoi] === true;
  const discordEnvois: { personne: string; contenu: string }[] = [];
  /* Jours et heures où chacun accepte d'être dérangé : prefs.plage = { jours: [1..7] (1 = lundi), de: 'HH:MM', a: 'HH:MM' } */
  const maintenant = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const jourSem = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf((maintenant.find((x) => x.type === 'weekday') as any)?.value || '') + 1;
  const hm = `${(maintenant.find((x) => x.type === 'hour') as any)?.value || '00'}:${(maintenant.find((x) => x.type === 'minute') as any)?.value || '00'}`.replace(/^24/, '00');
  const dansPlage = (p: string) => {
    const pl = (prefs[p] || {}).plage; if (!pl) return true;
    if (Array.isArray(pl.jours) && pl.jours.length && !pl.jours.includes(jourSem)) return false;
    const de = pl.de || '00:00', a = pl.a || '24:00';
    return de <= a ? hm >= de && hm < a : hm >= de || hm < a;
  };

  /* Ce qu'il faut envoyer, à qui */
  const envois: { personne: string; message: any }[] = [];
  if (corps.test) envois.push({ personne: membre, message: { titre: 'Gamins de Talus', texte: 'Les notifications marchent sur cet appareil 🎉', url: APP + '#/reglages/notifications', tag: 'test' } });
  else if (corps.confier) {
    const c = corps.confier, p = String(c.personne || '');
    if (p && p !== membre) {
      if (veut(p, 'assignes')) envois.push({ personne: p, message: { titre: '📧 ' + nom(membre) + ' te confie un mail', texte: court((c.de ? c.de + ' : ' : '') + (c.objet || '(sans objet)'), 140), url: APP + '#/mails', tag: 'confie' } });
      if (surDiscord(p, 'assignes')) discordEnvois.push({ personne: p, contenu: `[🔗](<${APP}#/mails>) 📧 **${nom(membre)}** te confie un mail` + (discord[p].texte === false ? '' : ` : ${court((c.de ? c.de + ' : ' : '') + (c.objet || '(sans objet)'), 200)}`) });
    }
  }
  else if (String(corps.key || '').startsWith('msg:')) {
    const m = corps.data || {};
    for (const p of personnes) if (p.k !== m.de && veut(p.k, 'messages')) envois.push({ personne: p.k, message: { titre: '💬 ' + nom(m.de), texte: court(m.texte || (m.sondage ? (m.sondage.type === 'dates' ? '📅 Sondage de dates : ' : '📊 Sondage : ') + (m.sondage.question || '') : '') || (m.photo ? '📷 Photo' : '') || (m.fichier ? '📎 ' + (m.fichier.nom || 'Fichier') : ''), 140), url: APP + '#/messages', tag: 'msg' } });
  } else if (String(corps.key || '').startsWith('mail:')) {
    const m = corps.data || {}, de = (m.de && (m.de.nom || m.de.adresse)) || '?';
    for (const p of personnes) {
      if (veut(p.k, 'mails')) envois.push({ personne: p.k, message: { titre: '📧 ' + court(de, 40), texte: court(m.objet || '(sans objet)', 140), url: APP + '#/mails', tag: 'mail' } });
      if (surDiscord(p.k, 'mails')) discordEnvois.push({ personne: p.k, contenu: `[🔗](<${APP}#/mails>) 📧 ` + (discord[p.k].texte === false ? 'Nouveau mail' : `**${court(de, 60)}** : ${court(m.objet || '(sans objet)', 200)}`) });
    }
  } else if (corps.matin) {
    const jour = aujourdhui(), taches = await lire('t:'), evs = await lire('ev:');
    for (const p of personnes) {
      if (!veut(p.k, 'jour') && !surDiscord(p.k, 'jour')) continue;
      const pour = (q: string) => !q || q === 'ensemble' || q === p.k;
      /* Tâches prévues aujourd'hui (un jour, ou une journée de travail d'aujourd'hui), ou dont l'échéance tombe aujourd'hui */
      const ts = taches.map((r) => r.data).filter((t) => t && t.statut !== 'termine' && pour(t.responsable) && (t.jour === jour || String(t.journee || '').endsWith('|' + jour) || (t.echeance === jour && !t.jour && !t.journee)));
      const es = evs.map((r) => r.data).filter((e) => e && aLieu(e, jour) && pour(e.qui));
      if (!ts.length && !es.length) continue;
      const lignes = [...es.map((e) => '📅 ' + (e.heureDebut ? e.heureDebut + ' ' : '') + (e.titre || 'Événement')), ...ts.map((t) => '✓ ' + t.titre)];
      if (veut(p.k, 'jour')) envois.push({ personne: p.k, message: { titre: "Aujourd'hui", texte: court(lignes.join(' · '), 180), url: APP + '#/accueil', tag: 'jour' } });
      if (surDiscord(p.k, 'jour')) discordEnvois.push({ personne: p.k, contenu: `[🔗](<${APP}#/>) **Aujourd'hui**\n` + court(lignes.join('\n'), 1800) });
    }
  }
  /* Hors des jours et heures choisis : rien (sauf le test) */
  if (!corps.test) { for (let i = envois.length - 1; i >= 0; i--) if (!dansPlage(envois[i].personne)) envois.splice(i, 1); for (let i = discordEnvois.length - 1; i >= 0; i--) if (!dansPlage(discordEnvois[i].personne)) discordEnvois.splice(i, 1); }
  /* Envoi à chaque appareil ; un abonnement expiré (404/410) est retiré */
  let ok = 0; const erreurs: string[] = pbVapid && envois.length ? [pbVapid] : [];
  for (const e of pbVapid ? [] : envois) for (const a of abos.filter((x) => x.personne === e.personne)) {
    try {
      const r = await envoyer(a, e.message, d);
      if (r.status === 404 || r.status === 410) await sb.from('rows').update({ deleted: true }).eq('key', a.key);
      else if (r.ok) ok++; else erreurs.push(`${new URL(a.endpoint).host} ${r.status} ${court(await r.text(), 120)}`);
    } catch (err) { erreurs.push(String((err as Error).message || err)); }
  }
  let discordOk = 0;
  for (const e of discordEnvois) {
    try {
      const r = await fetch(discord[e.personne].webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: e.contenu, allowed_mentions: { parse: [] } }) });
      if (r.ok) discordOk++; else erreurs.push(`discord ${r.status}`);
    } catch (err) { erreurs.push('discord ' + String((err as Error).message || err)); }
  }
  return json({ envoyes: ok, appareils: abos.length, discord: discordOk, erreurs });
});
