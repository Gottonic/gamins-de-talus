/* Gamins de Talus — calendrier : agenda, mois, heures (semaine + bilan de l'année).
   On y voit les heures travaillées, les jours off et vacances, les événements (travail, récolte, livraison,
   vente…, récurrents ou non) et les échéances des tâches et des factures. */
'use strict';

const heuresToutes = () => DB.all('h:');
const evenements = () => DB.all('ev:');
const HEU = { lundi: '', annee: '' };
const CAL = { mois: '', calques: Object.assign({ heures: true, evenements: true, taches: true, factures: true, relances: true }, (() => { try { return JSON.parse(ls.get('gdt-cal-calques') || 'null'); } catch (e) { return null; } })() || {}) };
const hKey = (date, p) => `h:${date}:${p}`;
const EV_TYPES = [
  { k: 'travail', label: 'Journée de travail', court: 'Travail' },
  { k: 'recolte', label: 'Chantier de récolte', court: 'Récolte' },
  { k: 'livraison', label: 'Livraison', court: 'Livraison' },
  { k: 'vente', label: 'Vente ou marché', court: 'Vente' },
  { k: 'vacances', label: 'Vacances ou congé', court: 'Vacances' },
  { k: 'autre', label: 'Autre', court: 'Autre' },
];
const evType = (k) => EV_TYPES.find((t) => t.k === k) || EV_TYPES[5];
const RECS = [['', 'Une seule fois'], ['hebdo', 'Chaque semaine'], ['bihebdo', 'Toutes les 2 semaines'], ['mensuel', 'Chaque mois']];
const CULT_PALETTE = ['#4E9A3A', '#E08A1E', '#C2512F', '#8A6BB8', '#2F8FA8', '#B8A11E', '#D0577E', '#5E7B8C', '#7A9E2E', '#A0522D'];
function couleurCulture(c, i) { return c.couleur || CULT_PALETTE[((c.ordre || i + 1) - 1) % CULT_PALETTE.length]; }
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function dateLongue(d) { const x = new Date(d + 'T12:00'); return `${JOURS[(x.getDay() + 6) % 7]} ${x.getDate()} ${MOIS[x.getMonth()]} ${x.getFullYear()}`; }
function quiLabel(q) { return !q ? '' : q === 'ensemble' ? 'Ensemble' : String(q).split('+').map(nomDe).join(' & '); }
function titreEv(e) {
  if (e.titre) return e.titre;
  const c = e.contactId && DB.get(e.contactId), cu = e.cultureId && DB.get(e.cultureId);
  if (e.type === 'livraison') return 'Livraison' + (c ? ' ' + displayName(c) : '');
  if (e.type === 'recolte') return 'Récolte' + (cu ? ' ' + cu.nom : '');
  if (e.type === 'vacances') return 'Congé' + (e.qui && e.qui !== 'ensemble' ? ' ' + quiLabel(e.qui) : '');
  return evGenre(e).nom;
}
/* Récoltes notées au calendrier pour une culture (kg) */
function recolteNotee(cultureKey) {
  if (typeof recoltesDeCulture === 'function') return recoltesDeCulture(cultureKey);
  let kg = 0;
  for (const e of evenements()) if (e.type === 'recolte' && e.cultureId === cultureKey) for (const o of Object.values(e.occ || {})) kg += num(o.kg);
  return kg;
}

/* ---------- Tout ce qui se passe sur une période ---------- */
function itemsPeriode(de, a) {
  const jours = {}; const add = (d, it) => { (jours[d] = jours[d] || []).push(it); };
  for (const e of evenements()) for (const o of occurrences(e, de, a)) {
    for (let d = o.date > de ? o.date : de; d <= o.fin && d <= a; d = addDays(d, 1)) {
      const st = (e.occ || {})[o.date] || {};
      add(d, { kind: 'ev', type: e.type, cat: catEv(e).cat, couleur: couleurEv(e, o.date), key: e.key, occ: o.date, titre: titreEv(e), heure: d === o.date ? e.heureDebut || '' : '', qui: e.qui, fait: !!st.fait, multi: o.fin > o.date, debut: d === o.date });
    }
  }
  for (const t of taches()) {
    if (t.statut === 'termine') continue; const d = jourPlanifie(t);
    if (d && d >= de && d <= a) add(d, { kind: 'tache', key: t.key, titre: t.titre, imp: importanceDe(t), qui: t.responsable, journee: (journeeDe(t) || {}).key || '' });
    else if (!estPlanifiee(t) && t.echeance && t.echeance >= de && t.echeance <= a) add(t.echeance, { kind: 'echeance', key: t.key, titre: t.titre, qui: t.responsable });
  }
  for (const f of factures()) { const s = facStatut(f); if ((s === 'ouverte' || s === 'retard') && f.echeance >= de && f.echeance <= a) add(f.echeance, { kind: 'facture', key: f.key, titre: `Échéance ${f.numero || f.blNumero || 'vente'} · ${f.client.nom}`, montant: f.total }); }
  for (const h of heuresToutes()) if (h.date >= de && h.date <= a) add(h.date, { kind: 'heures', personne: h.personne, heures: num(h.heures), off: !!h.off });
  for (const c of relancesProspection(de, a)) add(c.prospection.relanceLe, { kind: 'relance', key: c.key, titre: 'Relancer ' + displayName(c) });
  return jours;
}

/* ---------- Module ---------- */
/* Planification = calendrier + tâches : Vue d'ensemble, Tâches, Mois, Heures (l'adresse reste #/calendrier) */
MODULES.calendrier = {
  titre: 'Planification',
  tuile() {
    const auj = (itemsPeriode(todayISO(), todayISO())[todayISO()] || []).filter((x) => x.kind === 'ev' && (typeof pourMoi !== 'function' || pourMoi(x.qui))).length;
    const aP = aPlanifier().length, presse = tachesUrgentesPourMoi().length;
    const ev7 = Object.entries(itemsPeriode(todayISO(), addDays(todayISO(), 6))).reduce((a, [, xs]) => a + xs.filter((x) => x.kind === 'ev' && x.debut).length, 0);
    return { line: `${auj ? auj + " aujourd'hui · " : ''}${ev7} événement${ev7 > 1 ? 's' : ''} sur 7 jours · ${aP} tâche${aP > 1 ? 's' : ''} à planifier`, warn: !!presse, badge: auj + presse };
  },
  render(sub) {
    if (sub === 'semaine') { setTimeout(() => location.replace('#/calendrier/heures'), 0); return ''; }
    if (sub === 'agenda') sub = '';
    const nUrg = tachesUrgentesPourMoi().length;
    const t = tabs('calendrier', [['', "Vue d'ensemble"], ['taches', `Tâches${nUrg ? ' · ' + nUrg + ' échéance proche' : ''}`, nUrg > 0], ['mois', 'Calendrier'], ['heures', 'Heures']], sub === 'feuille' ? 'taches' : sub);
    if (sub === 'taches') return t + renderTaches();
    if (sub === 'feuille') { setTimeout(() => location.replace('#/calendrier/taches'), 0); return ''; }
    if (sub === 'mois') return t + (CAL.vue === 'semaine' ? renderSemaineCal() : renderMois());
    if (sub === 'heures') return t + `<div class="row"><button class="btn primary" type="button" data-act="heuresJour">+ Noter les heures du jour</button></div>` + renderSemaineHeures() + renderBilanHeures();
    return t + renderVue();
  },
  after(sub) {
    if (sub === 'heures') { const s = $('h-annee'); if (s) s.addEventListener('change', () => { HEU.annee = s.value; render(); }); return; }
    if (!sub || sub === 'agenda' || sub === 'taches') brancherGlisserTaches($('view'));
    brancherHeures($('view'));
  },
};
/* L'ancienne adresse #/heures mène au calendrier */
MODULES.heures = { titre: 'Calendrier', render(sub) { setTimeout(() => location.replace('#/calendrier/heures'), 0); return ''; } };

function brancherHeures(root) {
  root.querySelectorAll('input[data-h]').forEach((el) => el.addEventListener('change', () => {
    const [date, p] = el.dataset.h.split('|'); const k = hKey(date, p), old = DB.get(k) || { date, personne: p };
    const val = el.value.trim() === '' ? 0 : num(el.value);
    if (val < 0 || val > 24) { toast('Entre 0 et 24 heures.'); el.value = old.heures ? fmtH(old.heures) : ''; return; }
    const o = Object.assign({}, old, { heures: r2(val) });
    if (!o.heures && !o.off && !o.note) DB.del(k); else DB.put(k, o);
    if (root === $('view')) renderGardeFocus();
  }));
  root.querySelectorAll('input[data-jour]').forEach((el) => el.addEventListener('change', () => {
    const k = 'jour:' + el.dataset.jour, val = el.value.trim();
    if (!val) DB.del(k); else DB.put(k, { date: el.dataset.jour, remarque: val });
  }));
}

