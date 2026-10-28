/* Gamins de Talus — finances : dépenses, recettes, résultat et décompte entre associés. */
'use strict';

const CATEGORIES = ['Charges spécifiques', 'Outil', 'Machine', 'Carburant', 'Frais', 'Autres'];
const CAT_AIDE = 'Charges spécifiques : semences, plants, engrais, protection des cultures.';
const MOYENS = ['TWINT', 'Espèces', 'Virement', 'Autre'];
const depenses = () => DB.all('dep:');
const recettesDirectes = () => DB.all('rec:');
const reglements = () => DB.all('reg:');
const recettesToutes = () => recettesUnifiees(recettesDirectes(), factures(), cfg());
const FIN = { annee: '', type: '', par: '', q: '', sansJ: false };
/* Un justificatif manque si le champ est vide ou ne contient qu'un tiret (« --- » dans l'ancien tableur). */
const sansJustificatif = (d) => !(d.fichiers && d.fichiers.length) && !String(d.justificatif || '').replace(/[-–—\s.]/g, '');
const DEP = { fichiers: [], key: '' };
const anneesFin = () => { const s = new Set([todayISO().slice(0, 4)]); for (const d of depenses()) s.add(yearOf(d.date)); for (const r of recettesToutes()) s.add(yearOf(r.date)); return [...s].filter(Boolean).sort().reverse(); };

function decompteActuel() { return decompte(depenses(), recettesToutes(), reglements(), cfg(), todayISO()); }
/* « Nicolas 50 % / Noé 50 % », et les entrées d'associés à venir */
function phrasePartage() {
  const today = todayISO(), P = parts(cfg(), today), ps = personnes();
  const now = ps.filter((p) => P[p.k] > 0).map((p) => `${esc(p.nom)} ${Math.round(P[p.k] * 100)} %`).join(', ');
  const fut = ps.filter((p) => p.associeDes && p.associeDes > today).map((p) => `${esc(p.nom)} associé dès le ${fmtDate(p.associeDes)}`);
  return now + (fut.length ? ' · ' + fut.join(', ') : '');
}
function phraseDecompte(d) {
  if (!d.transferts.length) return 'Vous êtes quittes.';
  return d.transferts.map((t) => `${nomDe(t.de)} doit ${chf(t.montant)} à ${nomDe(t.a)}`).join(' · ');
}

MODULES.finances = {
  titre: 'Finances',
  tuile() { const d = decompteActuel(); return { line: phraseDecompte(d) }; },
  render(sub) {
    const t = tabs('finances', [['', "Vue d'ensemble"], ['depenses', 'Dépenses'], ['recettes', 'Recettes'], ['inventaire', 'Inventaire'], ['achats', 'Achats prévus'], ['associes', 'Entre associés'], ['annee', "Fin d'année"]], sub);
    if (sub === 'inventaire') return t + renderInventaire();
    if (sub === 'achats') return t + renderAchats();
    if (sub === 'annee') return t + renderBouclement();
    if (sub === 'depenses') return t + renderDepenses();
    if (sub === 'recettes') return t + renderRecettes();
    if (sub === 'associes') return t + renderAssocies();
    return t + renderBilan();
  },
  after() {
    const q = $('fin-q'); if (q) q.addEventListener('input', () => { FIN.q = q.value; const p = q.selectionStart; render(); const n = $('fin-q'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* */ } });
    for (const id of ['fin-annee', 'fin-type', 'fin-par']) { const s = $(id); if (s) s.addEventListener('change', () => { FIN[id.slice(4)] = s.value; render(); }); }
  },
};

