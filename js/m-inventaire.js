/* Gamins de Talus — inventaire, amortissements et achats prévus. */
'use strict';

const inventaire = () => DB.all('inv:').sort((a, b) => String(a.dateAchat || '').localeCompare(String(b.dateAchat || '')) || String(a.nom).localeCompare(b.nom, 'fr'));
const achats = () => DB.all('achat:');
const INV_CAT = ['Machine', 'Outil', 'Irrigation', 'Véhicule', 'Autre'];
const TAUX_DEFAUT = { Machine: 0.3, Outil: 0.5, Irrigation: 0.4, 'Véhicule': 0.4, Autre: 0.4 };
const PRIO = [['indispensable', 'Indispensable'], ['utile', 'Utile'], ['plustard', 'Plus tard']];
const pct = (t) => Math.round(num(t) * 1000) / 10 + ' %';

/* ---------- Investissement ↔ objet de l'inventaire ----------
   Une dépense d'investissement est une « part » d'un objet (parts = [{ depenseId, date, valeur }]) : plusieurs achats
   peuvent former un seul objet (« Système d'irrigation »). La valeur et la date de l'objet suivent ses parts. */
const CAT_DU_COMPTE = { 1500: 'Machine', 1510: 'Irrigation', 1520: 'Autre', 1530: 'Véhicule', 1540: 'Outil' };
const objetDeDepense = (depKey) => DB.all('inv:').find((i) => i.depenseId === depKey || (i.parts || []).some((p) => p.depenseId === depKey));
function avecParts(i) { return Array.isArray(i.parts) && i.parts.length ? i : Object.assign({}, i, { parts: [{ depenseId: i.depenseId || '', date: i.dateAchat, valeur: num(i.valeur) }] }); }
function recalculerObjet(i) {
  const ps = i.parts || []; if (!ps.length) return i;
  return Object.assign({}, i, { valeur: r2(ps.reduce((a, p) => a + num(p.valeur), 0)), dateAchat: ps.map((p) => p.date).filter(Boolean).sort()[0] || i.dateAchat });
}
/* Retire la dépense de l'objet où elle est ; un objet qui n'a plus aucun achat disparaît */
function detacherDepense(depKey) {
  const i = objetDeDepense(depKey); if (!i) return;
  const o = avecParts(i), reste = o.parts.filter((p) => p.depenseId !== depKey);
  if (!reste.length) DB.del(i.key); else DB.put(i.key, recalculerObjet(Object.assign({}, o, { parts: reste, depenseId: '' })));
}
/* Range la dépense dans un objet existant (invKey) ou dans un nouvel objet (opts : nom, categorie, methode, taux, duree) */
function lierDepenseInventaire(depKey, invKey, opts) {
  const d = DB.get(depKey); if (!d) return '';
  const deja = objetDeDepense(depKey), part = { depenseId: depKey, date: d.date, valeur: r2(num(d.montant)) };
  if (deja && (deja.key === invKey || (!invKey && !opts))) { const o = avecParts(deja); DB.put(deja.key, recalculerObjet(Object.assign({}, o, { parts: o.parts.map((p) => (p.depenseId === depKey ? part : p)) }))); return deja.key; }
  if (deja) detacherDepense(depKey);
  if (invKey && DB.get(invKey)) { const o = avecParts(DB.get(invKey)); DB.put(invKey, recalculerObjet(Object.assign({}, o, { parts: o.parts.concat([part]) }))); return invKey; }
  const n = 'inv:' + uid('i'), cpt = compteDe(d), x = opts || {};
  DB.put(n, recalculerObjet({ nom: x.nom || d.objet, categorie: x.categorie || CAT_DU_COMPTE[cpt] || 'Autre', compte: cpt, methode: x.methode === 'lineaire' ? 'lineaire' : 'degressif', taux: x.taux != null ? x.taux : (compteInfo(cpt).taux || 40) / 100, duree: num(x.duree) || 5, parts: [part], remarque: '' }));
  return n;
}
function ajouterInventaireDepuis(depKey) { if (!objetDeDepense(depKey)) lierDepenseInventaire(depKey, '', {}); }
const compteObjet = (i) => String(i.compte || ({ Machine: '1500', Irrigation: '1510', 'Véhicule': '1530', Outil: '1540' })[i.categorie] || '1500');
const amortTxt = (i) => i.methode === 'lineaire' ? `${num(i.duree) || 1} ans` : pct(i.taux);