/* ---------- Vue mois ---------- */
function renderMois() {
  const today = todayISO(); if (!CAL.mois) CAL.mois = today.slice(0, 7);
  const [Y, M] = CAL.mois.split('-').map(Number);
  const premier = `${CAL.mois}-01`, nbJours = new Date(Y, M, 0).getDate(), dernier = `${CAL.mois}-${String(nbJours).padStart(2, '0')}`;
  const gDe = lundiDe(premier), gA = addDays(lundiDe(dernier), 6);
  const items = itemsPeriode(gDe, gA), L = CAL.calques;
  const ps = personnes();
  /* Abréviations distinctes (Nicolas / Noé → Ni / No) */
  let n = 1; while (n < 4 && new Set(ps.map((p) => p.nom.slice(0, n).toLowerCase())).size < ps.length) n++;
  const ini = (k) => (nomDe(k) || '?').slice(0, n);
  let cells = '';
  for (let d = gDe; d <= gA; d = addDays(d, 1)) {
    const xs = items[d] || [], wd = (new Date(d + 'T12:00').getDay() + 6) % 7;
    const hs = xs.filter((x) => x.kind === 'heures');
    const off = hs.filter((x) => x.off).map((x) => x.personne);
    const vac = xs.filter((x) => x.kind === 'ev' && x.type === 'vacances');
    const hrs = L.heures ? hs.filter((x) => x.heures > 0).map((x) => `<span class="h">${esc(ini(x.personne))} ${fmtH(x.heures)}</span>`).join('') : '';
    const chips = [];
    if (L.heures) off.forEach((p) => chips.push(`<span class="ch" style="--c:var(--ev-vacances)">${esc(nomDe(p))} off</span>`));
    if (L.evenements) xs.filter((x) => x.kind === 'ev').sort((a, b) => String(a.heure).localeCompare(String(b.heure))).forEach((x) => chips.push(`<span class="ch${x.fait ? ' fait' : ''}${x.multi ? ' multi' : ''}" style="--c:${x.couleur}">${x.heure ? `<i>${esc(x.heure)}</i> ` : ''}${esc(x.titre)}</span>`));
    if (L.taches) xs.filter((x) => x.kind === 'tache' && !x.journee).forEach((x) => chips.push(`<span class="ch tache" style="--c:var(--c-taches)">☐ ${esc(x.titre)}</span>`));
    if (L.taches) xs.filter((x) => x.kind === 'echeance').forEach((x) => chips.push(`<span class="ch tache" style="--c:var(--late)">⏰ ${esc(x.titre)}</span>`));
    if (L.factures) xs.filter((x) => x.kind === 'facture').forEach((x) => chips.push(`<span class="ch" style="--c:var(--c-factures)">${esc(x.titre)}</span>`));
    if (L.relances) xs.filter((x) => x.kind === 'relance').forEach((x) => chips.push(`<span class="ch" style="--c:var(--c-contacts)">☎ ${esc(x.titre)}</span>`));
    const max = 4, plus = chips.length > max ? `<span class="more">+${chips.length - max}</span>` : '';
    cells += `<button type="button" class="cell${d.slice(0, 7) !== CAL.mois ? ' out' : ''}${d === today ? ' today' : ''}${wd >= 5 ? ' we' : ''}${vac.length && L.evenements ? ' vac' : ''}" data-act="calDay" data-d="${d}" aria-label="${esc(dateLongue(d))}">
      <span class="top"><span class="dn">${Number(d.slice(8))}</span>${wd === 0 ? `<span class="wk">S${semaineISO(d).semaine}</span>` : ''}<span class="hrs">${hrs}</span></span>
      <span class="chips">${chips.slice(0, max).join('')}${plus}</span><span class="dots">${chips.slice(0, 6).map((c) => `<span class="dot" style="${(c.match(/style="([^"]+)"/) || [, ''])[1]}"></span>`).join('')}</span></button>`;
  }
  const legend = [['heures', 'Heures et jours off'], ['evenements', 'Événements'], ['taches', 'Tâches et échéances'], ['factures', 'Échéances des factures'], ['relances', 'Relances prospection']]
    .map(([k, l]) => `<button type="button" class="chip${L[k] ? ' on' : ''}" data-act="calCalque" data-k="${k}">${l}</button>`).join('');
  const prev = new Date(Y, M - 2, 1), next = new Date(Y, M, 1);
  const ym = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  // Totaux du mois
  const tm = totalHeures(heuresToutes(), (h) => h.date.slice(0, 7) === CAL.mois);
  return `<div class="panel">
    <div class="row">${vueCalHtml()}</div>
    <div class="between"><div class="row"><button class="btn small" type="button" data-act="calMois" data-m="${ym(prev)}" aria-label="Mois précédent">←</button>
      <h2 style="min-width:9ch">${MOIS[M - 1].replace(/^./, (c) => c.toUpperCase())} ${Y}</h2><button class="btn small" type="button" data-act="calMois" data-m="${ym(next)}" aria-label="Mois suivant">→</button>
      ${CAL.mois !== today.slice(0, 7) ? `<button class="btn small" type="button" data-act="calMois" data-m="${today.slice(0, 7)}">Aujourd'hui</button>` : ''}</div>
      <div class="row"><span class="hint">${ps.map((p) => `${esc(p.nom)} ${fmtH(tm[p.k] || 0)} h`).join(' · ')}</span><button class="btn primary small" type="button" data-act="evEdit" data-date="${CAL.mois === today.slice(0, 7) ? today : premier}">+ Événement</button></div></div>
    <div class="chips">${legend}</div>
    <div class="cal"><div class="cal-h">${JOURS.map((j) => `<span>${j.slice(0, 3)}</span>`).join('')}</div><div class="cal-g">${cells}</div></div>
    <p class="hint">Touche un jour pour y saisir les heures, voir le détail ou ajouter un événement (journée de travail, récolte, livraison, vacances…).</p>
  </div>`;
}
ACTIONS.calMois = (el) => { CAL.mois = el.dataset.m; render(); };
/* ---------- Calendrier : vue Mois ou Semaine ---------- */
try { CAL.vue = ls.get('gdt-cal-vue') || 'mois'; } catch (e) { CAL.vue = 'mois'; }
const vueCalHtml = () => `<div class="seg-mini" role="group" aria-label="Vue"><button type="button" class="${CAL.vue !== 'semaine' ? 'on' : ''}" data-act="calVue" data-v="mois">Mois</button><button type="button" class="${CAL.vue === 'semaine' ? 'on' : ''}" data-act="calVue" data-v="semaine">Semaine</button></div>`;
ACTIONS.calVue = (el) => { CAL.vue = el.dataset.v; ls.set('gdt-cal-vue', CAL.vue); render(); };
ACTIONS.calSem = (el) => { const n = Number(el.dataset.n); CAL.lundi = n === 0 ? lundiDe(todayISO()) : addDays(CAL.lundi || lundiDe(todayISO()), n); render(); };
/* Une journée de travail s'ouvre en vue « journée » ; les autres événements, dans leur fiche */
const evClic = (x) => evGenre(DB.get(x.key) || {}).genre === 'travail' ? `data-act="plJourneeVoir" data-j="${esc(x.key + '|' + x.occ)}"` : `data-act="evEdit" data-key="${esc(x.key)}"`;
function renderSemaineCal() {
  const today = todayISO(); if (!CAL.lundi) CAL.lundi = lundiDe(today);
  const l = CAL.lundi, fin = addDays(l, 6), items = itemsPeriode(l, fin), L = CAL.calques, ps = personnes(), w = semaineISO(l);
  const ini = (k) => (nomDe(k) || '?').slice(0, 2);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(l, i)).map((d, i) => {
    const xs = items[d] || [];
    const evs = L.evenements ? xs.filter((x) => x.kind === 'ev').sort((a, b) => String(a.heure || '99').localeCompare(String(b.heure || '99'))) : [];
    const ts = L.taches ? xs.filter((x) => x.kind === 'tache' && !x.journee) : [], ech = L.taches ? xs.filter((x) => x.kind === 'echeance') : [];
    const fac = L.factures ? xs.filter((x) => x.kind === 'facture') : [], rel = L.relances ? xs.filter((x) => x.kind === 'relance') : [];
    const hs = L.heures ? xs.filter((x) => x.kind === 'heures' && (x.heures > 0 || x.off)) : [];
    return `<div class="sem-j${d === today ? ' today' : ''}${i >= 5 ? ' we' : ''}">
      <button type="button" class="sem-tete" data-act="plJourVoir" data-d="${d}"><b>${JOURS[i]}</b> ${fmtDateCourt(d)}</button>
      ${evs.map((x) => { const nt = taches().filter((t) => t.journee === x.key + '|' + x.occ && t.statut !== 'termine').length; return `<button type="button" class="sem-ev${x.fait ? ' fait' : ''}" style="--c:${esc(x.couleur)}" ${evClic(x)}>${x.heure ? `<span class="num">${esc(x.heure)}</span> ` : ''}<b>${esc(x.titre)}</b>${x.qui ? `<span class="hint"> · ${esc(quiLabel(x.qui))}</span>` : ''}${nt ? `<span class="sem-nb">☑ ${nt}</span>` : ''}</button>`; }).join('')}
      ${ts.map((x) => `<button type="button" class="sem-ta" data-act="taVoir" data-key="${esc(x.key)}">☐ ${esc(x.titre)}</button>`).join('')}
      ${ech.map((x) => `<button type="button" class="sem-ta ech" data-act="taVoir" data-key="${esc(x.key)}">⏰ ${esc(x.titre)}</button>`).join('')}
      ${fac.map((x) => `<button type="button" class="sem-ta" data-act="go" data-href="#/factures/voir/${encodeURIComponent(x.key)}">🧾 ${esc(x.titre)}</button>`).join('')}
      ${rel.map((x) => `<button type="button" class="sem-ta" data-act="go" data-href="#/contacts/prospect/${encodeURIComponent(x.key)}">☎ ${esc(x.titre)}</button>`).join('')}
      ${hs.length ? `<div class="sem-h">${hs.map((x) => `<span>${esc(ini(x.personne))} ${x.off ? 'off' : fmtH(x.heures) + ' h'}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  const legend = [['heures', 'Heures'], ['evenements', 'Événements'], ['taches', 'Tâches et échéances'], ['factures', 'Factures'], ['relances', 'Relances']].map(([k, n]) => `<button type="button" class="chip${L[k] ? ' on' : ''}" data-act="calCalque" data-k="${k}">${n}</button>`).join('');
  const th = totalHeures(heuresToutes(), (h) => h.date >= l && h.date <= fin);
  return `<div class="panel"><div class="row">${vueCalHtml()}</div>
    <div class="between"><div class="row"><button class="btn small" type="button" data-act="calSem" data-n="-7" aria-label="Semaine précédente">←</button><h2 style="min-width:9ch">Semaine ${w.semaine}</h2><button class="btn small" type="button" data-act="calSem" data-n="7" aria-label="Semaine suivante">→</button>
      ${l !== lundiDe(today) ? '<button class="btn small" type="button" data-act="calSem" data-n="0">Cette semaine</button>' : ''}</div>
      <div class="row"><span class="hint">${fmtDateCourt(l)} – ${fmtDate(fin)} · ${ps.map((p) => `${esc(p.nom)} ${fmtH(th[p.k] || 0)} h`).join(' · ')}</span><button class="btn primary small" type="button" data-act="evEdit" data-date="${l <= today && today <= fin ? today : l}">+ Événement</button></div></div>
    <div class="chips">${legend}</div>
    <div class="sem">${jours}</div>
    <p class="hint">Touche un jour pour l'ouvrir (tâches, ajout), une journée de travail pour voir ses tâches.</p></div>`;
}
ACTIONS.calCalque = (el) => { CAL.calques[el.dataset.k] = !CAL.calques[el.dataset.k]; ls.set('gdt-cal-calques', JSON.stringify(CAL.calques)); render(); };

