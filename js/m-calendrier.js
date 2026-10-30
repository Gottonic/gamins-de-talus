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
function quiLabel(q) { return !q ? '' : q === 'ensemble' ? 'Ensemble' : nomDe(q); }
function titreEv(e) {
  if (e.titre) return e.titre;
  const c = e.contactId && DB.get(e.contactId), cu = e.cultureId && DB.get(e.cultureId);
  if (e.type === 'livraison') return 'Livraison' + (c ? ' ' + displayName(c) : '');
  if (e.type === 'recolte') return 'Récolte' + (cu ? ' ' + cu.nom : '');
  if (e.type === 'vacances') return 'Vacances' + (e.qui && e.qui !== 'ensemble' ? ' ' + nomDe(e.qui) : '');
  return evType(e.type).label;
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
      add(d, { kind: 'ev', type: e.type, key: e.key, occ: o.date, titre: titreEv(e), heure: d === o.date ? e.heureDebut || '' : '', qui: e.qui, fait: !!st.fait, multi: o.fin > o.date, debut: d === o.date });
    }
  }
  for (const t of taches()) if (t.statut !== 'termine' && t.echeance && t.echeance >= de && t.echeance <= a) add(t.echeance, { kind: 'tache', key: t.key, titre: t.titre, urgent: t.urgent, qui: t.responsable });
  for (const f of factures()) { const s = facStatut(f); if ((s === 'ouverte' || s === 'retard') && f.echeance >= de && f.echeance <= a) add(f.echeance, { kind: 'facture', key: f.key, titre: `Échéance ${f.numero || f.blNumero || 'vente'} · ${f.client.nom}`, montant: f.total }); }
  for (const h of heuresToutes()) if (h.date >= de && h.date <= a) add(h.date, { kind: 'heures', personne: h.personne, heures: num(h.heures), off: !!h.off });
  for (const c of relancesProspection(de, a)) add(c.prospection.relanceLe, { kind: 'relance', key: c.key, titre: 'Relancer ' + displayName(c) });
  return jours;
}

