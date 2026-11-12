/* Gamins de Talus — finances : dépenses, recettes, résultat et décompte entre associés. */
'use strict';

/* Les comptes des dépenses : voir comptes.js (l'ancienne « catégorie » donne le compte des vieilles dépenses) */
const MOYENS = ['TWINT', 'Espèces', 'Virement', 'Autre'];
const depenses = () => DB.all('dep:');
const recettesDirectes = () => DB.all('rec:');
const reglements = () => DB.all('reg:');
const recettesToutes = () => recettesUnifiees(recettesDirectes(), factures(), cfg());
const FIN = { annee: '', type: '', par: '', q: '', sansJ: false, f: {} };
/* Filtres en boutons : plusieurs choix possibles par rangée (FIN.f[nom] = liste de valeurs ; vide = tout) */
const finSel = (nom) => FIN.f[nom] || (FIN.f[nom] = []);
const finGarde = (nom, v) => { const l = finSel(nom); return !l.length || l.includes(String(v)); };
ACTIONS.finFiltre = (el) => { const nom = el.dataset.f, v = el.dataset.v, l = finSel(nom); if (v === '') FIN.f[nom] = []; else { const i = l.indexOf(v); if (i >= 0) l.splice(i, 1); else l.push(v); } render(); };
ACTIONS.finFiltresOff = () => { FIN.f = {}; FIN.q = ''; FIN.sansJ = false; render(); };
function chipsFiltre(titre, nom, options) {
  if (options.length < 2) return '';
  const l = finSel(nom);
  return `<div class="fin-filtre"><span class="hint">${esc(titre)}</span><div class="chips">${options.map(([v, lib, n]) => `<button type="button" class="chip small${l.includes(String(v)) ? ' on' : ''}" data-act="finFiltre" data-f="${esc(nom)}" data-v="${esc(v)}" aria-pressed="${l.includes(String(v))}">${esc(lib)}${n != null ? `<span class="n">${esc(n)}</span>` : ''}</button>`).join('')}</div></div>`;
}
function chipsAnnees(ys) { return `<div class="fin-filtre"><span class="hint">Année</span><div class="chips"><button type="button" class="chip small${!FIN.annee ? ' on' : ''}" data-act="finAnnee" data-y="">Toutes</button>${ys.map((y) => `<button type="button" class="chip small${FIN.annee === y ? ' on' : ''}" data-act="finAnnee" data-y="${esc(y)}">${esc(y)}</button>`).join('')}</div></div>`; }
const compteCourt = (c) => `${c} ${trunc(compteInfo(c).nom || '', 22)}`.trim();
function totalFinHtml(tot, n, mot, filtre) { return `<div class="fin-total"><span class="k">${filtre ? 'Total filtré' : 'Total'}</span><b class="v">${chf(tot)}</b><span class="hint">${n} ${mot}${n > 1 ? 's' : ''}${filtre ? ` · <a href="#" data-act="finFiltresOff">tout voir</a>` : ''}</span></div>`; }
/* Garanties : sur la dépense de l'achat (garantie = date de fin, garantieNote = n° de série, vendeur…). Le justificatif
   d'une dépense sous garantie reste dans l'app tant que la garantie court (c'est la preuve d'achat). */