/* ---------- Fiche d'un jour ---------- */
ACTIONS.calDay = (el) => ouvrirJour(el.dataset.d);
function ouvrirJour(d) {
  const xs = itemsPeriode(d, d)[d] || [], ps = personnes(), j = DB.get('jour:' + d) || {};
  const evs = xs.filter((x) => x.kind === 'ev'), tch = xs.filter((x) => x.kind === 'tache'), fac = xs.filter((x) => x.kind === 'facture'), rel = xs.filter((x) => x.kind === 'relance');
  const heures = heuresGrilleHtml(d, '', true);
  const evHtml = evs.map((x) => {
    const e = DB.get(x.key) || {}, st = (e.occ || {})[x.occ] || {}, rec = e.rec && e.rec.freq;
    const c = e.contactId && DB.get(e.contactId), cu = e.cultureId && DB.get(e.cultureId);
    const det = [e.heureDebut ? e.heureDebut + (e.heureFin ? '–' + e.heureFin : '') : '', quiLabel(e.qui), c ? displayName(c) : '', cu ? cu.nom : '', rec ? (RECS.find((r) => r[0] === rec) || [, ''])[1].toLowerCase() : '', x.multi ? `du ${fmtDateCourt(x.occ)} au ${fmtDateCourt(addDays(x.occ, Math.round((new Date((e.fin || e.date) + 'T12:00') - new Date(e.date + 'T12:00')) / 864e5)))}` : ''].filter(Boolean).join(' · ');
    const ce = catEv(e), tj = taches().filter((t) => t.journee === x.key + '|' + x.occ);
    return `<div class="evline" style="--c:${couleurEv(e, x.occ, x.key)}"><div class="between"><div><strong>${esc(x.titre)}</strong><br><span class="hint">${esc(iconeEv(e) + ' ' + evGenre(e).nom)}${det ? ' · ' + esc(det) : ''}</span></div>
      <label class="row" style="font-size:14px"><input type="checkbox" data-fait="${esc(x.key)}|${x.occ}"${st.fait ? ' checked' : ''}> Fait</label></div>
      ${e.type === 'recolte' ? (() => { const kg = typeof recolteDeLEvenement === 'function' ? recolteDeLEvenement(x.key, x.occ) : 0; return kg ? `<p class="hint">✓ Récolte enregistrée : ${esc(fmtNum(kg, 1))} kg.</p>` : st.sansRecolte ? '<p class="hint">Pas de récolte ce jour-là.</p>' : `<div class="row"><button class="btn small primary" type="button" data-act="recolteEv" data-key="${esc(x.key)}" data-occ="${x.occ}">Enregistrer la récolte</button></div>`; })() : ''}
      ${e.remarque ? `<p class="hint" style="white-space:pre-wrap">${esc(e.remarque)}</p>` : ''}
      ${tj.length ? `<div class="ev-taches">${tj.map((t) => tacheHtml(t, { sansDate: true, court: true })).join('')}</div>` : ''}
      <div class="row">${ce.cat !== 'conge' ? `<button class="btn small" type="button" data-act="plJournee" data-j="${esc(x.key + '|' + x.occ)}">☑ Tâches de la journée${tj.length ? ' · ' + tj.length : ''}</button>` : ''}${e.type === 'livraison' && e.contactId ? `<button class="btn small primary" type="button" data-act="evFacturer" data-key="${esc(x.key)}" data-occ="${x.occ}">Créer la facture</button>` : ''}
        <button class="btn small" type="button" data-act="evEdit" data-key="${esc(x.key)}">Modifier</button>
        ${rec ? `<button class="btn small" type="button" data-act="evSauter" data-key="${esc(x.key)}" data-occ="${x.occ}">Annuler ce jour-là</button>` : ''}
        <button class="btn small danger" type="button" data-act="delItem" data-key="${esc(x.key)}" data-what="${rec ? 'toute la série' : 'cet événement'}">Supprimer${rec ? ' la série' : ''}</button></div></div>`;
  }).join('');
  openSheet(`${sheetHead(dateLongue(d).replace(/^./, (c) => c.toUpperCase()), 'Semaine ' + semaineISO(d).semaine)}<div class="sbody" id="jour-sheet">
    <h3>Heures travaillées</h3>${heures}
    ${fld('jr-rem', 'Remarque du jour', `<input id="jr-rem" data-jour="${d}" value="${esc(j.remarque || '')}" placeholder="Ex. Journée au champ ensemble">`)}
    <div class="between"><h3>Événements</h3><button class="btn small primary" type="button" data-act="evEdit" data-date="${d}">+ Événement</button></div>
    ${evHtml || '<p class="hint">Aucun événement ce jour.</p>'}
    ${tch.filter((x) => !x.journee).length ? `<h3>Tâches de ce jour</h3>${tch.filter((x) => !x.journee).map((x) => tacheHtml(tacheParCle(x.key) || {}, { sansDate: true, court: true })).join('')}` : ''}
    <div class="row"><button class="btn small" type="button" data-act="taNouvelle" data-date="${d}">+ Tâche pour ce jour</button></div>
    ${rel.length ? `<h3>Relances prospection</h3>${rel.map((r) => `<a class="item" href="#/contacts/prospect/${encodeURIComponent(r.key)}"><span class="who"><strong>${esc(r.titre)}</strong></span></a>`).join('')}` : ''}
    ${fac.length ? `<h3>Factures à échéance</h3>${fac.map((f) => `<a class="item" href="#/factures/voir/${encodeURIComponent(f.key)}"><span class="who"><strong>${esc(f.titre)}</strong></span><span class="amt">${chf(f.montant)}</span></a>`).join('')}` : ''}
  </div>`);
  const sh = $('jour-sheet'); brancherHeures(sh);
  sh.querySelectorAll('input[data-fait]').forEach((el) => el.addEventListener('change', () => {
    const [k, occ] = el.dataset.fait.split('|'); const e = DB.get(k); if (!e) return;
    const o = Object.assign({}, e, { occ: Object.assign({}, e.occ || {}) });
    o.occ[occ] = Object.assign({}, o.occ[occ] || {}, { fait: el.checked }); DB.put(k, o);
  }));
}
ACTIONS.evSauter = (el) => {
  const e = DB.get(el.dataset.key); if (!e) return;
  DB.put(el.dataset.key, Object.assign({}, e, { exceptions: [...new Set((e.exceptions || []).concat([el.dataset.occ]))] }));
  closeSheet(); toast(`Annulé pour le ${fmtDate(el.dataset.occ)} (la série continue).`);
};
ACTIONS.evFacturer = (el) => {
  const e = DB.get(el.dataset.key); if (!e) return;
  draftF.livraison = el.dataset.occ; draftF.date = todayISO();
  closeSheet(); go('#/factures/nouvelle/' + encodeURIComponent(e.contactId));
};
/* Le bouton off peut être dans la fiche du jour : on la rafraîchit */
const _hOff = (el) => {
  const k = hKey(el.dataset.d, el.dataset.p), old = DB.get(k) || { date: el.dataset.d, personne: el.dataset.p };
  const o = Object.assign({}, old, { off: !old.off });
  if (!o.heures && !o.off && !o.note) DB.del(k); else DB.put(k, o);
  if (el.dataset.sheet) { el.classList.toggle('on', !!o.off); el.setAttribute('aria-pressed', String(!!o.off)); }
};
ACTIONS.hOff = _hOff;

/* ---------- Formulaire d'événement ----------
   Un événement, c'est du travail, un congé, ou autre chose. Ce qu'on fait pendant une journée de travail (récolte,
   livraison…) et sa catégorie, ce sont ses tâches. Les anciens événements « récolte », « livraison », « marché »
   gardent leur type (et leur culture / client) tant qu'on ne les passe pas en Congé ou Autre. */
