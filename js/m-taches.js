/* Gamins de Talus — tâches partagées. */
'use strict';

const taches = () => DB.all('t:');
const tacheParCle = (k) => { const t = DB.get(k); return t ? Object.assign({ key: k }, t) : null; };
const TA = { qui: '', cat: '', vue: '' };
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}${u.length > 48 ? '…' : ''}</a>`);

/* Tâches récurrentes : quand on termine une tâche qui se répète, la suivante est créée avec la prochaine échéance */
const REPETITIONS = [['', 'Ne se répète pas'], ['hebdo', 'Chaque semaine'], ['bihebdo', 'Toutes les 2 semaines'], ['mensuel', 'Chaque mois'], ['trimestriel', 'Tous les 3 mois'], ['annuel', 'Chaque année']];
function ajouterMois(d, n) { const [y, m, j] = d.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + n, 1)), fin = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(j, fin)).padStart(2, '0')}`; }
function prochaineEcheance(base, rep) {
  /* n-ième échéance calculée depuis la date de départ (le 31 reste le dernier jour du mois, sans glisser au 28) */
  const nieme = (n) => rep === 'hebdo' ? addDays(base, 7 * n) : rep === 'bihebdo' ? addDays(base, 14 * n) : ajouterMois(base, n * (rep === 'mensuel' ? 1 : rep === 'trimestriel' ? 3 : 12));
  const today = todayISO(); let n = 1; while (nieme(n) < today && n < 600) n++; return nieme(n);
}
function repeterSiBesoin(k, t) {
  if (!t.rep || (t.repSuivante && DB.get(t.repSuivante))) return;
  const nk = 't:' + uid('t'), ech = prochaineEcheance(t.echeance || jourPlanifie(t) || todayISO(), t.rep);
  DB.put(nk, { titre: t.titre, statut: 'afaire', importance: importanceDe(t), responsable: t.responsable || '', cat: catTache(t).cat, sous: catTache(t).sous, cultures: t.cultures || [], planches: t.planches || '', liste: (t.liste || []).map((x) => ({ t: x.t, fait: false })), remarques: t.remarques || '', rep: t.rep, echeance: ech, cree: new Date().toISOString(), creePar: Sync.me || '' });
  DB.put(k, Object.assign({}, DB.get(k), { repSuivante: nk }));
  toast(`Tâche terminée. La prochaine est prévue le ${fmtDate(ech)}.`, 4000);
}
/* ---------- Le modèle d'une tâche ----------
   importance : 1 Important, 2 Normal, 3 Quand on peut (avant : « urgent » → 1, « suspendu » → 3)
   echeance : la date limite (facultative) — ce n'est PAS le jour où on la fait
   jour : le jour où on prévoit de la faire, ou journee = 'ev:…|AAAA-MM-JJ' : rattachée à une journée de travail prévue
   Une tâche pas planifiée attend dans « À planifier », triée : échéance proche d'abord, puis importance.
   Planifiée, elle ne se voit plus que dans la vue d'ensemble, à son jour ou sous sa journée. Si le jour passe sans qu'elle
   soit faite, elle revient dans « À planifier ». */
