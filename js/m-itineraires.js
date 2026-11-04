/* Gamins de Talus — cultures, suite : bibliothèque, itinéraires de travail, tâches générées, frise et charge de travail.
   - BIBLIO : des repères pour des cultures que vous n'avez pas encore (plateau suisse, plein champ), pour pré-remplir une fiche.
   - Itinéraires (cfg:itineraires) : vos suites de travaux (« Broyage » 21 j avant la plantation, « Fraise à 10 cm »…),
     à associer aux fiches. Une fiche a aussi ses propres étapes. Une étape = { id, t (titre), r (repère), j (jours), h (heures par planche, facultatif) }.
   - Les tâches de chaque culture du plan sont créées dans Planification, avec la date de l'étape comme échéance, et suivent si les dates changent.
     Une tâche supprimée ou déjà planifiée (jour, journée) n'est plus touchée. cul.taches = { idÉtape: clé de la tâche }.
   - Charge de travail : apprise des heures réelles des saisons passées (heures « cultures » réparties par culture, ce qui n'est pas
     précisé selon la surface), semaine par semaine depuis la plantation ; à défaut, les heures estimées des étapes. */
'use strict';

/* ---------- Bibliothèque : repères indicatifs, à ajuster dans la fiche ---------- */
const BIBLIO = [
  // nom, famille, mode (achete | direct | maison), semaine de plantation/semis, jours jusqu'à la 1re récolte, durée de récolte (sem.), rdt kg/m², lignes, interplant cm
  ['Patate douce', 'convolvulacees', 'achete', 21, 120, 2, 2, 1, 30], ['Courge butternut', 'cucurbitacees', 'achete', 21, 110, 3, 3, 1, 80],
  ['Potimarron', 'cucurbitacees', 'achete', 21, 95, 3, 2.5, 1, 80], ['Courgette', 'cucurbitacees', 'achete', 20, 50, 10, 5, 1, 80],
  ['Concombre', 'cucurbitacees', 'achete', 21, 55, 8, 4, 1, 50], ['Tomate', 'solanacees', 'achete', 19, 70, 10, 6, 1, 50],
  ['Poivron', 'solanacees', 'achete', 20, 80, 8, 2.5, 2, 40], ['Aubergine', 'solanacees', 'achete', 21, 80, 8, 2.5, 2, 50],
  ['Pomme de terre', 'solanacees', 'direct', 15, 100, 3, 2.5, 2, 35], ['Cacahuète', 'fabacees', 'achete', 20, 140, 2, 0.4, 2, 25],
  ['Maïs doux', 'poacees', 'direct', 20, 85, 3, 1.2, 2, 30], ['Haricot nain', 'fabacees', 'direct', 21, 60, 4, 1.2, 3, 8],
  ['Pois', 'fabacees', 'direct', 12, 80, 4, 0.8, 2, 3], ['Carotte', 'apiacees', 'direct', 14, 100, 8, 4, 4, 3],
  ['Betterave', 'amaranthacees', 'direct', 16, 75, 6, 3.5, 3, 8], ['Oignon', 'alliacees', 'achete', 13, 120, 4, 3, 4, 8],
  ['Ail', 'alliacees', 'direct', 44, 240, 2, 1, 4, 12], ['Poireau', 'alliacees', 'achete', 22, 130, 12, 3, 3, 12],
  ['Chou', 'brassicacees', 'achete', 19, 90, 4, 3.5, 2, 45], ['Chou kale', 'brassicacees', 'achete', 21, 70, 16, 1.5, 2, 45],
  ['Laitue', 'asteracees', 'achete', 15, 45, 2, 2.5, 3, 30], ['Épinard', 'amaranthacees', 'direct', 12, 50, 4, 1.5, 4, 5],
  ['Radis', 'brassicacees', 'direct', 12, 30, 2, 1.5, 5, 3], ['Fenouil', 'apiacees', 'achete', 24, 70, 4, 2.5, 2, 30],
  ['Céleri-rave', 'apiacees', 'achete', 21, 120, 6, 3, 2, 40], ['Blette', 'amaranthacees', 'achete', 18, 60, 16, 4, 2, 30],
  ['Panais', 'apiacees', 'direct', 14, 150, 10, 2.5, 3, 8], ['Navet', 'brassicacees', 'direct', 32, 60, 4, 3, 3, 10],
  ['Roquette', 'brassicacees', 'direct', 14, 35, 4, 1.2, 6, 2], ['Engrais vert', 'autre', 'direct', 36, 0, 0, 0, 0, 0],
].map(([nom, famille, mode, sem, jours, duree, rdt, lignes, interplant]) => ({ nom, famille, mode, sem, jours, duree, rdt, lignes, interplant }));
const MODES = [['achete', 'Plant acheté'], ['direct', 'Semis direct'], ['maison', 'Plant maison']];
const REPERES = [['plantation', 'la plantation (ou le semis)'], ['recolte', 'le début de récolte'], ['fin', 'la fin de récolte']];
/* Semaines de récolte proposées : plantation + jours jusqu'à la récolte, pendant la durée de récolte */
function semRecolteCalculee(semPlant, jours, duree) {
  const p = parseSemaines(semPlant); if (!p || !(num(jours) > 0)) return '';
  const a = ((p[0] - 1 + Math.round(num(jours) / 7)) % 52) + 1, b = ((a - 1 + Math.max(1, Math.round(num(duree) || 1)) - 1) % 52) + 1;
  return a === b ? String(a) : `${a}-${b}`;
}

