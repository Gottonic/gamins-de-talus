/* Gamins de Talus — tâches partagées. */
'use strict';

const STATUTS = [['afaire', 'À faire'], ['encours', 'En cours'], ['suspendu', 'Suspendu'], ['termine', 'Terminé']];
const TAGS = [['', '—'], ['admin', 'Admin'], ['agri', 'Agri'], ['vente', 'Vente'], ['materiel', 'Matériel'], ['autre', 'Autre']];
const tagLabel = (k) => (TAGS.find((t) => t[0] === k) || ['', ''])[1];
const taches = () => DB.all('t:');
const TA = { qui: '', tag: '', voirFini: false };
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
  DB.put(nk, { titre: t.titre, statut: 'afaire', responsable: t.responsable || '', tag: t.tag || '', remarques: t.remarques || '', rep: t.rep, echeance: ech, cree: new Date().toISOString(), creePar: Sync.me || '' });
  DB.put(k, Object.assign({}, DB.get(k), { repSuivante: nk }));
  toast(`Tâche terminée. La prochaine est prévue le ${fmtDate(ech)}.`, 4000);
}
function tacheEnRetard(t) { return t.statut !== 'termine' && t.echeance && t.echeance < todayISO(); }

MODULES.taches = {
  titre: 'Tâches',
  tuile() {
    const open = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu');
    const urg = open.filter((t) => t.urgent || tacheEnRetard(t));
    const demain = addDays(todayISO(), 1), presse = open.filter((t) => (t.urgent || (t.echeance && t.echeance <= demain)) && (typeof pourMoi !== 'function' || pourMoi(t.responsable))).length;
    if (urg.length) return { line: `${urg.length} urgente${urg.length > 1 ? 's' : ''} ou en retard · ${open.length} ouverte${open.length > 1 ? 's' : ''}`, warn: true, badge: presse };
    return { line: open.length ? `${open.length} à faire` : 'Rien à faire, bravo', badge: presse };
  },
  render(sub) {
    if (sub === 'semaine') return tabs('taches', [['', 'Tâches'], ['semaine', 'Feuille de la semaine']], 'semaine') + renderFeuille();
    let all = taches();
    const counts = { '': all.filter((t) => t.statut !== 'termine').length };
    if (TA.qui === 'moi') all = all.filter((t) => t.responsable === Sync.me || t.responsable === 'ensemble' || !t.responsable);
    else if (TA.qui) all = all.filter((t) => t.responsable === TA.qui);
    if (TA.tag) all = all.filter((t) => t.tag === TA.tag);
    const sortE = (a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999') || String(a.cree || '').localeCompare(String(b.cree || ''));
    const urg = all.filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu' && (t.urgent || tacheEnRetard(t))).sort(sortE);
    const enc = all.filter((t) => t.statut === 'encours' && !urg.includes(t)).sort(sortE);
    const af = all.filter((t) => (t.statut === 'afaire' || !t.statut) && !urg.includes(t)).sort(sortE);
    const sus = all.filter((t) => t.statut === 'suspendu').sort(sortE);
    const fin = all.filter((t) => t.statut === 'termine').sort((a, b) => String(b.termineLe || b.echeance || '').localeCompare(String(a.termineLe || a.echeance || '')));
    const sec = (titre, list) => list.length ? `<div><h3>${titre} · ${list.length}</h3>${list.map(tacheHtml).join('')}</div>` : '';
    const quiChips = [['', 'Toutes'], ['moi', 'Les miennes']].concat(persOptions(true)).map(([k, l]) => `<button class="chip${TA.qui === k ? ' on' : ''}" type="button" data-act="taQui" data-k="${k}">${esc(l)}</button>`).join('');
    const tagChips = TAGS.filter(([k]) => k).map(([k, l]) => `<button class="chip${TA.tag === k ? ' on' : ''}" type="button" data-act="taTag" data-k="${k}">${esc(l)}</button>`).join('');
    return tabs('taches', [['', 'Tâches'], ['semaine', 'Feuille de la semaine']], '') + `<div class="panel">
      <form class="quick" data-form="taQuick"><input name="titre" id="ta-quick" placeholder="Nouvelle tâche… (Entrée pour ajouter)" autocomplete="off" aria-label="Nouvelle tâche"><button class="btn primary" type="submit">Ajouter</button></form>
      <div class="chips">${quiChips}</div><div class="chips">${tagChips}</div>
      ${sec('Urgent ou en retard', urg)}${sec('En cours', enc)}${sec('À faire', af)}${sec('Suspendu', sus)}
      ${!urg.length && !enc.length && !af.length ? `<p class="empty">Aucune tâche ouverte${TA.qui || TA.tag ? ' avec ce filtre' : ''}.</p>` : ''}
      ${fin.length ? `<div><button class="btn link" type="button" data-act="taFini">${TA.voirFini ? 'Masquer' : 'Voir'} les ${fin.length} tâches terminées</button>${TA.voirFini ? fin.map(tacheHtml).join('') : ''}</div>` : ''}
    </div>`;
  },
};
function tacheHtml(t) {
  const done = t.statut === 'termine', late = tacheEnRetard(t);
  const meta = [];
  if (t.urgent && !done) meta.push('<span class="pill urgent">Urgent</span>');
  if (t.statut === 'encours') meta.push('<span class="pill encours">En cours</span>');
  if (t.echeance) meta.push(`<span class="${late ? 'err' : ''}">${late ? 'En retard · ' : ''}${fmtDate(t.echeance)}</span>`);
  if (t.responsable) meta.push(`<span>${esc(nomDe(t.responsable))}</span>`);
  if (t.tag) meta.push(`<span class="tpill">${esc(tagLabel(t.tag))}</span>`);
  if (t.rep && !done) meta.push(`<span title="Tâche qui se répète">↻ ${esc((REPETITIONS.find((r) => r[0] === t.rep) || ['', ''])[1].toLowerCase())}</span>`);
  return `<div class="task${done ? ' done' : ''}"><button class="tick" type="button" data-act="taTick" data-key="${esc(t.key)}" aria-label="${done ? 'Rouvrir' : 'Marquer comme terminée'} : ${esc(t.titre)}"></button>
    <div class="body" data-act="taEdit" data-key="${esc(t.key)}" role="button" tabindex="0"><strong>${esc(t.titre)}</strong>${meta.length ? `<span class="meta">${meta.join('')}</span>` : ''}${t.remarques ? `<span class="meta">${linkify(trunc(t.remarques, 160))}</span>` : ''}</div></div>`;
}
ACTIONS.taQui = (el) => { TA.qui = el.dataset.k; render(); };
ACTIONS.taTag = (el) => { TA.tag = TA.tag === el.dataset.k ? '' : el.dataset.k; render(); };
ACTIONS.taFini = () => { TA.voirFini = !TA.voirFini; render(); };
FORMS.taQuick = (v) => {
  if (!v.titre) return;
  const resp = TA.qui && TA.qui !== 'moi' ? TA.qui : '';
  DB.put('t:' + uid('t'), { titre: v.titre, statut: 'afaire', responsable: resp, tag: TA.tag, cree: new Date().toISOString(), creePar: Sync.me || '' });
  setTimeout(() => { const q = $('ta-quick'); if (q) q.focus(); }, 0);
};
ACTIONS.taTick = (el) => {
  const t = DB.get(el.dataset.key); if (!t) return;
  const done = t.statut === 'termine';
  DB.put(el.dataset.key, Object.assign({}, t, done ? { statut: 'afaire', termineLe: '' } : { statut: 'termine', termineLe: todayISO() }));
  if (!done) { if (t.rep) repeterSiBesoin(el.dataset.key, t); else toast('Tâche terminée.'); }
};
ACTIONS.taEdit = (el) => {
  const k = el.dataset.key, t = DB.get(k); if (!t) return;
  openSheet(`${sheetHead('Tâche')}<form class="sbody form" data-form="ta"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ta-titre', 'Tâche', t.titre, { name: 'titre', req: true })}
    <div class="grid2">${sel('ta-statut', 'Statut', t.statut || 'afaire', STATUTS, { name: 'statut' })}${inp('ta-ech', 'Échéance', t.echeance, { name: 'echeance', type: 'date' })}
      ${sel('ta-resp', 'Responsable', t.responsable || '', [['', '—']].concat(persOptions(true)), { name: 'responsable' })}${sel('ta-tag', 'Domaine', t.tag || '', TAGS, { name: 'tag' })}</div>
    <div class="grid2">${sel('ta-rep', 'Se répète', t.rep || '', REPETITIONS, { name: 'rep', sub: 'À la fin de la tâche, la suivante est créée avec la prochaine échéance.' })}
      <label class="row" style="font-size:14px;align-self:center"><input type="checkbox" name="urgent"${t.urgent ? ' checked' : ''}> Urgent</label></div>
    ${txt('ta-rem', 'Remarques', t.remarques, { name: 'remarques', rows: 4 })}
    ${t.remarques && /https?:\/\//.test(t.remarques) ? `<p class="hint">${linkify(t.remarques)}</p>` : ''}
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette tâche">Supprimer</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.ta = (v) => {
  const t = DB.get(v.key); if (!t || !v.titre) return;
  const was = t.statut;
  const o = Object.assign({}, t, { titre: v.titre, statut: v.statut, echeance: v.echeance, responsable: v.responsable, tag: v.tag, urgent: !!v.urgent, rep: v.rep || '', remarques: v.remarques, termineLe: v.statut === 'termine' ? (was === 'termine' ? t.termineLe : todayISO()) : '' });
  if (o.rep && !o.echeance && v.statut !== 'termine') o.echeance = todayISO();
  DB.put(v.key, o); closeSheet();
  if (v.statut === 'termine' && was !== 'termine' && o.rep) repeterSiBesoin(v.key, o); else toast('Tâche enregistrée.');
};