const sousGarantie = (d, t) => !!d.garantie && d.garantie >= (t || todayISO());
const garanties = () => depenses().filter((d) => sousGarantie(d)).sort((a, b) => String(a.garantie).localeCompare(String(b.garantie)));
function finGarantieTxt(g) {
  const j = Math.round((new Date(g + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000);
  return j <= 0 ? "se termine aujourd'hui" : j < 45 ? `encore ${j} jour${j > 1 ? 's' : ''}` : j < 730 ? `encore ${Math.round(j / 30.4)} mois` : `encore ${fmtNum(j / 365.25, 1)} ans`;
}
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
  tuile() { const d = decompteActuel(), gFin = garanties().filter((x) => x.garantie <= addDays(todayISO(), 30)).length; return { line: gFin ? `🛡️ ${gFin} garantie${gFin > 1 ? 's' : ''} se termine${gFin > 1 ? 'nt' : ''} bientôt` : phraseDecompte(d), badge: gFin + depenses().filter((x) => sansJustificatif(x) && (typeof pourMoi !== 'function' || pourMoi(x.par))).length }; },
  render(sub) {
    /* Quatre onglets : l'argent qui entre et sort, les comptes entre associés, les bilans et le bouclement de l'année, l'inventaire */
    if (['annee', 'bilan'].includes(sub)) sub = 'bilans'; if (sub === 'achats') { setTimeout(() => location.replace('#/finances/inventaire'), 0); return ''; }
    const onglet = ['associes', 'bilans', 'inventaire'].includes(sub) ? sub : '';
    const t = tabs('finances', [['', 'Dépenses et recettes'], ['associes', 'Associés'], ['bilans', 'Bilans et bouclement'], ['inventaire', 'Inventaire']], onglet);
    const sous = (items, cur) => `<nav class="row sousnav" aria-label="Rubriques">${items.map(([k, l]) => `<a class="chip${k === cur ? ' on' : ''}" href="#/finances/${k}">${l}</a>`).join('')}</nav>`;
    if (onglet === 'associes') return t + renderAssocies();
    if (onglet === 'bilans') return t + renderBilansBouclement();
    if (onglet === 'inventaire') return t + renderInventaire();
    const n = sous([['depenses', 'Dépenses'], ['recettes', 'Recettes']], sub === 'recettes' ? 'recettes' : 'depenses');
    if (sub === 'recettes') return t + n + renderRecettes();
    return t + n + renderDepenses();
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
  const cat = {}; for (const d of deps) { if (d.type === 'investissement') continue; const k = libCompte(compteDe(d)); cat[k] = (cat[k] || 0) + num(d.montant); }
  return { charges, invest, rec, amort, resultat: rec - charges - amort, cat, nDep: deps.length, nRec: recs.length };
}
ACTIONS.finAnnee = (el) => { FIN.annee = el.dataset.y; render(); };

/* ---------- Dépenses ---------- */
function renderDepenses() {
  const ys = anneesFin();
  let list = depenses().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.n || 0) - (a.n || 0));
  if (FIN.annee) list = list.filter((d) => yearOf(d.date) === FIN.annee);
  /* Les boutons de catégorie montrent ce qu'il y a dans l'année choisie */
  const base = list, parCat = {}; for (const d of base) { const c = compteDe(d); parCat[c] = (parCat[c] || 0) + num(d.montant); }
  list = list.filter((d) => finGarde('dType', d.type || 'charge') && finGarde('dPar', d.par) && finGarde('dCat', compteDe(d)));
  if (FIN.q) { const q = FIN.q.toLowerCase(); list = list.filter((d) => [d.objet, libCompte(compteDe(d)), d.justificatif, d.remarque, money(d.montant)].join(' ').toLowerCase().includes(q)); }
  const nSansJ = depenses().filter(sansJustificatif), gs = garanties();
  if (FIN.sansJ) list = list.filter(sansJustificatif);
  const tot = list.reduce((a, d) => a + num(d.montant), 0);
  const banner = nSansJ.length ? `<div class="banner"><span><b>${nSansJ.length} dépense${nSansJ.length > 1 ? 's' : ''} sans justificatif</b> (${chf(nSansJ.reduce((a, d) => a + num(d.montant), 0))}). Sans ticket ni facture, la dépense ne peut pas être justifiée en comptabilité.</span>
    <button class="btn small" type="button" data-act="finSansJ">${FIN.sansJ ? 'Voir toutes les dépenses' : 'Voir seulement celles-ci'}</button></div>` : '';
  return `<div class="panel" data-depot="nouvelle"><div class="between"><h2>Dépenses</h2><div class="row"><button class="btn small" type="button" data-act="depCsv">Exporter (CSV)</button><a class="btn primary small" href="#" data-act="depEdit">+ Dépense</a></div></div>
    ${totalFinHtml(tot, list.length, 'dépense', list.length !== base.length || !!FIN.q || FIN.sansJ)}
    <div class="fin-filtres">
      <input id="fin-q" class="fin-q" type="search" value="${esc(FIN.q)}" placeholder="🔍 Rechercher : objet, justificatif…" aria-label="Rechercher">
      ${chipsAnnees(ys)}
      ${chipsFiltre('Type', 'dType', [['charge', 'Charges'], ['investissement', 'Investissements']])}
      ${chipsFiltre('Payé par', 'dPar', persOptions().map(([k, l]) => [k, l]))}
      ${chipsFiltre('Catégories', 'dCat', Object.entries(parCat).sort((a, b) => b[1] - a[1]).map(([c, t]) => [c, compteCourt(c), Math.round(t)]))}
    </div>
    ${banner}
    ${gs.length ? `<details class="garanties"${gs.some((d) => d.garantie <= addDays(todayISO(), 60)) ? ' open' : ''}><summary>🛡️ <b>${gs.length} achat${gs.length > 1 ? 's' : ''} sous garantie</b></summary><div class="items">${gs.map((d) => `<button type="button" class="item" data-act="depEdit" data-key="${esc(d.key)}"><span class="who"><strong>${esc(d.objet)}</strong><span class="meta">acheté le ${fmtDate(d.date)} · ${chf(d.montant)}${d.garantieNote ? ' · ' + esc(d.garantieNote) : ''}${(d.fichiers || []).length ? ' · 📎 preuve d\'achat' : ' · ⚠️ pas de ticket joint'}</span></span><span class="num${d.garantie <= addDays(todayISO(), 60) ? ' bad' : ''}">jusqu'au ${fmtDate(d.garantie)}<br><span class="hint">${esc(finGarantieTxt(d.garantie))}</span></span></button>`).join('')}</div></details>` : ''}
    ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Objet</th><th>Compte</th><th>Payé par</th><th class="r">Montant</th></tr></thead><tbody>${list.map((d) => `<tr class="click${sansJustificatif(d) ? ' nojust' : ''}" data-act="depEdit" data-key="${esc(d.key)}" data-depot="ligne"><td class="num">${fmtDate(d.date)}</td><td>${esc(d.objet)}${d.type === 'investissement' ? ' <span class="tpill">Invest.</span>' : ''}${sansJustificatif(d) ? ' <span class="pill nojust">Justificatif manquant</span>' : ''}${d.fichiers && d.fichiers.length ? ` <span class="clip" title="${d.fichiers.length} fichier(s) joint(s)">📎${d.fichiers.length > 1 ? d.fichiers.length : ''}</span>` : ''}${sousGarantie(d) ? ` <span class="clip" title="Garantie jusqu'au ${fmtDate(d.garantie)}">🛡️</span>` : ''}</td><td title="${esc(libCompte(compteDe(d)))}"><span class="num">${esc(compteDe(d))}</span> ${esc(trunc(compteInfo(compteDe(d)).nom, 26))}</td><td>${esc(nomDe(d.par))}</td><td class="r num">${money(d.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4">${list.length} dépense${list.length > 1 ? 's' : ''}</td><td class="r num">${money(tot)}</td></tr></tfoot></table></div>` : '<p class="empty">Aucune dépense ne correspond.</p>'}
    <p class="hint depot-aide">Depuis un dossier de l'ordinateur : glisse un ticket ou une facture (photo ou PDF) sur une ligne pour l'y joindre, ou ailleurs dans ce cadre pour créer une nouvelle dépense avec.</p>
  </div>`;
}
ACTIONS.finSansJ = () => { FIN.sansJ = !FIN.sansJ; render(); };
ACTIONS.depEdit = (el) => {
  const k = el.dataset.key || '', d = k ? DB.get(k) : Object.assign({ date: todayISO(), par: Sync.me || 'nicolas', compte: '' }, el._pre || {});
  const cpt = d.compte || (k || d.categorie || d.type ? compteDe(d) : ''), obj = k ? objetDeDepense(k) : null;
  DEP.key = k; DEP.fichiers = (d.fichiers || []).slice();
  openSheet(`${sheetHead(k ? 'Modifier la dépense' : 'Nouvelle dépense', k && d.n ? 'N° ' + d.n : '')}<form class="sbody form" data-form="dep" data-depot="dep"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${inp('dp-date', 'Date', d.date, { name: 'date', type: 'date', req: true })}${inp('dp-montant', 'Montant CHF', d.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}</div>
    ${inp('dp-objet', 'Objet', d.objet, { name: 'objet', req: true, attrs: { maxlength: 90 } })}
    <div class="grid2"><div class="field"><label for="dp-compte">Compte</label><select id="dp-compte" name="compte" required><option value="">Choisir…</option>${optionsComptes(cpt)}</select>
      <span class="sub" id="dp-compte-aide">${esc(compteInfo(cpt).aide || '')}</span></div>${sel('dp-par', 'Payé par', d.par, persOptions(), { name: 'par' })}</div>
    ${AIDE_COMPTES}
    <div class="field dp-inv" id="dp-inv"${estInvest(cpt) ? '' : ' hidden'}><span class="flabel">📦 Dans l'inventaire</span>
      <select id="dp-invsel" name="invId"><option value="">➕ Nouvel objet</option>${inventaire().filter((i) => !i.sortieLe || (obj && obj.key === i.key)).map((i) => `<option value="${esc(i.key)}"${obj && obj.key === i.key ? ' selected' : ''}>${esc(i.nom)} · ${chf(i.valeur)}</option>`).join('')}</select>
      <span class="sub">Un investissement va dans un objet de l'inventaire pour être amorti. Plusieurs achats peuvent former un seul objet (ex. « Système d'irrigation »).</span>
      <div id="dp-invnew"${obj ? ' hidden' : ''}>${inp('dp-invnom', "Nom de l'objet", d.objet || '', { name: 'invNom', attrs: { placeholder: "Ex. Système d'irrigation" } })}
        ${methodeAmortHtml('dp', 'degressif', compteInfo(cpt).taux || 40, 5)}</div></div>
    ${typeof choixPourHtml === 'function' ? choixPourHtml('dp-pour', d.pour, String(d.date || todayISO()).slice(0, 4)) : ''}
    <div class="field"><span class="flabel">Justificatif (important)</span>
      <div id="dp-fichiers">${fichiersDep()}</div>
      <label class="btn justif-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>Photo du ticket ou PDF de la facture<input id="dp-file" type="file" accept="image/*,application/pdf" multiple hidden></label>
      <span class="sub depot-aide">…ou glisse les fichiers ici depuis un dossier de l'ordinateur (ticket, facture, certificat de garantie).</span>
      <span class="sub" id="dp-just-etat">${sansJustificatif(d) ? '<span class="pill nojust">Manquant</span> Sans justificatif, la dépense ne compte pas en comptabilité.' : ''}</span></div>
    ${inp('dp-just', 'Référence du justificatif (facultatif)', d.justificatif, { name: 'justificatif', attrs: { placeholder: 'N° de facture, nom du scan…' } })}
    ${inp('dp-rem', 'Remarque', d.remarque, { name: 'remarque' })}
    <div class="field"><span class="flabel">🛡️ Garantie (facultatif)</span>
      <div class="row">${['1', '2', '3', '5'].map((n) => `<button type="button" class="chip" data-act="depGarantie" data-ans="${n}">${n} an${n > 1 ? 's' : ''}</button>`).join('')}<button type="button" class="chip" data-act="depGarantie" data-ans="0">Aucune</button></div>
      <div class="grid2">${inp('dp-gar', "Garantie jusqu'au", d.garantie || '', { name: 'garantie', type: 'date' })}${inp('dp-garn', 'Pour la garantie (facultatif)', d.garantieNote || '', { name: 'garantieNote', attrs: { placeholder: 'n° de série, vendeur, conditions…', maxlength: 120 } })}</div>
      <span class="sub">Le ticket ou la facture joints ci-dessus servent de preuve d'achat : ils restent dans l'app tant que la garantie court. Tu peux aussi y joindre le certificat de garantie.</span></div>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette dépense">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const f = $('dp-file'); if (f) f.addEventListener('change', async () => { const l = [...f.files]; f.value = ''; for (const x of l) await joindreDep(x); });
  /* Le compte choisi : aide, « Pour quoi ? » par défaut, et l'inventaire pour un investissement */
  const sc = $('dp-compte'), so = $('dp-invsel');
  if (sc) sc.addEventListener('change', () => {
    const c = sc.value, info = compteInfo(c); $('dp-compte-aide').textContent = info.aide || '';
    $('dp-inv').hidden = !estInvest(c);
    const t = $('dp-taux'); if (t && estInvest(c) && !so.value) t.value = info.taux || 40;
    const pb = $('dp-pour'), def = pourDuCompte(c); if (pb && def && typeof choixPourHtml === 'function') pb.outerHTML = choixPourHtml('dp-pour', def, String(($('dp-date') || {}).value || todayISO()).slice(0, 4));
  });
  if (so) so.addEventListener('change', () => { $('dp-invnew').hidden = !!so.value; });
  const ob = $('dp-objet'), nn = $('dp-invnom'); if (ob && nn) ob.addEventListener('input', () => { if (!nn.dataset.touche) nn.value = ob.value; }); if (nn) nn.addEventListener('input', () => { nn.dataset.touche = '1'; });
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
ACTIONS.depGarantie = (el) => {
  const g = $('dp-gar'), d = ($('dp-date') && $('dp-date').value) || todayISO(), n = Number(el.dataset.ans);
  if (g) g.value = n ? addDays(ajouterMois(d, 12 * n), -1) : '';
};
/* Glisser-déposer depuis l'ordinateur : sur la fiche d'une dépense, sur une ligne de la liste, ou dans le cadre (nouvelle dépense) */
const avecFichiers = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
document.addEventListener('dragover', (e) => {
  const z = e.target.closest && e.target.closest('[data-depot]'); document.querySelectorAll('[data-depot].drop').forEach((x) => { if (x !== z) x.classList.remove('drop'); });
  if (!z || !avecFichiers(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; z.classList.add('drop');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.querySelectorAll('[data-depot].drop').forEach((x) => x.classList.remove('drop')); });
document.addEventListener('drop', async (e) => {
  const z = e.target.closest && e.target.closest('[data-depot]'); if (!z || !avecFichiers(e)) return;
  e.preventDefault(); z.classList.remove('drop');
  const fs = [...e.dataTransfer.files].filter((f) => /^image\/|pdf$/.test(f.type) || /\.(pdf|jpe?g|png|heic|webp)$/i.test(f.name));
  if (!fs.length) { toast('Seulement des photos ou des PDF.'); return; }
  if (z.dataset.depot === 'ligne') ACTIONS.depEdit({ dataset: { key: z.dataset.key } });
  else if (z.dataset.depot === 'nouvelle') {
    ACTIONS.depEdit({ dataset: {} });
    const o = $('dp-objet'); if (o && !o.value) o.value = trunc(fs[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), 80);
  }
  for (const f of fs) await joindreDep(f);
});
ACTIONS.depFichierOff = (el) => { DEP.fichiers.splice(Number(el.dataset.i), 1); majFichiersDep(); };
FORMS.dep = (v) => {
  const m = num(v.montant); if (!(m > 0) || !v.date || !v.objet) { toast('Date, montant et objet sont obligatoires.'); return; }
  if (!v.compte) { toast('Choisis le compte (« Comment choisir » t\'aide).'); $('dp-compte').focus(); return; }
  const inv = estInvest(v.compte), pour = (typeof lirePour === 'function' ? lirePour(v.pour) : null) || pourDuCompte(v.compte);
  const k = v.key || 'dep:' + uid('d'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '', n: 1 + Math.max(0, ...depenses().map((x) => x.n || 0)) };
  DB.put(k, Object.assign({}, old, { date: v.date, montant: r2(m), objet: v.objet, type: inv ? 'investissement' : 'charge', compte: v.compte, par: v.par, justificatif: v.justificatif, fichiers: DEP.fichiers.slice(), remarque: v.remarque, garantie: v.garantie || '', garantieNote: v.garantie ? String(v.garantieNote || '').trim() : '', pour }));
  /* Un investissement va dans un objet de l'inventaire (existant ou nouveau) ; une charge n'y est pas */
  if (inv) lierDepenseInventaire(k, v.invId || '', v.invId ? null : { nom: v.invNom || v.objet, methode: v.methode, taux: Math.min(1, Math.max(0, num(v.taux) / 100)), duree: num(v.duree) || 5 });
  else detacherDepense(k);
  closeSheet(); toast((v.key ? 'Dépense mise à jour.' : 'Dépense ajoutée.') + (sansJustificatif({ justificatif: v.justificatif, fichiers: DEP.fichiers }) ? ' Attention : justificatif manquant.' : ''), 4500);
};
ACTIONS.depCsv = () => {
  const rows = depenses().sort((a, b) => String(a.date).localeCompare(b.date)).map((d) => [d.n || '', fmtDate(d.date), r2(d.montant).toFixed(2), d.objet, d.type === 'investissement' ? 'Investissement' : 'Charges', libCompte(compteDe(d)), nomDe(d.par), [d.justificatif].concat((d.fichiers || []).map((x) => x.nom)).filter(Boolean).join(' · '), d.remarque]);
  downloadFile(`Dépenses Gamins de Talus ${todayISO()}.csv`, csv(['N°', 'Date', 'Montant', 'Objet', 'Type', 'Compte', 'Payé par', 'Justificatif', 'Remarque'], rows), 'text/csv;charset=utf-8');
};

/* ---------- Recettes ---------- */
function renderRecettes() {
  const ys = anneesFin();
  let list = recettesToutes(); if (FIN.annee) list = list.filter((r) => yearOf(r.date) === FIN.annee);
  const base = list, parCat = {}, moyens = {}; for (const r of base) { const c = compteRecette(r); parCat[c] = (parCat[c] || 0) + num(r.montant); moyens[r.moyen || '—'] = (moyens[r.moyen || '—'] || 0) + 1; }
  list = list.filter((r) => finGarde('rMoyen', r.moyen || '—') && finGarde('rPar', r.par) && finGarde('rCat', compteRecette(r)));
  if (FIN.q) { const q = FIN.q.toLowerCase(); list = list.filter((r) => [r.libelle, r.ref, r.moyen, compteRecette(r), money(r.montant)].join(' ').toLowerCase().includes(q)); }
  const tot = list.reduce((a, r) => a + num(r.montant), 0);
  return `<div class="panel"><div class="between"><h2>Recettes</h2><div class="row"><button class="btn small" type="button" data-act="recCsv">Exporter (CSV)</button><a class="btn primary small" href="#" data-act="recEdit">+ Autre entrée</a></div></div>
    <p class="hint">Les ventes arrivent ici toutes seules depuis <a href="#/factures">Ventes</a> : factures payées, ventes sans facture, encaissements de la vente directe. Ici, on saisit seulement l'argent qui n'est pas une vente : subvention, remboursement, indemnité…</p>
    ${totalFinHtml(tot, list.length, 'recette', list.length !== base.length || !!FIN.q)}
    <div class="fin-filtres">
      <input id="fin-q" class="fin-q" type="search" value="${esc(FIN.q)}" placeholder="🔍 Rechercher : client, libellé…" aria-label="Rechercher">
      ${chipsAnnees(ys)}
      ${chipsFiltre('Moyen', 'rMoyen', Object.entries(moyens).sort((a, b) => b[1] - a[1]).map(([m, n]) => [m, m, n]))}
      ${chipsFiltre('Encaissé par', 'rPar', persOptions().map(([k, l]) => [k, l]))}
      ${chipsFiltre('Catégories', 'rCat', Object.entries(parCat).sort((a, b) => b[1] - a[1]).map(([c, t]) => [c, compteCourt(c), Math.round(t)]))}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Client / libellé</th><th>Compte</th><th>Moyen</th><th>Encaissé par</th><th class="r">Montant</th></tr></thead><tbody>${list.map((r) => r.src === 'facture'
      ? `<tr class="click" data-act="go" data-href="#/factures/voir/${encodeURIComponent(r.key)}"><td class="num">${fmtDate(r.date)}</td><td>${esc(r.libelle)} <span class="tpill">${esc(r.ref)}</span></td><td title="${esc(libCompte(compteRecette(r)))}" class="num">${esc(compteRecette(r))}</td><td>${esc(r.moyen)}</td><td>${esc(nomDe(r.par))}</td><td class="r num">${money(r.montant)}</td></tr>`
      : `<tr class="click" data-act="recEdit" data-key="${esc(r.key)}"><td class="num">${fmtDate(r.date)}</td><td>${esc(r.libelle || '—')}</td><td title="${esc(libCompte(compteRecette(r)))}" class="num">${esc(compteRecette(r))}</td><td>${esc(r.moyen)}</td><td>${esc(nomDe(r.par))}</td><td class="r num">${money(r.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="5">${list.length} recette${list.length > 1 ? 's' : ''}</td><td class="r num">${money(tot)}</td></tr></tfoot></table></div>` : '<p class="empty">Aucune recette pour cette période.</p>'}</div>`;
}
ACTIONS.recEdit = (el) => {
  const k = el.dataset.key || '', r = k ? DB.get(k) : { date: todayISO(), moyen: 'TWINT', par: Sync.me || 'nicolas' };
  const cl = contacts().sort(byName);
  openSheet(`${sheetHead(k ? 'Modifier la recette' : 'Autre entrée d\'argent')}<form class="sbody form" data-form="rec"><input type="hidden" name="key" value="${esc(k)}">
    ${k ? '' : '<p class="hint">Pour une vente, passe par <a href="#/factures/nouvelle" data-act="closeGo" data-href="#/factures/nouvelle">Ventes → Nouvelle vente</a> : le stock, le prix du client et la recette suivent tout seuls.</p>'}
    <div class="grid2">${inp('rc-date', 'Date', r.date, { name: 'date', type: 'date', req: true })}${inp('rc-montant', 'Montant CHF', r.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}</div>
    ${sel('rc-contact', 'Client (contact)', r.contactId || '', [['', '— aucun / vente au stand —']].concat(cl.map((c) => [c.key, displayName(c)])), { name: 'contactId' })}
    ${inp('rc-client', 'Libellé', r.client, { name: 'client', attrs: { placeholder: 'Ex. Subvention, remboursement assurance' } })}
    <div class="field"><label for="rc-compte">Compte</label><select id="rc-compte" name="compte">${optionsComptesRecette(k ? compteRecette(Object.assign({ src: 'recette' }, r)) : '3600')}</select></div>
    <div class="grid2">${sel('rc-moyen', 'Moyen', r.moyen, MOYENS.map((m) => [m, m]), { name: 'moyen' })}${sel('rc-par', 'Encaissé par', r.par, persOptions(), { name: 'par' })}</div>
    ${inp('rc-just', 'Justificatif', r.justificatif, { name: 'justificatif' })}
    ${inp('rc-rem', 'Remarque', r.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette recette">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.rec = (v) => {
  const m = num(v.montant); if (!(m > 0) || !v.date) { toast('Date et montant sont obligatoires.'); return; }
  const c = DB.get(v.contactId);
  const k = v.key || 'rec:' + uid('r'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  DB.put(k, Object.assign({}, old, { date: v.date, montant: r2(m), contactId: v.contactId, client: v.client || (c ? displayName(c) : ''), moyen: v.moyen, par: v.par, justificatif: v.justificatif, remarque: v.remarque, compte: v.compte || '' }));
  closeSheet(); toast(v.key ? 'Recette mise à jour.' : 'Recette ajoutée.');
};
ACTIONS.recCsv = () => {
  const rows = recettesToutes().reverse().map((r) => [fmtDate(r.date), r2(r.montant).toFixed(2), r.libelle, libCompte(compteRecette(r)), r.moyen, nomDe(r.par), r.src === 'facture' ? 'Facture ' + r.ref : 'Saisie directe']);
  downloadFile(`Recettes Gamins de Talus ${todayISO()}.csv`, csv(['Date', 'Montant', 'Client / libellé', 'Compte', 'Moyen', 'Encaissé par', 'Origine'], rows), 'text/csv;charset=utf-8');
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
ACTIONS.delItemOk = (el) => {
  DB.del(el.dataset.key);
  /* Une tâche supprimée depuis la fenêtre d'un événement ou d'un jour : on revient à cette fenêtre */
  if (String(el.dataset.key).startsWith('t:') && typeof PL !== 'undefined' && PL.rafraichir) PL.rafraichir(); else closeSheet();
  toast('Supprimé. Récupérable dans la corbeille.');
};

