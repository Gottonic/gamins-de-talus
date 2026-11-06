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
/* Une tâche est urgente, ou pas (les anciennes « Important » sont urgentes ; « Normal » et « Quand on peut » ne le sont pas) */
const IMPORTANCES = [[1, 'Urgent', '🔥'], [2, 'Normale', '']];
const ECH_PROCHE = 7; // jours : une échéance plus proche que ça fait remonter la tâche en haut de la liste
const importanceDe = (t) => (Number(t.importance) === 1 || (!t.importance && t.urgent) ? 1 : 2);
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
    enregistrerOrdre(box);
  };
  /* Sur le document (la ligne déplacée change de place dans la page pendant le geste) */
  document.addEventListener('pointermove', bouge); document.addEventListener('pointerup', fin); document.addEventListener('pointercancel', fin);
});
document.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('[data-poignee]')) e.preventDefault(); });
/* Sur ordinateur, on peut aussi glisser la ligne entière d'une tâche dans sa liste (journée, jour) pour changer l'ordre */
const TRI = { el: null, box: null, avant: '' };
const ordreDe = (box) => [...box.children].filter((x) => x.dataset && x.dataset.tache).map((x) => x.dataset.tache).join(',');
document.addEventListener('dragstart', (e) => { const it = e.target.closest && e.target.closest('[data-tache]'), box = it && it.closest('.tri-taches'); TRI.el = box ? it : null; TRI.box = box || null; TRI.avant = box ? ordreDe(box) : ''; if (box) box.classList.add('tri-actif'); }, true);
document.addEventListener('dragend', () => { if (TRI.el) TRI.el.classList.remove('en-tri'); if (TRI.box) TRI.box.classList.remove('tri-actif');
  /* Lâchée sur elle-même ou entre deux lignes, la tâche a déjà changé de place à l'écran : on enregistre cet ordre-là */
  const b = TRI.box, change = b && b.isConnected && ordreDe(b) !== TRI.avant; TRI.el = null; TRI.box = null; if (change) { enregistrerOrdre(b); return; } document.querySelectorAll('.tri-actif').forEach((b) => b.classList.remove('tri-actif')); if (UI.pending && !enSaisie(document.activeElement)) { UI.pending = false; render(); } }, true);
document.addEventListener('dragover', (e) => {
  if (!TRI.el) return; const sur = e.target.closest && e.target.closest('[data-tache]');
  /* Au-dessus de sa propre ligne ou de sa liste : on accepte le lâcher (sinon le navigateur l'annule et l'ordre n'est pas gardé) */
  if (TRI.box.contains(e.target) && (!sur || sur === TRI.el)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return; }
  if (!sur || sur === TRI.el || sur.parentElement !== TRI.box) return;
  e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; TRI.el.classList.add('en-tri');
  const r = sur.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { if (sur.previousElementSibling !== TRI.el) TRI.box.insertBefore(TRI.el, sur); } else if (sur.nextElementSibling !== TRI.el) sur.after(TRI.el);
}, true);
document.addEventListener('drop', (e) => {
  if (!TRI.el || !(e.target.closest && e.target.closest('.tri-taches') === TRI.box)) return;
  e.preventDefault(); e.stopPropagation(); const box = TRI.box; TRI.el.classList.remove('en-tri'); box.classList.remove('tri-actif'); TRI.el = null; TRI.box = null;
  enregistrerOrdre(box);
}, true);
/* L'ordre affiché devient l'ordre enregistré ; puis l'écran se met à jour (il attendait la fin du geste) */
function enregistrerOrdre(box) {
  [...box.children].filter((x) => x.dataset && x.dataset.tache).forEach((x, i) => { const t = DB.get(x.dataset.tache); if (t && t.ordre !== i) DB.put(x.dataset.tache, Object.assign({}, t, { ordre: i })); });
  if (UI.pending) { UI.pending = false; render(); }
  if (typeof rafraichirFenetre === 'function') rafraichirFenetre();
}
/* Une tâche qu'on ajoute à une journée (ou à un jour) se met en bas de sa liste */
function ordreFin(o) {
  /* Les anciennes tâches sans ordre reçoivent d'abord leur place actuelle (sinon la nouvelle passerait devant elles) */
  const l = taches().filter((t) => (o.journee ? t.journee === o.journee : !t.journee && t.jour === o.jour)).sort(triOrdre);
  if (l.some((t) => t.ordre == null)) l.forEach((t, i) => { if (t.ordre !== i) DB.put(t.key, Object.assign({}, DB.get(t.key), { ordre: i })); });
  return l.length ? Math.max(l.length - 1, ...l.map((t) => num(t.ordre))) + 1 : 0;
}
const pourQui = (t) => TA.qui === 'moi' ? quiInclut(t.responsable, Sync.me) : TA.qui === 'ensemble' ? t.responsable === 'ensemble' : TA.qui ? quiDe(t).includes(TA.qui) : true;
const aPlanifier = () => trierAPlanifier(taches().filter((t) => tacheOuverte(t) && !estPlanifiee(t)));
/* Ce qui presse vraiment : pas planifiée et échéance dans 2 jours ou dépassée (pour moi) */
const tachesUrgentesPourMoi = () => { const d2 = addDays(todayISO(), 2); return taches().filter((t) => tacheOuverte(t) && !estPlanifiee(t) && t.echeance && t.echeance <= d2 && (typeof pourMoi !== 'function' || pourMoi(t.responsable))); };

/* L'ancienne adresse des tâches mène à la Planification */
MODULES.taches = { titre: 'Planification', render(sub) { setTimeout(() => location.replace('#/calendrier/taches'), 0); return ''; } };

