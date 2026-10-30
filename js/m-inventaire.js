/* Gamins de Talus — inventaire, amortissements et achats prévus. */
'use strict';

const inventaire = () => DB.all('inv:').sort((a, b) => String(a.dateAchat || '').localeCompare(String(b.dateAchat || '')) || String(a.nom).localeCompare(b.nom, 'fr'));
const achats = () => DB.all('achat:');
const INV_CAT = ['Machine', 'Outil', 'Irrigation', 'Véhicule', 'Autre'];
const TAUX_DEFAUT = { Machine: 0.3, Outil: 0.5, Irrigation: 0.4, 'Véhicule': 0.4, Autre: 0.4 };
const PRIO = [['indispensable', 'Indispensable'], ['utile', 'Utile'], ['plustard', 'Plus tard']];
const pct = (t) => Math.round(num(t) * 1000) / 10 + ' %';

function ajouterInventaireDepuis(depKey) {
  const d = DB.get(depKey); if (!d) return;
  if (DB.all('inv:').some((i) => i.depenseId === depKey)) return;
  const cat = d.categorie === 'Machine' ? 'Machine' : d.categorie === 'Outil' ? 'Outil' : 'Autre';
  DB.put('inv:' + uid('i'), { nom: d.objet, categorie: cat, dateAchat: d.date, valeur: r2(d.montant), taux: TAUX_DEFAUT[cat], depenseId: depKey, remarque: '' });
}

MODULES.inventaire = {
  titre: 'Inventaire',
  tuile() { const y = Number(todayISO().slice(0, 4)), l = inventaire(); const v = l.reduce((a, i) => a + valeurFinAnnee(i, y, !!cfg().amortirDesAchat), 0); const p = achats().filter((a) => a.statut !== 'achete').length; return { line: `${l.length} objets · valeur ${chf(v)}${p ? ` · ${p} achats prévus` : ''}` }; },
  /* L'inventaire est maintenant dans Finances : les anciennes adresses y mènent */
  render(sub) { setTimeout(() => location.replace(sub === 'achats' ? '#/finances/achats' : '#/finances/inventaire'), 0); return ''; },
};