/* ---------- Module ---------- */
MODULES.calendrier = {
  titre: 'Calendrier',
  tuile() {
    const l = lundiDe(todayISO()), fin = addDays(l, 6), t = totalHeures(heuresToutes(), (h) => h.date >= l && h.date <= fin);
    const prochains = Object.entries(itemsPeriode(todayISO(), addDays(todayISO(), 6))).reduce((a, [, xs]) => a + xs.filter((x) => x.kind === 'ev' && x.debut).length, 0);
    const auj = (itemsPeriode(todayISO(), todayISO())[todayISO()] || []).filter((x) => x.kind === 'ev' && (typeof pourMoi !== 'function' || pourMoi(x.qui))).length;
    return { line: `Semaine : ${personnes().map((p) => `${p.nom} ${fmtH(t[p.k] || 0)} h`).join(' · ')}${prochains ? ` · ${prochains} événement${prochains > 1 ? 's' : ''} à venir` : ''}`, badge: auj };
  },
  render(sub) {
    if (sub === 'semaine') { setTimeout(() => location.replace('#/calendrier/heures'), 0); return ''; }
    const t = tabs('calendrier', [['', 'Agenda'], ['mois', 'Mois'], ['heures', 'Heures']], sub === 'agenda' ? '' : sub);
    if (sub === 'mois') return t + renderMois();
    if (sub === 'heures') return t + `<div class="row"><button class="btn primary" type="button" data-act="mesHeures">+ Enregistrer mes heures</button></div>` + renderSemaineHeures() + renderBilanHeures();
    return t + renderAgenda();
  },
  after(sub) {
    if (sub === 'heures') { const s = $('h-annee'); if (s) s.addEventListener('change', () => { HEU.annee = s.value; render(); }); return; }
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
    if (L.evenements) xs.filter((x) => x.kind === 'ev').sort((a, b) => String(a.heure).localeCompare(String(b.heure))).forEach((x) => chips.push(`<span class="ch${x.fait ? ' fait' : ''}${x.multi ? ' multi' : ''}" style="--c:var(--ev-${x.type})">${x.heure ? `<i>${esc(x.heure)}</i> ` : ''}${esc(x.titre)}</span>`));
    if (L.taches) xs.filter((x) => x.kind === 'tache').forEach((x) => chips.push(`<span class="ch tache${x.urgent ? ' urgent' : ''}" style="--c:var(--c-taches)">⚑ ${esc(x.titre)}</span>`));
    if (L.factures) xs.filter((x) => x.kind === 'facture').forEach((x) => chips.push(`<span class="ch" style="--c:var(--c-factures)">${esc(x.titre)}</span>`));
    if (L.relances) xs.filter((x) => x.kind === 'relance').forEach((x) => chips.push(`<span class="ch" style="--c:var(--c-contacts)">☎ ${esc(x.titre)}</span>`));
    const max = 4, plus = chips.length > max ? `<span class="more">+${chips.length - max}</span>` : '';
    cells += `<button type="button" class="cell${d.slice(0, 7) !== CAL.mois ? ' out' : ''}${d === today ? ' today' : ''}${wd >= 5 ? ' we' : ''}${vac.length && L.evenements ? ' vac' : ''}" data-act="calDay" data-d="${d}" aria-label="${esc(dateLongue(d))}">
      <span class="top"><span class="dn">${Number(d.slice(8))}</span>${wd === 0 ? `<span class="wk">S${semaineISO(d).semaine}</span>` : ''}<span class="hrs">${hrs}</span></span>
      <span class="chips">${chips.slice(0, max).join('')}${plus}</span><span class="dots">${chips.slice(0, 6).map((c) => `<span class="dot" style="${(c.match(/style="([^"]+)"/) || [, ''])[1]}"></span>`).join('')}</span></button>`;
  }
  const legend = [['heures', 'Heures et jours off'], ['evenements', 'Événements'], ['taches', 'Échéances des tâches'], ['factures', 'Échéances des factures'], ['relances', 'Relances prospection']]
    .map(([k, l]) => `<button type="button" class="chip${L[k] ? ' on' : ''}" data-act="calCalque" data-k="${k}">${l}</button>`).join('');
  const prev = new Date(Y, M - 2, 1), next = new Date(Y, M, 1);
  const ym = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
  // Totaux du mois
  const tm = totalHeures(heuresToutes(), (h) => h.date.slice(0, 7) === CAL.mois);
  return `<div class="panel">
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
ACTIONS.calCalque = (el) => { CAL.calques[el.dataset.k] = !CAL.calques[el.dataset.k]; ls.set('gdt-cal-calques', JSON.stringify(CAL.calques)); render(); };

/* ---------- Fiche d'un jour ---------- */
ACTIONS.calDay = (el) => ouvrirJour(el.dataset.d);
function ouvrirJour(d) {
  const xs = itemsPeriode(d, d)[d] || [], ps = personnes(), j = DB.get('jour:' + d) || {};
  const evs = xs.filter((x) => x.kind === 'ev'), tch = xs.filter((x) => x.kind === 'tache'), fac = xs.filter((x) => x.kind === 'facture'), rel = xs.filter((x) => x.kind === 'relance');
  const heures = ps.map((p) => { const h = DB.get(hKey(d, p.k)) || {}; return `<div class="field"><label for="jh-${p.k}">${esc(p.nom)}</label><div class="hcell"><input id="jh-${p.k}" type="text" inputmode="decimal" autocomplete="off" data-h="${d}|${p.k}" value="${h.heures ? esc(fmtH(h.heures)) : ''}" placeholder="heures"><button type="button" class="off${h.off ? ' on' : ''}" data-act="hOff" data-d="${d}" data-p="${p.k}" data-sheet="1" aria-pressed="${!!h.off}">off</button></div></div>`; }).join('');
  const evHtml = evs.map((x) => {
    const e = DB.get(x.key) || {}, st = (e.occ || {})[x.occ] || {}, rec = e.rec && e.rec.freq;
    const c = e.contactId && DB.get(e.contactId), cu = e.cultureId && DB.get(e.cultureId);
    const det = [e.heureDebut ? e.heureDebut + (e.heureFin ? '–' + e.heureFin : '') : '', quiLabel(e.qui), c ? displayName(c) : '', cu ? cu.nom : '', rec ? (RECS.find((r) => r[0] === rec) || [, ''])[1].toLowerCase() : '', x.multi ? `du ${fmtDateCourt(x.occ)} au ${fmtDateCourt(addDays(x.occ, Math.round((new Date((e.fin || e.date) + 'T12:00') - new Date(e.date + 'T12:00')) / 864e5)))}` : ''].filter(Boolean).join(' · ');
    return `<div class="evline" style="--c:var(--ev-${e.type})"><div class="between"><div><strong>${esc(x.titre)}</strong><br><span class="hint">${esc(evType(e.type).court)}${det ? ' · ' + esc(det) : ''}</span></div>
      <label class="row" style="font-size:14px"><input type="checkbox" data-fait="${esc(x.key)}|${x.occ}"${st.fait ? ' checked' : ''}> Fait</label></div>
      ${e.type === 'recolte' ? (() => { const mv = DB.get(`mvt:ev:${x.key}:${x.occ}`), pr = typeof produitDeCulture === 'function' ? produitDeCulture(DB.get(e.cultureId)) : null; return `<div class="row"><label class="hint" for="kg-${esc(x.key)}">Récolté (kg)</label><input id="kg-${esc(x.key)}" style="max-width:110px" type="text" inputmode="decimal" data-kg="${esc(x.key)}|${x.occ}" value="${st.kg ? esc(fmtH(st.kg)) : ''}">${pr ? `<label class="hint"><input type="checkbox" id="kgs-${esc(x.key)}" data-kgstock="${esc(x.key)}|${x.occ}"${!mv || !mv.horsStock ? ' checked' : ''}> ajouter au stock (${esc(pr.nom)})</label>` : ''}</div>`; })() : ''}
      ${e.remarque ? `<p class="hint" style="white-space:pre-wrap">${esc(e.remarque)}</p>` : ''}
      <div class="row">${e.type === 'livraison' && e.contactId ? `<button class="btn small primary" type="button" data-act="evFacturer" data-key="${esc(x.key)}" data-occ="${x.occ}">Créer la facture</button>` : ''}
        <button class="btn small" type="button" data-act="evEdit" data-key="${esc(x.key)}">Modifier</button>
        ${rec ? `<button class="btn small" type="button" data-act="evSauter" data-key="${esc(x.key)}" data-occ="${x.occ}">Annuler ce jour-là</button>` : ''}
        <button class="btn small danger" type="button" data-act="delItem" data-key="${esc(x.key)}" data-what="${rec ? 'toute la série' : 'cet événement'}">Supprimer${rec ? ' la série' : ''}</button></div></div>`;
  }).join('');
  openSheet(`${sheetHead(dateLongue(d).replace(/^./, (c) => c.toUpperCase()), 'Semaine ' + semaineISO(d).semaine)}<div class="sbody" id="jour-sheet">
    <h3>Heures travaillées</h3><div class="grid2">${heures}</div>
    ${fld('jr-rem', 'Remarque du jour', `<input id="jr-rem" data-jour="${d}" value="${esc(j.remarque || '')}" placeholder="Ex. Journée au champ ensemble">`)}
    <div class="between"><h3>Événements</h3><button class="btn small primary" type="button" data-act="evEdit" data-date="${d}">+ Événement</button></div>
    ${evHtml || '<p class="hint">Aucun événement ce jour.</p>'}
    ${tch.length ? `<h3>Tâches à rendre</h3>${tch.map((t) => `<a class="item" href="#/taches" style="--c:var(--c-taches)"><span class="who"><strong>${esc(t.titre)}</strong><span class="meta">${t.qui ? esc(quiLabel(t.qui)) : ''}${t.urgent ? ' · urgent' : ''}</span></span></a>`).join('')}` : ''}
    ${rel.length ? `<h3>Relances prospection</h3>${rel.map((r) => `<a class="item" href="#/contacts/prospect/${encodeURIComponent(r.key)}"><span class="who"><strong>${esc(r.titre)}</strong></span></a>`).join('')}` : ''}
    ${fac.length ? `<h3>Factures à échéance</h3>${fac.map((f) => `<a class="item" href="#/factures/voir/${encodeURIComponent(f.key)}"><span class="who"><strong>${esc(f.titre)}</strong></span><span class="amt">${chf(f.montant)}</span></a>`).join('')}` : ''}
  </div>`);
  const sh = $('jour-sheet'); brancherHeures(sh);
  sh.querySelectorAll('input[data-fait]').forEach((el) => el.addEventListener('change', () => {
    const [k, occ] = el.dataset.fait.split('|'); const e = DB.get(k); if (!e) return;
    const o = Object.assign({}, e, { occ: Object.assign({}, e.occ || {}) });
    o.occ[occ] = Object.assign({}, o.occ[occ] || {}, { fait: el.checked }); DB.put(k, o);
  }));
  sh.querySelectorAll('input[data-kg]').forEach((el) => el.addEventListener('change', () => {
    const [k, occ] = el.dataset.kg.split('|'); const e = DB.get(k); if (!e) return;
    const o = Object.assign({}, e, { occ: Object.assign({}, e.occ || {}) }); o.occ[occ] = Object.assign({}, o.occ[occ] || {}, { kg: el.value.trim() === '' ? null : r2(num(el.value)) });
    if (o.occ[occ].kg) o.occ[occ].fait = true;
    DB.put(k, o); recolteCalendrierVersStock(k, occ); toast('Récolte notée.');
  }));
  sh.querySelectorAll('input[data-kgstock]').forEach((el) => el.addEventListener('change', () => { const [k, occ] = el.dataset.kgstock.split('|'); recolteCalendrierVersStock(k, occ); }));
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

/* ---------- Formulaire d'événement ---------- */
ACTIONS.evEdit = (el) => {
  const k = el.dataset.key || '', e = k ? DB.get(k) : { type: 'travail', date: el.dataset.date || todayISO(), qui: 'ensemble', rec: { freq: '' } };
  const cl = tousContacts().sort(byName), cu = DB.all('cul:').sort((a, b) => String(b.saison).localeCompare(String(a.saison)) || (a.ordre || 0) - (b.ordre || 0));
  openSheet(`${sheetHead(k ? 'Modifier l\'événement' : 'Nouvel événement', k && e.rec && e.rec.freq ? 'Modifie toute la série' : '')}<form class="sbody form" data-form="ev" id="ev-form"><input type="hidden" name="key" value="${esc(k)}">
    <div class="field"><span class="flabel">Type</span><div class="seg">${EV_TYPES.map((t) => `<label style="--c:var(--ev-${t.k})"><input type="radio" name="type" value="${t.k}"${e.type === t.k ? ' checked' : ''}> ${t.court}</label>`).join('')}</div></div>
    ${inp('ev-titre', 'Titre', e.titre, { name: 'titre', attrs: { placeholder: 'Facultatif : sinon « Livraison Epinettes », « Récolte Courge »…' } })}
    <div class="grid2">${inp('ev-date', 'Date', e.date, { name: 'date', type: 'date', req: true })}${inp('ev-fin', "Jusqu'au (plusieurs jours)", e.fin, { name: 'fin', type: 'date', sub: 'Pour des vacances, une semaine de récolte…' })}
      ${inp('ev-hd', 'Heure de début', e.heureDebut, { name: 'heureDebut', type: 'time' })}${inp('ev-hf', 'Heure de fin', e.heureFin, { name: 'heureFin', type: 'time' })}
      ${sel('ev-qui', 'Qui', e.qui || '', [['', '—']].concat(persOptions(true)), { name: 'qui' })}
      ${sel('ev-contact', 'Client / contact', e.contactId || '', [['', '—']].concat(cl.map((c) => [c.key, displayName(c) + (c.prospect ? ' (prospect)' : '')])), { name: 'contactId', sub: 'Pour une livraison : permet de créer la facture depuis le calendrier.' })}
      ${sel('ev-cul', 'Culture', e.cultureId || '', [['', '—']].concat(cu.map((c) => [c.key, `${c.nom} (${c.saison})`])), { name: 'cultureId', sub: 'Pour une récolte : les kilos notés s\'ajoutent à la récolte réelle.' })}
    </div>
    <h3>Répétition</h3>
    <div class="grid2">${sel('ev-rec', 'Se répète', (e.rec && e.rec.freq) || '', RECS, { name: 'freq' })}${inp('ev-jq', "Jusqu'au", e.rec && e.rec.jusquau, { name: 'jusquau', type: 'date', sub: 'Vide : sans fin.' })}</div>
    ${txt('ev-rem', 'Remarque', e.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="${e.rec && e.rec.freq ? 'toute la série' : 'cet événement'}">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  /* Vacances : il faut choisir la personne (pas « Ensemble ») */
  const f = $('ev-form'), qui = $('ev-qui'), lab = f.querySelector('label[for="ev-qui"]');
  const majQui = () => {
    const vac = (f.querySelector('input[name=type]:checked') || {}).value === 'vacances', cur = qui.value;
    const opts = vac ? [['', 'Choisir…']].concat(persOptions()) : [['', '—']].concat(persOptions(true));
    qui.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    qui.value = opts.some(([v]) => v === cur) ? cur : '';
    qui.required = vac; lab.textContent = vac ? 'Vacances de (obligatoire)' : 'Qui';
  };
  f.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', majQui)); majQui();
};
FORMS.ev = (v) => {
  if (!v.date) { toast('La date est obligatoire.'); return; }
  if (v.fin && v.fin < v.date) { toast('La date de fin est avant le début.'); return; }
  if (v.type === 'vacances' && !personnes().some((p) => p.k === v.qui)) { toast('Indique pour qui sont les vacances.'); $('ev-qui').focus(); return; }
  const k = v.key || 'ev:' + uid('e'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '', occ: {}, exceptions: [] };
  DB.put(k, Object.assign({}, old, { type: v.type || 'autre', titre: v.titre, date: v.date, fin: v.fin && v.fin > v.date ? v.fin : '', heureDebut: v.heureDebut, heureFin: v.heureFin, qui: v.qui, contactId: v.contactId, cultureId: v.cultureId, remarque: v.remarque, rec: { freq: v.freq, jusquau: v.freq ? v.jusquau : '' } }));
  closeSheet(); toast(v.key ? 'Événement mis à jour.' : 'Événement ajouté.');
};

/* ---------- Agenda (liste des 8 prochaines semaines) ---------- */
function renderAgenda() {
  const today = todayISO(), a = addDays(today, 55), items = itemsPeriode(today, a);
  const days = Object.keys(items).sort().filter((d) => items[d].some((x) => x.kind !== 'heures'));
  const ic = (x) => x.kind === 'ev' ? `var(--ev-${x.type})` : x.kind === 'tache' ? 'var(--c-taches)' : x.kind === 'facture' ? 'var(--c-factures)' : x.kind === 'relance' ? 'var(--c-contacts)' : 'var(--c-cultures)';
  return `<div class="panel"><div class="between"><h2>Les 8 prochaines semaines</h2><div class="row"><button class="btn small" type="button" data-act="icsSheet">📅 Dans mon agenda</button><button class="btn primary small" type="button" data-act="evEdit" data-date="${today}">+ Événement</button></div></div>
    ${days.length ? days.map((d) => `<div class="agday"><button type="button" class="agdate" data-act="calDay" data-d="${d}"><b>${d === today ? "Aujourd'hui" : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7]}</b><span>${fmtDateCourt(d)}</span></button>
      <div class="agitems">${items[d].filter((x) => x.kind !== 'heures' && !(x.kind === 'ev' && x.multi && !x.debut && d !== today)).map((x) => `<div class="agit${x.fait ? ' fait' : ''}" style="--c:${ic(x)}">${x.heure ? `<span class="num">${esc(x.heure)}</span> ` : ''}${esc(x.kind === 'tache' ? '⚑ ' + x.titre : x.titre)}${x.qui ? ` <span class="hint">· ${esc(quiLabel(x.qui))}</span>` : ''}${x.montant ? ` <span class="num">${chf(x.montant)}</span>` : ''}</div>`).join('')}</div></div>`).join('')
      : '<p class="empty">Rien de prévu. Ajoute des journées de travail, récoltes ou livraisons avec « + Événement ».</p>'}</div>`;
}

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
      const enVac = vac.some((x) => x.qui === p.k || x.qui === 'ensemble');
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
    for (let d = oc.date; d <= oc.fin; d = addDays(d, 1)) { if (yearOf(d) !== y) continue; const qui = e.qui === 'ensemble' || !e.qui ? personnes().map((p) => p.k) : [e.qui]; qui.forEach((k) => { o[k] = (o[k] || 0) + 1; }); }
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
      <div class="row"><button class="btn small" type="button" data-act="hCsv" data-y="${y}">Exporter ${y} (CSV)</button></div></div>`;
}
ACTIONS.hCsv = (el) => {
  const y = el.dataset.y, ps = personnes(), days = {};
  for (const h of heuresToutes()) if (yearOf(h.date) === y) { (days[h.date] = days[h.date] || {})[h.personne] = h; }
  for (const j of DB.all('jour:')) if (yearOf(j.date) === y) days[j.date] = days[j.date] || {};
  const rows = Object.keys(days).sort().map((d) => [fmtDate(d), JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7]].concat(ps.map((p) => (days[d][p.k] && days[d][p.k].heures) ? String(days[d][p.k].heures).replace('.', ',') : ''), ps.map((p) => (days[d][p.k] && days[d][p.k].off) ? 'off' : ''), [(DB.get('jour:' + d) || {}).remarque || '']));
  downloadFile(`Heures Gamins de Talus ${y}.csv`, csv(['Date', 'Jour'].concat(ps.map((p) => 'Heures ' + p.nom), ps.map((p) => 'Off ' + p.nom), ['Remarque']), rows), 'text/csv;charset=utf-8');
};

/* ---------- « Enregistrer mes heures » : le plus court chemin, aujourd'hui et à mon nom par défaut ---------- */
ACTIONS.mesHeures = (el) => {
  const p0 = (el && el.dataset.p) || Sync.me || personnes()[0].k, d0 = (el && el.dataset.d) || todayISO();
  openSheet(`${sheetHead('Enregistrer mes heures')}<form class="sbody form" data-form="mesHeures">
    <div class="grid2">${sel('mh-p', 'Qui', p0, persOptions(), { name: 'p' })}${inp('mh-d', 'Jour', d0, { name: 'd', type: 'date', attrs: { max: addDays(todayISO(), 31) } })}</div>
    ${inp('mh-h', 'Heures travaillées', '', { name: 'h', type: 'number', attrs: { placeholder: 'Ex. 7,5', autofocus: '' }, sub: '<span id="mh-deja"></span>7,5 = 7 h 30' })}
    <div class="row chips-h">${[2, 4, 6, 7, 8, 9].map((h) => `<button type="button" class="chip" data-act="mhSet" data-h="${h}">${h} h</button>`).join('')}</div>
    ${inp('mh-n', "Ce que j'ai fait (facultatif)", '', { name: 'n', attrs: { placeholder: 'Ex. récolte courges, livraison Épinettes' } })}
    <div class="row-end"><a class="btn link" href="#/calendrier/heures" data-act="go" data-href="#/calendrier/heures">Voir la semaine</a><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const maj = () => {
    const h = DB.get(hKey($('mh-d').value, $('mh-p').value)) || {};
    $('mh-h').value = h.heures ? fmtH(h.heures) : ''; $('mh-n').value = h.note || '';
    $('mh-deja').textContent = h.heures ? `Déjà noté ce jour-là : ${fmtH(h.heures)} h (tu peux corriger). ` : '';
  };
  $('mh-p').addEventListener('change', maj); $('mh-d').addEventListener('change', maj); maj();
  setTimeout(() => { const i = $('mh-h'); if (i) i.focus(); }, 60);
};
ACTIONS.mhSet = (el) => { $('mh-h').value = el.dataset.h; $('mh-h').focus(); };
FORMS.mesHeures = (v) => {
  if (!v.d || !v.p) { toast('Indique le jour et la personne.'); return; }
  const h = num(v.h); if (h < 0 || h > 24) { toast('Indique un nombre d\'heures entre 0 et 24.'); return; }
  const k = hKey(v.d, v.p), old = DB.get(k) || {};
  const o = Object.assign({}, old, { date: v.d, personne: v.p, heures: h || 0 });
  if (v.n) o.note = v.n; else delete o.note;
  if (h > 0) delete o.off;
  if (!o.heures && !o.off && !o.note) { if (DB.get(k)) DB.del(k); } else DB.put(k, o);
  closeSheet();
  toast(h ? `${fmtH(h)} h notées pour ${nomDe(v.p)} ${v.d === todayISO() ? "aujourd'hui" : 'le ' + fmtDate(v.d)}.` : 'Heures effacées pour ce jour.');
};