const IMPORTANCES = [[1, 'Important', '●●●'], [2, 'Normal', '●●'], [3, 'Quand on peut', '●']];
const ECH_PROCHE = 7; // jours : une échéance plus proche que ça fait remonter la tâche en haut de la liste
const importanceDe = (t) => Number(t.importance) || (t.urgent ? 1 : t.statut === 'suspendu' ? 3 : 2);
function journeeDe(t) {
  if (!t || !t.journee) return null; const [k, d] = String(t.journee).split('|'); const e = DB.get(k);
  if (!e || !d || (e.exceptions || []).includes(d)) return null; return { key: k, date: d, e, titre: titreEv(e) };
}
const jourPlanifie = (t) => { const j = journeeDe(t); return j ? j.date : t.jour || ''; };
const dateTache = jourPlanifie;
const tacheOuverte = (t) => t.statut !== 'termine';
const estPlanifiee = (t) => { const d = jourPlanifie(t); return !!d && d >= todayISO(); };
const tacheEnRetard = (t) => tacheOuverte(t) && !!t.echeance && t.echeance < todayISO();
const echeanceProche = (t) => tacheOuverte(t) && !!t.echeance && t.echeance <= addDays(todayISO(), ECH_PROCHE);
/* Prévue un jour passé (seule ou dans une journée) et pas cochée : elle revient en tête de « À planifier » */
const pasTerminee = (t) => tacheOuverte(t) && !!jourPlanifie(t) && jourPlanifie(t) < todayISO();
function trierAPlanifier(l) {
  return l.sort((a, b) => (pasTerminee(b) - pasTerminee(a)) || (pasTerminee(a) && pasTerminee(b) ? jourPlanifie(b).localeCompare(jourPlanifie(a)) : 0) || (echeanceProche(b) - echeanceProche(a)) || (echeanceProche(a) && echeanceProche(b) ? String(a.echeance).localeCompare(String(b.echeance)) : 0)
    || importanceDe(a) - importanceDe(b) || String(a.echeance || '9').localeCompare(String(b.echeance || '9')) || String(a.cree || '').localeCompare(String(b.cree || '')));
}
/* L'ordre des tâches dans une journée ou un jour (glisser par la poignée ⋮⋮) */
const triOrdre = (a, b) => (a.statut === 'termine') - (b.statut === 'termine') || (a.ordre ?? 1e9) - (b.ordre ?? 1e9) || importanceDe(a) - importanceDe(b) || String(a.cree || '').localeCompare(String(b.cree || ''));
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest && e.target.closest('[data-poignee]'); if (!h) return;
  const item = h.closest('[data-tache]'), box = item && item.closest('.tri-taches'); if (!box) return;
  e.preventDefault();
  item.classList.add('en-tri'); box.classList.add('tri-actif');
  const freres = () => [...box.children].filter((x) => x.dataset && x.dataset.tache);
  const bouge = (ev) => {
    const y = ev.clientY, autres = freres().filter((x) => x !== item); let avant = null;
    for (const x of autres) { const r = x.getBoundingClientRect(); if (y < r.top + r.height / 2) { avant = x; break; } }
    if (avant) { if (item.nextElementSibling !== avant) box.insertBefore(item, avant); } else { const der = autres[autres.length - 1]; if (der && der.nextElementSibling !== item) der.after(item); }
  };
  const fin = () => {
    document.removeEventListener('pointermove', bouge); document.removeEventListener('pointerup', fin); document.removeEventListener('pointercancel', fin);
    item.classList.remove('en-tri'); box.classList.remove('tri-actif');
    freres().forEach((x, i) => { const t = DB.get(x.dataset.tache); if (t && t.ordre !== i) DB.put(x.dataset.tache, Object.assign({}, t, { ordre: i })); });
    if (typeof rafraichirFenetre === 'function') rafraichirFenetre();
  };
  /* Sur le document (la ligne déplacée change de place dans la page pendant le geste) */
  document.addEventListener('pointermove', bouge); document.addEventListener('pointerup', fin); document.addEventListener('pointercancel', fin);
});
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('[data-poignee]')) e.preventDefault(); });
const pourQui = (t) => TA.qui === 'moi' ? (t.responsable === Sync.me || t.responsable === 'ensemble' || !t.responsable) : TA.qui ? t.responsable === TA.qui : true;
const aPlanifier = () => trierAPlanifier(taches().filter((t) => tacheOuverte(t) && !estPlanifiee(t)));
/* Ce qui presse vraiment : pas planifiée et échéance dans 2 jours ou dépassée (pour moi) */
const tachesUrgentesPourMoi = () => { const d2 = addDays(todayISO(), 2); return taches().filter((t) => tacheOuverte(t) && !estPlanifiee(t) && t.echeance && t.echeance <= d2 && (typeof pourMoi !== 'function' || pourMoi(t.responsable))); };

/* L'ancienne adresse des tâches mène à la Planification */
MODULES.taches = { titre: 'Planification', render(sub) { setTimeout(() => location.replace(sub === 'semaine' ? '#/calendrier/feuille' : '#/calendrier/taches'), 0); return ''; } };