function bilanAnnee(y) {
  const deps = depenses().filter((d) => yearOf(d.date) === y);
  const recs = recettesToutes().filter((r) => yearOf(r.date) === y);
  const charges = deps.filter((d) => d.type !== 'investissement').reduce((a, d) => a + num(d.montant), 0);
  const invest = deps.filter((d) => d.type === 'investissement').reduce((a, d) => a + num(d.montant), 0);
  const rec = recs.reduce((a, r) => a + num(r.montant), 0);
  const amort = DB.all('inv:').reduce((a, i) => a + amortissementAnnee(i, Number(y), !!cfg().amortirDesAchat), 0);
  const cat = {}; for (const d of deps) { const k = d.categorie || 'Sans catégorie'; cat[k] = (cat[k] || 0) + num(d.montant); }
  return { charges, invest, rec, amort, resultat: rec - charges - amort, cat, nDep: deps.length, nRec: recs.length };
}
function renderBilan() {
  const ys = anneesFin(); const y = FIN.annee && ys.includes(FIN.annee) ? FIN.annee : ys[0];
  const b = bilanAnnee(y), d = decompteActuel();
  const heures = Object.values(totalHeures(DB.all('h:'), (h) => yearOf(h.date) === y)).reduce((a, x) => a + x, 0);
  const maxCat = Math.max(1, ...Object.values(b.cat));
  return `<div class="row">${ys.map((x) => `<button class="chip${x === y ? ' on' : ''}" type="button" data-act="finAnnee" data-y="${x}">${x}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat good"><span class="k">Recettes ${y}</span><span class="v">${chf(b.rec)}</span><span class="s">${b.nRec} encaissement${b.nRec > 1 ? 's' : ''}</span></div>
      <div class="stat bad"><span class="k">Charges</span><span class="v">${chf(b.charges)}</span></div>
      <div class="stat blue"><span class="k">Investissements</span><span class="v">${chf(b.invest)}</span><span class="s">Amortis sur plusieurs années</span></div>
      <div class="stat"><span class="k">Amortissements ${y}</span><span class="v">${chf(b.amort)}</span></div>
      <div class="stat ${b.resultat >= 0 ? 'good' : 'bad'}"><span class="k">Résultat</span><span class="v">${chf(b.resultat)}</span><span class="s">Recettes − charges − amortissements</span></div>
      <div class="stat"><span class="k">Par heure travaillée</span><span class="v">${heures ? chf(b.resultat / heures) : '—'}</span><span class="s">${fmtH(heures)} h en ${y}</span></div>
    </div>
    <div class="split">
      <div class="panel"><div class="between"><h2>Entre associés</h2><a class="btn small" href="#/finances/associes">Détail</a></div>
        <p style="margin:0;font-size:18px"><b>${esc(phraseDecompte(d))}</b></p>
        <p class="hint">Calculé sur toutes les dépenses, recettes et remboursements depuis le début, avec un partage selon la date de chaque montant. Aujourd'hui : ${phrasePartage()}.</p>
        ${d.transferts.length ? `<div class="row"><button class="btn primary" type="button" data-act="regEdit" data-de="${d.transferts[0].de}" data-a="${d.transferts[0].a}" data-m="${d.transferts[0].montant}">Enregistrer le remboursement</button></div>` : ''}
      </div>
      <div class="panel"><h2>Dépenses ${y} par catégorie</h2>${Object.keys(b.cat).length ? `<div class="bars">${Object.entries(b.cat).sort((a, c) => c[1] - a[1]).map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><span class="bar-track"><span class="bar-fill b3" style="width:${(v / maxCat * 100).toFixed(1)}%"></span></span><span class="num">${money(v)}</span></div>`).join('')}</div>` : '<p class="empty">Aucune dépense cette année.</p>'}</div>
    </div>
    <div class="row"><a class="btn primary" href="#" data-act="depEdit">+ Dépense</a><a class="btn" href="#" data-act="recEdit">+ Recette</a></div>`;
}
ACTIONS.finAnnee = (el) => { FIN.annee = el.dataset.y; render(); };