/* ---------- Itinéraires ---------- */
const ITIN_DEFAUT = [
  { k: 'prepa', nom: 'Préparation de planche', etapes: [{ id: 'a', t: 'Broyage', r: 'plantation', j: -21 }, { id: 'b', t: 'Fraise à 10 cm', r: 'plantation', j: -14 }, { id: 'c', t: 'Faux semis', r: 'plantation', j: -10 }] },
  { k: 'desherb', nom: 'Désherbage', etapes: [{ id: 'a', t: 'Désherbage', r: 'plantation', j: 15 }, { id: 'b', t: 'Désherbage', r: 'plantation', j: 35 }] },
  { k: 'fin', nom: 'Fin de culture', etapes: [{ id: 'a', t: 'Broyage des résidus', r: 'fin', j: 7 }] },
];
const itineraires = () => { const l = (DB.get('cfg:itineraires') || {}).liste; return Array.isArray(l) ? l : ITIN_DEFAUT; };
const reperesTxt = (e) => `${num(e.j) === 0 ? 'à' : Math.abs(num(e.j)) + ' j ' + (num(e.j) < 0 ? 'avant' : 'après')} ${(REPERES.find((r) => r[0] === e.r) || REPERES[0])[1]}`;
/* Éditeur d'étapes (dans une fiche ou un itinéraire) : une ligne par étape */
function etapesEditeurHtml(id, etapes) {
  const ligne = (e) => `<div class="et-l" data-et><input value="${esc(e.t || '')}" data-ef="t" placeholder="Ex. Fraise à 10 cm" aria-label="Travail">
    <input type="number" value="${esc(e.j ?? '')}" data-ef="j" placeholder="jours" aria-label="Jours (négatif = avant)" style="width:76px">
    <select data-ef="r" aria-label="Repère">${REPERES.map(([k, l]) => `<option value="${k}"${(e.r || 'plantation') === k ? ' selected' : ''}>${k === 'plantation' ? 'plantation' : k === 'recolte' ? 'début récolte' : 'fin récolte'}</option>`).join('')}</select>
    <input type="number" step="0.5" value="${esc(e.h ?? '')}" data-ef="h" placeholder="h/pl." aria-label="Heures par planche (facultatif)" style="width:70px">
    <input type="hidden" data-ef="id" value="${esc(e.id || uid('e'))}"><button type="button" class="btn small" data-act="etSuppr" aria-label="Retirer">✕</button></div>`;
  return `<div class="et-ed" id="${id}">${etapes.map(ligne).join('')}</div><button type="button" class="btn small" data-act="etAjout" data-ed="${id}">+ Étape</button>
    <span class="sub">Jours : négatif = avant le repère (−14 = 2 semaines avant). h/pl. : heures par planche, pour estimer la charge de travail (facultatif).</span>`;
}
ACTIONS.etAjout = (el) => { const ed = $(el.dataset.ed); if (!ed) return; ed.insertAdjacentHTML('beforeend', etapesEditeurHtml('x', [{}]).match(/<div class="et-l"[\s\S]*?<\/div>/)[0]); ed.lastElementChild.querySelector('input').focus(); };
ACTIONS.etSuppr = (el) => { const l = el.closest('[data-et]'); if (l) l.remove(); };
const lireEtapes = (id) => [...document.querySelectorAll(`#${id} [data-et]`)].map((l) => { const g = (f) => (l.querySelector(`[data-ef="${f}"]`) || {}).value || ''; return { id: g('id') || uid('e'), t: g('t').trim(), r: g('r') || 'plantation', j: Math.round(num(g('j'))), h: g('h') === '' ? '' : num(g('h')) }; }).filter((e) => e.t);
function itinerairesHtml() {
  const l = itineraires();
  return `<div class="panel"><div class="between"><h2>Itinéraires de travail</h2><button class="btn small" type="button" data-act="itinEdit">+ Itinéraire</button></div>
    <p class="hint">Vos suites de travaux, à associer aux cultures dans leur fiche : leurs tâches se créent toutes seules dans Planification, aux bonnes dates.</p>
    ${l.length ? `<div class="items">${l.map((it) => `<button type="button" class="item" data-act="itinEdit" data-k="${esc(it.k)}"><span class="who"><strong>${esc(it.nom)}</strong><span class="meta">${it.etapes.map((e) => esc(e.t) + ' (' + (num(e.j) > 0 ? '+' : '') + num(e.j) + ' j)').join(' · ')}</span></span><span class="hint">${fiches().filter((f) => (f.itin || []).includes(it.k)).length} cult.</span></button>`).join('')}</div>` : '<p class="empty">Aucun itinéraire.</p>'}</div>`;
}
ACTIONS.itinEdit = (el) => {
  const k = el.dataset.k || '', it = k ? itineraires().find((x) => x.k === k) : { nom: '', etapes: [{}] };
  openSheet(`${sheetHead(k ? it.nom : 'Nouvel itinéraire')}<form class="sbody form" data-form="itin"><input type="hidden" name="k" value="${esc(k)}">
    ${inp('it-nom', 'Nom', it.nom, { name: 'nom', req: true, attrs: { placeholder: 'Ex. Préparation au rotavator' } })}
    <div class="field"><span class="flabel">Étapes</span>${etapesEditeurHtml('it-et', it.etapes)}</div>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="itinSuppr" data-k="${esc(k)}">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.itin = (v) => {
  const l = itineraires().slice(), etapes = lireEtapes('it-et'); if (!v.nom) { toast('Donne un nom.'); return; }
  const i = l.findIndex((x) => x.k === v.k), o = { k: v.k || uid('it'), nom: v.nom, etapes };
  if (i >= 0) l[i] = o; else l.push(o);
  DB.put('cfg:itineraires', { liste: l }); closeSheet(); toast('Itinéraire enregistré.'); synchroTachesCultures();
};
ACTIONS.itinSuppr = (el) => { DB.put('cfg:itineraires', { liste: itineraires().filter((x) => x.k !== el.dataset.k) }); closeSheet(); toast('Itinéraire supprimé (les tâches déjà créées restent).'); };

/* ---------- Les étapes d'une culture du plan, avec leur date ---------- */
function datesCulture(c) {
  const p = periodeCulture(c); if (!p) return null;
  return { plantation: p.debut, recolte: p.recolteDebut || '', fin: p.recolteDebut ? p.fin : '' };
}
function etapesCulture(c) {
  const f = DB.get(ficheDe(c)) || {}, mode = f.mode || c.mode || 'achete', d = datesCulture(c); if (!d) return [];
  const out = [], aj = (id, t, r, j, h, src) => { const base = d[r]; if (!base) return; out.push({ id, t, r, j, h, src, date: addDays(base, num(j)) }); };
  if (mode === 'achete') aj('std:commande', 'Commander les plantons', 'plantation', -7 * num(reglagesPlantons().delai), '', 'standard');
  if (mode === 'maison') aj('std:pepiniere', 'Semis en pépinière', 'plantation', -7 * num(f.dureePep || 6), '', 'standard');
  aj('std:plantation', mode === 'direct' ? 'Semis' : 'Plantation', 'plantation', 0, '', 'standard');
  aj('std:recolte', 'Début de récolte', 'recolte', 0, '', 'standard');
  for (const k of f.itin || []) { const it = itineraires().find((x) => x.k === k); if (it) for (const e of it.etapes) aj(`it:${k}:${e.id}`, e.t, e.r, e.j, e.h, it.nom); }
  for (const e of f.etapes || []) aj(`fi:${e.id}`, e.t, e.r, e.j, e.h, 'fiche');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
/* ---------- Création et mise à jour des tâches dans Planification ---------- */
function synchroTachesCultures(saison) {
  if (typeof taches !== 'function') return { n: 0, m: 0 };
  const today = todayISO(), ss = saison ? [String(saison)] : saisons().filter((s) => s >= today.slice(0, 4));
  let n = 0, m = 0;
  sansAnnuler(() => {
    for (const s of ss) for (const c of cultures(s)) {
      const lien = Object.assign({}, c.taches || {}); let change = false;
      for (const e of etapesCulture(c)) {
        const tk = lien[e.id], t = tk ? DB.get(tk) : null;
        if (tk && !t) continue;                                           // supprimée par quelqu'un : on ne la recrée pas
        if (t) { if (t.statut !== 'termine' && !t.jour && !t.journee && t.echeance !== e.date) { DB.put(tk, Object.assign({}, t, { echeance: e.date })); m++; } continue; }
        if (e.date < addDays(today, -3)) continue;                         // déjà passée : rien à créer
        const g = typeof devinerCategorie === 'function' ? devinerCategorie(e.t, s) : { cat: 'champ', sous: '' };
        const k = 't:' + uid('t'), pl = (c.emplacements || []).map((x) => (typeof nomPlanche === 'function' ? nomPlanche(x) : x));
        DB.put(k, { titre: `${e.t} · ${c.nom}`, statut: 'afaire', importance: 2, echeance: e.date, cat: g.cat || 'champ', sous: g.sous || '', cultures: [c.key], planches: pl.join(', '), gen: { cul: c.key, etape: e.id }, heuresPrevues: e.h ? r2(num(e.h) * Math.max(1, num(c.planches))) : '', cree: new Date().toISOString(), creePar: Sync.me || '' });
        lien[e.id] = k; change = true; n++;
      }
      if (change) DB.put(c.key, Object.assign({}, DB.get(c.key), { taches: lien }));
    }
  });
  return { n, m };
}
ACTIONS.cuTaches = () => { const r = synchroTachesCultures(saisonCourante()); toast(r.n || r.m ? `${r.n} tâche${r.n > 1 ? 's' : ''} créée${r.n > 1 ? 's' : ''}${r.m ? `, ${r.m} remise${r.m > 1 ? 's' : ''} à la bonne date` : ''} dans Planification.` : 'Les tâches sont à jour.', 4500); };
/* Une fois par jour sur l'appareil : les nouvelles étapes et les dates changées */
setTimeout(() => { if (!(Sync.me || LOCAL_MODE) || ls.get('gdt-cu-synchro') === todayISO()) return; ls.set('gdt-cu-synchro', todayISO()); synchroTachesCultures(); }, 15000);

/* ---------- Rendement : moyenne des 5 dernières saisons récoltées ---------- */
function rendementMoyen(ficheKey) {
  const h = historiqueFiche(ficheKey).filter((x) => x.rdtReel > 0 && x.unite === 'kg' && String(x.saison) < todayISO().slice(0, 4) + '9').slice(0, 5);
  if (!h.length) return null;
  return { v: Math.round(h.reduce((a, x) => a + x.rdtReel, 0) / h.length * 100) / 100, n: h.length, de: h[h.length - 1].saison, a: h[0].saison };
}

/* ---------- Charge de travail : heures des cultures, semaine par semaine ---------- */
/* Heures réelles d'une saison, par culture et par semaine (repartir : « toutes les cultures » selon la surface) */
function heuresCulturesParSemaine(s) {
  const cs = cultures(s), P = paramsCultures(s), surf = {}; for (const c of cs) surf[c.key] = culture(c, P).surface;
  const o = {};
  for (const h of heuresToutes()) {
    if (yearOf(h.date) !== String(s) || !(num(h.heures) > 0)) continue;
    const w = semaineISO(h.date).semaine, r = repartir(num(h.heures), h.pour, surf);
    for (const [k, x] of Object.entries(r.cultures)) { (o[k] = o[k] || {})[w] = (o[k][w] || 0) + x; }
  }
  return { o, surf };
}
/* Profil appris : pour une fiche, heures par m² selon la semaine depuis la plantation (moyenne des saisons passées) */
function profilFiche(ficheKey, avant) {
  const prof = {}; let n = 0;
  for (const s of saisons().filter((x) => x < avant).sort().reverse().slice(0, 5)) {
    const c = cultures(s).find((x) => ficheDe(x) === ficheKey), d = c && datesCulture(c); if (!d) continue;
    const H = heuresCulturesParSemaine(s), hs = H.o[c.key], sf = H.surf[c.key]; if (!hs || !sf) continue;
    const w0 = semaineISO(d.plantation).semaine; n++;
    for (const [w, x] of Object.entries(hs)) { const off = Number(w) - w0; prof[off] = (prof[off] || 0) + x / sf; }
  }
  if (!n) return null;
  for (const k of Object.keys(prof)) prof[k] /= n;
  return { prof, n };
}
function chargePrevue(s) {
  const P = paramsCultures(s), sem = {}, src = {};
  for (const c of cultures(s)) {
    const d = datesCulture(c); if (!d) continue; const sf = culture(c, P).surface, pr = profilFiche(ficheDe(c), String(s));
    if (pr) { const w0 = semaineISO(d.plantation).semaine; for (const [off, x] of Object.entries(pr.prof)) { const w = w0 + Number(off); if (w >= 1 && w <= 53) sem[w] = (sem[w] || 0) + x * sf; } src[c.key] = `appris (${pr.n} saison${pr.n > 1 ? 's' : ''})`; }
    else { let any = false; for (const e of etapesCulture(c)) if (num(e.h) > 0 && yearOf(e.date) === String(s)) { const w = semaineISO(e.date).semaine; sem[w] = (sem[w] || 0) + num(e.h) * Math.max(1, num(c.planches)); any = true; } src[c.key] = any ? 'heures des étapes' : 'pas encore de données'; }
  }
  return { sem, src };
}

/* ---------- Onglet Frise : l'année de chaque culture, puis la charge de travail ---------- */
/* Frise de la saison et charge de travail : dans « Plan de cultures » */
function friseHtml(s) {
  const list = cultures(s), y = Number(s), today = todayISO();
  const deb = `${y}-01-01`, fin = `${y}-12-31`, tot = jours0(deb, fin) + 1, pc = (d) => Math.max(0, Math.min(100, jours0(deb, d) / tot * 100));
  const mois = MOIS_COURT.map((m, i) => `<span style="left:${pc(`${y}-${String(i + 1).padStart(2, '0')}-01`)}%">${m}</span>`).join('');
  const barre = (a, b, cls, titre) => (a && b && b >= deb && a <= fin ? `<span class="fr-b ${cls}" style="left:${pc(a < deb ? deb : a)}%;width:${Math.max(0.6, pc(b > fin ? fin : b) - pc(a < deb ? deb : a))}%" title="${esc(titre)}"></span>` : '');
  const auj = today.slice(0, 4) === s ? `<span class="fr-auj" style="left:${pc(today)}%"></span>` : '';
  const lignes = list.map((c, i) => {
    const d = datesCulture(c), f = DB.get(ficheDe(c)) || {}, coul = f.couleur || couleurCulture(c, i), mode = f.mode || 'achete';
    if (!d) return `<div class="fr-l"><span class="fr-n"><span class="sw" style="background:${coul}"></span>${esc(c.nom)}</span><span class="fr-t hint">pas de semaine de plantation dans la fiche</span></div>`;
    const pep = mode === 'maison' ? barre(addDays(d.plantation, -7 * num(f.dureePep || 6)), d.plantation, 'pep', 'Pépinière') : '';
    const sol = barre(d.plantation, d.recolte || d.fin || addDays(d.plantation, 84), 'sol', 'En terre'), rec = d.recolte ? barre(d.recolte, d.fin, 'rec', 'Récolte') : '';
    const ets = etapesCulture(c).filter((e) => e.src !== 'standard').map((e) => `<span class="fr-e" style="left:${pc(e.date)}%" title="${esc(e.t + ' · ' + fmtDate(e.date))}"></span>`).join('');
    return `<div class="fr-l" style="--c:${coul}"><a class="fr-n" href="#/cultures/fiches/${encodeURIComponent(ficheDe(c))}"><span class="sw" style="background:${coul}"></span>${esc(c.nom)}</a><span class="fr-t">${pep}${sol}${rec}${ets}${auj}</span></div>`;
  }).join('');
  /* Charge : prévue (apprise) et réelle, par semaine */
  const C = chargePrevue(s), R = heuresCulturesParSemaine(s), reel = {}; for (const m of Object.values(R.o)) for (const [w, x] of Object.entries(m)) reel[w] = (reel[w] || 0) + x;
  const max = Math.max(1, ...Object.values(C.sem), ...Object.values(reel)), wNow = today.slice(0, 4) === s ? semaineISO(today).semaine : 0;
  const barres = Array.from({ length: 52 }, (_, i) => i + 1).map((w) => `<span class="ch-w${w === wNow ? ' now' : ''}" title="Semaine ${w} : prévu ${fmtH(r2(C.sem[w] || 0))} h${reel[w] ? ', réel ' + fmtH(r2(reel[w])) + ' h' : ''}"><i class="p" style="height:${(C.sem[w] || 0) / max * 100}%"></i><i class="r" style="height:${(reel[w] || 0) / max * 100}%"></i></span>`).join('');
  const totP = Object.values(C.sem).reduce((a, x) => a + x, 0);
  return `<div class="panel"><div class="between"><h2>Frise ${s}</h2><button class="btn small" type="button" data-act="cuTaches">Créer / mettre à jour les tâches</button></div>
      ${list.length ? `<div class="frise"><div class="fr-l fr-mois"><span class="fr-n"></span><span class="fr-t">${mois}</span></div>${lignes}</div>
      <p class="hint fr-leg"><span class="fr-b pep"></span> pépinière <span class="fr-b sol"></span> en terre <span class="fr-b rec"></span> récolte <span class="fr-e"></span> étape d'un itinéraire · Les dates viennent des semaines de la fiche de chaque culture.</p>` : '<p class="empty">Aucune culture dans ce plan.</p>'}</div>
    <div class="panel"><h2>Charge de travail prévue · cultures</h2>
      <div class="charge">${barres}</div><div class="charge-ax">${[0, 3, 6, 9].map((m) => `<span style="left:${m / 12 * 100}%">${MOIS_COURT[m]}</span>`).join('')}</div>
      <p class="hint"><span class="lg p"></span> prévu (${fmtH(r2(totP))} h sur la saison) <span class="lg r"></span> réel. Le prévu apprend des heures notées les saisons passées, semaine par semaine depuis la plantation, et à la surface de cette année ; les heures « champ » sans culture précise sont réparties selon la surface. Sans historique, il prend les heures estimées des étapes (h par planche).</p>
      ${list.length ? `<p class="hint">${list.map((c) => `${esc(c.nom)} : ${esc(C.src[c.key] || '—')}`).join(' · ')}</p>` : ''}</div>`;
}
const jours0 = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
