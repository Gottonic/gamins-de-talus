// Gamins de Talus — flux de calendrier (ICS) à ajouter dans Google Agenda, Proton Calendar, etc.
// Adresse : https://<projet>.supabase.co/functions/v1/calendrier?t=<jeton>
// Le jeton (secret) est propre à chaque personne : il est créé dans l'app (Calendrier → S'abonner) et rangé
// dans la ligne cfg:ics:<personne>. Le flux montre ce qui concerne cette personne (ou tout, si elle l'a choisi).
// À déployer SANS « Verify JWT » (les agendas ne peuvent pas se connecter) : c'est le jeton qui protège.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TYPES: Record<string, string> = { travail: 'Journée de travail', recolte: 'Chantier de récolte', livraison: 'Livraison', vente: 'Vente ou marché', vacances: 'Vacances', autre: 'Événement' };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
function occurrences(ev: any, de: string, a: string) {
  const out: { date: string; fin: string }[] = [];
  const dur = ev.fin && ev.fin > ev.date ? Math.round((new Date(ev.fin + 'T12:00:00Z').getTime() - new Date(ev.date + 'T12:00:00Z').getTime()) / 864e5) : 0;
  const ex = new Set(ev.exceptions || []), rec = (ev.rec && ev.rec.freq) || '', fin = (ev.rec && ev.rec.jusquau) || '9999-12-31';
  const push = (d: string) => { const f = addDays(d, dur); if (f >= de && d <= a && !ex.has(d)) out.push({ date: d, fin: f }); };
  if (!rec) { push(ev.date); return out; }
  const step = (n: number) => {
    if (rec === 'mensuel') { const [Y, M, D] = ev.date.split('-').map(Number); const last = new Date(Date.UTC(Y, M + n, 0)).getUTCDate(); return iso(new Date(Date.UTC(Y, M - 1 + n, Math.min(D, last), 12))); }
    return addDays(ev.date, n * (rec === 'bihebdo' ? 14 : 7));
  };
  let d = ev.date, i = 0;
  while (d <= a && d <= fin && i < 1000) { push(d); i++; d = step(i); }
  return out;
}
const txt = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/* Lignes de 75 octets au plus (RFC 5545) */
function plier(l: string) { const b = new TextEncoder().encode(l); if (b.length <= 75) return l; const out: string[] = []; let cur = ''; for (const ch of l) { if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; } out.push(cur); return out.join('\r\n '); }
const VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Zurich', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD', 'END:VTIMEZONE'];

Deno.serve(async (req) => {
  const u = new URL(req.url), jeton = u.searchParams.get('t') || '';
  if (jeton.length < 20) return new Response('Jeton manquant', { status: 401 });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const lire = async (prefixe: string) => { const out: any[] = []; for (let f = 0; ; f += 1000) { const { data, error } = await sb.from('rows').select('key,data').like('key', prefixe + '%').eq('deleted', false).range(f, f + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; } return out; };
  /* Un jeton par personne : lignes cfg:ics:<personne> = { jeton, tout } */
  const qui = (await lire('cfg:ics:')).find((r) => r.data && r.data.jeton === jeton);
  if (!qui) return new Response('Jeton inconnu', { status: 403 });
  const personne = qui.key.split(':')[2], opts = qui.data;
  const tout = !!opts.tout, pour = (q: string) => tout || !q || q === 'ensemble' || q === personne;
  const [evs, cul, cts, cfg] = await Promise.all([lire('ev:'), lire('cul:'), lire('ct:'), lire('cfg:reglages')]);
  const noms: Record<string, string> = {}; for (const p of (cfg[0]?.data?.personnes || [])) noms[p.k] = p.nom;
  const get = (rows: any[], k: string) => rows.find((r) => r.key === k)?.data;
  const de = addDays(iso(new Date()), -60), a = addDays(iso(new Date()), 400), stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gamins de Talus//App//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Gamins de Talus' + (tout ? '' : ' · ' + (noms[personne] || personne)), 'X-WR-TIMEZONE:Europe/Zurich', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTZ];
  for (const { key, data: e } of evs) {
    if (!pour(e.qui)) continue;
    const c = e.contactId && get(cts, e.contactId), cu = e.cultureId && get(cul, e.cultureId);
    let titre = e.titre || (e.type === 'livraison' ? 'Livraison' + (c ? ' ' + (c.organisation || c.nom || '') : '') : e.type === 'recolte' ? 'Récolte' + (cu ? ' ' + cu.nom : '') : TYPES[e.type] || 'Événement');
    if (e.type === 'vacances' && e.qui && e.qui !== 'ensemble' && !e.titre) titre = 'Vacances ' + (noms[e.qui] || e.qui);
    if (e.qui && e.qui !== 'ensemble' && tout && !titre.includes(noms[e.qui] || '§')) titre += ' · ' + (noms[e.qui] || e.qui);
    for (const o of occurrences(e, de, a)) {
      const d = o.date.replace(/-/g, ''), uid = `${key.replace(/[^a-zA-Z0-9]/g, '')}-${d}@gaminsdetalus`;
      L.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp);
      if (e.heureDebut && o.fin === o.date) {
        const h1 = e.heureDebut.replace(':', '') + '00', h2 = (e.heureFin && e.heureFin > e.heureDebut ? e.heureFin : e.heureDebut.replace(/^(\d\d)/, (m: string) => String(Math.min(23, Number(m) + 1)).padStart(2, '0'))).replace(':', '') + '00';
        L.push(`DTSTART;TZID=Europe/Zurich:${d}T${h1}`, `DTEND;TZID=Europe/Zurich:${d}T${h2}`);
      } else L.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + addDays(o.fin, 1).replace(/-/g, ''));
      L.push('SUMMARY:' + txt(titre));
      const desc = [e.remarque, c && c.telephone ? 'Tél. ' + c.telephone : '', 'https://gottonic.github.io/gamins-de-talus/#/calendrier'].filter(Boolean).join('\n');
      L.push('DESCRIPTION:' + txt(desc));
      if (c && (c.rue || c.localite)) L.push(('LOCATION:' + txt([[c.rue, c.numero].filter(Boolean).join(' '), [c.npa, c.localite].filter(Boolean).join(' ')].filter(Boolean).join(', '))));
      if (e.type === 'vacances') L.push('TRANSP:TRANSPARENT');
      L.push('END:VEVENT');
    }
  }
  /* Les tâches ne vont pas dans l'agenda : seulement les événements planifiés */
  L.push('END:VCALENDAR');
  return new Response(L.map(plier).join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'max-age=900', 'Access-Control-Allow-Origin': '*' } });
});
