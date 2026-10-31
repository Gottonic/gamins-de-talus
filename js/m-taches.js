/* Gamins de Talus — tâches partagées. */
'use strict';

const STATUTS = [['afaire', 'À faire'], ['encours', 'En cours'], ['suspendu', 'Suspendu'], ['termine', 'Terminé']];
const taches = () => DB.all('t:');
const TA = { qui: '', cat: '', voirFini: false };
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
  const nk = 't:' + uid('t'), ech = prochaineEcheance(t.echeance || todayISO(), t.rep);
  DB.put(nk, { titre: t.titre, statut: 'afaire', responsable: t.responsable || '', cat: catTache(t).cat, sous: catTache(t).sous, cultures: t.cultures || [], planches: t.planches || '', liste: (t.liste || []).map((x) => ({ t: x.t, fait: false })), remarques: t.remarques || '', rep: t.rep, echeance: ech, cree: new Date().toISOString(), creePar: Sync.me || '' });
  DB.put(k, Object.assign({}, DB.get(k), { repSuivante: nk }));
  toast(`Tâche terminée. La prochaine est prévue le ${fmtDate(ech)}.`, 4000);
}
/* Une tâche a une date (« pour le ») et peut être rattachée à une journée de travail prévue (journee = 'ev:…|AAAA-MM-JJ').
   Rattachée, elle se range sous cette journée, même si sa date est différente. */
function journeeDe(t) {
  if (!t || !t.journee) return null; const [k, d] = String(t.journee).split('|'); const e = DB.get(k);
  if (!e || !d || (e.exceptions || []).includes(d)) return null; return { key: k, date: d, e, titre: titreEv(e) };
}
const dateTache = (t) => { const j = journeeDe(t); return j ? j.date : t.echeance || ''; };
const tacheOuverte = (t) => t.statut !== 'termine' && t.statut !== 'suspendu';
function tacheEnRetard(t) { const d = dateTache(t); return t.statut !== 'termine' && d && d < todayISO(); }

/* L'ancienne adresse des tâches mène à la Planification */
MODULES.taches = { titre: 'Planification', render(sub) { setTimeout(() => location.replace(sub === 'semaine' ? '#/calendrier/feuille' : '#/calendrier/taches'), 0); return ''; } };
const tachesUrgentesPourMoi = () => { const demain = addDays(todayISO(), 1); return taches().filter((t) => tacheOuverte(t) && (t.urgent || (dateTache(t) && dateTache(t) <= demain)) && (typeof pourMoi !== 'function' || pourMoi(t.responsable))); };

