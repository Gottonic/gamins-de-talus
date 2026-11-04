/* Gamins de Talus — relevés de fin d'année : le relevé TWINT et le relevé bancaire de l'année (ou de la durée de l'activité).
   Ils sont demandés avant l'archive annuelle et l'export « Impôts », ajoutés au zip (dossier Relevés/), et servent à vérifier :
   - TWINT : chaque paiement du relevé est-il compté dans les recettes ? (les paiements manquants s'ajoutent en un clic)
   - Banque : les virements reçus ↔ les factures payées par virement ; les débits ↔ les dépenses payées par le titulaire du compte.
   Le compte bancaire est un compte personnel : les autres lignes (privées) ne sont ni montrées ni gardées.
   Les fichiers restent sur cet appareil le temps de faire l'archive (ils ne sont pas envoyés dans l'app) ; le résultat de la
   vérification est gardé dans cfg:releves:AAAA, et les factures et dépenses retrouvées sont marquées (rapproche). */
'use strict';

const REL = {};   // année → { twint: { nom, blob, tx }, banque: { nom, blob, lignes } }
const relDe = (y) => (REL[y] = REL[y] || {});
const relEtat = (y) => DB.get('cfg:releves:' + y) || {};

/* ---------- Lecture ---------- */
async function lireReleveTwint(file) {
  const rows = /\.csv$/i.test(file.name) || file.type === 'text/csv' ? lireCsv(await file.text()) : await lireXlsx(file);
  let hi = rows.findIndex((r) => r.filter((x) => typeof x === 'string' && x.trim() && !twDate(x) && !isFinite(twNombre(x))).length >= 2); if (hi < 0) hi = 0;
  const entete = rows[hi].map((x, j) => String(x || 'Colonne ' + (j + 1))), lignes = rows.slice(hi + 1).filter((r) => r.some((x) => String(x).trim())), c = twDevine(entete, lignes);
  if (c.date < 0 || c.montant < 0) throw new Error('colonnes date / montant introuvables');
  return lignes.map((l) => ({ date: twDate(l[c.date]), montant: r2(twNombre(l[c.montant])), ref: c.ref >= 0 ? String(l[c.ref] || '').trim() : '', texte: c.texte >= 0 ? String(l[c.texte] || '').trim() : '' }))
    .filter((t) => t.date && isFinite(t.montant) && t.montant !== 0).sort((a, b) => a.date.localeCompare(b.date));
}
/* Relevé bancaire : camt.053 / camt.054 (XML, le format standard des banques suisses) ou CSV ; un PDF est seulement joint */
async function lireReleveBanque(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return null;
  const txt = await file.text();
  if (/^\s*</.test(txt)) {
    const doc = new DOMParser().parseFromString(txt, 'application/xml'), q = (el, sel) => { for (const n of sel.split('>')) { if (!el) return null; el = [...el.children].find((c) => c.localName === n); } return el; };
    const tous = (el, nom) => [...el.getElementsByTagNameNS('*', nom)];
    return tous(doc, 'Ntry').map((e) => {
      const m = num((q(e, 'Amt') || {}).textContent), deb = ((q(e, 'CdtDbtInd') || {}).textContent || '') === 'DBIT';
      const date = ((q(e, 'BookgDt>Dt') || q(e, 'ValDt>Dt') || {}).textContent || '').slice(0, 10) || ((q(e, 'BookgDt>DtTm') || {}).textContent || '').slice(0, 10);
      const textes = [...tous(e, 'AddtlNtryInf'), ...tous(e, 'Ustrd'), ...tous(e, 'AddtlTxInf'), ...tous(e, 'Ref')].map((x) => x.textContent.trim()).filter(Boolean);
      const noms = tous(e, 'Nm').map((x) => x.textContent.trim()).filter(Boolean);
      return { date, montant: r2(deb ? -m : m), texte: [...new Set(textes)].join(' · '), nom: noms.join(' · ') };
    }).filter((l) => l.date && l.montant);
  }
  const rows = lireCsv(txt); let hi = rows.findIndex((r) => r.filter((x) => /date|datum/i.test(String(x))).length && r.length >= 3); if (hi < 0) throw new Error('format non reconnu');
  const h = rows[hi].map((x) => sansAccentsS(String(x))), col = (re) => h.findIndex((x) => re.test(x));
  const cD = col(/date|datum/), cM = col(/montant|betrag|amount/), cC = col(/credit|gutschrift|entree/), cB = col(/debit|belastung|sortie/), cT = col(/texte|libelle|description|buchungstext|communication|motif|avis|details/);
  if (cD < 0 || (cM < 0 && cC < 0 && cB < 0)) throw new Error('colonnes date / montant introuvables');
  return rows.slice(hi + 1).map((r) => {
    const m = cM >= 0 ? twNombre(r[cM]) : (twNombre(r[cC]) || 0) - Math.abs(twNombre(r[cB]) || 0);
    return { date: twDate(r[cD]), montant: r2(m), texte: cT >= 0 ? String(r[cT] || '') : r.join(' '), nom: '' };
  }).filter((l) => l.date && isFinite(l.montant) && l.montant);
}