function renderTaches() {
  const tout = taches().filter(pourQui);
  const filtreCat = (t) => !TA.cat || (catTache(t).cat || '-') === TA.cat;
  const ouv = tout.filter(tacheOuverte), aP = trierAPlanifier(ouv.filter((t) => !estPlanifiee(t))), pl = ouv.filter(estPlanifiee), fin = tout.filter((t) => !tacheOuverte(t));
  const base = TA.vue === 'planifiees' ? pl : TA.vue === 'faites' ? fin : aP;
  const nCat = {}; for (const t of base) { const c = catTache(t).cat || '-'; nCat[c] = (nCat[c] || 0) + 1; }
  const l = base.filter(filtreCat);
  const vues = [['', `À planifier · ${aP.filter((t) => !estPlusTard(t)).length}`], ['planifiees', `Planifiées · ${pl.length}`], ['faites', 'Faites']].map(([k, n]) => `<button class="chip${TA.vue === k ? ' on' : ''}" type="button" data-act="taVue" data-k="${k}">${esc(n)}</button>`).join('');
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
    ${ajoutTacheBarre({ id: 'ta-quick', cat: TA.cat && TA.cat !== '-' ? TA.cat : '', resp: TA.qui && TA.qui !== 'moi' ? TA.qui : '', placeholder: `Nouvelle tâche${catQ ? ' (' + catQ.nom + ')' : ''}…` })}
    <div class="chips">${vues}</div><div class="chips">${quiChips}</div>${catChips ? `<div class="chips">${catChips}</div>` : ''}
    ${corps}
  </div>`;
}
/* La liste « À planifier » : échéance proche en haut, puis par importance */
/* « À planifier » : à venir (échéance dans les 30 prochains jours, ou dépassée), puis quand on peut (sans échéance).
   Une échéance plus lointaine attend, repliée dans « Plus tard ». */
const A_VENIR_JOURS = 30;
const estPlusTard = (t) => !!t.echeance && t.echeance > addDays(todayISO(), A_VENIR_JOURS);
function listeAPlanifierHtml(l, o = {}) {
  if (!l.length) return `<p class="empty">${o.vide || 'Rien à planifier.'}</p>`;
  o = Object.assign({ planifier: true }, o);
  const parEch = (a, b) => String(a.echeance).localeCompare(String(b.echeance)) || importanceDe(a) - importanceDe(b);
  const aVenir = l.filter((t) => t.echeance && !estPlusTard(t)).sort(parEch), qop = l.filter((t) => !t.echeance), tard = l.filter(estPlusTard).sort(parEch);
  const sec = (titre, xs, cls) => xs.length ? `<div class="ta-sec${cls ? ' ' + cls : ''}"><h4>${titre} · ${xs.length}</h4>${xs.map((t) => tacheHtml(t, o)).join('')}</div>` : '';
  return (aVenir.length || qop.length ? '' : `<p class="empty">${o.vide || 'Rien à planifier.'}</p>`) + sec('⏰ À venir', aVenir, 'proche') + sec('Quand on peut', qop)
    + (tard.length ? `<details class="ta-sec ta-tard"><summary><h4>Plus tard · ${tard.length}</h4></summary>${tard.map((t) => tacheHtml(t, o)).join('')}</details>` : '');
}
function tacheHtml(t, o = {}) {
  const done = !tacheOuverte(t), c = catTache(t), j = journeeDe(t), imp = importanceDe(t), today = todayISO();
  const meta = [];
  if (!o.sansCat && c.cat) meta.push(catPill(c.cat, c.sous)); else if (c.sous) meta.push(catPill(c.cat, c.sous, true));
  if (t.echeance && !done) meta.push(`<span class="ech${t.echeance < today ? ' passee' : echeanceProche(t) ? ' proche' : ''}">⏰ ${t.echeance < today ? 'échéance dépassée · ' : 'avant le '}${fmtDateCourt(t.echeance)}</span>`);
  if (o.plan && j) meta.push(`<span>📅 ${esc(j.titre)}</span>`);
  if (pasTerminee(t)) { const jp = journeeDe(t); meta.push(`<span class="pasfinie">pas cochée ${jp ? '· ' + esc(jp.titre) + ' ' : ''}du ${fmtDateCourt(jourPlanifie(t))}</span>`); }
  if (t.responsable) meta.push(`<span>${esc(quiLabel(t.responsable))}</span>`);
  const cus = (t.cultures || []).map((k) => DB.get(k)).filter(Boolean);
  if (cus.length) meta.push(`<span>🌿 ${esc(cus.map((x) => x.nom).join(', '))}</span>`);
  if (t.planches) meta.push(`<span>▦ ${esc(t.planches)}</span>`);
  const ctc = t.contactId && DB.get(t.contactId); if (ctc) meta.push(`<span>👤 ${esc(displayName(ctc))}</span>`);
  const li = t.liste || []; if (li.length) meta.push(`<span>☑ ${li.filter((x) => x.fait).length}/${li.length}</span>`);
  if (t.rep && !done) meta.push(`<span title="Tâche qui se répète">↻</span>`);
  return `<div class="task${done ? ' done' : ''}" draggable="${done ? 'false' : 'true'}" data-tache="${esc(t.key)}" style="--c:${esc(couleurCat(c.cat))}">${o.tri && !done ? '<span class="poignee" data-poignee draggable="false" title="Glisser pour changer l\'ordre" aria-hidden="true">⋮⋮</span>' : ''}<button class="tick" type="button" data-act="taTick" data-key="${esc(t.key)}" aria-label="${done ? 'Rouvrir' : 'Marquer comme faite'} : ${esc(t.titre)}"></button>
    <div class="body" data-act="taVoir" data-key="${esc(t.key)}" role="button" tabindex="0"><strong>${!done && !o.sansImp && imp === 1 ? '<span class="imp imp1" title="Urgent">🔥</span> ' : ''}${esc(t.titre)}</strong>${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}${t.remarques && !o.court ? `<span class="meta">${linkify(trunc(t.remarques, 160))}</span>` : ''}</div>${o.sous && li.length ? `<div class="ta-sous">${li.map((x, i) => `<label class="ta-li"><input type="checkbox" data-li-t="${esc(t.key)}|${i}"${x.fait ? ' checked' : ''}> <span${x.fait ? ' class="barre"' : ''}>${esc(x.t)}</span></label>`).join('')}</div>` : ''}</div>`;
}
/* Planifier en deux touches (téléphone) : une journée prévue, ou un jour */
ACTIONS.taPlanifier = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return; const today = todayISO();
  const jrs = journeesProchaines().slice(0, 8);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d, i) => [d, i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3) + ' ' + fmtDateCourt(d)]);
  PL.rafraichir = null; TA.fenetre = 'taPlanifier';
  const jp = journeeDe(t), pf = pasTerminee(t);
  if (!TA.ouvert || TA.ouvert.k !== k) TA.ouvert = null;
  openSheet(`${titreTacheHead(t, k, pf ? 'Pas terminée ?' : 'À planifier')}<div class="sbody">
    ${pf ? `<div class="pasfinie-box"><p>Prévue ${jp ? 'pendant « ' + esc(jp.titre) + ' » ' : ''}le ${esc(dateLongue(jourPlanifie(t)))}, mais pas cochée.</p><div class="row"><button class="btn primary" type="button" data-act="taFaiteOk" data-key="${esc(k)}">✓ En fait, c'est fait</button><span class="hint">Sinon, choisis un nouveau jour ci-dessous.</span></div></div>` : ''}
    ${resumeTacheHtml(t, k)}
    <h2 class="pl-q">Quand la faire ?</h2>
    ${jrs.length ? `<h3>Dans une journée prévue</h3><div class="menu-list">${jrs.map(([j, l]) => `<button type="button" class="menu-it" data-act="taPlanOk" data-key="${esc(k)}" data-j="${esc(j)}">📅 ${esc(l)}</button>`).join('')}</div>` : ''}
    <h3>Ou un jour</h3><div class="chips">${jours.map(([d, l]) => `<button type="button" class="chip" data-act="taPlanOk" data-key="${esc(k)}" data-d="${d}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px"><input type="date" id="tp-d" min="${today}"><button class="btn" type="button" data-act="taPlanOk" data-key="${esc(k)}" data-champ="1">OK</button></div>
    <div class="row-end">${estPlanifiee(t) ? `<button class="btn" type="button" data-act="taPlanOk" data-key="${esc(k)}" data-retirer="1">Remettre à planifier</button>` : ''}<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette tâche">Supprimer</button>${pf ? '' : `<button class="btn" type="button" data-act="taFaiteOk" data-key="${esc(k)}">✓ Faite</button>`}</div></div>`);
};
ACTIONS.taPlanOk = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return;
  if (el.dataset.retirer) { DB.put(k, Object.assign({}, t, { jour: '', journee: '' })); closeSheet(); toast('Remise dans « À planifier ».'); return; }
  const d = el.dataset.champ ? ($('tp-d') || {}).value : el.dataset.d, j = el.dataset.j || '';
  if (!j && !d) { toast('Choisis un jour.'); return; }
  DB.put(k, Object.assign({}, t, j ? { journee: j, jour: '', ordre: t.journee === j ? t.ordre : ordreFin({ journee: j }) } : { jour: d, journee: '', ordre: t.jour === d && !t.journee ? t.ordre : ordreFin({ jour: d }) })); closeSheet();
  toast(j ? `Rattachée à ${titreEv(DB.get(j.split('|')[0]) || {})} (${fmtDateCourt(j.split('|')[1])}).` : `Prévue le ${fmtDate(d)}.`);
};
ACTIONS.taQui = (el) => { TA.qui = el.dataset.k; render(); };
ACTIONS.taCat = (el) => { TA.cat = TA.cat === el.dataset.k ? '' : el.dataset.k; render(); };
ACTIONS.taVue = (el) => { TA.vue = el.dataset.k; render(); };
/* Barre d'ajout de tâche (partout pareille) : « Ajouter » = ajout rapide (le titre suffit), « + d'options » = la fiche complète.
   o : { id, jour, journee, cat, resp, placeholder } — le contexte (jour, journée, catégorie) est repris dans les deux cas. */