/* ---------- Dépenses ---------- */
function renderDepenses() {
  const ys = anneesFin();
  let list = depenses().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.n || 0) - (a.n || 0));
  if (FIN.annee) list = list.filter((d) => yearOf(d.date) === FIN.annee);
  if (FIN.type) list = list.filter((d) => (d.type || 'charge') === FIN.type);
  if (FIN.par) list = list.filter((d) => d.par === FIN.par);
  if (FIN.q) { const q = FIN.q.toLowerCase(); list = list.filter((d) => [d.objet, d.categorie, d.justificatif, d.remarque, money(d.montant)].join(' ').toLowerCase().includes(q)); }
  const nSansJ = depenses().filter(sansJustificatif);
  if (FIN.sansJ) list = list.filter(sansJustificatif);
  const tot = list.reduce((a, d) => a + num(d.montant), 0);
  const banner = nSansJ.length ? `<div class="banner"><span><b>${nSansJ.length} dépense${nSansJ.length > 1 ? 's' : ''} sans justificatif</b> (${chf(nSansJ.reduce((a, d) => a + num(d.montant), 0))}). Sans ticket ni facture, la dépense ne peut pas être justifiée en comptabilité.</span>
    <button class="btn small" type="button" data-act="finSansJ">${FIN.sansJ ? 'Voir toutes les dépenses' : 'Voir seulement celles-ci'}</button></div>` : '';
  return `<div class="panel"><div class="between"><h2>Dépenses</h2><div class="row"><button class="btn small" type="button" data-act="depCsv">Exporter (CSV)</button><a class="btn primary small" href="#" data-act="depEdit">+ Dépense</a></div></div>
    <div class="grid2">
      ${fld('fin-q', 'Rechercher', `<input id="fin-q" type="search" value="${esc(FIN.q)}" placeholder="Objet, justificatif…">`)}
      ${sel('fin-annee', 'Année', FIN.annee, [['', 'Toutes']].concat(ys.map((y) => [y, y])))}
      ${sel('fin-type', 'Type', FIN.type, [['', 'Tous'], ['charge', 'Charges'], ['investissement', 'Investissements']])}
      ${sel('fin-par', 'Payé par', FIN.par, [['', 'Tous']].concat(persOptions()))}
    </div>
    ${banner}
    ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Objet</th><th>Catégorie</th><th>Payé par</th><th class="r">Montant</th></tr></thead><tbody>${list.map((d) => `<tr class="click${sansJustificatif(d) ? ' nojust' : ''}" data-act="depEdit" data-key="${esc(d.key)}"><td class="num">${fmtDate(d.date)}</td><td>${esc(d.objet)}${d.type === 'investissement' ? ' <span class="tpill">Invest.</span>' : ''}${sansJustificatif(d) ? ' <span class="pill nojust">Justificatif manquant</span>' : ''}${d.fichiers && d.fichiers.length ? ` <span class="clip" title="${d.fichiers.length} fichier(s) joint(s)">📎${d.fichiers.length > 1 ? d.fichiers.length : ''}</span>` : ''}</td><td>${esc(d.categorie || '—')}</td><td>${esc(nomDe(d.par))}</td><td class="r num">${money(d.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">${list.length} dépense${list.length > 1 ? 's' : ''}</td><td class="r num">${money(tot)}</td></tr></tfoot></table></div>` : '<p class="empty">Aucune dépense ne correspond.</p>'}
  </div>`;
}
ACTIONS.finSansJ = () => { FIN.sansJ = !FIN.sansJ; render(); };
ACTIONS.depEdit = (el) => {
  const k = el.dataset.key || '', d = k ? DB.get(k) : Object.assign({ date: todayISO(), type: 'charge', par: Sync.me || 'nicolas', categorie: '' }, el._pre || {});
  const inInv = k && DB.all('inv:').some((i) => i.depenseId === k);
  DEP.key = k; DEP.fichiers = (d.fichiers || []).slice();
  openSheet(`${sheetHead(k ? 'Modifier la dépense' : 'Nouvelle dépense', k && d.n ? 'N° ' + d.n : '')}<form class="sbody form" data-form="dep"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${inp('dp-date', 'Date', d.date, { name: 'date', type: 'date', req: true })}${inp('dp-montant', 'Montant CHF', d.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}</div>
    ${inp('dp-objet', 'Objet', d.objet, { name: 'objet', req: true, attrs: { maxlength: 90 } })}
    <div class="field"><span class="flabel">Type</span><div class="seg">
      <label><input type="radio" name="type" value="charge"${d.type !== 'investissement' ? ' checked' : ''}> Charge</label>
      <label><input type="radio" name="type" value="investissement"${d.type === 'investissement' ? ' checked' : ''}> Investissement</label></div>
      <span class="sub">Investissement : un achat qui dure plusieurs années (machine, outil, irrigation). Il est amorti dans l'inventaire.</span></div>
    <div class="grid2">${sel('dp-cat', 'Catégorie', d.categorie, [['', '—']].concat(CATEGORIES.map((c) => [c, c])), { name: 'categorie', sub: CAT_AIDE })}${sel('dp-par', 'Payé par', d.par, persOptions(), { name: 'par' })}</div>
    <div class="field"><span class="flabel">Justificatif (important)</span>
      <div id="dp-fichiers">${fichiersDep()}</div>
      <label class="btn justif-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>Photo du ticket ou PDF de la facture<input id="dp-file" type="file" accept="image/*,application/pdf" hidden></label>
      <span class="sub" id="dp-just-etat">${sansJustificatif(d) ? '<span class="pill nojust">Manquant</span> Sans justificatif, la dépense ne compte pas en comptabilité.' : ''}</span></div>
    ${inp('dp-just', 'Référence du justificatif (facultatif)', d.justificatif, { name: 'justificatif', attrs: { placeholder: 'N° de facture, nom du scan…' } })}
    ${inp('dp-rem', 'Remarque', d.remarque, { name: 'remarque' })}
    ${!inInv ? `<label class="row" style="font-size:14px"><input type="checkbox" name="versInventaire"${el._pre && el._pre.type === 'investissement' ? ' checked' : ''}> Ajouter à l'inventaire (pour l'amortir)</label>` : '<p class="hint">Cet achat est dans l\'inventaire.</p>'}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette dépense">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const f = $('dp-file'); if (f) f.addEventListener('change', () => { joindreDep(f.files[0]); f.value = ''; });
};
/* Justificatifs joints : envoyés tout de suite ; sur une dépense existante, enregistrés aussitôt (rien ne se perd si on ferme) */
function fichiersDep() {
  if (!DEP.fichiers.length) return '';
  return `<div class="fich-list">${DEP.fichiers.map((x, i) => `<span class="fich">
    <button type="button" class="fich-voir" data-act="${x.expire ? 'aucun' : 'voirFichier'}" data-fichier="${esc(x.chemin)}" data-titre="${esc(x.nom || '')}">${x.expire ? '<span class="fich-pdf" style="color:var(--muted);font-size:11px;text-align:center">dans l\'archive</span>' : x.type === 'application/pdf' ? '<span class="fich-pdf">PDF</span>' : `<img data-fichier="${esc(x.chemin)}" alt="Justificatif">`}<small>${esc(trunc(x.nom || 'fichier', 22))}</small></button>
    <button type="button" class="fich-x" data-act="depFichierOff" data-i="${i}" aria-label="Retirer ce fichier">×</button></span>`).join('')}</div>`;
}
function majFichiersDep() {
  const box = $('dp-fichiers'); if (box) box.innerHTML = fichiersDep();
  const et = $('dp-just-etat'); if (et) et.innerHTML = DEP.fichiers.length ? '' : '<span class="pill nojust">Manquant</span> Sans justificatif, la dépense ne compte pas en comptabilité.';
  if (DEP.key && DB.get(DEP.key)) DB.put(DEP.key, Object.assign({}, DB.get(DEP.key), { fichiers: DEP.fichiers.slice() }));
}
async function joindreDep(file) {
  if (!file) return;
  const et = $('dp-just-etat'); if (et) et.textContent = 'Envoi du justificatif…';
  try {
    const f = await preparerFichier(file, 'justif');
    const chemin = await Fichiers.envoyer(f.blob, cheminFichier('justificatifs', f.ext));
    if (!LOCAL_MODE) Fichiers.liens[chemin] = { url: URL.createObjectURL(f.blob), exp: Date.now() + 50 * 60000 };
    DEP.fichiers.push({ chemin, nom: f.nom, type: f.type, ajoute: new Date().toISOString(), par: Sync.me || '' });
    majFichiersDep(); toast('Justificatif joint.');
  } catch (e) { if (et) et.textContent = ''; majFichiersDep(); toast("Le justificatif n'est pas parti : " + e.message, 6000); }
}
ACTIONS.depFichierOff = (el) => { DEP.fichiers.splice(Number(el.dataset.i), 1); majFichiersDep(); };
FORMS.dep = (v) => {
  const m = num(v.montant); if (!(m > 0) || !v.date || !v.objet) { toast('Date, montant et objet sont obligatoires.'); return; }
  const k = v.key || 'dep:' + uid('d'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '', n: 1 + Math.max(0, ...depenses().map((x) => x.n || 0)) };
  DB.put(k, Object.assign({}, old, { date: v.date, montant: r2(m), objet: v.objet, type: v.type || 'charge', categorie: v.categorie, par: v.par, justificatif: v.justificatif, fichiers: DEP.fichiers.slice(), remarque: v.remarque }));
  if (v.versInventaire) ajouterInventaireDepuis(k);
  closeSheet(); toast((v.key ? 'Dépense mise à jour.' : 'Dépense ajoutée.') + (sansJustificatif({ justificatif: v.justificatif, fichiers: DEP.fichiers }) ? ' Attention : justificatif manquant.' : ''), 4500);
};
ACTIONS.depCsv = () => {
  const rows = depenses().sort((a, b) => String(a.date).localeCompare(b.date)).map((d) => [d.n || '', fmtDate(d.date), r2(d.montant).toFixed(2), d.objet, d.type === 'investissement' ? 'Investissement' : 'Charges', d.categorie, nomDe(d.par), [d.justificatif].concat((d.fichiers || []).map((x) => x.nom)).filter(Boolean).join(' · '), d.remarque]);
  downloadFile(`Dépenses Gamins de Talus ${todayISO()}.csv`, csv(['N°', 'Date', 'Montant', 'Objet', 'Type', 'Catégorie', 'Payé par', 'Justificatif', 'Remarque'], rows), 'text/csv;charset=utf-8');
};

/* ---------- Recettes ---------- */
function renderRecettes() {
  const ys = anneesFin();
  let list = recettesToutes(); if (FIN.annee) list = list.filter((r) => yearOf(r.date) === FIN.annee);
  const tot = list.reduce((a, r) => a + num(r.montant), 0);
  return `<div class="panel"><div class="between"><h2>Recettes</h2><div class="row"><button class="btn small" type="button" data-act="recCsv">Exporter (CSV)</button><a class="btn primary small" href="#" data-act="recEdit">+ Recette</a></div></div>
    <p class="hint">Les factures payées s'ajoutent ici toutes seules. Saisis ici le reste : stand (TWINT, espèces), marché, ventes sans facture.</p>
    <div class="grid2">${sel('fin-annee', 'Année', FIN.annee, [['', 'Toutes']].concat(ys.map((y) => [y, y])))}</div>
    ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Client / libellé</th><th>Moyen</th><th>Encaissé par</th><th class="r">Montant</th></tr></thead><tbody>${list.map((r) => r.src === 'facture'
      ? `<tr class="click" data-act="go" data-href="#/factures/voir/${encodeURIComponent(r.key)}"><td class="num">${fmtDate(r.date)}</td><td>${esc(r.libelle)} <span class="tpill">${esc(r.ref)}</span></td><td>${esc(r.moyen)}</td><td>${esc(nomDe(r.par))}</td><td class="r num">${money(r.montant)}</td></tr>`
      : `<tr class="click" data-act="recEdit" data-key="${esc(r.key)}"><td class="num">${fmtDate(r.date)}</td><td>${esc(r.libelle || '—')}</td><td>${esc(r.moyen)}</td><td>${esc(nomDe(r.par))}</td><td class="r num">${money(r.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">${list.length} recette${list.length > 1 ? 's' : ''}</td><td class="r num">${money(tot)}</td></tr></tfoot></table></div>` : '<p class="empty">Aucune recette pour cette période.</p>'}</div>`;
}
ACTIONS.recEdit = (el) => {
  const k = el.dataset.key || '', r = k ? DB.get(k) : { date: todayISO(), moyen: 'TWINT', par: Sync.me || 'nicolas' };
  const cl = contacts().sort(byName);
  openSheet(`${sheetHead(k ? 'Modifier la recette' : 'Nouvelle recette')}<form class="sbody form" data-form="rec"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${inp('rc-date', 'Date', r.date, { name: 'date', type: 'date', req: true })}${inp('rc-montant', 'Montant CHF', r.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}</div>
    ${sel('rc-contact', 'Client (contact)', r.contactId || '', [['', '— aucun / vente au stand —']].concat(cl.map((c) => [c.key, displayName(c)])), { name: 'contactId' })}
    ${inp('rc-client', 'Libellé', r.client, { name: 'client', attrs: { placeholder: 'Ex. Stand self-service, semaine 44' } })}
    <div class="grid2">${sel('rc-moyen', 'Moyen', r.moyen, MOYENS.map((m) => [m, m]), { name: 'moyen' })}${sel('rc-par', 'Encaissé par', r.par, persOptions(), { name: 'par' })}</div>
    ${inp('rc-just', 'Justificatif', r.justificatif, { name: 'justificatif' })}
    ${inp('rc-rem', 'Remarque', r.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette recette">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.rec = (v) => {
  const m = num(v.montant); if (!(m > 0) || !v.date) { toast('Date et montant sont obligatoires.'); return; }
  const c = DB.get(v.contactId);
  const k = v.key || 'rec:' + uid('r'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  DB.put(k, Object.assign({}, old, { date: v.date, montant: r2(m), contactId: v.contactId, client: v.client || (c ? displayName(c) : ''), moyen: v.moyen, par: v.par, justificatif: v.justificatif, remarque: v.remarque }));
  closeSheet(); toast(v.key ? 'Recette mise à jour.' : 'Recette ajoutée.');
};
ACTIONS.recCsv = () => {
  const rows = recettesToutes().reverse().map((r) => [fmtDate(r.date), r2(r.montant).toFixed(2), r.libelle, r.moyen, nomDe(r.par), r.src === 'facture' ? 'Facture ' + r.ref : 'Saisie directe']);
  downloadFile(`Recettes Gamins de Talus ${todayISO()}.csv`, csv(['Date', 'Montant', 'Client / libellé', 'Moyen', 'Encaissé par', 'Origine'], rows), 'text/csv;charset=utf-8');
};

/* ---------- Entre associés ---------- */
function renderAssocies() {
  const d = decompteActuel(), ps = personnes();
  const row = (lab, f, sign) => `<tr><td>${lab}</td>${ps.map((p) => `<td class="r num">${sign && d[f][p.k] ? sign : ''}${money(d[f][p.k])}</td>`).join('')}</tr>`;
  const regs = reglements().sort((a, b) => String(b.date).localeCompare(a.date));
  return `<div class="split"><div class="panel"><h2>Qui doit quoi</h2>
      <p style="margin:0;font-size:20px"><b>${esc(phraseDecompte(d))}</b></p>
      ${d.transferts.length ? `<div class="row"><button class="btn primary" type="button" data-act="regEdit" data-de="${d.transferts[0].de}" data-a="${d.transferts[0].a}" data-m="${d.transferts[0].montant}">Enregistrer ce remboursement</button></div>` : ''}
      <div class="table-wrap"><table class="list"><thead><tr><th></th>${ps.map((p) => `<th class="r">${esc(p.nom)}</th>`).join('')}</tr></thead><tbody>
        ${row('A payé des dépenses', 'paye')}${row('Sa part des dépenses', 'partDep')}${row('A encaissé des recettes', 'encaisse')}${row('Sa part des recettes', 'partRec')}${row('A remboursé', 'verse')}${row('A été remboursé', 'recu')}${ps.some((p) => d.reprise[p.k]) ? row('Reprise de parts (doit)', 'reprise') : ''}
      </tbody><tfoot><tr><td>Solde (positif : doit recevoir)</td>${ps.map((p) => `<td class="r num">${money(d.solde[p.k])}</td>`).join('')}</tr></tfoot></table></div>
      <p class="hint">Partage aujourd'hui : ${phrasePartage()} (modifiable dans les Réglages ; chaque montant est partagé selon les associés à sa date). Dépenses depuis le début : ${chf(d.totalDep)} · recettes : ${chf(d.totalRec)}.</p></div>
    <div class="panel"><div class="between"><h2>Remboursements</h2><a class="btn small" href="#" data-act="regEdit">+ Remboursement</a></div>
      ${regs.length ? `<div class="items">${regs.map((g) => `<a class="item" href="#" data-act="regEdit" data-key="${esc(g.key)}"><span class="who"><strong>${esc(nomDe(g.de))} → ${esc(nomDe(g.a))}</strong><span class="meta">${fmtDate(g.date)}${g.remarque ? ' · ' + esc(g.remarque) : ''}</span></span><span class="amt">${chf(g.montant)}</span></a>`).join('')}</div>` : '<p class="empty">Aucun remboursement enregistré.</p>'}</div></div>`;
}
ACTIONS.regEdit = (el) => {
  const k = el.dataset.key || '', g = k ? DB.get(k) : { date: todayISO(), de: el.dataset.de || Sync.me || 'nicolas', a: el.dataset.a || (personnes().find((p) => p.k !== Sync.me) || {}).k, montant: el.dataset.m || '' };
  openSheet(`${sheetHead(k ? 'Modifier le remboursement' : 'Remboursement entre associés')}<form class="sbody form" data-form="reg"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${sel('rg-de', 'De', g.de, persOptions(), { name: 'de' })}${sel('rg-a', 'À', g.a, persOptions(), { name: 'a' })}</div>
    <div class="grid2">${inp('rg-date', 'Date', g.date, { name: 'date', type: 'date' })}${inp('rg-m', 'Montant CHF', g.montant, { name: 'montant', type: 'number', attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}</div>
    ${inp('rg-rem', 'Remarque', g.remarque, { name: 'remarque', attrs: { placeholder: 'Ex. TWINT, espèces' } })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="ce remboursement">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.reg = (v) => {
  const m = num(v.montant); if (!(m > 0) || v.de === v.a) { toast('Indique un montant et deux personnes différentes.'); return; }
  const k = v.key || 'reg:' + uid('g');
  DB.put(k, Object.assign({}, DB.get(k) || { cree: new Date().toISOString() }, { date: v.date || todayISO(), de: v.de, a: v.a, montant: r2(m), remarque: v.remarque }));
  closeSheet(); toast('Remboursement enregistré.');
};

/* Suppression générique (va dans la corbeille) */
ACTIONS.delItem = (el) => confirmSheet('Supprimer ' + (el.dataset.what || 'cet élément') + ' ?', 'Il reste récupérable dans la corbeille (Réglages → Données).', 'delItemOk', 'Supprimer', { key: el.dataset.key });
ACTIONS.delItemOk = (el) => { DB.del(el.dataset.key); closeSheet(); toast('Supprimé. Récupérable dans la corbeille.'); };

function attentionFinances() { const d = decompteActuel(); return d.transferts.filter((t) => t.montant >= 50).map((t) => ({ href: '#/finances/associes', txt: `${nomDe(t.de)} doit de l'argent à ${nomDe(t.a)}`, val: chf(t.montant), info: true })); }