/* ---------- Vérification ---------- */
const jours = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
function verifierReleves(y) {
  const R = relDe(y), out = { y };
  if (R.twint && R.twint.tx) {
    const tx = R.twint.tx.filter((t) => yearOf(t.date) === y), imp = importerTransactionsTwint(tx);
    /* Un paiement du relevé qui correspond à une recette TWINT déjà saisie à la main (même montant, à un jour près) : on les relie */
    const prisesR = new Set(DB.all('tw:').map((t) => t.utilise).filter(Boolean));
    const recTw = DB.all('rec:').filter((r) => yearOf(r.date) === y && /twint/i.test(r.moyen || '') && !r.self && !prisesR.has(r.key));
    for (const t of DB.all('tw:').filter((x) => yearOf(x.date) === y && x.montant > 0 && (!x.utilise || !DB.get(x.utilise)))) {
      const r = recTw.find((x) => !prisesR.has(x.key) && Math.abs(num(x.montant) - t.montant) < 0.01 && Math.abs(jours(x.date, t.date)) <= 1);
      if (r) { prisesR.add(r.key); DB.put(t.key, Object.assign({}, t, { utilise: r.key })); }
    }
    const twY = DB.all('tw:').filter((t) => yearOf(t.date) === y), libres = twY.filter((t) => t.montant > 0 && (!t.utilise || !DB.get(t.utilise)));
    const appTw = recettesToutes().filter((r) => yearOf(r.date) === y && /twint/i.test(r.moyen || ''));
    out.twint = { n: tx.length, total: r2(tx.reduce((a, t) => a + t.montant, 0)), app: r2(appTw.reduce((a, r) => a + num(r.montant), 0)), nouveaux: imp.n, libres: libres.length, libresTotal: r2(libres.reduce((a, t) => a + t.montant, 0)) };
  }
  if (R.banque && R.banque.lignes) {
    const ls = R.banque.lignes.filter((l) => yearOf(l.date) === y), prises = new Set(), tit = (typeof titulaireCompte === 'function' && titulaireCompte()) || '';
    const trouve = (test) => { const i = ls.findIndex((l, j) => !prises.has(j) && test(l)); if (i >= 0) prises.add(i); return i >= 0 ? ls[i] : null; };
    const marque = (k, o, l) => { const v = `${l.date} ${money(Math.abs(l.montant))}`; if (o.rapproche !== v) DB.put(k, Object.assign({}, o, { rapproche: v })); };
    /* Factures payées par virement : un crédit du même montant, après la facture (le numéro ou le client dans le texte aide) */
    const fac = factures().filter((f) => f.numero && f.statut === 'payee' && f.payeePar !== 'especes' && f.payeePar !== 'twint' && yearOf(f.payeeLe || f.date) === y);
    const facSans = [];
    for (const f of fac.sort((a, b) => String(a.payeeLe || a.date).localeCompare(String(b.payeeLe || b.date)))) {
      const ok = (l) => l.montant > 0 && Math.abs(l.montant - num(f.total)) < 0.01 && l.date >= f.date && jours(f.payeeLe || f.date, l.date) <= 20 && jours(f.payeeLe || f.date, l.date) >= -40;
      const l = trouve((x) => ok(x) && (x.texte + ' ' + x.nom).includes(f.numero)) || trouve((x) => ok(x) && f.client && sansAccentsS(x.nom + ' ' + x.texte).includes(sansAccentsS(String(f.client.nom).split(/\s+/)[0] || '§'))) || trouve(ok);
      if (l) marque(f.key, f, l); else facSans.push(f.key);
    }
    /* Factures encore ouvertes, mais dont le virement apparaît sur le relevé */
    const ouvertesPayees = [];
    for (const f of factures().filter((x) => ['ouverte', 'retard'].includes(facStatut(x)) && x.numero)) {
      const l = trouve((x) => x.montant > 0 && Math.abs(x.montant - num(f.total)) < 0.01 && x.date >= f.date && ((x.texte + ' ' + x.nom).includes(f.numero) || jours(f.date, x.date) <= 60));
      if (l) ouvertesPayees.push({ k: f.key, date: l.date });
    }
    /* Dépenses payées par le titulaire du compte : un débit du même montant, à quelques jours près */
    const deps = depenses().filter((d) => yearOf(d.date) === y && (!tit || d.par === tit)), depSans = [];
    for (const d of deps) { const l = trouve((x) => x.montant < 0 && Math.abs(-x.montant - num(d.montant)) < 0.01 && Math.abs(jours(d.date, x.date)) <= 10); if (l) marque(d.key, d, l); else depSans.push(d.key); }
    const twCredits = ls.filter((l) => l.montant > 0 && /twint/i.test(l.texte + ' ' + l.nom));
    out.banque = { n: ls.length, factures: fac.length, facOk: fac.length - facSans.length, facSans, ouvertesPayees, deps: deps.length, depOk: deps.length - depSans.length, depSans, tit, twint: r2(twCredits.reduce((a, l) => a + l.montant, 0)) };
  }
  const old = relEtat(y);
  DB.put('cfg:releves:' + y, Object.assign({}, old, out.twint ? { twint: Object.assign({ fichier: relDe(y).twint.nom }, out.twint) } : {}, out.banque ? { banque: Object.assign({ fichier: relDe(y).banque.nom }, out.banque) } : {}, { le: new Date().toISOString(), par: Sync.me || '' }));
  return relEtat(y);
}