/* Barre d'ajout rapide : [champ][+], puis (dans une journée) « Choisir… » parmi les tâches à planifier et « + d'options » */
function ajoutTacheBarre(o) {
  const bas = [o.journee ? `<button class="btn small" type="button" data-act="plJournee" data-j="${esc(o.journee)}" title="Choisir dans « À planifier »">Choisir…</button>` : '', o.fait ? '' : `<button class="btn small" type="button" data-act="taAjoutOptions">+ d'options</button>`].filter(Boolean).join('');
  return `<form class="ajout-barre" data-form="taAjout"><input type="hidden" name="jour" value="${esc(o.jour || '')}"><input type="hidden" name="journee" value="${esc(o.journee || '')}"><input type="hidden" name="cat" value="${esc(o.cat || '')}"><input type="hidden" name="resp" value="${esc(o.resp || '')}"><input type="hidden" name="champ" value="${esc(o.id)}">${o.fait ? `<input type="hidden" name="fait" value="${esc(o.fait)}">` : ''}
    <div class="ab-ligne"><input name="titre" id="${esc(o.id)}" placeholder="${esc(o.placeholder || 'Nouvelle tâche…')}" autocomplete="off" aria-label="Nouvelle tâche" enterkeyhint="done"><button class="btn primary ab-plus" type="submit" title="Ajouter" aria-label="Ajouter">+</button></div>
    ${bas ? `<div class="ab-bas">${bas}</div>` : ''}</form>`;
}
FORMS.taAjout = (v) => {
  if (!v.titre) { toast('Tape le nom de la tâche, ou « + d\'options ».'); return; }
  const e = v.journee ? DB.get(v.journee.split('|')[0]) : null;
  const g = devinerCategorie(v.titre, (v.journee ? v.journee.split('|')[1] : v.jour || todayISO()).slice(0, 4)), cat = v.cat || g.cat, sous = v.cat ? '' : g.sous;
  const pl = v.journee || v.jour ? { ordre: ordreFin({ journee: v.journee, jour: v.journee ? '' : v.jour }) } : {};
  DB.put('t:' + uid('t'), Object.assign({ titre: v.titre, statut: 'afaire', importance: 2, cat, sous, cultures: g.cultures, responsable: v.resp || (e && respDeQui(e.qui)) || '', journee: v.journee || '', jour: v.journee ? '' : v.jour || '', cree: new Date().toISOString(), creePar: Sync.me || '' }, pl,
    /* « Autres tâches effectuées ? » (fiche des heures) : la tâche est créée déjà faite, ce jour-là */
    v.fait ? { statut: 'termine', termineLe: v.fait, terminePar: Sync.me || '', jour: v.fait, responsable: v.resp || Sync.me || '' } : {}));
  if (v.fait && typeof majPourAuto === 'function') majPourAuto(v.fait);
  const classe = [cat ? catInfo(cat).icone + ' ' + catInfo(cat).nom : '', sous && sousInfo(cat, sous) ? sousInfo(cat, sous).nom : '', ...g.cultures.map((c) => (DB.get(c) || {}).nom)].filter(Boolean).join(' · ');
  toast(`« ${v.titre} » ${v.fait ? 'notée comme faite' : 'ajoutée'}${v.journee || v.jour || v.fait ? '' : ' dans « À planifier »'}${classe ? ' · ' + classe : ''}.`, classe ? 4500 : 3000);
  if (typeof rafraichirFenetre === 'function') rafraichirFenetre();
  /* Dans la page (accueil, onglet Tâches) : on ré-affiche tout de suite, sans attendre qu'on quitte la case */
  const q0 = $(v.champ); if (q0) q0.value = '';
  if (q0 && $('view').contains(q0)) { q0.focus(); renderGardeFocus(); return; }
  setTimeout(() => { const q = $(v.champ); if (q) { q.value = ''; q.focus(); } }, 40);
};
ACTIONS.taAjoutOptions = (el) => {
  const f = el.closest('form'); if (!f) return; const g = (n) => (f.querySelector(`[name="${n}"]`) || {}).value || '';
  ACTIONS.taEdit({ closest: (s) => el.closest(s), dataset: { key: '', titre: g('titre').trim(), cat: g('cat'), date: g('jour'), journee: g('journee'), resp: g('resp') } });
};
ACTIONS.taTick = (el) => {
  const t = DB.get(el.dataset.key); if (!t) return;
  const done = t.statut === 'termine';
  DB.put(el.dataset.key, Object.assign({}, t, done ? { statut: 'afaire', termineLe: '' } : { statut: 'termine', termineLe: todayISO(), terminePar: Sync.me || '' }));
  /* Les heures déjà notées ce jour-là se répartissent d'après les tâches faites : on recalcule */
  if (typeof majPourAuto === 'function') { const dj = t.journee ? t.journee.split('|')[1] : t.jour || todayISO(); majPourAuto(dj); if (dj !== todayISO()) majPourAuto(todayISO()); }
  if (!done) {
    if (t.rep) repeterSiBesoin(el.dataset.key, t);
    /* Une récolte faite : on note tout de suite la quantité (sinon elle reste dans « Récoltes à noter ») */
    if (catTache(t).sous === 'recolte' && typeof ACTIONS.mvtNouveau === 'function') { setTimeout(() => ACTIONS.recolteEv({ dataset: { key: el.dataset.key } }), 50); return; }
  }
  if (typeof rafraichirFenetre === 'function') rafraichirFenetre();
};
/* Toucher une tâche : pas planifiée → choisir son jour ; sinon → son résumé (pour la faire). « Modifier » ouvre la fiche complète. */
ACTIONS.taVoir = (el) => { const t = DB.get(el.dataset.key); if (!t) return; if (!(el.closest && el.closest('#sheet'))) PL.rafraichir = null; if (tacheOuverte(t) && !estPlanifiee(t)) ACTIONS.taPlanifier(el); else ACTIONS.taResume(el); };
/* L'aperçu d'une tâche = sa fiche : tout se change en un clic, sans bouton « Modifier ».
   Titre : on le touche. Échéance : une puce. Liste, répétition, remarques, culture, client : « + » puis on remplit (enregistré tout de suite). */