function renderTaches() {
  let all = taches();
  if (TA.qui === 'moi') all = all.filter((t) => t.responsable === Sync.me || t.responsable === 'ensemble' || !t.responsable);
  else if (TA.qui) all = all.filter((t) => t.responsable === TA.qui);
  const ouvertes = all.filter((t) => t.statut !== 'termine');
  const nCat = {}; for (const t of ouvertes) { const c = catTache(t).cat || '-'; nCat[c] = (nCat[c] || 0) + 1; }
  if (TA.cat) all = all.filter((t) => (catTache(t).cat || '-') === TA.cat);
  const sortE = (a, b) => (dateTache(a) || '9999').localeCompare(dateTache(b) || '9999') || String(a.cree || '').localeCompare(String(b.cree || ''));
  const urg = all.filter((t) => tacheOuverte(t) && (t.urgent || tacheEnRetard(t))).sort(sortE);
  const enc = all.filter((t) => t.statut === 'encours' && !urg.includes(t)).sort(sortE);
  const af = all.filter((t) => (t.statut === 'afaire' || !t.statut) && !urg.includes(t)).sort(sortE);
  const sus = all.filter((t) => t.statut === 'suspendu').sort(sortE);
  const fin = all.filter((t) => t.statut === 'termine').sort((a, b) => String(b.termineLe || b.echeance || '').localeCompare(String(a.termineLe || a.echeance || '')));
  const sec = (titre, list, fort) => list.length ? `<div><h3${fort ? ' class="titre-fort"' : ''}>${titre} · ${list.length}</h3>${list.map((t) => tacheHtml(t)).join('')}</div>` : '';
  const quiChips = [['', 'Toutes'], ['moi', 'Les miennes']].concat(persOptions(true)).map(([k, l]) => `<button class="chip${TA.qui === k ? ' on' : ''}" type="button" data-act="taQui" data-k="${k}">${esc(l)}</button>`).join('');
  const catChips = catsTaches().concat([{ k: '-', nom: 'Sans catégorie', icone: '', couleur: '#999' }]).filter((c) => nCat[c.k] || TA.cat === c.k)
    .map((c) => `<button class="chip catchip${TA.cat === c.k ? ' on' : ''}" style="--c:${esc(c.couleur)}" type="button" data-act="taCat" data-k="${esc(c.k)}">${esc(c.icone || '')} ${esc(c.nom)}<span class="n">${nCat[c.k] || 0}</span></button>`).join('');
  const catQ = TA.cat && TA.cat !== '-' ? catInfo(TA.cat) : null;
  return `<div class="panel">
    <div class="between"><form class="quick" data-form="taQuick" style="flex:1"><input name="titre" id="ta-quick" placeholder="Nouvelle tâche${catQ ? ' (' + esc(catQ.nom) + ')' : ''}… (Entrée pour ajouter)" autocomplete="off" aria-label="Nouvelle tâche"><button class="btn primary" type="submit">Ajouter</button></form>
      <a class="btn small" href="#/calendrier/feuille">🖨 Feuille de la semaine</a></div>
    <div class="chips">${quiChips}</div><div class="chips">${catChips}</div>
    ${sec('Urgent ou en retard', urg, true)}${sec('En cours', enc)}${sec('À faire', af)}${sec('Suspendu', sus)}
    ${!urg.length && !enc.length && !af.length ? `<p class="empty">Aucune tâche ouverte${TA.qui || TA.cat ? ' avec ce filtre' : ''}.</p>` : ''}
    ${fin.length ? `<div><button class="btn link" type="button" data-act="taFini">${TA.voirFini ? 'Masquer' : 'Voir'} les ${fin.length} tâches terminées</button>${TA.voirFini ? fin.map((t) => tacheHtml(t)).join('') : ''}</div>` : ''}
    <p class="hint">Une tâche sans date attend dans « À planifier » (Vue d'ensemble) : donne-lui un jour, ou rattache-la à une journée de travail prévue.</p>
  </div>`;
}
function tacheHtml(t, o = {}) {
  const done = t.statut === 'termine', late = tacheEnRetard(t), c = catTache(t), j = journeeDe(t), d = dateTache(t);
  const meta = [];
  if (!o.sansCat && c.cat) meta.push(catPill(c.cat, c.sous));
  else if (c.sous) meta.push(catPill(c.cat, c.sous, true));
  if (t.urgent && !done) meta.push('<span class="pill urgent">Urgent</span>');
  if (t.statut === 'encours') meta.push('<span class="pill encours">En cours</span>');
  if (!o.sansDate && d) meta.push(`<span class="${late ? 'err' : ''}">${late ? 'En retard · ' : ''}${j ? '📅 ' + esc(j.titre) + ' · ' : ''}${fmtDate(d)}</span>`);
  if (t.responsable) meta.push(`<span>${esc(nomDe(t.responsable))}</span>`);
  const cus = (t.cultures || []).map((k) => DB.get(k)).filter(Boolean);
  if (cus.length) meta.push(`<span>🌿 ${esc(cus.map((x) => x.nom).join(', '))}</span>`);
  if (t.planches) meta.push(`<span>▦ ${esc(t.planches)}</span>`);
  const li = t.liste || []; if (li.length) meta.push(`<span>☑ ${li.filter((x) => x.fait).length}/${li.length}</span>`);
  if (t.rep && !done) meta.push(`<span title="Tâche qui se répète">↻ ${esc((REPETITIONS.find((r) => r[0] === t.rep) || ['', ''])[1].toLowerCase())}</span>`);
  return `<div class="task${done ? ' done' : ''}${t.urgent && !done ? ' urgente' : ''}" draggable="${done ? 'false' : 'true'}" data-tache="${esc(t.key)}" style="--c:${esc(couleurCat(c.cat))}"><button class="tick" type="button" data-act="taTick" data-key="${esc(t.key)}" aria-label="${done ? 'Rouvrir' : 'Marquer comme terminée'} : ${esc(t.titre)}"></button>
    <div class="body" data-act="taEdit" data-key="${esc(t.key)}" role="button" tabindex="0"><strong>${esc(t.titre)}</strong>${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}${t.remarques && !o.court ? `<span class="meta">${linkify(trunc(t.remarques, 160))}</span>` : ''}</div></div>`;
}
ACTIONS.taQui = (el) => { TA.qui = el.dataset.k; render(); };
ACTIONS.taCat = (el) => { TA.cat = TA.cat === el.dataset.k ? '' : el.dataset.k; render(); };
ACTIONS.taFini = () => { TA.voirFini = !TA.voirFini; render(); };
FORMS.taQuick = (v) => {
  if (!v.titre) return;
  const resp = TA.qui && TA.qui !== 'moi' ? TA.qui : '';
  DB.put('t:' + uid('t'), { titre: v.titre, statut: 'afaire', responsable: resp, cat: TA.cat && TA.cat !== '-' ? TA.cat : '', cree: new Date().toISOString(), creePar: Sync.me || '' });
  setTimeout(() => { const q = $('ta-quick'); if (q) q.focus(); }, 0);
};
ACTIONS.taTick = (el) => {
  const t = DB.get(el.dataset.key); if (!t) return;
  const done = t.statut === 'termine';
  DB.put(el.dataset.key, Object.assign({}, t, done ? { statut: 'afaire', termineLe: '' } : { statut: 'termine', termineLe: todayISO(), terminePar: Sync.me || '' }));
  if (!done) { if (t.rep) repeterSiBesoin(el.dataset.key, t); else toast('Tâche terminée.'); }
};
/* Les journées prévues auxquelles rattacher une tâche : événements des 6 prochaines semaines (sauf congés) */
function journeesProchaines(garder) {
  const today = todayISO(), it = itemsPeriode(addDays(today, -7), addDays(today, 42)), out = [];
  for (const d of Object.keys(it).sort()) for (const x of it[d]) if (x.kind === 'ev' && x.debut && catEv(DB.get(x.key) || {}).cat !== 'conge' && (d >= today || x.key + '|' + x.occ === garder)) out.push([x.key + '|' + x.occ, `${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)} · ${x.titre}${x.qui ? ' (' + quiLabel(x.qui) + ')' : ''}`]);
  return out;
}
/* Fiche d'une tâche (nouvelle si pas de clé) ; el.dataset peut préremplir date, journee, cat */
ACTIONS.taEdit = (el) => {
  const k = el.dataset.key || '', t = k ? DB.get(k) : { statut: 'afaire', echeance: el.dataset.date || '', journee: el.dataset.journee || '', cat: el.dataset.cat || '', responsable: '' };
  if (!t) return; const c = catTache(t), s = (dateTache(t) || todayISO()).slice(0, 4);
  const cus = typeof cultures === 'function' ? cultures(typeof saisons === 'function' && saisons().includes(s) ? s : saisonCourante()) : [];
  const jrs = journeesProchaines(t.journee);
  TA.liste = (t.liste || []).map((x) => Object.assign({}, x));
  openSheet(`${sheetHead(k ? 'Tâche' : 'Nouvelle tâche')}<form class="sbody form" data-form="ta"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ta-titre', 'Tâche', t.titre, { name: 'titre', req: true, attrs: k ? {} : { autofocus: '' } })}
    ${catChoixHtml('ta-cat', c.cat, c.sous)}
    <div class="grid2">${inp('ta-ech', 'Pour le', t.echeance, { name: 'echeance', type: 'date', sub: 'Vide : à planifier.' })}
      ${sel('ta-jour', 'Ou rattachée à une journée prévue', t.journee || '', [['', '—']].concat(jrs), { name: 'journee', sub: 'Elle se range sous cette journée.' })}
      ${sel('ta-resp', 'Qui', t.responsable || '', [['', '—']].concat(persOptions(true)), { name: 'responsable' })}${sel('ta-statut', 'Statut', t.statut || 'afaire', STATUTS, { name: 'statut' })}</div>
    <label class="row" style="font-size:14px"><input type="checkbox" name="urgent"${t.urgent ? ' checked' : ''}> Urgent</label>
    <details class="ta-plus"${(t.cultures || []).length || t.planches || (t.liste || []).length || t.rep ? ' open' : ''}><summary>Culture, planches, liste, répétition</summary>
      ${cus.length ? `<div class="field"><span class="flabel">Culture(s) (facultatif)</span><input type="hidden" name="cultures" id="ta-cus" value="${esc((t.cultures || []).join(','))}"><div class="chips">${cus.map((x) => `<button type="button" class="chip${(t.cultures || []).includes(x.key) ? ' on' : ''}" data-act="taCu" data-k="${esc(x.key)}">${esc(x.nom)}</button>`).join('')}</div></div>` : ''}
      ${inp('ta-pl', 'Planche(s) (facultatif)', t.planches || '', { name: 'planches', attrs: { placeholder: 'ex. A3, A4 ou serre 2', maxlength: 60 } })}
      <div class="field"><span class="flabel">Liste à cocher (facultatif)</span><div id="ta-liste">${listeTacheHtml()}</div>
        <div class="row"><input id="ta-li" placeholder="Ajouter un élément…" style="flex:1" autocomplete="off"><button class="btn small" type="button" data-act="taLiAjout">+</button></div></div>
      ${sel('ta-rep', 'Se répète', t.rep || '', REPETITIONS, { name: 'rep', sub: 'À la fin de la tâche, la suivante est créée avec la prochaine date.' })}
    </details>
    ${txt('ta-rem', 'Remarques', t.remarques, { name: 'remarques', rows: 3 })}
    ${t.remarques && /https?:\/\//.test(t.remarques) ? `<p class="hint">${linkify(t.remarques)}</p>` : ''}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette tâche">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const li = $('ta-li'); if (li) li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ACTIONS.taLiAjout(); } });
};
function listeTacheHtml() { return TA.liste.map((x, i) => `<label class="row ta-li"><input type="checkbox" data-li="${i}"${x.fait ? ' checked' : ''}> <span style="flex:1">${esc(x.t)}</span><button type="button" class="btn link small" data-act="taLiOff" data-i="${i}" aria-label="Retirer">×</button></label>`).join(''); }
document.addEventListener('change', (e) => { const i = e.target.dataset && e.target.dataset.li; if (i == null || !TA.liste) return; TA.liste[Number(i)].fait = e.target.checked; });
ACTIONS.taLiAjout = () => { const i = $('ta-li'); if (!i || !i.value.trim()) return; TA.liste.push({ t: i.value.trim(), fait: false }); i.value = ''; $('ta-liste').innerHTML = listeTacheHtml(); i.focus(); };
ACTIONS.taLiOff = (el) => { TA.liste.splice(Number(el.dataset.i), 1); $('ta-liste').innerHTML = listeTacheHtml(); };
ACTIONS.taCu = (el) => { const h = $('ta-cus'), l = h.value ? h.value.split(',') : [], i = l.indexOf(el.dataset.k); if (i >= 0) l.splice(i, 1); else l.push(el.dataset.k); h.value = l.join(','); el.classList.toggle('on', i < 0); };
ACTIONS.taNouvelle = (el) => ACTIONS.taEdit({ dataset: Object.assign({}, el.dataset, { key: '' }) });
FORMS.ta = (v) => {
  if (!v.titre) return;
  const k = v.key || 't:' + uid('t'), t = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  const was = t.statut;
  const o = Object.assign({}, t, { titre: v.titre, statut: v.statut || 'afaire', echeance: v.echeance || '', journee: v.journee || '', responsable: v.responsable, cat: v.cat || '', sous: v.cat ? v.sous || '' : '', urgent: !!v.urgent, rep: v.rep || '',
    cultures: v.cultures != null ? String(v.cultures).split(',').filter(Boolean) : (t.cultures || []), planches: v.planches != null ? String(v.planches).trim() : t.planches || '', liste: (TA.liste || []).slice(), remarques: v.remarques,
    termineLe: v.statut === 'termine' ? (was === 'termine' ? t.termineLe : todayISO()) : '' });
  delete o.tag;
  if (o.rep && !dateTache(o) && v.statut !== 'termine') o.echeance = todayISO();
  DB.put(k, o); closeSheet();
  if (v.statut === 'termine' && was !== 'termine' && o.rep) repeterSiBesoin(k, o); else toast(v.key ? 'Tâche enregistrée.' : 'Tâche ajoutée.');
};