const EVF = { genre: 'travail', type: 'travail', ancien: '', sondage: '', qui: [] };
const EV_CHAMPS = { titre: ['travail', 'recolte', 'livraison', 'vente', 'autre'], heures: ['travail', 'recolte', 'livraison', 'vente', 'autre'], contact: [], culture: [], rep: ['travail', 'recolte', 'livraison', 'vente', 'autre'] };
function evFormHtml() {
  return `<div class="seg ev-genre">${[['travail', '🧰 Travail'], ['conge', '🏖️ Congé'], ['autre', '📌 Autre']].map(([k, n]) => `<button type="button" class="${EVF.genre === k ? 'on' : ''}" data-act="evGenre" data-g="${k}">${n}</button>`).join('')}</div>`;
}
function majEvForm() {
  const f = $('ev-form'); if (!f) return; const t = EVF.type;
  $('ev-choix').innerHTML = evFormHtml(); f.querySelector('input[name=type]').value = t;
  for (const [bloc, types] of Object.entries(EV_CHAMPS)) f.querySelectorAll(`[data-bloc="${bloc}"]`).forEach((x) => { x.hidden = !types.includes(t); });
  const titre = $('ev-titre'); if (titre) { titre.required = t === 'autre'; titre.placeholder = t === 'autre' ? 'Ex. Formation, rendez-vous banque…' : 'Facultatif : sinon « Journée de travail » (ex. Journée au champ, Marché de Fribourg)'; }
  const lt = f.querySelector('label[for="ev-titre"]'); if (lt) lt.textContent = t === 'autre' ? 'Titre (obligatoire)' : 'Titre';
  const ld = f.querySelector('label[for="ev-date"]'), lf = f.querySelector('label[for="ev-fin"]'); if (ld) ld.textContent = t === 'vacances' ? 'Du' : 'Date'; if (lf) lf.textContent = t === 'vacances' ? 'Au (facultatif)' : "Jusqu'au (plusieurs jours)";
  majQuiEv();
}
/* Qui : Ensemble / Moi / Noé / Marc — on peut en choisir plusieurs (journée à deux) */
function quiBoutonsHtml() {
  const ps = personnes(), moi = ps.find((p) => p.k === Sync.me), ordre = moi ? [moi].concat(ps.filter((p) => p !== moi)) : ps;
  const tous = ps.every((p) => EVF.qui.includes(p.k));
  return `<button type="button" class="${tous ? 'on' : ''}" data-act="evQui" data-k="ensemble" aria-pressed="${tous}">Ensemble</button>` +
    ordre.map((p) => { const on = !tous && EVF.qui.includes(p.k); return `<button type="button" class="${on ? 'on' : ''}" data-act="evQui" data-k="${esc(p.k)}" aria-pressed="${on}">${p.k === Sync.me ? 'Moi' : esc(p.nom)}</button>`; }).join('');
}
function majQuiEv() {
  const b = $('ev-qui-b'), h = $('ev-qui'); if (!b || !h) return;
  b.innerHTML = quiBoutonsHtml(); h.value = quiDeListe(EVF.qui);
  const lab = $('ev-qui-l'); if (lab) lab.textContent = EVF.type === 'vacances' ? 'Congé de' : 'Qui';
}
ACTIONS.evQui = (el) => {
  const k = el.dataset.k, ps = personnes().map((p) => p.k), tous = ps.every((x) => EVF.qui.includes(x));
  if (k === 'ensemble') EVF.qui = ps.slice();
  else if (tous) EVF.qui = [k];                                   /* depuis « Ensemble », un clic choisit cette personne seule */
  else EVF.qui = EVF.qui.includes(k) ? EVF.qui.filter((x) => x !== k) : EVF.qui.concat([k]);
  majQuiEv();
};
ACTIONS.evGenre = (el) => { EVF.genre = el.dataset.g; EVF.type = EVF.genre === 'conge' ? 'vacances' : EVF.genre === 'autre' ? 'autre' : EVF.ancien || 'travail'; majEvForm(); };
ACTIONS.evEdit = (el) => {
  const k = el.dataset.key || '', e = k ? DB.get(k) : { type: 'travail', titre: el.dataset.titre || '', date: el.dataset.date || todayISO(), qui: 'ensemble', rec: { freq: '' } };
  if (!el.dataset.titre) EVF.sondage = '';
  EVF.type = EV_GENRES[e.type] ? e.type : 'autre'; EVF.genre = evGenre(e).genre; EVF.qui = quiListe(e.qui || (k ? '' : 'ensemble'));
  if (k && !e.qui) EVF.qui = []; EVF.ancien = ['recolte', 'livraison', 'vente'].includes(e.type) ? e.type : '';
  openSheet(`${sheetHead(k ? 'Modifier l\'événement' : 'Nouvel événement', k && e.rec && e.rec.freq ? 'Modifie toute la série' : '')}<form class="sbody form" data-form="ev" id="ev-form"><input type="hidden" name="key" value="${esc(k)}"><input type="hidden" name="type" value="${esc(EVF.type)}">
    <div id="ev-choix">${evFormHtml()}</div>
    <div data-bloc="titre">${inp('ev-titre', 'Titre', e.titre, { name: 'titre' })}</div>
    <div class="grid2">${inp('ev-date', 'Date', e.date, { name: 'date', type: 'date', req: true })}${inp('ev-fin', "Jusqu'au (plusieurs jours)", e.fin, { name: 'fin', type: 'date' })}</div>
    <div class="grid2" data-bloc="heures">${inp('ev-hd', 'Heure de début', e.heureDebut, { name: 'heureDebut', type: 'time' })}${inp('ev-hf', 'Heure de fin', e.heureFin, { name: 'heureFin', type: 'time' })}</div>
    <div class="field"><span class="flabel" id="ev-qui-l">Qui</span><input type="hidden" name="qui" id="ev-qui"><div class="seg ev-qui" id="ev-qui-b" role="group" aria-labelledby="ev-qui-l"></div></div>
    <details data-bloc="rep"${e.rec && e.rec.freq ? ' open' : ''}><summary class="hint" style="cursor:pointer">↻ Répétition</summary><div class="grid2">${sel('ev-rec', 'Se répète', (e.rec && e.rec.freq) || '', RECS, { name: 'freq' })}${inp('ev-jq', "Jusqu'au", e.rec && e.rec.jusquau, { name: 'jusquau', type: 'date', sub: 'Vide : sans fin.' })}</div></details>
    ${txt('ev-rem', 'Remarque', e.remarque, { name: 'remarque', rows: 2 })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="${e.rec && e.rec.freq ? 'toute la série' : 'cet événement'}">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  majEvForm();
};
FORMS.ev = (v) => {
  const t = EV_GENRES[v.type] ? v.type : 'autre', champ = (b) => EV_CHAMPS[b].includes(t);
  if (!v.date) { toast('La date est obligatoire.'); return; }
  if (v.fin && v.fin < v.date) { toast('La date de fin est avant le début.'); return; }
  if (t === 'autre' && !String(v.titre || '').trim()) { toast('Donne un titre à cet événement.'); $('ev-titre').focus(); return; }
  if (t === 'vacances' && !v.qui) { toast('Indique pour qui est le congé.'); return; }
  const k = v.key || 'ev:' + uid('e'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '', occ: {}, exceptions: [] };
  const o = Object.assign({}, old, { type: t, titre: champ('titre') ? v.titre : '', date: v.date, fin: v.fin && v.fin > v.date ? v.fin : '', heureDebut: champ('heures') ? v.heureDebut : '', heureFin: champ('heures') ? v.heureFin : '', qui: v.qui,
    contactId: EVF.ancien && t === EVF.ancien ? old.contactId || '' : '', cultureId: EVF.ancien && t === EVF.ancien ? old.cultureId || '' : '', remarque: v.remarque, rec: champ('rep') ? { freq: v.freq, jusquau: v.freq ? v.jusquau : '' } : { freq: '' } });
  delete o.cat; delete o.sous;
  DB.put(k, o); closeSheet();
  if (EVF.sondage && !v.key) { const m = DB.get(EVF.sondage); if (m) DB.put(EVF.sondage, Object.assign({}, m, { evenement: k })); EVF.sondage = ''; } toast(v.key ? 'Événement mis à jour.' : 'Événement ajouté.');
};

/* ---------- Vue d'ensemble : les 14 prochains jours ----------
   Jour par jour : les événements en cartes, avec les tâches rattachées à chaque journée, puis les tâches prévues ce jour.
   À côté : « À planifier » (échéance proche d'abord, puis importance). Une tâche n'apparaît qu'à un seul endroit.
   Sur ordinateur : glisser une tâche sur un jour (lui donne cette date), sur une journée (l'y rattache) ou sur « À planifier ». */
const PL = { qui: '', jours: 14 };
const concerneMoi = (q) => !Sync.me || quiInclut(q, Sync.me);
function renderVue() {
  const today = todayISO(), fin = addDays(today, PL.jours - 1), items = itemsPeriode(today, fin);
  const pour = (q) => PL.qui !== 'moi' || concerneMoi(q);
  const aPlan = trierAPlanifier(taches().filter((t) => tacheOuverte(t) && !estPlanifiee(t) && pour(t.responsable)));
  const ev = (x, d) => {
    const e = DB.get(x.key) || {}, ce = catEv(e), j = x.key + '|' + x.occ, tj = taches().filter((t) => t.journee === j && t.statut !== 'suspendu');
    const fort = d === today && concerneMoi(x.qui) && !x.fait && !(Sync.me && heuresNotees(d, Sync.me));
    const cu = e.cultureId && DB.get(e.cultureId), c = e.contactId && DB.get(e.contactId);
    const det = [x.heure ? x.heure + (e.heureFin ? '–' + e.heureFin : '') : '', x.qui ? quiLabel(x.qui) : '', c && !x.titre.includes(displayName(c)) ? displayName(c) : '', cu && !x.titre.includes(cu.nom) ? cu.nom : ''].filter(Boolean).join(' · ');
    const rec = e.type === 'recolte' && d <= today && typeof recolteDeLEvenement === 'function' && !recolteDeLEvenement(x.key, x.occ) && !((e.occ || {})[x.occ] || {}).sansRecolte;
    return `<div class="pl-ev${fort ? ' fort' : ''}${x.fait ? ' fait' : ''}" style="--c:${esc(x.couleur)}" data-journee="${esc(j)}">
      <div class="pl-ev-h" data-act="plJourneeVoir" data-j="${esc(j)}" role="button" tabindex="0" title="Ouvrir la journée"><span class="pl-ev-t">${esc(iconeEv(e))} <b>${esc(x.titre)}</b>${x.multi ? ' <span class="hint">(plusieurs jours)</span>' : ''}</span>${det ? `<span class="pl-ev-d">${esc(det)}</span>` : ''}</div>
      ${tj.length ? `<div class="pl-ev-nb" data-act="plJourneeVoir" data-j="${esc(j)}" role="button" tabindex="0">☑ ${tj.filter((t) => t.statut !== 'termine').length} tâche${tj.filter((t) => t.statut !== 'termine').length > 1 ? 's' : ''} prévue${tj.filter((t) => t.statut !== 'termine').length > 1 ? 's' : ''}${tj.some((t) => t.statut === 'termine') ? ` · ${tj.filter((t) => t.statut === 'termine').length} faite${tj.filter((t) => t.statut === 'termine').length > 1 ? 's' : ''}` : ''} ›</div>` : ''}
      ${rec ? `<div class="row pl-ev-act"><button class="btn small primary" type="button" data-act="recolteEv" data-key="${esc(x.key)}" data-occ="${x.occ}">Enregistrer la récolte</button></div>` : ''}</div>`;
  };
  let jours = '';
  for (let d = today; d <= fin; d = addDays(d, 1)) {
    const xs = (items[d] || []).filter((x) => x.kind !== 'heures' && (x.kind === 'tache' || x.kind === 'facture' || pour(x.qui)));
    const evs = xs.filter((x) => x.kind === 'ev' && (x.debut || d === today) && pour(x.qui)).sort((a, b) => String(a.heure || '99').localeCompare(String(b.heure || '99')));
    const ts = xs.filter((x) => x.kind === 'tache' && !x.journee).map((x) => tacheParCle(x.key)).filter((t) => t && pour(t.responsable)).sort(triOrdre);
    const autres = xs.filter((x) => x.kind === 'facture' || x.kind === 'relance');
    const vide = !evs.length && !ts.length && !autres.length;
    /* Jour vide : caché (il n'apparaît que pendant qu'on glisse une tâche, pour pouvoir l'y déposer) */
    if (vide && d !== today) { jours += `<div class="pl-jour vide" data-jour="${d}"><span class="pl-date">${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)}</span><span class="hint">déposer ici</span></div>`; continue; }
    jours += `<div class="pl-jour${d === today ? ' auj' : ''}" data-jour="${d}">
      <div class="between pl-jour-h"><button type="button" class="pl-date" data-act="plJourVoir" data-d="${d}" title="Ouvrir le jour"><b>${d === today ? "Aujourd'hui" : d === addDays(today, 1) ? 'Demain' : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7]}</b> ${fmtDateCourt(d)}</button></div>
      ${evs.map((x) => ev(x, d)).join('')}
      ${ts.length ? `<div class="pl-taches tri-taches">${ts.map((t) => tacheHtml(t, { sansDate: true, court: true, tri: ts.length > 1 })).join('')}</div>` : ''}
      ${autres.map((x) => `<div class="agit clic" style="--c:${x.kind === 'facture' ? 'var(--c-factures)' : 'var(--c-contacts)'}" data-act="go" data-href="${x.kind === 'facture' ? '#/factures/voir/' : '#/contacts/prospect/'}${encodeURIComponent(x.key)}" role="button" tabindex="0">${esc(x.titre)}${x.montant ? ` <span class="num">${chf(x.montant)}</span>` : ''}</div>`).join('')}
      ${vide ? '<p class="hint" style="margin:0">Rien de prévu.</p>' : ''}</div>`;
  }
  const plan = listeAPlanifierHtml(aPlan, { court: true, vide: 'Tout est planifié. 👌' });
  const quiChips = Sync.me ? `<div class="seg-mini" role="group" aria-label="Afficher"><button type="button" class="${PL.qui === 'moi' ? 'on' : ''}" data-act="plQui" data-v="moi">Pour moi</button><button type="button" class="${PL.qui !== 'moi' ? 'on' : ''}" data-act="plQui" data-v="">Tout le monde</button></div>` : '';
  return `<div class="pl-cols"><div class="panel"><div class="between"><div class="row">${quiChips}</div><div class="row"><button class="btn small" type="button" data-act="icsSheet">📅 Dans mon agenda</button><button class="btn primary small" type="button" data-act="evEdit" data-date="${today}">+ Événement</button></div></div>
      <div class="pl-jours">${jours}</div>
      <div class="row"><button class="btn link" type="button" data-act="plAutreJour">+ Prévoir un autre jour…</button>${PL.jours < 42 ? `<button class="btn link" type="button" data-act="plPlus">Voir plus loin</button>` : ''}</div></div>
    <div class="panel pl-aplan" data-jour=""><div class="between"><h2>À planifier${aPlan.length ? ' · ' + aPlan.length : ''}</h2></div>
      ${ajoutTacheBarre({ id: 'pl-aplan-ajout' })}
      ${plan}
      <p class="hint pl-aide">Touche une tâche pour la planifier. Sur ordinateur, tu peux aussi la glisser sur un jour ou sur une journée.</p></div></div>`;
}
/* ---------- Journée en cours (accueil) ----------
   Une journée de travail où je suis inscrit : ouverte d'office sur l'accueil (tâches à cocher), avec
   « Terminer la journée et enregistrer mes heures ». Une journée passée reste tant que mes heures ne sont pas notées
   (par moi ou par quelqu'un d'autre), au plus 7 jours. ✕ la replie en bouton. */
const heuresNotees = (d, p) => { const h = p && DB.get(hKey(d, p)); return !!(h && (num(h.heures) > 0 || h.off)); };
function journeesEnCours() {
  const today = todayISO(), de = addDays(today, -6), it = itemsPeriode(de, today), out = [], vus = new Set();
  for (let d = today; d >= de; d = addDays(d, -1)) for (const x of it[d] || []) {
    if (x.kind !== 'ev' || !concerneMoi(x.qui) || evGenre(DB.get(x.key) || {}).genre !== 'travail') continue;
    const j = x.key + '|' + x.occ, id = j + '@' + d; if (vus.has(id)) continue; vus.add(id);
    /* Mes heures notées : la journée est terminée, elle n'est plus mise en avant */
    if (Sync.me ? heuresNotees(d, Sync.me) : d < today) continue;
    out.push({ j, d, id, titre: x.titre, couleur: x.couleur, heure: x.heure });
  }
  return out;
}
const ICONE_REGLAGES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h3.4M11.1 6.5h9.4M3.5 12h9.9M17.6 12h2.9M3.5 17.5h1.4M9.1 17.5h11.4"/><circle cx="9" cy="6.5" r="2.1"/><circle cx="15.5" cy="12" r="2.1"/><circle cx="7" cy="17.5" r="2.1"/></svg>';
const jcFermees = () => { try { return JSON.parse(ls.get('gdt-jc-fermees') || '[]'); } catch (e) { return []; } };
const jcOuverte = (x) => !jcFermees().includes(x.id);
ACTIONS.jcOuvrir = (el) => { ls.set('gdt-jc-fermees', JSON.stringify(jcFermees().filter((i) => i !== el.dataset.id))); render(); };
ACTIONS.jcFermer = (el) => { const ids = new Set(journeesEnCours().map((x) => x.id)); ls.set('gdt-jc-fermees', JSON.stringify(jcFermees().filter((i) => ids.has(i)).concat([el.dataset.id]))); render(); };
/* Le bouton qui reste tant que mes heures ne sont pas notées ; ensuite, un rappel de ce qui est noté */
function terminerJourneeHtml(j, d) {
  if (d > todayISO()) return '';
  const e = DB.get(j.split('|')[0]) || {}, moi = Sync.me && quiInclut(e.qui, Sync.me);
  if (moi && !heuresNotees(d, Sync.me)) return `<div class="row"><button class="btn primary big jc-fin" type="button" data-act="heuresJour" data-d="${d}" data-j="${esc(j)}">Terminer la journée et enregistrer mes heures</button></div>`;
  const notes = quiListe(e.qui).map((p) => [p, DB.get(hKey(d, p)) || {}]).filter(([, h]) => num(h.heures) > 0 || h.off);
  return `<div class="row jc-fait"><span>${notes.length ? '✓ ' + notes.map(([p, h]) => `${esc(p === Sync.me ? 'Toi' : nomDe(p))} ${h.off ? 'off' : fmtH(h.heures) + ' h'}`).join(' · ') : 'Heures pas encore notées.'}</span>
    <button class="btn link small" type="button" data-act="heuresJour" data-d="${d}" data-j="${esc(j)}">${notes.length ? 'Modifier les heures' : 'Noter les heures'}</button></div>`;
}
function journeeEnCoursHtml() {
  /* Repliée : une barre de la même largeur ; un clic la rouvre. Ouverte : un clic sur le haut (ou ✕) la replie. */
  return journeesEnCours().map((x) => {
    if (!jcOuverte(x)) return `<button class="btn big jc-btn" type="button" data-act="jcOuvrir" data-id="${esc(x.id)}" style="--c:${esc(x.couleur)}" aria-expanded="false"><span>🧰 ${esc(x.titre)} <small>${x.d === todayISO() ? 'en cours' : esc(fmtDateCourt(x.d))}</small></span><span class="icone-btn jc-tri" aria-hidden="true">▾</span></button>`;
    const { j, d } = x, [ek] = j.split('|'), e = DB.get(ek); if (!e) return '';
    const tj = taches().filter((t) => t.journee === j).sort(triOrdre), faites = tj.filter((t) => t.statut === 'termine').length;
    const quand = d === todayISO() ? "aujourd'hui" : dateLongue(d);
    return `<section class="panel jc" style="--c:${esc(couleurEv(e, j.split('|')[1], ek))}">
      <span class="jc-coin"><button class="icone-btn" type="button" data-act="evEdit" data-key="${esc(ek)}" title="Modifier la journée" aria-label="Modifier la journée">${ICONE_REGLAGES}</button><button class="icone-btn jc-tri" type="button" data-act="jcFermer" data-id="${esc(x.id)}" title="Replier" aria-label="Replier la journée" aria-expanded="true">▴</button></span>
      <h2 class="jc-tete" data-act="jcFermer" data-id="${esc(x.id)}" role="button" tabindex="0" aria-expanded="true" title="Replier">${esc(iconeEv(e))} ${esc(titreEv(e))} <small class="hint">${esc(quand)}${e.heureDebut ? ' · ' + esc(e.heureDebut) + (e.heureFin ? '–' + esc(e.heureFin) : '') : ''}${e.qui ? ' · ' + esc(quiLabel(e.qui)) : ''}${tj.length ? ` · ${faites}/${tj.length} faites` : ''}</small></h2>
      ${e.remarque ? `<p class="pl-rem">${linkify(e.remarque)}</p>` : ''}
      ${tj.length ? `<div class="tri-taches">${tj.map((t) => tacheHtml(t, { court: true, sansDate: true, tri: true })).join('')}</div>` : '<p class="hint">Pas encore de tâche pour cette journée.</p>'}
      ${ajoutTacheBarre({ id: 'jc-ajout-' + x.id.replace(/[^\w-]/g, ''), journee: j, placeholder: 'Ajouter une tâche à la journée…' })}
      ${terminerJourneeHtml(j, d)}</section>`;
  }).join('');
}
/* Un jour sans rien : le choisir, puis y mettre une tâche ou un événement */
ACTIONS.plAutreJour = () => {
  openSheet(`${sheetHead('Prévoir un autre jour')}<div class="sbody form">${inp('pa-d', 'Jour', addDays(todayISO(), 1), { type: 'date' })}
    <div class="row-end"><button class="btn primary" type="button" data-act="plAutreJourOk">Ouvrir ce jour</button></div></div>`);
};
ACTIONS.plAutreJourOk = () => { const d = ($('pa-d') || {}).value; if (!d) return; ACTIONS.plJourVoir({ dataset: { d } }); };

/* ---------- Vues simplifiées (fenêtres) : un jour, une journée prévue ----------
   On y coche les tâches, on en ajoute ; « Modifier » ouvre la fiche complète. */
PL.rafraichir = null;
/* « Fermer » sur une fenêtre ouverte depuis une journée (ou un jour) ramène à cette journée ; fermer la journée elle-même ferme tout */
(() => {
  const fermer = ACTIONS.close;
  ACTIONS.close = (el) => {
    const ouverte = document.body.classList.contains('sheet-open'), racine = !!$('sheet').querySelector('[data-vue-racine]');
    if (ouverte && PL.rafraichir && !racine) { PL.rafraichir(); return; }
    if (racine) PL.rafraichir = null;
    fermer(el);
  };
  /* Toutes les fenêtres fermées (enregistrement, etc.) : on oublie la journée d'où l'on venait */
  new MutationObserver(() => { if ($('scrim').hidden) setTimeout(() => { if ($('scrim').hidden) PL.rafraichir = null; }, 80); }).observe($('scrim'), { attributes: true, attributeFilter: ['hidden'] });
})();
const rafraichirFenetre = () => { if (PL.rafraichir && document.body.classList.contains('sheet-open')) PL.rafraichir(); };
const ajoutTacheHtml = (o) => ajoutTacheBarre({ id: 'pl-ajout', jour: o.jour, journee: o.journee, placeholder: `Nouvelle tâche${o.journee ? ' pour cette journée' : ' ce jour-là'}…` });
ACTIONS.plJourneeVoir = (el) => {
  const j = el.dataset.j, [ek, d] = j.split('|'), e = DB.get(ek); if (!e) return; const ce = catEv(e);
  PL.rafraichir = () => ACTIONS.plJourneeVoir({ dataset: { j } });
  const tj = taches().filter((t) => t.journee === j).sort(triOrdre);
  const cu = e.cultureId && DB.get(e.cultureId), c = e.contactId && DB.get(e.contactId);
  const det = [e.heureDebut ? e.heureDebut + (e.heureFin ? '–' + e.heureFin : '') : '', e.qui ? quiLabel(e.qui) : '', c ? displayName(c) : '', cu ? cu.nom : ''].filter(Boolean).join(' · ');
  const rec = e.type === 'recolte' && d <= todayISO() && typeof recolteDeLEvenement === 'function' && !recolteDeLEvenement(ek, d) && !((e.occ || {})[d] || {}).sansRecolte;
  const faites = tj.filter((t) => t.statut === 'termine').length;
  openSheet(`<div class="shead pl-tete" data-vue-racine style="--c:${esc(couleurEv(e, d, ek))}"><h2>${esc(iconeEv(e))} ${esc(titreEv(e))}<small>${esc(dateLongue(d))}${det ? ' · ' + esc(det) : ''}</small></h2><button type="button" class="xbtn" data-act="close" aria-label="Fermer">Fermer</button></div>
    <div class="sbody">
    ${e.remarque ? `<p class="pl-rem">${linkify(e.remarque)}</p>` : ''}
    ${rec ? `<div class="row"><button class="btn primary" type="button" data-act="recolteEv" data-key="${esc(ek)}" data-occ="${d}">Enregistrer la récolte</button></div>` : ''}
    <h3>Tâches${tj.length ? ` · ${faites}/${tj.length} faites` : ''}</h3>
    ${tj.length ? `<div class="tri-taches">${tj.map((t) => tacheHtml(t, { court: true, sansDate: true, tri: true })).join('')}</div>` : '<p class="hint">Aucune tâche pour cette journée.</p>'}
    ${ajoutTacheHtml({ journee: j })}
    ${ce.cat !== 'conge' ? terminerJourneeHtml(j, d) : ''}
    <div class="row-end"><button class="btn" type="button" data-act="evEdit" data-key="${esc(ek)}">Modifier la journée</button></div></div>`);
};
ACTIONS.plJourVoir = (el) => {
  const d = el.dataset.d, today = todayISO(); PL.rafraichir = () => ACTIONS.plJourVoir({ dataset: { d } });
  const xs = itemsPeriode(d, d)[d] || [];
  const evs = xs.filter((x) => x.kind === 'ev').sort((a, b) => String(a.heure || '99').localeCompare(String(b.heure || '99')));
  const ts = xs.filter((x) => x.kind === 'tache' && !x.journee).map((x) => tacheParCle(x.key)).filter(Boolean)
    .concat(taches().filter((t) => t.statut === 'termine' && !t.journee && t.jour === d)).sort(triOrdre);
  openSheet(`${sheetHead((d === today ? "Aujourd'hui · " : '') + dateLongue(d).replace(/^./, (c) => c.toUpperCase()))}<div class="sbody" data-vue-racine>
    ${evs.length ? evs.map((x) => { const nt = taches().filter((t) => t.journee === x.key + '|' + x.occ && t.statut !== 'termine').length; return `<button type="button" class="pl-ev pl-ev-btn" style="--c:${esc(x.couleur)}" data-act="plJourneeVoir" data-j="${esc(x.key + '|' + x.occ)}"><span><b>${esc(x.titre)}</b>${x.heure ? ' · ' + esc(x.heure) : ''}${x.qui ? ' · ' + esc(quiLabel(x.qui)) : ''}</span>${nt ? `<span class="hint">${nt} tâche${nt > 1 ? 's' : ''} ›</span>` : '<span class="hint">›</span>'}</button>`; }).join('') : ''}
    <h3>Tâches de ce jour</h3>
    ${ts.length ? `<div class="tri-taches">${ts.map((t) => tacheHtml(t, { court: true, sansDate: true, tri: true })).join('')}</div>` : '<p class="hint">Aucune tâche prévue ce jour-là (hors journées).</p>'}
    ${ajoutTacheHtml({ jour: d })}
    <div class="row-end">${d <= today ? `<button class="btn" type="button" data-act="heuresJour" data-d="${d}">Noter les heures</button>` : ''}<button class="btn primary" type="button" data-act="evEdit" data-date="${d}">+ Événement</button></div></div>`);
};
ACTIONS.plQui = (el) => { PL.qui = el.dataset.v; ls.set('gdt-pl-qui', PL.qui); render(); };
ACTIONS.plPlus = () => { PL.jours += 14; render(); };
try { PL.qui = ls.get('gdt-pl-qui') ?? 'moi'; } catch (e) { PL.qui = 'moi'; }
/* Glisser une tâche (ordinateur) */
function brancherGlisserTaches(root) {
  if (!root || root._glisse) return; root._glisse = true;
  const T = 'application/x-gdt-tache';
  const cible = (e) => e.target.closest && (e.target.closest('[data-journee]') || e.target.closest('[data-jour]'));
  root.addEventListener('dragstart', (e) => { const t = e.target.closest && e.target.closest('[data-tache]'); if (!t) return; e.dataTransfer.setData(T, t.dataset.tache); e.dataTransfer.effectAllowed = 'move'; t.classList.add('glisse'); setTimeout(() => root.classList.add('glisse-tache'), 0); });
  root.addEventListener('dragend', () => { root.classList.remove('glisse-tache'); root.querySelectorAll('.glisse, .drop').forEach((x) => x.classList.remove('glisse', 'drop')); });
  root.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes(T)) return; const c = cible(e);
    root.querySelectorAll('.drop').forEach((x) => { if (x !== c) x.classList.remove('drop'); });
    if (!c) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; c.classList.add('drop');
  });
  root.addEventListener('drop', (e) => {
    if (![...e.dataTransfer.types].includes(T)) return; const c = cible(e); if (!c) return; e.preventDefault();
    const k = e.dataTransfer.getData(T), t = DB.get(k); root.classList.remove('glisse-tache'); root.querySelectorAll('.drop, .glisse').forEach((x) => x.classList.remove('drop', 'glisse')); if (!t) return;
    if (c.dataset.journee) { const [ek, d] = c.dataset.journee.split('|'); if (t.journee === c.dataset.journee) return; DB.put(k, Object.assign({}, t, { journee: c.dataset.journee, jour: '', ordre: ordreFin({ journee: c.dataset.journee }) })); toast(`« ${t.titre} » rattachée à ${titreEv(DB.get(ek) || {})} (${fmtDateCourt(d)}).`); }
    else { const d = c.dataset.jour; if (!t.journee && (t.jour || '') === (d || '')) return; DB.put(k, Object.assign({}, t, { jour: d, journee: '', ordre: d ? ordreFin({ jour: d }) : undefined })); toast(d ? `« ${t.titre} » pour le ${fmtDate(d)}.` : `« ${t.titre} » remise à planifier.`); }
  });
}
/* Les tâches d'une journée prévue : cocher celles à y faire (parmi les tâches ouvertes), ou en créer une */
ACTIONS.plJournee = (el) => {
  const j = el.dataset.j, [ek, d] = j.split('|'), e = DB.get(ek); if (!e) return; const ce = catEv(e);
  const ouv = trierAPlanifier(taches().filter((t) => tacheOuverte(t) && (t.journee === j || !estPlanifiee(t))));
  const rang = (t) => (t.journee === j ? 0 : catTache(t).cat === ce.cat ? 1 : !catTache(t).cat ? 2 : 3);
  const l = ouv.map((t, i) => [t, i]).sort((a, b) => rang(a[0]) - rang(b[0]) || a[1] - b[1]).map((x) => x[0]);
  openSheet(`${sheetHead('Tâches de la journée', `${titreEv(e)} · ${dateLongue(d)}`)}<form class="sbody form" data-form="plJournee"><input type="hidden" name="j" value="${esc(j)}">
    <div class="row"><input id="pj-new" placeholder="Nouvelle tâche pour cette journée…" style="flex:1" autocomplete="off"><button class="btn small" type="button" data-act="plJourneeNew">Ajouter</button></div>
    <div class="pj-liste">${l.length ? l.map((t) => { const c = catTache(t), dt = dateTache(t); return `<label class="row pj-it" style="--c:${esc(couleurCat(c.cat))}"><input type="checkbox" name="t" value="${esc(t.key)}"${t.journee === j ? ' checked' : ''}> <span style="flex:1"><b>${esc(t.titre)}</b> ${c.cat ? catPill(c.cat, c.sous, true) : ''}<br><span class="hint">${[IMPORTANCES[importanceDe(t) - 1][1], t.responsable ? nomDe(t.responsable) : '', t.echeance ? 'avant le ' + fmtDateCourt(t.echeance) : '', dt && t.journee !== j && estPlanifiee(t) ? 'prévue le ' + fmtDateCourt(dt) : ''].filter(Boolean).join(' · ')}</span></span></label>`; }).join('') : '<p class="empty">Aucune tâche ouverte.</p>'}</div>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const n = $('pj-new'); if (n) n.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ACTIONS.plJourneeNew(); } });
};
ACTIONS.plJourneeNew = () => {
  const n = $('pj-new'), f = n && n.closest('form'); if (!n || !n.value.trim() || !f) return; const j = f.querySelector('input[name=j]').value, e = DB.get(j.split('|')[0]) || {};
  const ce = catEv(e); DB.put('t:' + uid('t'), { titre: n.value.trim(), statut: 'afaire', importance: 2, cat: ce.cat === 'conge' ? '' : ce.cat, responsable: respDeQui(e.qui), journee: j, cultures: e.cultureId ? [e.cultureId] : [], cree: new Date().toISOString(), creePar: Sync.me || '' });
  ACTIONS.plJournee({ dataset: { j } }); toast('Tâche ajoutée à la journée.');
};
FORMS.plJournee = (v, form) => {
  const j = v.j, coches = new Set([...form.querySelectorAll('input[name=t]:checked')].map((x) => x.value));
  for (const t of taches()) {
    if (coches.has(t.key) && t.journee !== j) DB.put(t.key, Object.assign({}, t, { journee: j, jour: '', ordre: ordreFin({ journee: j }) }));
    else if (!coches.has(t.key) && t.journee === j) DB.put(t.key, Object.assign({}, t, { journee: '' }));
  }
  closeSheet(); toast(`${coches.size} tâche${coches.size > 1 ? 's' : ''} pour cette journée.`);
};