const quiDe = (t) => String(t.responsable || '').split('+').filter(Boolean);
function resumeTacheHtml(t, k) {
  const c = catTache(t), j = journeeDe(t), imp = importanceDe(t), today = todayISO(), ouv = (TA.ouvert && TA.ouvert.k === k) ? TA.ouvert.p : [];
  const sous = c.cat ? catInfo(c.cat).sous || [] : [], qui = quiDe(t);
  const ech = `<label class="chip ech-chip${t.echeance ? ' on' + (t.echeance < today ? ' passee' : echeanceProche(t) ? ' proche' : '') : ''}">⏰ ${t.echeance ? (t.echeance < today ? 'dépassée · ' : 'avant le ') + fmtDateCourt(t.echeance) : '+ Échéance'}<input type="date" data-ta-k="${esc(k)}" data-ta-f="echeance" value="${esc(t.echeance || '')}" aria-label="Échéance"></label>${t.echeance ? `<button type="button" class="chip" data-act="taViteSet" data-key="${esc(k)}" data-f="echeance" data-v="" aria-label="Retirer l'échéance">×</button>` : ''}`;
  const vite = `<div class="ta-vite">
      <div class="chips">${catsTaches().map((x) => `<button type="button" class="chip catchip${x.k === c.cat ? ' on' : ''}" style="--c:${esc(x.couleur)}" data-act="taSetCat" data-key="${esc(k)}" data-cat="${esc(x.k)}">${esc(x.icone || '')} ${esc(x.nom)}</button>`).join('')}</div>
      ${sous.length ? `<div class="chips ta-vite-sous">${sous.map((x) => `<button type="button" class="chip${x.k === c.sous ? ' on' : ''}" data-act="taSetSous" data-key="${esc(k)}" data-sous="${esc(x.k)}">${esc(x.nom)}</button>`).join('')}</div>` : ''}
      <div class="chips ta-vite-qui"><span class="hint">Qui :</span>${persOptions(true).map(([p, nom]) => `<button type="button" class="chip${(p === 'ensemble' ? t.responsable === 'ensemble' : qui.includes(p)) ? ' on' : ''}" data-act="taSetQui" data-key="${esc(k)}" data-p="${esc(p)}">${esc(nom)}</button>`).join('')}</div>
</div>`;
  /* Les parties : affichées si la tâche en a, ou si on vient de toucher « + » */
  const s0 = (jourPlanifie(t) || today).slice(0, 4), cus = typeof cultures === 'function' ? cultures(typeof saisons === 'function' && saisons().includes(s0) ? s0 : saisonCourante()) : [];
  const parts = [
    ['liste', '☑ Liste à cocher', (t.liste || []).length || ouv.includes('liste'), () => `<div class="ta-res-liste">${(t.liste || []).map((x, i) => `<label class="row ta-li"><input type="checkbox" data-li-t="${esc(k)}|${i}"${x.fait ? ' checked' : ''}> <span${x.fait ? ' class="barre"' : ''} style="flex:1">${esc(x.t)}</span><button type="button" class="btn link small" data-act="taViteLiOff" data-key="${esc(k)}" data-i="${i}" aria-label="Retirer">×</button></label>`).join('')}</div>
      <form class="row ta-vli" data-form="taViteLi"><input type="hidden" name="key" value="${esc(k)}"><input name="t" id="ta-vli" placeholder="Ajouter un élément…" autocomplete="off" style="flex:1" enterkeyhint="done"><button class="btn small" type="submit">+</button></form>`],
    ['rep', '🔁 Répétition', t.rep || ouv.includes('rep'), () => `<select data-ta-k="${esc(k)}" data-ta-f="rep" aria-label="Se répète">${REPETITIONS.map(([v, n]) => `<option value="${v}"${(t.rep || '') === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`],
    ['rem', '📝 Remarques', t.remarques || ouv.includes('rem'), () => `<textarea data-ta-k="${esc(k)}" data-ta-f="remarques" rows="3" placeholder="Remarques…">${esc(t.remarques || '')}</textarea>${t.remarques && /https?:\/\//.test(t.remarques) ? `<p class="hint">${linkify(t.remarques)}</p>` : ''}`],
    ['cult', '🌿 Culture et planches', (t.cultures || []).length || t.planches || ouv.includes('cult'), () => `${cus.length ? `<div class="chips">${cus.map((x) => `<button type="button" class="chip${(t.cultures || []).includes(x.key) ? ' on' : ''}" data-act="taViteCu" data-key="${esc(k)}" data-c="${esc(x.key)}">${esc(x.nom)}</button>`).join('')}</div>` : ''}<input data-ta-k="${esc(k)}" data-ta-f="planches" value="${esc(t.planches || '')}" placeholder="Planches (ex. A1–A4)" aria-label="Planches">`],
    ['client', '👤 Client', t.contactId || ouv.includes('client'), () => `<select data-ta-k="${esc(k)}" data-ta-f="contactId" aria-label="Client ou contact"><option value="">—</option>${tousContacts().sort(byName).map((x) => `<option value="${esc(x.key)}"${t.contactId === x.key ? ' selected' : ''}>${esc(displayName(x) + (x.prospect ? ' (prospect)' : ''))}</option>`).join('')}</select>`],
  ];
  const plus = `<button type="button" class="chip urgent-chip${imp === 1 ? ' on' : ''}" data-act="taSetImp" data-key="${esc(k)}" data-imp="${imp === 1 ? 2 : 1}" aria-pressed="${imp === 1}">🔥 Urgent</button>` + ech + parts.filter(([, , on]) => !on).map(([id, nom]) => `<button type="button" class="chip" data-act="taViteOuvrir" data-key="${esc(k)}" data-p="${id}">${nom.replace(' ', ' + ')}</button>`).join('');
  return `<div class="ta-resume">${vite}
    ${parts.filter(([, , on]) => on).map(([id, nom, , html]) => `<fieldset class="ta-partie"><legend>${nom}</legend>${html()}</fieldset>`).join('')}
    ${plus ? `<div class="chips ta-plus-btns">${plus}</div>` : ''}
    ${estPlanifiee(t) ? `<p class="meta ta-quand">📅 ${j ? esc(j.titre) + ', ' : ''}${esc(dateLongue(jourPlanifie(t)))}</p>` : ''}</div>`;
}
const majTache = (k, patch) => { const t = DB.get(k); if (!t) return; DB.put(k, Object.assign({}, t, patch)); };
ACTIONS.taViteOuvrir = (el) => { const k = el.dataset.key; TA.ouvert = { k, p: ((TA.ouvert && TA.ouvert.k === k) ? TA.ouvert.p : []).concat([el.dataset.p]) }; reouvrirTache(k); setTimeout(() => { const x = el.dataset.p === 'liste' ? $('ta-vli') : document.querySelector(`#sheet [data-ta-f="${({ rep: 'rep', rem: 'remarques', cult: 'planches', client: 'contactId' })[el.dataset.p]}"]`); if (x && el.dataset.p !== 'cult') x.focus(); }, 30); };
ACTIONS.taViteSet = (el) => { majTache(el.dataset.key, { [el.dataset.f]: el.dataset.v }); reouvrirTache(el.dataset.key); };
ACTIONS.taViteCu = (el) => { const k = el.dataset.key, t = DB.get(k); if (!t) return; const l = (t.cultures || []).slice(), i = l.indexOf(el.dataset.c); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.c); majTache(k, { cultures: l }); reouvrirTache(k); };
ACTIONS.taViteLiOff = (el) => { const k = el.dataset.key, t = DB.get(k); if (!t) return; const l = (t.liste || []).slice(); l.splice(Number(el.dataset.i), 1); majTache(k, { liste: l }); reouvrirTache(k); };
FORMS.taViteLi = (v) => { if (!String(v.t || '').trim()) return; const t = DB.get(v.key); if (!t) return; majTache(v.key, { liste: (t.liste || []).concat([{ t: v.t.trim(), fait: false }]) }); reouvrirTache(v.key); setTimeout(() => { const i = $('ta-vli'); if (i) i.focus(); }, 30); };
/* Un champ de l'aperçu (échéance, répétition, remarques, planches, client) : enregistré dès qu'on le quitte */
document.addEventListener('change', (e) => {
  const x = e.target, k = x.dataset && x.dataset.taK, f = x.dataset && x.dataset.taF; if (!k || !f) return;
  majTache(k, { [f]: f === 'planches' ? x.value.trim() : x.value });
  if (f === 'echeance' || f === 'contactId') reouvrirTache(k);
});
/* Le titre : on le touche pour le changer */
ACTIONS.taTitre = (el) => {
  const k = el.dataset.key, t = DB.get(k), h = el.closest('h2') || el; if (!t || h.querySelector('input')) return;
  h.innerHTML = `<input id="ta-titre-vite" value="${esc(t.titre)}" aria-label="Titre de la tâche" enterkeyhint="done" style="width:100%;font:inherit">`;
  const i = $('ta-titre-vite'); i.focus(); i.select();
  const ok = () => { const v = i.value.trim(); if (v && v !== t.titre) majTache(k, { titre: v }); reouvrirTache(k); };
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } if (e.key === 'Escape') { i.value = t.titre; i.blur(); } });
  i.addEventListener('blur', ok, { once: true });
};
document.addEventListener('click', (e) => { const i = e.target.closest && e.target.closest('.ech-chip') && e.target.closest('.ech-chip').querySelector('input[type=date]'); if (i && i.showPicker) { e.preventDefault(); try { i.showPicker(); } catch (x) { i.focus(); } } });
const titreTacheHead = (t, k, sous) => sheetHead(t.titre, sous).replace(/<h2>/, `<h2 class="ta-titre" data-act="taTitre" data-key="${esc(k)}" role="button" tabindex="0" title="Changer le titre">`);
/* Changer en un clic depuis l'aperçu, puis réafficher la même fenêtre */
const reouvrirTache = (k) => { const f = TA.fenetre === 'taPlanifier' ? ACTIONS.taPlanifier : ACTIONS.taResume; const r = PL.rafraichir; f({ dataset: { key: k } }); if (TA.fenetre === 'taPlanifier') PL.rafraichir = r; };
ACTIONS.taSetCat = (el) => { const k = el.dataset.key, t = DB.get(k); if (!t) return; const meme = catTache(t).cat === el.dataset.cat; const o = Object.assign({}, t, { cat: meme ? '' : el.dataset.cat, sous: '' }); delete o.tag; DB.put(k, o); reouvrirTache(k); };
ACTIONS.taSetQui = (el) => {
  const k = el.dataset.key, t = DB.get(k), p = el.dataset.p; if (!t) return;
  let r; if (p === 'ensemble') r = t.responsable === 'ensemble' ? '' : 'ensemble';
  else { const l = quiDe(t).filter((x) => x !== 'ensemble'), i = l.indexOf(p); if (i >= 0) l.splice(i, 1); else l.push(p); r = personnes().map((x) => x.k).filter((x) => l.includes(x)).join('+'); }
  majTache(k, { responsable: r }); reouvrirTache(k);
};
ACTIONS.taSetSous = (el) => { const k = el.dataset.key, t = DB.get(k); if (!t) return; const c = catTache(t); const o = Object.assign({}, t, { cat: c.cat, sous: c.sous === el.dataset.sous ? '' : el.dataset.sous }); delete o.tag; DB.put(k, o); reouvrirTache(k); };
ACTIONS.taSetImp = (el) => { const k = el.dataset.key, t = DB.get(k); if (!t) return; const o = Object.assign({}, t, { importance: Number(el.dataset.imp) }); delete o.urgent; DB.put(k, o); reouvrirTache(k); };
ACTIONS.taResume = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return; const done = t.statut === 'termine'; TA.fenetre = 'taResume';
  const retour = PL.rafraichir;
  if (!TA.ouvert || TA.ouvert.k !== k) TA.ouvert = null;
  openSheet(`${titreTacheHead(t, k)}<div class="sbody">${resumeTacheHtml(t, k)}
    ${catTache(t).sous === 'livraison' && t.contactId ? `<div class="row"><button class="btn" type="button" data-act="taFacture" data-key="${esc(k)}">🧾 Créer la facture</button></div>` : ''}
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette tâche">Supprimer</button>${!done ? `<button class="btn" type="button" data-act="taPlanifier" data-key="${esc(k)}">📅 Changer le jour</button>` : ''}
      <button class="btn primary" type="button" data-act="taFaiteOk" data-key="${esc(k)}">${done ? 'Rouvrir' : '✓ Faite'}</button>${retour ? '<button class="btn link" type="button" data-act="plRetour">‹ Retour</button>' : ''}</div></div>`);
};
ACTIONS.taFacture = (el) => { const t = DB.get(el.dataset.key); if (!t || !t.contactId) return; draftF.livraison = jourPlanifie(t) || todayISO(); draftF.date = todayISO(); closeSheet(); go('#/factures/nouvelle/' + encodeURIComponent(t.contactId)); };
ACTIONS.taFaiteOk = (el) => { ACTIONS.taTick(el); if (PL.rafraichir) PL.rafraichir(); else closeSheet(); };
ACTIONS.plRetour = () => { if (PL.rafraichir) PL.rafraichir(); else closeSheet(); };
document.addEventListener('change', (e) => {
  const v = e.target.dataset && e.target.dataset.liT; if (!v) return; const [k, i] = v.split('|'), t = DB.get(k); if (!t) return;
  const l = (t.liste || []).map((x) => Object.assign({}, x)); if (!l[Number(i)]) return; l[Number(i)].fait = e.target.checked;
  DB.put(k, Object.assign({}, t, { liste: l })); const s = e.target.nextElementSibling; if (s) s.classList.toggle('barre', e.target.checked);
  /* Toute la liste cochée : la tâche est faite ; une case décochée : elle redevient à faire */
  const toutes = l.every((x) => x.fait), faite = t.statut === 'termine';
  if (toutes !== faite) { ACTIONS.taTick({ dataset: { key: k } }); if (!e.target.closest('.ta-sous') && e.target.closest('#sheet') && typeof reouvrirTache === 'function') reouvrirTache(k); }
  if (e.target.closest('.ta-sous') && typeof rafraichirFenetre === 'function') rafraichirFenetre();
});
/* Les journées prévues auxquelles rattacher une tâche : événements des 6 prochaines semaines (sauf congés) */
function journeesProchaines(garder) {
  const today = todayISO(), it = itemsPeriode(addDays(today, -7), addDays(today, 42)), out = [];
  for (const d of Object.keys(it).sort()) for (const x of it[d]) if (x.kind === 'ev' && x.debut && catEv(DB.get(x.key) || {}).cat !== 'conge' && (d >= today || x.key + '|' + x.occ === garder)) out.push([x.key + '|' + x.occ, `${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)} · ${x.titre}${x.qui ? ' (' + quiLabel(x.qui) + ')' : ''}`]);
  return out;
}
/* Fiche d'une tâche (nouvelle si pas de clé) ; el.dataset peut préremplir jour, journee, cat */
ACTIONS.taEdit = (el) => {
  if (el.dataset.key && DB.get(el.dataset.key)) { ACTIONS.taResume({ dataset: { key: el.dataset.key } }); return; }
  if (!el.dataset.resp && el.dataset.journee) { const ev = DB.get(String(el.dataset.journee).split('|')[0]); if (ev && ev.qui) el = { closest: el.closest ? (s) => el.closest(s) : () => null, dataset: Object.assign({}, el.dataset, { resp: ev.qui }) }; }
  const k = el.dataset.key || '', t = k ? DB.get(k) : { titre: el.dataset.titre || '', statut: 'afaire', importance: 2, jour: el.dataset.date || '', journee: el.dataset.journee || '', cat: el.dataset.cat || '', responsable: el.dataset.resp || '' };
  if (!t) return; const c = catTache(t), s = (jourPlanifie(t) || todayISO()).slice(0, 4), imp = importanceDe(t);
  const cus = typeof cultures === 'function' ? cultures(typeof saisons === 'function' && saisons().includes(s) ? s : saisonCourante()) : [];
  const jrs = journeesProchaines(t.journee);
  TA.liste = (t.liste || []).map((x) => Object.assign({}, x));
  PL.retourEdit = el.closest && el.closest('#sheet') ? PL.rafraichir : null;
  openSheet(`${sheetHead(k ? 'Modifier la tâche' : 'Nouvelle tâche')}<form class="sbody form" data-form="ta"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ta-titre', 'Tâche', t.titre, { name: 'titre', req: true, attrs: k ? {} : { autofocus: '' } })}
    ${catChoixHtml('ta-cat', c.cat, c.sous)}
    ${k ? '' : '<p class="hint" id="ta-auto" style="margin:-4px 0 0"></p>'}
    <label class="chip urgent-chip urgent-cb"><input type="checkbox" name="importance"${imp === 1 ? ' checked' : ''}> 🔥 Urgent</label>
    <div class="grid2">${inp('ta-ech', 'Échéance (facultatif)', t.echeance, { name: 'echeance', type: 'date', sub: `Date limite. Elle fait remonter la tâche en haut de la liste ${ECH_PROCHE} jours avant.` })}
      ${sel('ta-resp', 'Qui', t.responsable || '', [['', '—']].concat(persOptions(true), String(t.responsable || '').includes('+') ? [[t.responsable, quiLabel(t.responsable)]] : []), { name: 'responsable' })}</div>
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
  /* Nouvelle tâche : la catégorie (et la culture) se devinent pendant qu'on écrit, tant qu'on ne l'a pas choisie soi-même */
  TA.catManuel = !!k || !!el.dataset.cat;
  if (!k) {
    const ti = $('ta-titre'); let tm = 0;
    const deviner = () => {
      if (TA.catManuel || !$('ta-cat')) return; const g = devinerCategorie(ti.value, s);
      $('ta-cat').outerHTML = catChoixHtml('ta-cat', g.cat, g.sous);
      const h = $('ta-cus'); if (h) { h.value = g.cultures.join(','); document.querySelectorAll('[data-act="taCu"]').forEach((b) => b.classList.toggle('on', g.cultures.includes(b.dataset.k))); if (g.cultures.length) { const f = $('tp-cult'); if (f) f.hidden = false; const bt = document.querySelector('[data-act="taPartie"][data-p="cult"]'); if (bt) bt.hidden = true; } }
      const a = $('ta-auto'), txt = [g.cat ? catInfo(g.cat).nom : '', g.sous && sousInfo(g.cat, g.sous) ? sousInfo(g.cat, g.sous).nom : '', ...g.cultures.map((c) => (DB.get(c) || {}).nom)].filter(Boolean).join(' · ');
      if (a) a.textContent = txt ? '🪄 Classée automatiquement : ' + txt + ' (tu peux changer)' : '';
    };
    if (ti) { ti.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(deviner, 250); }); if (ti.value) deviner(); }
  }
  /* Une journée choisie efface le jour, et inversement */
  const sj = $('ta-jour'), dj = $('ta-j'); if (sj && dj) { sj.addEventListener('change', () => { if (sj.value) dj.value = ''; }); dj.addEventListener('change', () => { if (dj.value) sj.value = ''; }); }
};
function listeTacheHtml() { return TA.liste.map((x, i) => `<label class="row ta-li"><input type="checkbox" data-li="${i}"${x.fait ? ' checked' : ''}> <span style="flex:1">${esc(x.t)}</span><button type="button" class="btn link small" data-act="taLiOff" data-i="${i}" aria-label="Retirer">×</button></label>`).join(''); }
document.addEventListener('change', (e) => { const i = e.target.dataset && e.target.dataset.li; if (i == null || !TA.liste) return; TA.liste[Number(i)].fait = e.target.checked; });
ACTIONS.taLiAjout = () => { const i = $('ta-li'); if (!i || !i.value.trim()) return; TA.liste.push({ t: i.value.trim(), fait: false }); i.value = ''; $('ta-liste').innerHTML = listeTacheHtml(); i.focus(); };
ACTIONS.taLiOff = (el) => { TA.liste.splice(Number(el.dataset.i), 1); $('ta-liste').innerHTML = listeTacheHtml(); };
ACTIONS.taCu = (el) => { const h = $('ta-cus'), l = h.value ? h.value.split(',') : [], i = l.indexOf(el.dataset.k); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.k); h.value = l.join(','); el.classList.toggle('on', i < 0); };
document.addEventListener('gdt-cat', (e) => { if (e.detail.id === 'ta-cat') { TA.catManuel = true; const a = $('ta-auto'); if (a) a.textContent = ''; } });
document.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#ta-cat')) TA.catManuel = true; });
ACTIONS.taPartie = (el) => { const f = $('tp-' + el.dataset.p); if (f) { f.hidden = false; const x = f.querySelector('input:not([type=hidden]), select, textarea'); if (x) x.focus(); } el.hidden = true; };
ACTIONS.taNouvelle = (el) => ACTIONS.taEdit({ dataset: Object.assign({}, el.dataset, { key: '' }) });
FORMS.ta = (v) => {
  if (!v.titre) return;
  const k = v.key || 't:' + uid('t'), t = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  const was = t.statut === 'termine', faite = !!v.faite;
  const o = Object.assign({}, t, { titre: v.titre, statut: faite ? 'termine' : 'afaire', importance: v.importance === true || String(v.importance) === '1' ? 1 : 2, echeance: v.echeance || '', journee: v.journee || '', jour: v.journee ? '' : v.jour || '', responsable: v.responsable, cat: v.cat || '', sous: v.cat ? v.sous || '' : '', rep: v.rep || '',
    contactId: v.contactId != null ? v.contactId : t.contactId || '', cultures: v.cultures != null ? String(v.cultures).split(',').filter(Boolean) : (t.cultures || []), planches: v.planches != null ? String(v.planches).trim() : t.planches || '', liste: (TA.liste || []).slice(), remarques: v.remarques,
    termineLe: faite ? (was ? t.termineLe : todayISO()) : '' });
  delete o.tag; delete o.urgent;
  if ((o.journee && o.journee !== t.journee) || (!o.journee && o.jour && (o.jour !== t.jour || t.journee))) o.ordre = ordreFin({ journee: o.journee, jour: o.jour });
  DB.put(k, o); closeSheet(); if (PL.retourEdit) { const r = PL.retourEdit; PL.retourEdit = null; setTimeout(r, 0); }
  if (faite && !was && o.rep) repeterSiBesoin(k, o); else toast(v.key ? 'Tâche enregistrée.' : 'Tâche ajoutée.');
};