function renderInventaire() {
  const l = inventaire(), des = !!cfg().amortirDesAchat, now = Number(todayISO().slice(0, 4));
  const y0 = Math.min(now, ...l.map((i) => Number(yearOf(i.dateAchat)) || now));
  const years = Array.from({ length: 5 }, (_, i) => y0 + i);
  const tot = years.map((y) => l.reduce((a, i) => a + valeurFinAnnee(i, y, des), 0));
  const amortY = l.reduce((a, i) => a + amortissementAnnee(i, now, des), 0);
  const linked = new Set(l.map((i) => i.depenseId).filter(Boolean));
  const libres = depenses().filter((d) => d.type === 'investissement' && !linked.has(d.key)).sort((a, b) => String(a.date).localeCompare(b.date));
  return `<div class="stats">
      <div class="stat good"><span class="k">Valeur d'achat</span><span class="v">${chf(l.reduce((a, i) => a + num(i.valeur), 0))}</span><span class="s">${l.length} objet${l.length > 1 ? 's' : ''}</span></div>
      <div class="stat blue"><span class="k">Valeur fin ${now}</span><span class="v">${chf(l.reduce((a, i) => a + valeurFinAnnee(i, now, des), 0))}</span></div>
      <div class="stat"><span class="k">Amortissement ${now}</span><span class="v">${chf(amortY)}</span><span class="s">Compté comme charge dans le résultat</span></div></div>
    <div class="panel"><div class="between"><h2>Valeur résiduelle par année</h2><button class="btn primary small" type="button" data-act="invEdit">+ Objet</button></div>
      ${l.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Objet</th><th>Achat</th><th class="r">Taux</th>${years.map((y) => `<th class="r">${y}</th>`).join('')}</tr></thead><tbody>
        ${l.map((i) => `<tr class="click" data-act="invEdit" data-key="${esc(i.key)}"><td>${esc(i.nom)}${i.sortieLe ? ' <span class="tpill">sorti</span>' : ''}${(() => { const d = i.depenseId ? DB.get(i.depenseId) : null; return d && d.garantie && d.garantie >= todayISO() ? ` <span class="clip" title="Garantie jusqu'au ${fmtDate(d.garantie)}">🛡️</span>` : ''; })()}<br><span class="hint">${esc(i.categorie || '')}</span></td><td class="num">${i.dateAchat ? fmtDate(i.dateAchat) : '—'}</td><td class="r num">${pct(i.taux)}</td>${years.map((y) => `<td class="r num">${num(i.valeur) ? money(valeurFinAnnee(i, y, des)) : '—'}</td>`).join('')}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Total</td>${tot.map((v) => `<td class="r num">${money(v)}</td>`).join('')}</tr></tfoot></table></div>`
      : '<p class="empty">Aucun objet dans l\'inventaire.</p>'}
      <p class="hint">Amortissement dégressif : chaque année, la valeur baisse du taux indiqué. ${des ? "L'amortissement commence dès l'année d'achat." : "Comme dans votre ancien tableur, l'année d'achat garde la valeur d'achat ; l'amortissement commence l'année suivante."} Réglage modifiable dans Réglages. Les taux sont à valider avec votre fiduciaire.</p></div>
    ${libres.length ? `<div class="panel"><h2>Investissements pas encore dans l'inventaire</h2><p class="hint">Ces dépenses sont marquées « investissement ». Ajoute celles qui durent plusieurs années pour les amortir.</p>
      <div class="items">${libres.map((d) => `<div class="item" style="cursor:default"><span class="who"><strong>${esc(d.objet)}</strong><span class="meta">${fmtDate(d.date)} · ${esc(d.categorie || '—')}</span></span><span class="row"><span class="amt">${chf(d.montant)}</span><button class="btn small" type="button" data-act="invFromDep" data-key="${esc(d.key)}">Ajouter</button></span></div>`).join('')}</div></div>` : ''}`;
}
ACTIONS.invFromDep = (el) => { ajouterInventaireDepuis(el.dataset.key); toast('Ajouté à l\'inventaire.'); };
ACTIONS.invEdit = (el) => {
  const k = el.dataset.key || '', i = k ? DB.get(k) : { categorie: 'Outil', taux: 0.5, dateAchat: todayISO() };
  const dep = i.depenseId ? DB.get(i.depenseId) : null;
  openSheet(`${sheetHead(k ? i.nom : 'Nouvel objet')}<form class="sbody form" data-form="inv"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('iv-nom', 'Objet', i.nom, { name: 'nom', req: true })}
    <div class="grid2">${sel('iv-cat', 'Catégorie', i.categorie, INV_CAT.map((c) => [c, c]), { name: 'categorie' })}${inp('iv-date', "Date d'achat", i.dateAchat, { name: 'dateAchat', type: 'date' })}
      ${inp('iv-val', "Valeur d'achat CHF", i.valeur ?? '', { name: 'valeur', type: 'number', attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}${inp('iv-taux', "Taux d'amortissement %", r2(num(i.taux) * 100), { name: 'taux', type: 'number', attrs: { step: '1', min: '0', max: '100' }, sub: 'Machines 30 %, outils 50 % dans votre ancien tableur.' })}</div>
    ${dep ? `<p class="hint">Lié à la dépense du ${fmtDate(dep.date)} : ${esc(dep.objet)} (${chf(dep.montant)}).${dep.garantie ? ` 🛡️ Garantie jusqu'au ${fmtDate(dep.garantie)}${dep.garantie < todayISO() ? ' (terminée)' : ''}.` : ''} <a href="#" data-act="depEdit" data-key="${esc(i.depenseId)}">Voir la dépense et son ticket</a></p>` : ''}
    ${inp('iv-sortie', 'Vendu ou jeté le', i.sortieLe, { name: 'sortieLe', type: 'date', sub: "Laisser vide tant que l'objet est utilisé." })}
    ${txt('iv-rem', 'Remarque', i.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet objet">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.inv = (v) => {
  if (!v.nom) { toast("Le nom de l'objet est obligatoire."); return; }
  const k = v.key || 'inv:' + uid('i');
  DB.put(k, Object.assign({}, DB.get(k) || {}, { nom: v.nom, categorie: v.categorie, dateAchat: v.dateAchat, valeur: v.valeur === '' ? 0 : r2(num(v.valeur)), taux: Math.min(1, Math.max(0, num(v.taux) / 100)), sortieLe: v.sortieLe, remarque: v.remarque }));
  closeSheet(); toast('Objet enregistré.');
};

function renderAchats() {
  const l = achats(), prevus = l.filter((a) => a.statut !== 'achete'), faits = l.filter((a) => a.statut === 'achete');
  const tot = (xs) => xs.reduce((s, a) => s + num(a.qte || 1) * num(a.prixUnit), 0);
  const ordre = { indispensable: 0, utile: 1, plustard: 2 };
  const item = (a) => `<div class="item" data-act="achatEdit" data-key="${esc(a.key)}"><span class="who"><strong>${num(a.qte) > 1 ? fmtNum(a.qte) + ' × ' : ''}${esc(a.nom)}</strong><span class="meta">${[a.fournisseur, (PRIO.find((p) => p[0] === a.priorite) || ['', ''])[1]].filter(Boolean).map(esc).join(' · ')}${a.lien ? ` · <a href="${esc(a.lien)}" target="_blank" rel="noopener">lien</a>` : ''}</span></span><span class="amt">${a.prixUnit ? chf(num(a.qte || 1) * num(a.prixUnit)) : '—'}</span></div>`;
  return `<div class="split"><div class="panel"><div class="between"><h2>À acheter</h2><button class="btn primary small" type="button" data-act="achatEdit">+ Achat</button></div>
      ${prevus.length ? `<p class="hint">Total estimé : <span class="num">${chf(tot(prevus))}</span></p><div class="items">${prevus.sort((a, b) => (ordre[a.priorite] ?? 3) - (ordre[b.priorite] ?? 3)).map(item).join('')}</div>` : '<p class="empty">Rien de prévu.</p>'}</div>
    <div class="panel"><h2>Déjà achetés</h2>${faits.length ? `<div class="items">${faits.map(item).join('')}</div>` : '<p class="empty">Aucun.</p>'}</div></div>`;
}
ACTIONS.achatEdit = (el) => {
  if (el.closest && el.closest('a[target]')) return;
  const k = el.dataset.key || '', a = k ? DB.get(k) : { qte: 1, priorite: 'utile', statut: 'prevu' };
  openSheet(`${sheetHead(k ? a.nom : 'Achat prévu')}<form class="sbody form" data-form="achat"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ac-nom', 'Quoi', a.nom, { name: 'nom', req: true })}
    <div class="grid2">${inp('ac-qte', 'Quantité', a.qte, { name: 'qte', type: 'number', attrs: { step: 'any', min: '0' } })}${inp('ac-prix', 'Prix unitaire CHF', a.prixUnit ?? '', { name: 'prixUnit', type: 'number', attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}
      ${sel('ac-prio', 'Priorité', a.priorite, PRIO, { name: 'priorite' })}${inp('ac-four', 'Fournisseur', a.fournisseur, { name: 'fournisseur' })}</div>
    ${inp('ac-lien', 'Lien', a.lien, { name: 'lien', type: 'url' })}
    ${sel('ac-st', 'Statut', a.statut || 'prevu', [['prevu', 'Prévu'], ['achete', 'Acheté']], { name: 'statut' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet achat">Supprimer</button>` : ''}${k && a.statut !== 'achete' ? `<button class="btn" type="button" data-act="achatFait" data-key="${esc(k)}">Acheté : saisir la dépense</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.achat = (v) => {
  if (!v.nom) { toast('Indique ce qu\'il faut acheter.'); return; }
  const k = v.key || 'achat:' + uid('a');
  DB.put(k, Object.assign({}, DB.get(k) || {}, { nom: v.nom, qte: num(v.qte) || 1, prixUnit: v.prixUnit === '' ? null : r2(num(v.prixUnit)), priorite: v.priorite, fournisseur: v.fournisseur, lien: v.lien, statut: v.statut }));
  closeSheet(); toast('Achat enregistré.');
};
ACTIONS.achatFait = (el) => {
  const a = DB.get(el.dataset.key); if (!a) return;
  DB.put(el.dataset.key, Object.assign({}, a, { statut: 'achete' }));
  ACTIONS.depEdit({ dataset: {}, _pre: { objet: a.nom, montant: a.prixUnit ? r2(num(a.qte || 1) * num(a.prixUnit)) : '', type: 'investissement', categorie: 'Outil' } });
};