/* ---------- Fenêtre « Relevés de l'année » ---------- */
function rapportRelevesHtml(y) {
  const e = relEtat(y), R = relDe(y), l = [];
  const ligne = (ok, txt, act) => `<li class="${ok ? 'ok' : 'todo'}"><span class="ck">${ok ? '✓' : '!'}</span><span>${txt}</span>${act || ''}</li>`;
  if (e.twint) {
    const t = e.twint, ecart = r2(t.total - t.app);
    l.push(ligne(true, `Relevé TWINT : ${t.n} paiements, ${chf(t.total)}${t.nouveaux ? ` (${t.nouveaux} ajouté${t.nouveaux > 1 ? 's' : ''} aux paiements TWINT de l'app)` : ''}.`));
    l.push(t.libres ? ligne(false, `<b>${t.libres} paiement${t.libres > 1 ? 's' : ''} TWINT pas encore compté${t.libres > 1 ? 's' : ''} dans les recettes</b> (${chf(t.libresTotal)}).`, `<button class="btn small" type="button" data-act="relTwRecettes" data-y="${y}">Les ajouter aux recettes</button>`) : ligne(true, 'Tous les paiements TWINT sont dans les recettes.'));
    l.push(ligne(Math.abs(ecart) < 1, `Recettes TWINT dans l'app : ${chf(t.app)}${Math.abs(ecart) >= 1 ? ` — écart avec le relevé : <b>${chf(ecart)}</b>${ecart < 0 ? ' (l\'app compte plus que le relevé : une recette en double, ou payée sur un autre TWINT ?)' : ''}` : ''}.`));
  }
  if (e.banque) {
    const b = e.banque;
    l.push(ligne(!b.facSans.length, `Factures payées par virement retrouvées sur le relevé : ${b.facOk}/${b.factures}.${b.facSans.length ? ' Sans virement trouvé : ' + b.facSans.map((k) => { const f = DB.get(k); return f ? `<a href="#/factures/voir/${encodeURIComponent(k)}" data-act="closeGo" data-href="#/factures/voir/${encodeURIComponent(k)}">${esc(f.numero)}</a>` : ''; }).join(', ') + ' (payées sur un autre compte ou en espèces ?)' : ''}`));
    if (b.ouvertesPayees.length) l.push(ligne(false, `<b>${b.ouvertesPayees.length} facture${b.ouvertesPayees.length > 1 ? 's' : ''} encore ouverte${b.ouvertesPayees.length > 1 ? 's' : ''}</b> dont le virement semble arrivé : ${b.ouvertesPayees.map((x) => esc((DB.get(x.k) || {}).numero || '')).join(', ')}.`, `<button class="btn small" type="button" data-act="relMarquerPayees" data-y="${y}">Marquer payées</button>`));
    l.push(ligne(!b.depSans.length, `Dépenses payées par ${esc(b.tit ? nomDe(b.tit) : 'le titulaire du compte')} retrouvées sur le relevé : ${b.depOk}/${b.deps}.${b.depSans.length ? ` <a href="#" data-act="relDepSans" data-y="${y}">Voir les ${b.depSans.length} autres</a> (payées en espèces, avec une autre carte, ou montant différent ?)` : ''}`));
    if (b.twint) l.push(ligne(true, `Versements TWINT sur le compte : ${chf(b.twint)} (TWINT retient ses frais).`));
  }
  return l.length ? `<ul class="checklist">${l.join('')}</ul>` : '';
}
function relevesFeuille(y, suite) {
  const R = relDe(y), e = relEtat(y);
  const etat = (k, nom) => R[k] ? `✓ ${esc(R[k].nom)}` : e[k] ? `<span class="hint">vérifié le ${fmtDate(String(e.le).slice(0, 10))} (${esc(e[k].fichier || '')}) — à rajouter pour l'archive</span>` : `<span class="hint">pas encore</span>`;
  openSheet(`${sheetHead(`Relevés ${y}`, 'Pour les impôts et l\'archive')}<div class="sbody" id="rel-sheet">
    <p class="hint" style="margin-top:0">Du 1<sup>er</sup> janvier (ou du début de l'activité) au 31 décembre ${y}. Ils vont dans l'archive (dossier « Relevés ») et servent à vérifier que rien ne manque. Les fichiers ne sont pas envoyés dans l'app : seul le résultat de la vérification est gardé, et les autres lignes du compte (privées) sont ignorées.</p>
    <div class="rel-l">
      <label class="rel-it"><span><b>Relevé TWINT</b><br><span class="hint">TWINT Business → Transactions → télécharger l'année (Excel ou CSV)</span><br>${etat('twint')}</span><span class="btn small">Choisir<input type="file" data-rel="twint" data-y="${y}" accept=".xlsx,.csv,text/csv" hidden></span></label>
      <label class="rel-it"><span><b>Relevé bancaire</b><br><span class="hint">E-banking → relevé de compte de l'année, de préférence en <b>camt.053 (XML)</b> ou CSV pour la vérification ; un PDF est seulement joint</span><br>${etat('banque')}</span><span class="btn small">Choisir<input type="file" data-rel="banque" data-y="${y}" accept=".xml,.csv,.pdf,text/xml,application/xml,text/csv,application/pdf" hidden></span></label>
    </div>
    <div id="rel-rapport">${rapportRelevesHtml(y)}</div>
    <div class="row-end">${suite ? `<button class="btn" type="button" data-act="relSuite" data-suite="${suite}">${R.twint || R.banque ? 'Continuer' : 'Continuer sans les relevés'}</button>` : '<button class="btn" type="button" data-act="close">Fermer</button>'}</div></div>`);
  $('rel-sheet').addEventListener('change', async (ev) => {
    const inp = ev.target; if (!inp.dataset || !inp.dataset.rel || !inp.files[0]) return; const f = inp.files[0], k = inp.dataset.rel;
    try {
      if (k === 'twint') relDe(y).twint = { nom: f.name, blob: f, tx: await lireReleveTwint(f) };
      else { const lignes = await lireReleveBanque(f); relDe(y).banque = { nom: f.name, blob: f, lignes }; if (!lignes) toast('PDF joint à l\'archive. Pour la vérification, il faut le format camt.053 (XML) ou CSV.', 6000); }
      verifierReleves(y); toast('Relevé lu et vérifié.');
    } catch (err) { toast('Relevé illisible : ' + (err.message || err), 6000); }
    relevesFeuille(y, suite);
  });
}
ACTIONS.relOuvrir = () => relevesFeuille(BCL.annee, '');
ACTIONS.relSuite = (el) => { closeSheet(); if (el.dataset.suite === 'archive') ACTIONS.bclZip({ dataset: { sansDemander: '1' } }); else ACTIONS.expGo({ dataset: { sansDemander: '1' } }); };
/* Paiements TWINT libres → recettes (une par mois) */
ACTIONS.relTwRecettes = (el) => {
  const y = el.dataset.y, libres = DB.all('tw:').filter((t) => yearOf(t.date) === y && t.montant > 0 && (!t.utilise || !DB.get(t.utilise))), mois = {};
  for (const t of libres) (mois[t.date.slice(0, 7)] = mois[t.date.slice(0, 7)] || []).push(t);
  for (const [m, l] of Object.entries(mois)) {
    const rk = 'rec:' + uid('r'), fin = l.map((t) => t.date).sort().pop();
    DB.put(rk, { date: fin, montant: r2(l.reduce((a, t) => a + t.montant, 0)), moyen: 'TWINT', par: (typeof titulaireCompte === 'function' && titulaireCompte()) || Sync.me || '', client: 'Ventes TWINT', libelle: `Ventes TWINT ${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)} (${l.length} paiement${l.length > 1 ? 's' : ''}, relevé)`, cree: new Date().toISOString(), creePar: Sync.me || '' });
    for (const t of l) DB.put(t.key, Object.assign({}, t, { utilise: rk }));
  }
  verifierReleves(y); toast(`${libres.length} paiement${libres.length > 1 ? 's' : ''} ajouté${libres.length > 1 ? 's' : ''} aux recettes (${Object.keys(mois).length} ligne${Object.keys(mois).length > 1 ? 's' : ''}, une par mois).`, 5000);
  const r = $('rel-rapport'); if (r) r.innerHTML = rapportRelevesHtml(y);
};
ACTIONS.relMarquerPayees = (el) => {
  const y = el.dataset.y, b = (relEtat(y).banque || {}); let n = 0;
  for (const x of b.ouvertesPayees || []) { const f = DB.get(x.k); if (f && ['ouverte', 'retard'].includes(facStatut(Object.assign({ key: x.k }, f)))) { DB.put(x.k, Object.assign({}, f, { statut: 'payee', payeeLe: x.date, payeePar: 'virement', encaissePar: (typeof titulaireCompte === 'function' && titulaireCompte()) || Sync.me || '' })); n++; } }
  verifierReleves(y); toast(`${n} facture${n > 1 ? 's' : ''} marquée${n > 1 ? 's' : ''} payée${n > 1 ? 's' : ''}.`);
  const r = $('rel-rapport'); if (r) r.innerHTML = rapportRelevesHtml(y);
};
ACTIONS.relDepSans = (el) => {
  const y = el.dataset.y, l = ((relEtat(y).banque || {}).depSans || []).map((k) => DB.get(k) && Object.assign({ key: k }, DB.get(k))).filter(Boolean);
  openSheet(`${sheetHead('Dépenses pas retrouvées sur le relevé', String(l.length))}<div class="sbody"><p class="hint">Rien d'anormal si elles ont été payées en espèces ou avec un autre compte. Sinon, vérifie le montant ou la date.</p>
    <div class="items">${l.map((d) => `<button type="button" class="item" data-act="depEdit" data-key="${esc(d.key)}"><span class="who"><strong>${esc(d.objet)}</strong><span class="meta">${fmtDate(d.date)} · ${esc(libCompte(compteDe(d)))}</span></span><span class="amt">${chf(d.montant)}</span></button>`).join('')}</div></div>`);
};
/* Pour l'archive et l'export : les fichiers des relevés */
function ajouterRelevesZip(dir, y) {
  const R = relDe(y), l = [];
  for (const k of ['twint', 'banque']) if (R[k] && R[k].blob) { dir.file(`Relevés/${k === 'twint' ? 'TWINT' : 'Banque'} - ${nomZip(R[k].nom)}`, R[k].blob); l.push(R[k].nom); }
  return l;
}