/* ---------- Heures : la semaine en lecture (un clic sur une case pour noter), puis le bilan de l'année ---------- */
function renderSemaineHeures() {
  if (!HEU.lundi) HEU.lundi = lundiDe(todayISO());
  const l = HEU.lundi, ps = personnes(), today = todayISO(), w = semaineISO(l), fin = addDays(l, 6);
  const items = itemsPeriode(l, fin);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(l, i));
  const tot = {}; ps.forEach((p) => { tot[p.k] = 0; });
  const rows = jours.map((d, i) => {
    const vac = (items[d] || []).filter((x) => x.kind === 'ev' && x.type === 'vacances');
    const cells = ps.map((p) => {
      const h = DB.get(hKey(d, p.k)) || {}; tot[p.k] += num(h.heures);
      const enVac = vac.some((x) => quiInclut(x.qui, p.k));
      const mien = p.k === Sync.me;
      const contenu = h.heures ? `<b>${fmtH(h.heures)} h</b>${h.note ? `<small>${esc(trunc(h.note, 34))}</small>` : ''}`
        : h.off ? '<span class="tag-off">off</span>' : enVac ? '<span class="tag-vac">vacances</span>' : `<span class="plus">${mien ? '+ noter' : '+'}</span>`;
      return `<td><button type="button" class="hbtn${h.heures ? ' full' : ''}${mien ? ' mien' : ''}" data-act="mesHeures" data-d="${d}" data-p="${p.k}" aria-label="Heures de ${esc(p.nom)} le ${fmtDate(d)}">${contenu}</button></td>`;
    }).join('');
    const j = DB.get('jour:' + d) || {};
    return `<tr class="${d === today ? 'today' : ''} ${i >= 5 ? 'we' : ''}"><td class="day"><button type="button" class="daybtn" data-act="calDay" data-d="${d}"><b>${JOURS[i]}</b><span>${fmtDateCourt(d)}</span></button>
        ${j.remarque ? `<span class="jrem">${esc(trunc(j.remarque, 40))}</span>` : ''}</td>${cells}</tr>`;
  }).join('');
  return `<div class="panel">
    <div class="between"><div class="row"><button class="btn small" type="button" data-act="hWeek" data-n="-7" aria-label="Semaine précédente">←</button>
      <h2>Semaine ${w.semaine}</h2><button class="btn small" type="button" data-act="hWeek" data-n="7" aria-label="Semaine suivante">→</button></div>
      <div class="row"><span class="hint">${fmtDate(l)} – ${fmtDate(fin)}</span>${l !== lundiDe(today) ? '<button class="btn small" type="button" data-act="hWeek" data-n="0">Cette semaine</button>' : ''}</div></div>
    <div class="table-wrap"><table class="week hweek"><thead><tr><th>Jour</th>${ps.map((p) => `<th>${esc(p.nom)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td>${ps.map((p) => `<td>${fmtH(tot[p.k])} h</td>`).join('')}</tr></tfoot></table></div>
    <p class="hint">Touche une case pour noter ou corriger des heures, ou un jour pour sa remarque, les jours off et ses événements.</p></div>`;
}
ACTIONS.hWeek = (el) => { const n = Number(el.dataset.n); HEU.lundi = n === 0 ? lundiDe(todayISO()) : addDays(HEU.lundi || lundiDe(todayISO()), n); render(); };

/* ---------- Bilan des heures ---------- */
function joursVacances(y) {
  const o = {};
  for (const e of evenements()) if (e.type === 'vacances') for (const oc of occurrences(e, y + '-01-01', y + '-12-31')) {
    for (let d = oc.date; d <= oc.fin; d = addDays(d, 1)) { if (yearOf(d) !== y) continue; const qui = quiListe(e.qui); qui.forEach((k) => { o[k] = (o[k] || 0) + 1; }); }
  }
  return o;
}
function renderBilanHeures() {
  const all = heuresToutes(), ps = personnes();
  const ys = [...new Set(all.map((h) => yearOf(h.date)).concat([todayISO().slice(0, 4)]))].sort().reverse();
  const y = HEU.annee && ys.includes(HEU.annee) ? HEU.annee : ys[0];
  const inY = all.filter((h) => yearOf(h.date) === y);
  const ty = totalHeures(inY), total = Object.values(ty).reduce((a, b) => a + b, 0);
  const offs = {}; inY.forEach((h) => { if (h.off) offs[h.personne] = (offs[h.personne] || 0) + 1; });
  const vac = joursVacances(y);
  const parMois = MOIS.map((m, i) => { const mm = y + '-' + String(i + 1).padStart(2, '0'); return [m, totalHeures(inY, (h) => h.date.slice(0, 7) === mm)]; });
  const maxM = Math.max(1, ...parMois.map(([, t]) => Math.max(0, ...Object.values(t))));
  const b = bilanAnnee(y), obj = num(cfg().objectifAnnuel);
  const joursTrav = {}; inY.forEach((h) => { if (num(h.heures) > 0) joursTrav[h.personne] = (joursTrav[h.personne] || 0) + 1; });
  return `<div class="between" style="margin-top:22px"><h2 style="margin:0">Bilan de l'année</h2>${sel('h-annee', 'Année', y, ys.map((x) => [x, x]))}</div>
    <div class="stats">
      ${ps.map((p, i) => `<div class="stat ${i ? 'blue' : 'good'}"><span class="k">${esc(p.nom)}</span><span class="v">${fmtH(ty[p.k] || 0)} h</span><span class="s">${joursTrav[p.k] || 0} jours travaillés · ${offs[p.k] || 0} jours off · ${vac[p.k] || 0} jours de vacances</span></div>`).join('')}
      <div class="stat"><span class="k">Total ${y}</span><span class="v">${fmtH(total)} h</span></div>
      <div class="stat"><span class="k">Résultat par heure</span><span class="v">${total ? chf(b.resultat / total) : '—'}</span><span class="s">Résultat ${y} : ${chf(b.resultat)}</span></div>
      <div class="stat"><span class="k">Objectif par heure</span><span class="v">${total && obj ? chf(obj / total) : '—'}</span><span class="s">Si vous gagnez ${chf(obj)} (Réglages)</span></div>
    </div>
    <div class="panel"><h2>Par mois</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Mois</th>${ps.map((p) => `<th>${esc(p.nom)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${parMois.map(([m, t]) => { const s = Object.values(t).reduce((a, x) => a + x, 0); return `<tr><td>${m}</td>${ps.map((p, i) => `<td><div class="bar-row" style="grid-template-columns:minmax(0,1fr) 56px"><span class="bar-track"><span class="bar-fill ${i ? 'b2' : ''}" style="width:${((t[p.k] || 0) / maxM * 100).toFixed(1)}%"></span></span><span class="num">${fmtH(t[p.k] || 0)}</span></div></td>`).join('')}<td class="r num">${fmtH(s)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td>${ps.map((p) => `<td class="num">${fmtH(ty[p.k] || 0)} h</td>`).join('')}<td class="r num">${fmtH(total)} h</td></tr></tfoot></table></div>
      <div class="row"><button class="btn small" type="button" data-act="hCsv" data-y="${y}">Exporter ${y} (CSV)</button></div></div>
    ${bilanHeuresCategories(inY, ps)}`;
}
/* Heures de l'année par grande catégorie (selon « Pour quoi ? » noté avec les heures ; plusieurs choix : à parts égales) */
function bilanHeuresCategories(inY, ps) {
  const lignes = [['admin', 'Admin', catInfo('admin').couleur], ['ventes', 'Ventes & livraisons', catInfo('ventes').couleur], ['cultures', 'Cultures (champ)', catInfo('champ').couleur], ['', 'Pas précisé', '#9AA0A6']];
  const t = {}; for (const [k] of lignes) t[k] = {};
  for (const h of inY) {
    const x = num(h.heures); if (!(x > 0)) continue; const pr = h.pour || {}, parts = [];
    if (pr.admin) parts.push('admin'); if (pr.ventes) parts.push('ventes'); if (pr.cultures === 'toutes' || (Array.isArray(pr.cultures) && pr.cultures.length)) parts.push('cultures');
    if (!parts.length) parts.push('');
    const pw = pr.poids || {}, tot = parts.reduce((a, k) => a + (k && pw[k] ? pw[k] : 1), 0);
    for (const k of parts) t[k][h.personne] = (t[k][h.personne] || 0) + x * ((k && pw[k] ? pw[k] : 1) / tot);
  }
  const tot = (k) => Object.values(t[k]).reduce((a, x) => a + x, 0), total = lignes.reduce((a, [k]) => a + tot(k), 0);
  if (!total) return '';
  return `<div class="panel"><h2>Par catégorie</h2>
    <div class="table-wrap"><table class="list"><thead><tr><th>Catégorie</th>${ps.map((p) => `<th class="r">${esc(p.nom)}</th>`).join('')}<th class="r">Total</th><th style="width:30%"></th></tr></thead><tbody>
    ${lignes.filter(([k]) => tot(k) > 0).map(([k, nom, c]) => `<tr><td><span class="catpill" style="--c:${esc(c)}">${esc(nom)}</span></td>${ps.map((p) => `<td class="r num">${fmtH(t[k][p.k] || 0)}</td>`).join('')}<td class="r num"><b>${fmtH(tot(k))} h</b></td>
      <td><div class="bar-row" style="grid-template-columns:minmax(0,1fr) 44px"><span class="bar-track"><span class="bar-fill" style="width:${(tot(k) / total * 100).toFixed(1)}%;background:${esc(c)}"></span></span><span class="num">${Math.round(tot(k) / total * 100)} %</span></div></td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint">D'après les tâches faites chaque jour où des heures sont notées : 3 tâches au champ et 1 d'admin, c'est ¾ du temps aux cultures et ¼ à l'admin. Un jour sans tâche faite reste « Pas précisé ».</p></div>`;
}
ACTIONS.hCsv = (el) => {
  const y = el.dataset.y, ps = personnes(), days = {};
  for (const h of heuresToutes()) if (yearOf(h.date) === y) { (days[h.date] = days[h.date] || {})[h.personne] = h; }
  for (const j of DB.all('jour:')) if (yearOf(j.date) === y) days[j.date] = days[j.date] || {};
  const rows = Object.keys(days).sort().map((d) => [fmtDate(d), JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7]].concat(ps.map((p) => (days[d][p.k] && days[d][p.k].heures) ? String(days[d][p.k].heures).replace('.', ',') : ''), ps.map((p) => (days[d][p.k] && days[d][p.k].off) ? 'off' : ''), [(DB.get('jour:' + d) || {}).remarque || '']));
  downloadFile(`Heures Gamins de Talus ${y}.csv`, csv(['Date', 'Jour'].concat(ps.map((p) => 'Heures ' + p.nom), ps.map((p) => 'Off ' + p.nom), ['Remarque']), rows), 'text/csv;charset=utf-8');
};

/* ---------- Noter les heures : une seule fiche, au style de « Heures et détails du jour » ----------
   Ne propose que les personnes inscrites à la journée (ou aux journées de travail du jour ; personne d'inscrit : tout le monde),
   les autres sont repliées sous « Quelqu'un d'autre ? ». En dessous, les tâches faites ce jour-là, et « Autres tâches effectuées ? »
   pour noter ce qu'on a fait sous forme de tâches. Le temps se répartit ensuite tout seul d'après ces tâches (voir majPourAuto). */
function inscritsDuJour(d, j) {
  if (j) { const e = DB.get(j.split('|')[0]); return e ? quiListe(e.qui) : personnes().map((p) => p.k); }
  const evs = ((itemsPeriode(d, d)[d]) || []).filter((x) => x.kind === 'ev' && evGenre(DB.get(x.key) || {}).genre === 'travail');
  if (!evs.length) return personnes().map((p) => p.k);
  return [...new Set(evs.flatMap((x) => quiListe(x.qui)))];
}
function heuresGrilleHtml(d, j, avecOff) {
  const ins = new Set(inscritsDuJour(d, j)), ps = personnes();
  const cellule = (p) => { const h = DB.get(hKey(d, p.k)) || {}; return `<div class="field"><label for="jh-${p.k}">${esc(p.nom)}</label><div class="hcell"><input id="jh-${p.k}" type="text" inputmode="decimal" autocomplete="off" data-h="${d}|${p.k}" value="${h.heures ? esc(fmtH(h.heures)) : ''}" placeholder="heures">${avecOff || h.off ? `<button type="button" class="off${h.off ? ' on' : ''}" data-act="hOff" data-d="${d}" data-p="${p.k}" data-sheet="1" aria-pressed="${!!h.off}" title="Jour off : pas travaillé ce jour-là">off</button>` : ''}</div></div>`; };
  const deja = (p) => { const h = DB.get(hKey(d, p.k)); return h && (num(h.heures) > 0 || h.off); };
  const vus = ps.filter((p) => ins.has(p.k) || deja(p)), autres = ps.filter((p) => !vus.includes(p));
  return `<div class="grid2">${vus.map(cellule).join('')}</div>${autres.length ? `<details class="hj-autres"><summary class="hint">Quelqu'un d'autre a travaillé ?</summary><div class="grid2">${autres.map(cellule).join('')}</div></details>` : ''}`;
}
function tachesDuJour(d, j) {
  const ins = inscritsDuJour(d, j);
  const prevue = (t) => (j ? t.journee === j : (t.journee && t.journee.endsWith('|' + d)) || (!t.journee && t.jour === d));
  const faiteCeJour = (t) => !t.journee && t.statut === 'termine' && t.termineLe === d && (!t.terminePar || ins.includes(t.terminePar));
  return taches().filter((t) => t.statut !== 'suspendu' && (prevue(t) || faiteCeJour(t))).sort(triOrdre);
}
ACTIONS.heuresJour = (el) => {
  const d = el.dataset.d || todayISO(), j = el.dataset.j || '', e = j ? DB.get(j.split('|')[0]) : null;
  PL.rafraichir = () => ACTIONS.heuresJour({ dataset: { d, j } });
  const ts = tachesDuJour(d, j), faites = ts.filter((t) => t.statut === 'termine').length;
  const titre = e ? `${iconeEv(e)} ${titreEv(e)}` : (d === todayISO() ? "Aujourd'hui" : dateLongue(d).replace(/^./, (c) => c.toUpperCase()));
  openSheet(`${sheetHead(titre, e ? dateLongue(d) : '')}<div class="sbody" id="hj-sheet" data-vue-racine>
    <h3>Heures travaillées</h3>${heuresGrilleHtml(d, j)}
    <h3>Tâches${e ? ' de la journée' : ' du jour'}${ts.length ? ` · ${faites}/${ts.length} faites` : ''}</h3>
    ${ts.length ? `<div class="tri-taches">${ts.map((t) => tacheHtml(t, { court: true, sansDate: true })).join('')}</div>` : '<p class="hint">Aucune tâche cochée ce jour-là.</p>'}
    <details class="hj-plus"${ts.length ? '' : ' open'}><summary>Autres tâches effectuées ?</summary>${ajoutTacheBarre({ id: 'hj-ajout', fait: d, placeholder: 'Ex. désherbé les carottes' })}</details>
    <p class="hint">Les heures se répartissent d'elles-mêmes entre admin, ventes et cultures d'après les tâches faites.</p>
    <div class="row-end"><button class="btn primary" type="button" data-act="hjOk" data-d="${d}">Terminé</button></div></div>`);
  brancherHeures($('hj-sheet'));
  const moi = $('jh-' + Sync.me); if (moi && !moi.value && matchMedia('(pointer: fine)').matches) setTimeout(() => moi.focus(), 60);
};
ACTIONS.hjOk = (el) => {
  const d = el.dataset.d; majPourAuto(d); PL.rafraichir = null; closeSheet();
  toast(heuresNotees(d, Sync.me) ? `Heures notées pour le ${fmtDate(d)}. Merci !` : 'Fermé (pas d\'heures à ton nom ce jour-là).');
};
/* Les anciens boutons « Enregistrer mes heures » (tableau de la semaine…) ouvrent la même fiche */
ACTIONS.mesHeures = (el) => ACTIONS.heuresJour({ dataset: { d: (el && el.dataset && el.dataset.d) || todayISO() } });
/* Répartition automatique : pour chaque personne qui a des heures ce jour-là (sauf « Pour quoi ? » choisi à la main autrefois) */
function majPourAuto(d) {
  if (!d) return;
  for (const h of DB.all('h:' + d + ':')) {
    if (!(num(h.heures) > 0) || (h.pour && !h.pourAuto)) continue;
    const k = hKey(d, h.personne), sug = pourSuggere(d, h.personne), o = Object.assign({}, DB.get(k));
    if (sug) { o.pour = sug.pour; o.pourAuto = true; } else { delete o.pour; delete o.pourAuto; }
    if (JSON.stringify(o.pour || null) !== JSON.stringify((DB.get(k) || {}).pour || null)) DB.put(k, o);
  }
}
/* Ce qu'une journée prévue dit des heures : catégories des événements et tâches du jour (de cette personne) → « Pour quoi ? » */
function pourSuggere(d, p) {
  if (!d || !p) return null;
  const pourP = (q) => quiInclut(q, p);
  const evs = ((itemsPeriode(d, d)[d]) || []).filter((x) => x.kind === 'ev' && pourP(x.qui)).map((x) => DB.get(x.key) && Object.assign({ key: x.key }, DB.get(x.key))).filter(Boolean);
  if (evs.some((e) => catEv(e).cat === 'conge') && !evs.some((e) => evGenre(e).genre === 'travail')) return null;
  const js = new Set(evs.map((e) => e.key));
  const ts = taches().filter((t) => t.statut !== 'suspendu' && (pourP(t.responsable) || t.terminePar === p) && (dateTache(t) === d || (t.statut === 'termine' && t.termineLe === d && t.terminePar === p) || (t.journee && js.has(t.journee.split('|')[0]) && t.journee.endsWith('|' + d))));
  const o = {}, cus = new Set(), poids = {};
  const ajoute = (cat, cultures) => { const h = cat && catInfo(cat).heures; if (!h) return; poids[h] = (poids[h] || 0) + 1; if (h === 'admin') o.admin = true; else if (h === 'ventes') o.ventes = true; else if (h === 'cultures') { o.cultures = o.cultures || []; for (const c of cultures || []) cus.add(c); } };
  /* Les tâches faites d'abord ; s'il n'y en a pas encore, celles prévues ce jour-là ; sinon les événements */
  const faitesT = ts.filter((t) => t.statut === 'termine');
  for (const t of faitesT.length ? faitesT : ts) ajoute(catTache(t).cat, t.cultures);
  if (!Object.keys(o).length) for (const e of evs) ajoute(catEv(e).cat, e.cultureId ? [e.cultureId] : []);
  if (!Object.keys(o).length) return null;
  if (o.cultures) { const l = [...cus].filter((k) => { const c = DB.get(k); return c && String(c.saison) === d.slice(0, 4); }); o.cultures = l.length ? l : 'toutes'; }
  const parts = Object.keys(poids); if (parts.length > 1 && new Set(Object.values(poids)).size > 1) o.poids = poids;
  return { pour: o, d: [...evs.map(titreEv), ...(ts.length ? [`${ts.length} tâche${ts.length > 1 ? 's' : ''}`] : [])].join(', ') };
}
/* ---------- S'abonner au calendrier depuis Google Agenda, Proton Calendar… (fonction Supabase « calendrier ») ---------- */
const ICS_URL = (j) => `${SB_URL}/functions/v1/calendrier?t=${j}`;
ACTIONS.icsSheet = () => {
  const k = 'cfg:ics:' + (Sync.me || 'local'), c = DB.get(k);
  if (!c) { const a = new Uint8Array(24); crypto.getRandomValues(a); DB.put(k, { jeton: [...a].map((x) => x.toString(16).padStart(2, '0')).join(''), tout: false }); }
  const d = DB.get(k), url = ICS_URL(d.jeton);
  openSheet(`${sheetHead('Voir ce calendrier dans mon agenda', nomDe(Sync.me))}<div class="sbody">
    <p>Ton adresse personnelle (à garder pour toi : qui l'a peut lire le calendrier) :</p>
    <div class="row"><input id="ics-url" readonly value="${esc(url)}" style="flex:1;font-family:var(--font-mono);font-size:12px"><button class="btn" type="button" data-act="copy" data-v="${esc(url)}">Copier</button></div>
    <label class="row" style="font-size:14px;margin-top:8px"><input type="checkbox" id="ics-tout"${d.tout ? ' checked' : ''}> Tout le monde (sinon : ce qui me concerne, et ce qui est pour toute l'équipe)</label>
    <h3>Google Agenda</h3><p class="hint">Sur ordinateur : calendar.google.com → « Autres agendas » → <b>+</b> → <b>À partir de l'URL</b> → colle l'adresse. Il apparaît ensuite aussi sur le téléphone. Google le met à jour plusieurs fois par jour (pas tout de suite).</p>
    <h3>Proton Calendar</h3><p class="hint">Calendrier → <b>+</b> à côté de « Mes agendas » → <b>Ajouter un agenda</b> → <b>S'abonner via un lien</b> (ou « Autres calendriers » selon la version) → colle l'adresse.</p>
    <h3>Apple, Thunderbird…</h3><p class="hint">« S'abonner à un calendrier » / « Nouveau calendrier en réseau » avec la même adresse.</p>
    <p class="hint">Contenu : les événements planifiés (journées de travail, congés…), de 2 mois en arrière à 1 an en avant. Les tâches n'y vont pas. Lecture seule : on modifie dans l'app.</p>
    <div class="row-end"><button class="btn danger" type="button" data-act="icsNouveau">Changer l'adresse</button></div></div>`);
  $('ics-tout').addEventListener('change', (e) => { DB.put(k, Object.assign({}, DB.get(k), { tout: e.target.checked })); });
};
ACTIONS.icsNouveau = () => { const k = 'cfg:ics:' + (Sync.me || 'local'); if (DB.get(k)) DB.del(k); closeSheet(); setTimeout(() => { ACTIONS.icsSheet(); toast("Nouvelle adresse : l'ancienne ne marche plus."); }, 50); };