MODULES.inventaire = {
  titre: 'Inventaire',
  tuile() { const y = Number(todayISO().slice(0, 4)), l = inventaire(); const v = l.reduce((a, i) => a + valeurFinAnnee(i, y, !!cfg().amortirDesAchat), 0); const p = achats().filter((a) => a.statut !== 'achete').length; return { line: `${l.length} objets · valeur ${chf(v)}${p ? ` · ${p} achats prévus` : ''}` }; },
  /* L'inventaire est maintenant dans Finances : les anciennes adresses y mènent */
  render() { setTimeout(() => location.replace('#/finances/inventaire'), 0); return ''; },
};

function renderInventaire() {
  const l = inventaire(), des = !!cfg().amortirDesAchat, now = Number(todayISO().slice(0, 4));
  const y0 = Math.min(now, ...l.map((i) => Number(yearOf(i.dateAchat)) || now));
  const years = Array.from({ length: 5 }, (_, i) => y0 + i);
  const tot = years.map((y) => l.reduce((a, i) => a + valeurFinAnnee(i, y, des), 0));
  const amortY = l.reduce((a, i) => a + amortissementAnnee(i, now, des), 0);
  const linked = new Set(l.flatMap((i) => [i.depenseId].concat((i.parts || []).map((p) => p.depenseId))).filter(Boolean));
  const libres = depenses().filter((d) => d.type === 'investissement' && !linked.has(d.key)).sort((a, b) => String(a.date).localeCompare(b.date));
  return `<div class="stats">
      <div class="stat good"><span class="k">Valeur d'achat</span><span class="v">${chf(l.reduce((a, i) => a + num(i.valeur), 0))}</span><span class="s">${l.length} objet${l.length > 1 ? 's' : ''}</span></div>
      <div class="stat blue"><span class="k">Valeur fin ${now}</span><span class="v">${chf(l.reduce((a, i) => a + valeurFinAnnee(i, now, des), 0))}</span></div>
      <div class="stat"><span class="k">Amortissement ${now}</span><span class="v">${chf(amortY)}</span><span class="s">Compté comme charge dans le résultat</span></div></div>
    <div class="panel"><div class="between"><h2>Valeur résiduelle par année</h2><button class="btn primary small" type="button" data-act="invEdit">+ Objet</button></div>
      ${l.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Objet</th><th>Achat</th><th class="r">Amort.</th>${years.map((y) => `<th class="r">${y}</th>`).join('')}</tr></thead><tbody>
        ${l.map((i) => `<tr class="click" data-act="invEdit" data-key="${esc(i.key)}"><td>${esc(i.nom)}${(i.parts || []).length > 1 ? ` <span class="tpill">${i.parts.length} achats</span>` : ''}${i.sortieLe ? ' <span class="tpill">sorti</span>' : ''}${(() => { const d = [i.depenseId].concat((i.parts || []).map((p) => p.depenseId)).filter(Boolean).map((k) => DB.get(k)).find((x) => x && x.garantie && x.garantie >= todayISO()); return d && d.garantie && d.garantie >= todayISO() ? ` <span class="clip" title="Garantie jusqu'au ${fmtDate(d.garantie)}">🛡️</span>` : ''; })()}<br><span class="hint">${esc(i.categorie || '')}</span></td><td class="num">${i.dateAchat ? fmtDate(i.dateAchat) : '—'}</td><td class="r num">${amortTxt(i)}</td>${years.map((y) => `<td class="r num">${num(i.valeur) ? money(valeurFinAnnee(i, y, des)) : '—'}</td>`).join('')}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3">Total</td>${tot.map((v) => `<td class="r num">${money(v)}</td>`).join('')}</tr></tfoot></table></div>`
      : '<p class="empty">Aucun objet dans l\'inventaire.</p>'}
      <p class="hint">Amortissement dégressif : chaque année, la valeur baisse du taux indiqué. ${des ? "L'amortissement commence dès l'année d'achat." : "Comme dans votre ancien tableur, l'année d'achat garde la valeur d'achat ; l'amortissement commence l'année suivante."} Réglage modifiable dans Réglages. Les taux sont à valider avec votre fiduciaire.</p></div>
    ${libres.length ? `<div class="panel"><h2>Investissements pas encore dans l'inventaire</h2><p class="hint">Ces dépenses sont des investissements. « Ranger… » : les mettre dans un objet existant ou en créer un, pour les amortir.</p>
      <div class="items">${libres.map((d) => `<div class="item" style="cursor:default"><span class="who"><strong>${esc(d.objet)}</strong><span class="meta">${fmtDate(d.date)} · ${esc(d.categorie || '—')}</span></span><span class="row"><span class="amt">${chf(d.montant)}</span><button class="btn small" type="button" data-act="depEdit" data-key="${esc(d.key)}">Ranger…</button></span></div>`).join('')}</div></div>` : ''}`;
}
ACTIONS.invFromDep = (el) => { ajouterInventaireDepuis(el.dataset.key); toast('Ajouté à l\'inventaire.'); };
ACTIONS.invEdit = (el) => {
  const k = el.dataset.key || '', i = k ? DB.get(k) : { categorie: 'Outil', taux: 0.45, methode: 'degressif', duree: 5, dateAchat: todayISO() };
  const o = k ? avecParts(i) : i, deps = (o.parts || []).filter((p) => p.depenseId), lin = i.methode === 'lineaire';
  openSheet(`${sheetHead(k ? i.nom : 'Nouvel objet')}<form class="sbody form" data-form="inv"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('iv-nom', 'Objet', i.nom, { name: 'nom', req: true, sub: 'Plusieurs achats peuvent former un seul objet, ex. « Système d\'irrigation ».' })}
    <div class="grid2">${sel('iv-cat', 'Catégorie', i.categorie, INV_CAT.map((c) => [c, c]), { name: 'categorie' })}${deps.length ? `<div class="field"><span class="flabel">Valeur d'achat</span><b class="num">${chf(o.parts.reduce((a, p) => a + num(p.valeur), 0))}</b><span class="sub">Somme des achats ci-dessous.</span></div>` : inp('iv-val', "Valeur d'achat CHF", i.valeur ?? '', { name: 'valeur', type: 'number', attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}
      ${deps.length ? '' : inp('iv-date', "Date d'achat", i.dateAchat, { name: 'dateAchat', type: 'date' })}</div>
    ${methodeAmortHtml('iv', lin ? 'lineaire' : 'degressif', r2(num(i.taux) * 100), num(i.duree) || 5)}
    ${deps.length ? `<div class="field"><span class="flabel">Achats (${deps.length})</span><div class="items">${o.parts.map((p) => { const d = p.depenseId && DB.get(p.depenseId); return `<button type="button" class="item" ${d ? `data-act="depEdit" data-key="${esc(p.depenseId)}"` : 'disabled'}><span class="who"><strong>${esc(d ? d.objet : p.depenseId ? 'Dépense supprimée' : 'Valeur de départ')}</strong><span class="meta">${p.date ? fmtDate(p.date) : ''}${d && d.garantie && d.garantie >= todayISO() ? ' · 🛡️ garantie jusqu\'au ' + fmtDate(d.garantie) : ''}</span></span><span class="amt">${chf(p.valeur)}</span></button>`; }).join('')}</div>
      <span class="sub">Pour ajouter un achat : dans la dépense, choisis le compte 15xx puis cet objet.</span></div>` : ''}
    ${inp('iv-sortie', 'Vendu ou jeté le', i.sortieLe, { name: 'sortieLe', type: 'date', sub: "Laisser vide tant que l'objet est utilisé." })}
    ${txt('iv-rem', 'Remarque', i.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet objet">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
/* Méthode d'amortissement : dégressif (taux sur la valeur restante) ou linéaire (durée en années) */
function methodeAmortHtml(id, m, taux, duree) {
  return `<div class="field am"><span class="flabel">Amortissement</span>
    <div class="seg"><label><input type="radio" name="methode" value="degressif"${m !== 'lineaire' ? ' checked' : ''}> Dégressif</label><label><input type="radio" name="methode" value="lineaire"${m === 'lineaire' ? ' checked' : ''}> Linéaire</label></div>
    <div class="am-ch">${inp(id + '-taux', 'Taux par an %', taux, { name: 'taux', type: 'number', attrs: { step: '1', min: '0', max: '100' }, sub: 'Dégressif : sur la valeur restante. Repères : installations 25 %, machines 30 %, véhicules et informatique 40 %, outillage 45 %.' })}${inp(id + '-duree', 'Durée (ans)', duree, { name: 'duree', type: 'number', attrs: { step: '1', min: '1', max: '50' }, sub: "Linéaire : la même part chaque année, jusqu'à zéro." })}</div></div>`;
}
FORMS.inv = (v) => {
  if (!v.nom) { toast("Le nom de l'objet est obligatoire."); return; }
  const k = v.key || 'inv:' + uid('i'), old = DB.get(k) || {};
  const o = Object.assign({}, old, { nom: v.nom, categorie: v.categorie, methode: v.methode === 'lineaire' ? 'lineaire' : 'degressif', taux: Math.min(1, Math.max(0, num(v.taux) / 100)), duree: Math.max(1, num(v.duree) || 1), sortieLe: v.sortieLe, remarque: v.remarque });
  if (v.valeur !== undefined) o.valeur = v.valeur === '' ? 0 : r2(num(v.valeur));
  if (v.dateAchat !== undefined) o.dateAchat = v.dateAchat;
  if (Array.isArray(old.parts) && old.parts.length === 1 && !old.parts[0].depenseId) o.parts = [{ date: o.dateAchat, valeur: o.valeur }];
  DB.put(k, o); closeSheet(); toast('Objet enregistré.');
};

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
  ACTIONS.depEdit({ dataset: {}, _pre: { objet: a.nom, montant: a.prixUnit ? r2(num(a.qte || 1) * num(a.prixUnit)) : '', compte: '1540' } });
};

/* Les « achats prévus » sont devenus des tâches : chaque achat pas encore fait devient une tâche (une seule fois) */
function achatsEnTaches() {
  const l = achats().filter((a) => a.statut !== 'achete' && !a.tache); if (!l.length) return;
  const imp = { indispensable: 3, utile: 2, plustard: 1 };
  for (const a of l) {
    const tk = 't:' + uid('t'), prix = a.prixUnit ? r2(num(a.qte || 1) * num(a.prixUnit)) : 0;
    DB.put(tk, { titre: `Acheter : ${a.nom}${num(a.qte) > 1 ? ' × ' + fmtNum(a.qte) : ''}`, statut: 'afaire', importance: imp[a.priorite] || 2, cat: 'admin', sous: '', cultures: [],
      remarques: [a.fournisseur ? 'Fournisseur : ' + a.fournisseur : '', prix ? 'Prix estimé : ' + chf(prix) : '', a.lien || ''].filter(Boolean).join('\n'), cree: new Date().toISOString(), creePar: Sync.me || '' });
    DB.put(a.key, Object.assign({}, a, { tache: tk }));
  }
}
setTimeout(() => { if (Sync.me || LOCAL_MODE) sansAnnuler(achatsEnTaches); }, 12000);
