/* Gamins de Talus — boîte à idées : bugs, idées, nouvelles fonctions (bouton 💡 en haut).
   idee:<id> = { titre, type: 'bug' | 'idee', details, par, cree, fait?, faitPar?, faitLe? } — cochée = faite, elle disparaît de la liste. */
'use strict';
const IDEE_TYPES = [['bug', '🐞', 'Bug'], ['idee', '💡', 'Idée']];
const idees = () => DB.all('idee:').sort((a, b) => String(b.cree || '').localeCompare(String(a.cree || '')));
const IDEE = { type: 'idee', faites: false };
function ideesHtml() {
  const l = idees(), ouv = l.filter((x) => !x.fait), faites = l.filter((x) => x.fait);
  const ligne = (x) => { const t = IDEE_TYPES.find((y) => y[0] === x.type) || IDEE_TYPES[1];
    return `<div class="idee${x.fait ? ' fait' : ''}"><input type="checkbox" data-idee="${esc(x.key)}"${x.fait ? ' checked' : ''} aria-label="Fait : ${esc(x.titre)}">
      <button type="button" class="idee-t" data-act="ideeVoir" data-key="${esc(x.key)}"><span>${t[1]} ${esc(x.titre)}</span><span class="hint">${esc(nomDe(x.par))}${x.details ? ' · 📝' : ''}</span></button></div>`; };
  return `${sheetHead('Bugs et idées', 'Ce qui ne marche pas, ce qui manque')}<div class="sbody" data-vue-racine>
    <form class="form idee-ajout" data-form="ideeAjout">
      <div class="chips">${IDEE_TYPES.map(([k, e, n]) => `<button type="button" class="chip${IDEE.type === k ? ' on' : ''}" data-act="ideeType" data-k="${k}">${e} ${n}</button>`).join('')}</div>
      <div class="ab-ligne"><input name="titre" id="idee-titre" placeholder="${IDEE.type === 'bug' ? 'Ce qui ne marche pas…' : 'Ton idée, une nouvelle fonction…'}" autocomplete="off" enterkeyhint="done" aria-label="Titre"><button class="btn primary ab-plus" type="submit" aria-label="Ajouter">+</button></div>
      <details><summary class="hint">+ Détails</summary>${txt('idee-det', 'Détails (facultatif)', '', { name: 'details', rows: 3 })}</details></form>
    <div class="idees">${ouv.length ? ouv.map(ligne).join('') : '<p class="empty">Rien en attente. 🌿</p>'}</div>
    ${faites.length ? `<button type="button" class="btn link small" data-act="ideeFaites">${IDEE.faites ? 'Cacher' : 'Voir'} les faites (${faites.length})</button>${IDEE.faites ? `<div class="idees">${faites.slice(0, 50).map(ligne).join('')}</div>` : ''}` : ''}</div>`;
}
ACTIONS.idees = () => { openSheet(ideesHtml()); };
const ideesRafraichir = () => { if (document.querySelector('#sheet .idees') || document.querySelector('#sheet .idee-ajout')) openSheet(ideesHtml()); };
ACTIONS.ideeType = (el) => { IDEE.type = el.dataset.k; const t = $('idee-titre'), v = t ? t.value : ''; openSheet(ideesHtml()); const n = $('idee-titre'); if (n) { n.value = v; n.focus(); } };
ACTIONS.ideeFaites = () => { IDEE.faites = !IDEE.faites; openSheet(ideesHtml()); };
FORMS.ideeAjout = (v) => {
  if (!String(v.titre || '').trim()) { toast('Écris le titre.'); return; }
  DB.put('idee:' + uid('i'), { titre: v.titre.trim(), type: IDEE.type, details: String(v.details || '').trim(), par: Sync.me || '', cree: new Date().toISOString() });
  toast(IDEE.type === 'bug' ? 'Bug noté. Merci !' : 'Idée notée. Merci !'); openSheet(ideesHtml()); const n = $('idee-titre'); if (n) n.focus();
};
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.idee; if (!k) return; const x = DB.get(k); if (!x) return;
  DB.put(k, Object.assign({}, x, e.target.checked ? { fait: true, faitPar: Sync.me || '', faitLe: todayISO() } : { fait: false, faitPar: '', faitLe: '' }));
  setTimeout(ideesRafraichir, 250);
});
ACTIONS.ideeVoir = (el) => {
  const k = el.dataset.key, x = DB.get(k); if (!x) return;
  openSheet(`${sheetHead(x.titre, `${(IDEE_TYPES.find((y) => y[0] === x.type) || IDEE_TYPES[1])[2]} · ${nomDe(x.par)} · ${fmtDate(String(x.cree || '').slice(0, 10))}${x.fait ? ` · fait${x.faitPar ? ' par ' + nomDe(x.faitPar) : ''}` : ''}`)}<form class="sbody form" data-form="ideeEdit"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ie-t', 'Titre', x.titre, { name: 'titre', req: true })}
    <div class="field"><span class="flabel">Type</span><div class="seg">${IDEE_TYPES.map(([t, e, n]) => `<label><input type="radio" name="type" value="${t}"${(x.type || 'idee') === t ? ' checked' : ''}> ${e} ${n}</label>`).join('')}</div></div>
    ${txt('ie-d', 'Détails', x.details, { name: 'details', rows: 6 })}
    ${x.details && /https?:\/\//.test(x.details) ? `<p class="hint">${linkify(x.details)}</p>` : ''}
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet élément">Supprimer</button><button class="btn" type="button" data-act="idees">‹ Liste</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.ideeEdit = (v) => { const x = DB.get(v.key); if (!x || !String(v.titre || '').trim()) return; DB.put(v.key, Object.assign({}, x, { titre: v.titre.trim(), type: v.type || x.type, details: String(v.details || '').trim() })); toast('Enregistré.'); ACTIONS.idees(); };