function renderTaches() {
  const tout = taches().filter(pourQui);
  const filtreCat = (t) => !TA.cat || (catTache(t).cat || '-') === TA.cat;
  const ouv = tout.filter(tacheOuverte), aP = trierAPlanifier(ouv.filter((t) => !estPlanifiee(t))), pl = ouv.filter(estPlanifiee), fin = tout.filter((t) => !tacheOuverte(t));
  const base = TA.vue === 'planifiees' ? pl : TA.vue === 'faites' ? fin : aP;
  const nCat = {}; for (const t of base) { const c = catTache(t).cat || '-'; nCat[c] = (nCat[c] || 0) + 1; }
  const l = base.filter(filtreCat);
  const vues = [['', `À planifier · ${aP.length}`], ['planifiees', `Planifiées · ${pl.length}`], ['faites', 'Faites']].map(([k, n]) => `<button class="chip${TA.vue === k ? ' on' : ''}" type="button" data-act="taVue" data-k="${k}">${esc(n)}</button>`).join('');
  const quiChips = [['', 'Toutes'], ['moi', 'Les miennes']].concat(persOptions(true)).map(([k, n]) => `<button class="chip${TA.qui === k ? ' on' : ''}" type="button" data-act="taQui" data-k="${k}">${esc(n)}</button>`).join('');
  const catChips = catsTaches().concat([{ k: '-', nom: 'Sans catégorie', icone: '', couleur: '#999' }]).filter((c) => nCat[c.k] || TA.cat === c.k)
    .map((c) => `<button class="chip catchip${TA.cat === c.k ? ' on' : ''}" style="--c:${esc(c.couleur)}" type="button" data-act="taCat" data-k="${esc(c.k)}">${esc(c.icone || '')} ${esc(c.nom)}<span class="n">${nCat[c.k] || 0}</span></button>`).join('');
  let corps = '';
  if (!TA.vue) corps = listeAPlanifierHtml(l, { vide: `Rien à planifier${TA.qui || TA.cat ? ' avec ce filtre' : ''}. 👌` });
  else if (TA.vue === 'planifiees') {
    const parJour = {}; for (const t of l) (parJour[jourPlanifie(t)] = parJour[jourPlanifie(t)] || []).push(t);
    corps = Object.keys(parJour).sort().map((d) => `<h3>${d === todayISO() ? "Aujourd'hui" : esc(dateLongue(d))}</h3>${parJour[d].map((t) => tacheHtml(t, { plan: true })).join('')}`).join('') || '<p class="empty">Aucune tâche planifiée.</p>';
  } else corps = l.sort((a, b) => String(b.termineLe || '').localeCompare(String(a.termineLe || ''))).slice(0, 80).map((t) => tacheHtml(t)).join('') || '<p class="empty">Aucune tâche faite.</p>';
  const catQ = TA.cat && TA.cat !== '-' ? catInfo(TA.cat) : null;
  return `<div class="panel">
    <div class="between"><form class="quick" data-form="taQuick" style="flex:1"><input name="titre" id="ta-quick" placeholder="Nouvelle tâche${catQ ? ' (' + esc(catQ.nom) + ')' : ''}… (Entrée : ajout rapide)" autocomplete="off" aria-label="Nouvelle tâche"><button class="btn primary" type="button" data-act="taAjoutFiche">+ Tâche</button></form>
      <a class="btn small" href="#/calendrier/feuille">🖨 Feuille de la semaine</a></div>
    <div class="chips">${vues}</div><div class="chips">${quiChips}</div>${catChips ? `<div class="chips">${catChips}</div>` : ''}
    ${corps}
  </div>`;
}
/* La liste « À planifier » : échéance proche en haut, puis par importance */
function listeAPlanifierHtml(l, o = {}) {
  if (!l.length) return `<p class="empty">${o.vide || 'Rien à planifier.'}</p>`;
  const pasFinies = l.filter(pasTerminee), proches = l.filter((t) => !pasTerminee(t) && echeanceProche(t)), reste = l.filter((t) => !pasTerminee(t) && !echeanceProche(t));
  const sec = (titre, xs, cls) => xs.length ? `<div class="ta-sec${cls ? ' ' + cls : ''}"><h4>${titre} · ${xs.length}</h4>${xs.map((t) => tacheHtml(t, o)).join('')}</div>` : '';
  o = Object.assign({ planifier: true }, o);
  return sec('↩ Pas terminées ?', pasFinies, 'pasfinie') + sec('⏰ Échéance proche', proches, 'proche') + IMPORTANCES.map(([n, nom, pts]) => sec(`<span class="imp imp${n}">${pts}</span> ${nom}`, reste.filter((t) => importanceDe(t) === n))).join('');
}
function tacheHtml(t, o = {}) {
  const done = !tacheOuverte(t), c = catTache(t), j = journeeDe(t), imp = importanceDe(t), today = todayISO();
  const meta = [];
  if (!o.sansCat && c.cat) meta.push(catPill(c.cat, c.sous)); else if (c.sous) meta.push(catPill(c.cat, c.sous, true));
  if (t.echeance && !done) meta.push(`<span class="ech${t.echeance < today ? ' passee' : echeanceProche(t) ? ' proche' : ''}">⏰ ${t.echeance < today ? 'échéance dépassée · ' : 'avant le '}${fmtDateCourt(t.echeance)}</span>`);
  if (o.plan && j) meta.push(`<span>📅 ${esc(j.titre)}</span>`);
  if (pasTerminee(t)) { const jp = journeeDe(t); meta.push(`<span class="pasfinie">pas cochée ${jp ? '· ' + esc(jp.titre) + ' ' : ''}du ${fmtDateCourt(jourPlanifie(t))}</span>`); }
  if (t.responsable) meta.push(`<span>${esc(nomDe(t.responsable))}</span>`);
  const cus = (t.cultures || []).map((k) => DB.get(k)).filter(Boolean);
  if (cus.length) meta.push(`<span>🌿 ${esc(cus.map((x) => x.nom).join(', '))}</span>`);
  if (t.planches) meta.push(`<span>▦ ${esc(t.planches)}</span>`);
  const ctc = t.contactId && DB.get(t.contactId); if (ctc) meta.push(`<span>👤 ${esc(displayName(ctc))}</span>`);
  const li = t.liste || []; if (li.length) meta.push(`<span>☑ ${li.filter((x) => x.fait).length}/${li.length}</span>`);
  if (t.rep && !done) meta.push(`<span title="Tâche qui se répète">↻</span>`);
  return `<div class="task${done ? ' done' : ''}" draggable="${done ? 'false' : 'true'}" data-tache="${esc(t.key)}" style="--c:${esc(couleurCat(c.cat))}">${o.tri && !done ? '<span class="poignee" data-poignee draggable="false" title="Glisser pour changer l\'ordre" aria-hidden="true">⋮⋮</span>' : ''}<button class="tick" type="button" data-act="taTick" data-key="${esc(t.key)}" aria-label="${done ? 'Rouvrir' : 'Marquer comme faite'} : ${esc(t.titre)}"></button>
    <div class="body" data-act="taVoir" data-key="${esc(t.key)}" role="button" tabindex="0"><strong>${!done && !o.sansImp ? `<span class="imp imp${imp}" title="${esc(IMPORTANCES[imp - 1][1])}">${IMPORTANCES[imp - 1][2]}</span> ` : ''}${esc(t.titre)}</strong>${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}${t.remarques && !o.court ? `<span class="meta">${linkify(trunc(t.remarques, 160))}</span>` : ''}</div></div>`;
}
/* Planifier en deux touches (téléphone) : une journée prévue, ou un jour */
ACTIONS.taPlanifier = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return; const today = todayISO();
  const jrs = journeesProchaines().slice(0, 8);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d, i) => [d, i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3) + ' ' + fmtDateCourt(d)]);
  PL.rafraichir = null;
  const jp = journeeDe(t), pf = pasTerminee(t);
  openSheet(`${sheetHead(t.titre, pf ? 'Pas terminée ?' : 'À planifier')}<div class="sbody">
    ${pf ? `<div class="pasfinie-box"><p>Prévue ${jp ? 'pendant « ' + esc(jp.titre) + ' » ' : ''}le ${esc(dateLongue(jourPlanifie(t)))}, mais pas cochée.</p><div class="row"><button class="btn primary" type="button" data-act="taFaiteOk" data-key="${esc(k)}">✓ En fait, c'est fait</button><span class="hint">Sinon, choisis un nouveau jour ci-dessous.</span></div></div>` : ''}
    ${resumeTacheHtml(t, k)}
    <h2 class="pl-q">Quand la faire ?</h2>
    ${jrs.length ? `<h3>Dans une journée prévue</h3><div class="menu-list">${jrs.map(([j, l]) => `<button type="button" class="menu-it" data-act="taPlanOk" data-key="${esc(k)}" data-j="${esc(j)}">📅 ${esc(l)}</button>`).join('')}</div>` : ''}
    <h3>Ou un jour</h3><div class="chips">${jours.map(([d, l]) => `<button type="button" class="chip" data-act="taPlanOk" data-key="${esc(k)}" data-d="${d}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px"><input type="date" id="tp-d" min="${today}"><button class="btn" type="button" data-act="taPlanOk" data-key="${esc(k)}" data-champ="1">OK</button></div>
    <div class="row-end">${estPlanifiee(t) ? `<button class="btn" type="button" data-act="taPlanOk" data-key="${esc(k)}" data-retirer="1">Remettre à planifier</button>` : ''}<button class="btn" type="button" data-act="taEdit" data-key="${esc(k)}">Modifier</button>${pf ? '' : `<button class="btn" type="button" data-act="taFaiteOk" data-key="${esc(k)}">✓ Faite</button>`}</div></div>`);
};
ACTIONS.taPlanOk = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return;
  if (el.dataset.retirer) { DB.put(k, Object.assign({}, t, { jour: '', journee: '' })); closeSheet(); toast('Remise dans « À planifier ».'); return; }
  const d = el.dataset.champ ? ($('tp-d') || {}).value : el.dataset.d, j = el.dataset.j || '';
  if (!j && !d) { toast('Choisis un jour.'); return; }
  DB.put(k, Object.assign({}, t, j ? { journee: j, jour: '' } : { jour: d, journee: '' })); closeSheet();
  toast(j ? `Rattachée à ${titreEv(DB.get(j.split('|')[0]) || {})} (${fmtDateCourt(j.split('|')[1])}).` : `Prévue le ${fmtDate(d)}.`);
};
ACTIONS.taQui = (el) => { TA.qui = el.dataset.k; render(); };
ACTIONS.taCat = (el) => { TA.cat = TA.cat === el.dataset.k ? '' : el.dataset.k; render(); };
ACTIONS.taVue = (el) => { TA.vue = el.dataset.k; render(); };
FORMS.taQuick = (v) => {
  if (!v.titre) return;
  const resp = TA.qui && TA.qui !== 'moi' ? TA.qui : '';
  DB.put('t:' + uid('t'), { titre: v.titre, statut: 'afaire', importance: 2, responsable: resp, cat: TA.cat && TA.cat !== '-' ? TA.cat : '', cree: new Date().toISOString(), creePar: Sync.me || '' });
  toast(`« ${v.titre} » ajoutée dans « À planifier ».`);
  setTimeout(() => { const q = $('ta-quick'); if (q) q.focus(); }, 0);
};
/* Le bouton ouvre la fiche (avec le titre déjà tapé) ; Entrée ajoute directement */
ACTIONS.taAjoutFiche = () => { const q = $('ta-quick'); ACTIONS.taEdit({ dataset: { key: '', titre: q ? q.value.trim() : '', cat: TA.cat && TA.cat !== '-' ? TA.cat : '' } }); };
ACTIONS.taTick = (el) => {
  const t = DB.get(el.dataset.key); if (!t) return;
  const done = t.statut === 'termine';
  DB.put(el.dataset.key, Object.assign({}, t, done ? { statut: 'afaire', termineLe: '' } : { statut: 'termine', termineLe: todayISO(), terminePar: Sync.me || '' }));
  if (!done) {
    if (t.rep) repeterSiBesoin(el.dataset.key, t); else toast('Tâche faite. 👍');
    /* Une récolte faite : on note tout de suite la quantité (sinon elle reste dans « Récoltes à noter ») */
    if (catTache(t).sous === 'recolte' && typeof ACTIONS.mvtNouveau === 'function') { setTimeout(() => ACTIONS.recolteEv({ dataset: { key: el.dataset.key } }), 50); return; }
  }
  if (typeof rafraichirFenetre === 'function') rafraichirFenetre();
};
/* Toucher une tâche : pas planifiée → choisir son jour ; sinon → son résumé (pour la faire). « Modifier » ouvre la fiche complète. */
ACTIONS.taVoir = (el) => { const t = DB.get(el.dataset.key); if (!t) return; if (!(el.closest && el.closest('#sheet'))) PL.rafraichir = null; if (tacheOuverte(t) && !estPlanifiee(t)) ACTIONS.taPlanifier(el); else ACTIONS.taResume(el); };
function resumeTacheHtml(t, k) {
  const c = catTache(t), j = journeeDe(t), cus = (t.cultures || []).map((k) => DB.get(k)).filter(Boolean), imp = importanceDe(t);
  const infos = [c.cat ? catPill(c.cat, c.sous) : '', `<span class="imp imp${imp}">${IMPORTANCES[imp - 1][2]}</span> ${IMPORTANCES[imp - 1][1]}`, t.responsable ? '👤 ' + esc(quiLabel(t.responsable)) : '',
    t.echeance ? `<span class="ech${t.echeance < todayISO() ? ' passee' : echeanceProche(t) ? ' proche' : ''}">⏰ avant le ${fmtDate(t.echeance)}</span>` : '',
    estPlanifiee(t) ? `📅 ${j ? esc(j.titre) + ', ' : ''}${esc(dateLongue(jourPlanifie(t)))}` : ''].filter(Boolean);
  return `<div class="ta-resume"><p class="meta">${infos.join(' <span class="sep">·</span> ')}</p>
    ${t.contactId && DB.get(t.contactId) ? `<p>👤 ${esc(displayName(DB.get(t.contactId)))}</p>` : ''}
    ${cus.length || t.planches ? `<p>${cus.length ? '🌿 ' + esc(cus.map((x) => x.nom).join(', ')) : ''}${cus.length && t.planches ? ' · ' : ''}${t.planches ? '▦ ' + esc(t.planches) : ''}</p>` : ''}
    ${(t.liste || []).length ? `<div class="ta-res-liste">${t.liste.map((x, i) => `<label class="row ta-li"><input type="checkbox" data-li-t="${esc(k)}|${i}"${x.fait ? ' checked' : ''}> <span${x.fait ? ' class="barre"' : ''}>${esc(x.t)}</span></label>`).join('')}</div>` : ''}
    ${t.remarques ? `<p class="pl-rem">${linkify(t.remarques)}</p>` : ''}</div>`;
}
ACTIONS.taResume = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return; const done = t.statut === 'termine';
  const retour = PL.rafraichir;
  openSheet(`${sheetHead(t.titre)}<div class="sbody">${resumeTacheHtml(t, k)}
    ${catTache(t).sous === 'livraison' && t.contactId ? `<div class="row"><button class="btn" type="button" data-act="taFacture" data-key="${esc(k)}">🧾 Créer la facture</button></div>` : ''}
    <div class="row-end"><button class="btn" type="button" data-act="taEdit" data-key="${esc(k)}">Modifier</button>${!done ? `<button class="btn" type="button" data-act="taPlanifier" data-key="${esc(k)}">📅 Changer le jour</button>` : ''}
      <button class="btn primary" type="button" data-act="taFaiteOk" data-key="${esc(k)}">${done ? 'Rouvrir' : '✓ Faite'}</button>${retour ? '<button class="btn link" type="button" data-act="plRetour">‹ Retour</button>' : ''}</div></div>`);
};
ACTIONS.taFacture = (el) => { const t = DB.get(el.dataset.key); if (!t || !t.contactId) return; draftF.livraison = jourPlanifie(t) || todayISO(); draftF.date = todayISO(); closeSheet(); go('#/factures/nouvelle/' + encodeURIComponent(t.contactId)); };
ACTIONS.taFaiteOk = (el) => { ACTIONS.taTick(el); if (PL.rafraichir) PL.rafraichir(); else closeSheet(); };
ACTIONS.plRetour = () => { if (PL.rafraichir) PL.rafraichir(); else closeSheet(); };
document.addEventListener('change', (e) => {
  const v = e.target.dataset && e.target.dataset.liT; if (!v) return; const [k, i] = v.split('|'), t = DB.get(k); if (!t) return;
  const l = (t.liste || []).map((x) => Object.assign({}, x)); if (!l[Number(i)]) return; l[Number(i)].fait = e.target.checked;
  DB.put(k, Object.assign({}, t, { liste: l })); const s = e.target.nextElementSibling; if (s) s.classList.toggle('barre', e.target.checked);
});
/* Les journées prévues auxquelles rattacher une tâche : événements des 6 prochaines semaines (sauf congés) */
function journeesProchaines(garder) {
  const today = todayISO(), it = itemsPeriode(addDays(today, -7), addDays(today, 42)), out = [];
  for (const d of Object.keys(it).sort()) for (const x of it[d]) if (x.kind === 'ev' && x.debut && catEv(DB.get(x.key) || {}).cat !== 'conge' && (d >= today || x.key + '|' + x.occ === garder)) out.push([x.key + '|' + x.occ, `${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)} · ${x.titre}${x.qui ? ' (' + quiLabel(x.qui) + ')' : ''}`]);
  return out;
}
/* Fiche d'une tâche (nouvelle si pas de clé) ; el.dataset peut préremplir jour, journee, cat */
ACTIONS.taEdit = (el) => {
  const k = el.dataset.key || '', t = k ? DB.get(k) : { titre: el.dataset.titre || '', statut: 'afaire', importance: 2, jour: el.dataset.date || '', journee: el.dataset.journee || '', cat: el.dataset.cat || '', responsable: '' };
  if (!t) return; const c = catTache(t), s = (jourPlanifie(t) || todayISO()).slice(0, 4), imp = importanceDe(t);
  const cus = typeof cultures === 'function' ? cultures(typeof saisons === 'function' && saisons().includes(s) ? s : saisonCourante()) : [];
  const jrs = journeesProchaines(t.journee);
  TA.liste = (t.liste || []).map((x) => Object.assign({}, x));
  PL.retourEdit = el.closest && el.closest('#sheet') ? PL.rafraichir : null;
  openSheet(`${sheetHead(k ? 'Modifier la tâche' : 'Nouvelle tâche')}<form class="sbody form" data-form="ta"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ta-titre', 'Tâche', t.titre, { name: 'titre', req: true, attrs: k ? {} : { autofocus: '' } })}
    ${catChoixHtml('ta-cat', c.cat, c.sous)}
    <div class="field"><span class="flabel">Importance</span><div class="seg">${IMPORTANCES.map(([n, nom, pts]) => `<label><input type="radio" name="importance" value="${n}"${imp === n ? ' checked' : ''}> <span class="imp imp${n}">${pts}</span> ${nom}</label>`).join('')}</div></div>
    <div class="grid2">${inp('ta-ech', 'Échéance (facultatif)', t.echeance, { name: 'echeance', type: 'date', sub: `Date limite. Elle fait remonter la tâche en haut de la liste ${ECH_PROCHE} jours avant.` })}
      ${sel('ta-resp', 'Qui', t.responsable || '', [['', '—']].concat(persOptions(true)), { name: 'responsable' })}</div>
    ${(() => {
      /* Le reste s'ouvre à la demande : un bouton « + » par partie (déjà ouverte si la tâche en a) */
      const a = { planif: !!(t.journee || t.jour), cult: !!((t.cultures || []).length || t.planches), client: !!t.contactId, liste: !!(t.liste || []).length, rep: !!t.rep, rem: !!t.remarques };
      const parts = [
        ['planif', '📅 Planifier', `<div class="grid2">${sel('ta-jour', 'Dans une journée prévue', t.journee || '', [['', '—']].concat(jrs), { name: 'journee' })}${inp('ta-j', 'Ou un jour', t.journee ? '' : t.jour, { name: 'jour', type: 'date' })}</div><span class="sub">Planifiée, elle quitte « À planifier » et se range à ce jour dans la vue d'ensemble.</span>`],
        ['cult', '🌿 Culture et planches', `${cus.length ? `<div class="field"><span class="flabel">Culture(s)</span><input type="hidden" name="cultures" id="ta-cus" value="${esc((t.cultures || []).join(','))}"><div class="chips">${cus.map((x) => `<button type="button" class="chip${(t.cultures || []).includes(x.key) ? ' on' : ''}" data-act="taCu" data-k="${esc(x.key)}">${esc(x.nom)}</button>`).join('')}</div></div>` : ''}${inp('ta-pl', 'Planche(s)', t.planches || '', { name: 'planches', attrs: { placeholder: 'ex. A3, A4 ou serre 2', maxlength: 60 } })}`],
        ['client', '👤 Client', `${sel('ta-ct', 'Client ou contact', t.contactId || '', [['', '—']].concat(tousContacts().sort(byName).map((x) => [x.key, displayName(x) + (x.prospect ? ' (prospect)' : '')])), { name: 'contactId', sub: 'Pour une livraison : « Créer la facture » depuis la tâche.' })}`],
        ['liste', '☑ Liste à cocher', `<div id="ta-liste">${listeTacheHtml()}</div><div class="row"><input id="ta-li" placeholder="Ajouter un élément…" style="flex:1" autocomplete="off"><button class="btn small" type="button" data-act="taLiAjout">+</button></div>`],
        ['rep', '↻ Répétition', sel('ta-rep', 'Se répète', t.rep || '', REPETITIONS, { name: 'rep', sub: 'Une fois faite, la suivante est créée avec la prochaine échéance.' })],
        ['rem', '📝 Remarques', txt('ta-rem', 'Remarques', t.remarques, { name: 'remarques', rows: 3 }) + (t.remarques && /https?:\/\//.test(t.remarques) ? `<p class="hint">${linkify(t.remarques)}</p>` : '')],
      ];
      return `<div class="row ta-plus-btns">${parts.map(([id, nom]) => `<button type="button" class="chip" data-act="taPartie" data-p="${id}"${a[id] ? ' hidden' : ''}>+ ${nom.replace(/^\S+ /, '')}</button>`).join('')}</div>
        ${parts.map(([id, nom, html]) => `<fieldset class="ta-partie" id="tp-${id}"${a[id] ? '' : ' hidden'}><legend>${nom}</legend>${html}</fieldset>`).join('')}`;
    })()}
    ${k ? `<label class="row" style="font-size:14px"><input type="checkbox" name="faite"${t.statut === 'termine' ? ' checked' : ''}> Faite</label>` : ''}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette tâche">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const li = $('ta-li'); if (li) li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.taLiAjout(); } });
  /* Une journée choisie efface le jour, et inversement */
  const sj = $('ta-jour'), dj = $('ta-j'); if (sj && dj) { sj.addEventListener('change', () => { if (sj.value) dj.value = ''; }); dj.addEventListener('change', () => { if (dj.value) sj.value = ''; }); }
};
function listeTacheHtml() { return TA.liste.map((x, i) => `<label class="row ta-li"><input type="checkbox" data-li="${i}"${x.fait ? ' checked' : ''}> <span style="flex:1">${esc(x.t)}</span><button type="button" class="btn link small" data-act="taLiOff" data-i="${i}" aria-label="Retirer">×</button></label>`).join(''); }
document.addEventListener('change', (e) => { const i = e.target.dataset && e.target.dataset.li; if (i == null || !TA.liste) return; TA.liste[Number(i)].fait = e.target.checked; });
ACTIONS.taLiAjout = () => { const i = $('ta-li'); if (!i || !i.value.trim()) return; TA.liste.push({ t: i.value.trim(), fait: false }); i.value = ''; $('ta-liste').innerHTML = listeTacheHtml(); i.focus(); };
ACTIONS.taLiOff = (el) => { TA.liste.splice(Number(el.dataset.i), 1); $('ta-liste').innerHTML = listeTacheHtml(); };
ACTIONS.taCu = (el) => { const h = $('ta-cus'), l = h.value ? h.value.split(',') : [], i = l.indexOf(el.dataset.k); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.k); h.value = l.join(','); el.classList.toggle('on', i < 0); };
ACTIONS.taPartie = (el) => { const f = $('tp-' + el.dataset.p); if (f) { f.hidden = false; const x = f.querySelector('input:not([type=hidden]), select, textarea'); if (x) x.focus(); } el.hidden = true; };
ACTIONS.taNouvelle = (el) => ACTIONS.taEdit({ dataset: Object.assign({}, el.dataset, { key: '' }) });
FORMS.ta = (v) => {
  if (!v.titre) return;
  const k = v.key || 't:' + uid('t'), t = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  const was = t.statut === 'termine', faite = !!v.faite;
  const o = Object.assign({}, t, { titre: v.titre, statut: faite ? 'termine' : 'afaire', importance: Number(v.importance) || 2, echeance: v.echeance || '', journee: v.journee || '', jour: v.journee ? '' : v.jour || '', responsable: v.responsable, cat: v.cat || '', sous: v.cat ? v.sous || '' : '', rep: v.rep || '',
    contactId: v.contactId != null ? v.contactId : t.contactId || '', cultures: v.cultures != null ? String(v.cultures).split(',').filter(Boolean) : (t.cultures || []), planches: v.planches != null ? String(v.planches).trim() : t.planches || '', liste: (TA.liste || []).slice(), remarques: v.remarques,
    termineLe: faite ? (was ? t.termineLe : todayISO()) : '' });
  delete o.tag; delete o.urgent;
  DB.put(k, o); closeSheet(); if (PL.retourEdit) { const r = PL.retourEdit; PL.retourEdit = null; setTimeout(r, 0); }
  if (faite && !was && o.rep) repeterSiBesoin(k, o); else toast(v.key ? 'Tâche enregistrée.' : 'Tâche ajoutée.');
};