/* Une récolte notée au calendrier devient un mouvement « récolte » (culture + produit lié), dans le stock si la case est cochée */
function recolteCalendrierVersStock(k, occ) {
  if (typeof produitDeCulture !== 'function') return;
  const e = DB.get(k); if (!e) return; const kg = num(((e.occ || {})[occ] || {}).kg), mk = `mvt:ev:${k}:${occ}`;
  if (!(kg > 0)) { if (DB.get(mk)) DB.del(mk); return; }
  const pr = produitDeCulture(DB.get(e.cultureId)), cb = $('kgs-' + k);
  const o = { date: occ, prod: pr ? pr.key : '', qte: kg, type: 'recolte', culture: e.cultureId || '', ref: 'ev:' + k + ':' + occ, par: Sync.me || '', note: 'Calendrier' };
  if (!pr || (cb && !cb.checked)) o.horsStock = true;
  DB.put(mk, o);
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
    <p class="hint">Contenu : événements (livraisons, récoltes, journées, vacances…) et échéances des tâches, de 2 mois en arrière à 1 an en avant. Lecture seule : on modifie dans l'app.</p>
    <div class="row-end"><button class="btn danger" type="button" data-act="icsNouveau">Changer l'adresse</button></div></div>`);
  $('ics-tout').addEventListener('change', (e) => { DB.put(k, Object.assign({}, DB.get(k), { tout: e.target.checked })); });
};
ACTIONS.icsNouveau = () => { const k = 'cfg:ics:' + (Sync.me || 'local'); if (DB.get(k)) DB.del(k); closeSheet(); setTimeout(() => { ACTIONS.icsSheet(); toast("Nouvelle adresse : l'ancienne ne marche plus."); }, 50); };
