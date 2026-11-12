/* Gamins de Talus — précommandes (ventes spéciales : sachets de la Saint-Nicolas…), dans Ventes → Stock et prix.
   pcmd:<id> = { contactId, lignes: [{ prod, qte }], qui (qui s'en occupe), remarque,
                 statut: 'reservee' | 'livree' | 'annulee', vente (clé fac: une fois livrée), moyen, livreeLe, cree, creePar }
   Le stock ne bouge qu'à la livraison (une vente normale : stock, prix, recette). En attendant : en stock / réservé / libre.
   L'adresse du contact sert à la tournée : facultative, mais signalée tant qu'elle manque.
   cfg:tournee = { ordre: [clés pcmd:], depart: { q, lat, lon }, calculeLe, km } — l'ordre de la tournée de livraison.
   Coordonnées des adresses : géocodeur public de la Confédération (api3.geo.admin.ch), gardées sur le contact (geo). */
'use strict';

const PC = { lignes: null, voirLivrees: false };
const precommandes = () => DB.all('pcmd:').sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
const pcOuvertes = () => precommandes().filter((p) => p.statut === 'reservee');
const contactPc = (p) => { const c = DB.get(p.contactId); return c ? Object.assign({ key: p.contactId }, c) : null; };
const nomContactPc = (p) => { const c = contactPc(p); return c ? displayName(c) : '(contact supprimé)'; };
const adresseOk = (c) => !!(c && String(c.rue || '').trim() && (String(c.npa || '').trim() || String(c.localite || '').trim()));
const adresseTxt = (c) => (c ? [street(c), place(c)].filter(Boolean).join(', ') : '');
const prixPc = (prodKey, contactId) => { const p = DB.get(prodKey); if (!p) return 0; const pc = typeof prixClient === 'function' ? prixClient(contactId, prodKey) : null; if (pc) return num(pc.prix); const c = DB.get(contactId); return num(prixPour(p, c ? (c.type || 'autre') : 'particulier')); };
const totalPc = (p) => r2((p.lignes || []).reduce((a, l) => a + num(l.qte) * prixPc(l.prod, p.contactId), 0));
const qteTxt = (q, u) => `${fmtQty(r2(q))} ${u === 'pièce' ? 'pc' : esc(u || '')}`.trim();
const quoiPc = (p) => (p.lignes || []).map((l) => `${qteTxt(l.qte, (DB.get(l.prod) || {}).unite)} ${esc((DB.get(l.prod) || { nom: '?' }).nom)}`).join(' · ');
/* Ce qui est réservé, par produit (précommandes pas encore livrées) */
function reserves() { const o = {}; for (const p of pcOuvertes()) for (const l of p.lignes || []) o[l.prod] = (o[l.prod] || 0) + num(l.qte); return o; }
/* Une précommande à livrer pour ce contact, sans adresse : la petite alerte de la fiche contact */
const pcSansAdressePour = (ck) => pcOuvertes().some((p) => p.contactId === ck) && !adresseOk(DB.get(ck));

/* ---------- Le cadre dans « Stock et prix » ---------- */
function precommandesPanelHtml() {
  const ouv = pcOuvertes(), res = reserves(), recentes = precommandes().filter((p) => p.statut === 'livree' && String(p.livreeLe || '') >= addDays(todayISO(), -30));
  if (!ouv.length && !recentes.length) return '';
  const sansAdr = ouv.filter((p) => !adresseOk(DB.get(p.contactId))).length, aCharger = Object.entries(res);
  return `<div class="panel pc-cadre"><div class="between"><h2>🎁 Précommandes${ouv.length ? ` · ${ouv.length} à livrer` : ''}</h2><button class="btn primary small" type="button" data-act="pcEdit">+ Précommande</button></div>
    ${aCharger.length ? `<div class="pc-prods">${aCharger.map(([k, q]) => { const p = DB.get(k) || { nom: '?' }, st = typeof stockDe === 'function' ? stockDe(k) : null, libre = st == null ? null : r2(num(st) - q);
      return `<div class="pc-prod"><b>${esc(p.nom)}</b><span>réservé <b>${qteTxt(q, p.unite)}</b></span><span>en stock ${st == null ? '—' : qteTxt(st, p.unite)}</span><span class="${libre != null && libre < 0 ? 'bad' : ''}">libre <b>${libre == null ? '—' : qteTxt(libre, p.unite)}</b>${libre != null && libre < 0 ? ' ⚠️ il en manque' : ''}</span></div>`; }).join('')}</div>` : '<p class="hint">Tout est livré.</p>'}
    ${sansAdr ? `<p class="pc-alerte">⚠️ ${sansAdr} adresse${sansAdr > 1 ? 's' : ''} manquante${sansAdr > 1 ? 's' : ''} pour la livraison.</p>` : ''}
    <div class="row"><button class="btn small" type="button" data-act="pcListe">📋 La liste (${ouv.length})</button>${ouv.length ? '<button class="btn small" type="button" data-act="pcTournee">🚚 Tournée de livraison</button>' : ''}</div></div>`;
}

/* ---------- La liste ---------- */
function ligneListePc(p) {
  const c = contactPc(p), ok = adresseOk(c);
  return `<button type="button" class="item" data-act="pcEdit" data-key="${esc(p.key)}"><span class="who"><strong>${esc(nomContactPc(p))}</strong><span class="meta">${quoiPc(p)}${p.qui ? ` · 👤 ${esc(p.qui === Sync.me ? 'toi' : nomDe(p.qui))}` : ''}${p.remarque ? ' · 📝' : ''}<br>${p.statut === 'reservee' ? (ok ? esc(adresseTxt(c)) : '<span class="bad">⚠️ adresse manquante</span>') : ''}</span></span>
    <span class="num">${p.statut === 'livree' ? '<span class="pill payee">livrée</span><br>' : p.statut === 'annulee' ? '<span class="pill annulee">annulée</span><br>' : ''}${chf(totalPc(p))}</span></button>`;
}
ACTIONS.pcListe = () => {
  const ouv = ordreTournee(), autres = precommandes().filter((p) => p.statut !== 'reservee').reverse();
  openSheet(`${sheetHead('Précommandes', `${ouv.length} à livrer · ${chf(ouv.reduce((a, p) => a + totalPc(p), 0))}`)}<div class="sbody">
    ${ouv.length ? `<div class="items">${ouv.map(ligneListePc).join('')}</div>` : '<p class="empty">Rien à livrer.</p>'}
    ${autres.length ? `<button type="button" class="btn link small" data-act="pcLivrees">${PC.voirLivrees ? 'Cacher' : 'Voir'} les livrées et annulées (${autres.length})</button>${PC.voirLivrees ? `<div class="items">${autres.slice(0, 100).map(ligneListePc).join('')}</div>` : ''}` : ''}
    <div class="row-end"><button class="btn" type="button" data-act="pcEdit">+ Précommande</button>${ouv.length ? '<button class="btn primary" type="button" data-act="pcTournee">🚚 Tournée</button>' : ''}</div></div>`);
};
ACTIONS.pcLivrees = () => { PC.voirLivrees = !PC.voirLivrees; ACTIONS.pcListe(); };

/* ---------- La fiche (nouvelle ou existante) ---------- */
function pcLignesForm() { const f = $('pc-form'); if (!f) return null; return [...f.querySelectorAll('.pc-ligne')].map((r) => ({ prod: r.querySelector('select').value, qte: r.querySelector('input').value })); }
function pcFeuille(k, garder) {
  const p = k ? DB.get(k) : null, o = p || { contactId: '', lignes: [], qui: Sync.me || '', remarque: '', statut: 'reservee' };
  if (!garder) PC.lignes = (o.lignes || []).map((l) => ({ prod: l.prod, qte: l.qte }));
  if (!PC.lignes.length) { const der = precommandes().slice(-1)[0]; PC.lignes.push({ prod: der && der.lignes && der.lignes[0] ? der.lignes[0].prod : '', qte: '' }); }
  const ps = produits(), res = reserves(), cl = contacts().sort(byName), c = o.contactId ? DB.get(o.contactId) || {} : {};
  const optP = (v) => `<option value="">Choisir…</option>${ps.map((x) => { const st = typeof stockDe === 'function' ? stockDe(x.key) : null, libre = st == null ? '' : ` · libre ${fmtQty(r2(num(st) - (res[x.key] || 0)))}`; return `<option value="${esc(x.key)}"${x.key === v ? ' selected' : ''}>${esc(x.nom)}${esc(libre)}</option>`; }).join('')}`;
  openSheet(`${sheetHead(k ? 'Précommande' : 'Nouvelle précommande', p ? `${p.statut === 'livree' ? 'livrée' : p.statut === 'annulee' ? 'annulée' : 'à livrer'} · notée par ${nomDe(p.creePar)}` : '')}
    <form class="sbody form" data-form="pc" id="pc-form"><input type="hidden" name="key" value="${esc(k || '')}">
    ${sel('pc-contact', 'Pour qui', o.contactId, [['', '➕ Nouveau contact…']].concat(cl.map((x) => [x.key, displayName(x)])), { name: 'contactId' })}
    <div id="pc-nouveau"${o.contactId ? ' hidden' : ''}><div class="grid2">${inp('pc-nom', 'Nom', '', { name: 'nom', attrs: { placeholder: 'Prénom Nom' } })}${inp('pc-tel', 'Téléphone', '', { name: 'tel', type: 'tel' })}</div></div>
    <div class="field"><span class="flabel">Adresse de livraison</span>
      <div class="grid2">${inp('pc-rue', '', c.rue || '', { name: 'rue', attrs: { placeholder: 'Rue', 'aria-label': 'Rue' } })}${inp('pc-num', '', c.numero || '', { name: 'numero', attrs: { placeholder: 'N°', 'aria-label': 'Numéro' } })}${inp('pc-npa', '', c.npa || '', { name: 'npa', attrs: { placeholder: 'NPA', inputmode: 'numeric', 'aria-label': 'NPA' } })}${inp('pc-loc', '', c.localite || '', { name: 'localite', attrs: { placeholder: 'Localité', 'aria-label': 'Localité' } })}</div>
      <span class="sub">Facultative maintenant, mais nécessaire pour la tournée : elle est gardée sur le contact.</span></div>
    <div class="field"><span class="flabel">Quoi</span>
      ${PC.lignes.map((l, i) => `<div class="row pc-ligne"><select aria-label="Produit" name="p_${i}">${optP(l.prod)}</select><input class="cell-in" name="q_${i}" inputmode="decimal" placeholder="Qté" value="${esc(l.qte ?? '')}" style="width:70px">${PC.lignes.length > 1 ? `<button type="button" class="btn small" data-act="pcLigneOff" data-i="${i}" data-key="${esc(k || '')}" aria-label="Retirer">×</button>` : ''}</div>`).join('')}
      <button type="button" class="btn link small" data-act="pcLigne" data-key="${esc(k || '')}">+ un autre produit</button></div>
    <div class="grid2">${sel('pc-qui', "Qui s'en occupe", o.qui || '', [['', 'Personne en particulier']].concat(persOptions()), { name: 'qui' })}${inp('pc-rem', 'Remarque', o.remarque, { name: 'remarque', attrs: { placeholder: 'Ex. sonner chez le voisin' } })}</div>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette précommande">Supprimer</button>` : ''}
      ${p && p.statut === 'reservee' ? `<button class="btn" type="button" data-act="pcStatut" data-key="${esc(k)}" data-s="annulee">Annulée</button><button class="btn" type="button" data-act="pcLivree" data-key="${esc(k)}">✓ Livrée…</button>` : ''}
      ${p && p.statut !== 'reservee' ? `<button class="btn" type="button" data-act="pcStatut" data-key="${esc(k)}" data-s="reservee">Remettre à livrer</button>` : ''}
      ${p && p.vente && DB.get(p.vente) ? `<a class="btn" href="#/factures/voir/${encodeURIComponent(p.vente)}" data-act="closeGo" data-href="#/factures/voir/${encodeURIComponent(p.vente)}">Voir la vente</a>` : ''}
      <button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const s = $('pc-contact');
  if (s) s.addEventListener('change', () => { $('pc-nouveau').hidden = !!s.value; const x = DB.get(s.value) || {}; for (const [id, f] of [['pc-rue', 'rue'], ['pc-num', 'numero'], ['pc-npa', 'npa'], ['pc-loc', 'localite']]) $(id).value = x[f] || ''; });
}
ACTIONS.pcEdit = (el) => pcFeuille((el.dataset && el.dataset.key) || '');
/* Ajouter / retirer une ligne sans perdre ce qui est déjà rempli */
const pcRelire = () => { const l = pcLignesForm(); if (l) PC.lignes = l; };
const pcRouvrir = (k) => { const f = $('pc-form'), v = f ? formValues(f) : {}; pcFeuille(k, true); for (const [n, x] of Object.entries(v)) { const e = $('pc-form') && $('pc-form').elements[n]; if (e && !/^[pq]_/.test(n) && n !== 'key') e.value = x; } const s = $('pc-contact'); if (s) $('pc-nouveau').hidden = !!s.value; };
ACTIONS.pcLigne = (el) => { pcRelire(); PC.lignes.push({ prod: '', qte: '' }); pcRouvrir(el.dataset.key); };
ACTIONS.pcLigneOff = (el) => { pcRelire(); PC.lignes.splice(Number(el.dataset.i), 1); pcRouvrir(el.dataset.key); };
ACTIONS.pcStatut = (el) => { const p = DB.get(el.dataset.key); if (!p) return; DB.put(el.dataset.key, Object.assign({}, p, { statut: el.dataset.s })); closeSheet(); toast(el.dataset.s === 'annulee' ? 'Précommande annulée : sa réservation est libérée.' : 'Remise à livrer.'); };
FORMS.pc = (v, form) => {
  const lignes = [...form.querySelectorAll('.pc-ligne')].map((r) => ({ prod: r.querySelector('select').value, qte: r2(num(r.querySelector('input').value)) })).filter((l) => l.prod && l.qte > 0);
  if (!lignes.length) { toast('Choisis au moins un produit et sa quantité.'); return; }
  const adr = { rue: String(v.rue || '').trim(), numero: String(v.numero || '').trim(), npa: String(v.npa || '').trim(), localite: String(v.localite || '').trim() };
  let ck = v.contactId;
  if (!ck) {
    const nom = String(v.nom || '').trim(); if (!nom) { toast('Choisis le contact, ou écris le nom du nouveau.'); return; }
    ck = 'ct:' + uid('c'); DB.put(ck, Object.assign({ nom, telephone: String(v.tel || '').trim(), type: 'particulier', notes: 'Créé depuis une précommande.', cree: new Date().toISOString() }, adr));
  } else {
    /* L'adresse tapée ici va sur le contact (et ses coordonnées sont recalculées si elle change) */
    const c = DB.get(ck) || {}, change = Object.keys(adr).some((f) => adr[f] !== String(c[f] || '').trim());
    if (change) { const o = Object.assign({}, c, adr); delete o.geo; DB.put(ck, o); }
  }
  const k = v.key || 'pcmd:' + uid('p'), old = DB.get(k) || { statut: 'reservee', cree: new Date().toISOString(), creePar: Sync.me || '' };
  DB.put(k, Object.assign({}, old, { contactId: ck, lignes, qui: v.qui || '', remarque: String(v.remarque || '').trim() })); PC.lignes = null;
  closeSheet(); toast((v.key ? 'Précommande mise à jour.' : 'Précommande notée.') + (adresseOk(DB.get(ck)) ? '' : ' Il manque l\'adresse pour la livraison.'), 4500);
};

/* ---------- Livrée : la vente est enregistrée tout de suite (stock, recette) ---------- */
ACTIONS.pcLivree = (el) => {
  const k = el.dataset.key, p = DB.get(k); if (!p) return;
  openSheet(`${sheetHead('Livrée : ' + nomContactPc(p), `${quoiPc(Object.assign({ key: k }, p)).replace(/<[^>]+>/g, '')} · ${chf(totalPc(p))}`)}<div class="sbody">
    <p>Comment ${esc(nomContactPc(p))} a payé ?</p>
    <div class="menu-list"><button type="button" class="menu-it" data-act="pcLivrer" data-key="${esc(k)}" data-m="especes">💵 Espèces</button><button type="button" class="menu-it" data-act="pcLivrer" data-key="${esc(k)}" data-m="twint">📱 TWINT</button><button type="button" class="menu-it" data-act="pcLivrer" data-key="${esc(k)}" data-m="plustard">🧾 Plus tard (reste à encaisser)</button><button type="button" class="menu-it" data-act="pcLivrer" data-key="${esc(k)}" data-m="vente">✏️ Autre : ouvrir la vente pour la modifier</button></div>
    <p class="hint">La vente est enregistrée sans facture : le stock baisse et la recette compte. « Plus tard » : elle reste dans « À encaisser » (et peut aller dans la facture du mois).</p></div>`);
};
ACTIONS.pcLivrer = (el) => {
  const k = el.dataset.key, m = el.dataset.m, p = DB.get(k); if (!p) return;
  if (m === 'vente') { closeSheet(); pcVersVente(k); return; }
  const v = pcLivrerDirect(k, m);
  if (PC.retourTournee) ACTIONS.pcTournee(); else closeSheet();
  toast(`${nomContactPc(p)} : livrée${m === 'plustard' ? ', reste à encaisser' : m === 'twint' ? ', payée par TWINT' : ', payée en espèces'} (${chf(v.total)}).`, 4500);
};
/* La vente, sans passer par l'écran « Nouvelle vente » (le brouillon en cours est gardé de côté) */
function lignesVentePc(p) { return (p.lignes || []).map((l) => { const pr = DB.get(l.prod) || {}; return { produitId: l.prod, designation: pr.nom || '?', quantite: String(l.qte), unite: pr.unite || 'pièce', prix: prixLigne(Object.assign({ key: l.prod }, pr), l.prod), auto: true }; }); }
function pcLivrerDirect(k, moyen) {
  const p = DB.get(k), sauv = JSON.parse(JSON.stringify(draftF));
  viderBrouillon(); Object.assign(draftF, { clientId: p.contactId, facture: false, stock: true, moyen }); draftF.lignes = lignesVentePc(p);
  const d = factureDepuisBrouillon(), date = todayISO();
  const inv = Object.assign({}, d.inv, { lignes: d.lignes, date, cree: new Date().toISOString(), creePar: Sync.me || '', facture: false, stock: true, precommande: k, remarque: p.remarque ? 'Précommande · ' + p.remarque : 'Précommande' });
  inv.total = factureTotal(inv); delete inv.numero; delete inv.seq; delete inv.annee; delete inv.bulletin;
  Object.assign(inv, moyen === 'plustard' ? { paiement: 'virement', statut: 'ouverte', payeeLe: '', payeePar: '', encaissePar: '' } : { paiement: moyen === 'especes' ? 'especes' : 'virement', statut: 'payee', payeeLe: date, payeePar: moyen, encaissePar: Sync.me || '', echeance: date });
  const key = 'fac:' + uid('f'); DB.put(key, inv); stockPourVente(key, inv);
  Object.keys(draftF).forEach((x) => delete draftF[x]); Object.assign(draftF, sauv);
  DB.put(k, Object.assign({}, p, { statut: 'livree', vente: key, moyen, livreeLe: date }));
  /* Payée par TWINT et déjà enregistrée toute seule depuis le mail (vente directe) : on la rattache à cette vente, sans la compter deux fois */
  if (moyen === 'twint') {
    const tw = DB.all('tw:').find((t) => t.src === 'mail' && t.date === date && Math.abs(num(t.montant) - inv.total) < 0.005 && String(t.utilise || '').startsWith('rec:twm-'));
    if (tw) { DB.del(tw.utilise); DB.put(tw.key, Object.assign({}, DB.get(tw.key), { utilise: key })); }
  }
  return inv;
}
/* « Autre » : l'écran « Nouvelle vente » prérempli ; à l'enregistrement, la précommande passe en « livrée » */
function pcVersVente(k) {
  const p = DB.get(k); if (!p) return;
  viderBrouillon(); Object.assign(draftF, { clientId: p.contactId, facture: false, moyen: 'especes', precommande: k, remarque: p.remarque || '' }); draftF.lignes = lignesVentePc(p);
  go('#/factures/nouvelle'); toast('Vérifie et enregistre la vente.', 4000);
}
function pcVenteEnregistree(venteKey) {
  const k = draftF.precommande; if (!k) return; draftF.precommande = '';
  const p = DB.get(k); if (p) DB.put(k, Object.assign({}, p, { statut: 'livree', vente: venteKey, livreeLe: todayISO() }));
}

/* ---------- La tournée de livraison ---------- */
const cfgTournee = () => DB.get('cfg:tournee') || {};
const departTxt = () => { const s = cfg(); return [street(s), place(s)].filter(Boolean).join(', '); };
/* Par défaut : rangées par NPA, localité, rue, numéro (les mêmes quartiers ensemble) */
const cleRangement = (p) => { const c = contactPc(p) || {}; return [String(c.npa || '9999'), sansAccentsS(c.localite || 'zzz'), sansAccentsS(c.rue || 'zzz'), String(parseInt(c.numero, 10) || 0).padStart(5, '0')].join('|'); };
function ordreTournee() {
  const ouv = pcOuvertes(), o = cfgTournee().ordre || [], pos = new Map(o.map((k, i) => [k, i]));
  return ouv.slice().sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e6) - (pos.has(b.key) ? pos.get(b.key) : 1e6) || cleRangement(a).localeCompare(cleRangement(b)));
}
const distKm = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r, x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
async function geocoder(q) {
  const u = 'https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&limit=1&sr=4326&searchText=' + encodeURIComponent(q);
  const r = await fetch(u); if (!r.ok) throw new Error('géocodage ' + r.status);
  const j = await r.json(), a = (j.results && j.results[0] && j.results[0].attrs) || (j.features && j.features[0] && j.features[0].properties);
  return a && isFinite(a.lat) && isFinite(a.lon) ? { lat: Number(a.lat), lon: Number(a.lon), label: String(a.label || '').replace(/<[^>]+>/g, '') } : null;
}
/* Ordre le plus court (approché) : du plus proche au plus proche depuis la ferme, puis on décroise les trajets (2-opt), retour compris */
function meilleurOrdre(dep, pts) {
  const rest = pts.slice(), route = []; let cur = dep;
  while (rest.length) { let bi = 0, bd = Infinity; rest.forEach((x, i) => { const d = distKm(cur, x.g); if (d < bd) { bd = d; bi = i; } }); cur = rest[bi].g; route.push(rest.splice(bi, 1)[0]); }
  const P = (i) => (i < 0 || i >= route.length ? dep : route[i].g);
  for (let ameliore = true, n = 0; ameliore && n < 50; n++) {
    ameliore = false;
    for (let i = 0; i < route.length - 1; i++) for (let j = i + 1; j < route.length; j++) {
      const avant = distKm(P(i - 1), P(i)) + distKm(P(j), P(j + 1)), apres = distKm(P(i - 1), P(j)) + distKm(P(i), P(j + 1));
      if (apres < avant - 1e-6) { route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse()); ameliore = true; }
    }
  }
  let km = 0; for (let i = 0; i <= route.length; i++) km += distKm(P(i - 1), P(i));
  return { route, km };
}
ACTIONS.pcCalculer = async (el) => {
  if (el) { el.disabled = true; el.textContent = 'Calcul…'; }
  const ouv = pcOuvertes(), T = cfgTournee(); let erreurs = 0;
  try {
    let dep = T.depart && T.depart.q === departTxt() ? T.depart : null;
    if (!dep && departTxt()) { const g = await geocoder(departTxt()); if (g) dep = Object.assign({ q: departTxt() }, g); }
    const pts = [], sans = [];
    for (const p of ouv) {
      const c = contactPc(p); if (!adresseOk(c)) { sans.push(p); continue; }
      let g = c.geo && c.geo.q === adresseTxt(c) ? c.geo : null;
      if (!g) { try { const x = await geocoder(adresseTxt(c)); if (x) { g = Object.assign({ q: adresseTxt(c) }, x); sansAnnuler(() => DB.put(c.key, Object.assign({}, DB.get(c.key), { geo: g }))); } } catch (e) { erreurs++; } }
      if (g) pts.push({ p, g }); else sans.push(p);
    }
    if (!pts.length) throw new Error(erreurs ? 'le service des adresses ne répond pas (réseau ?)' : 'aucune adresse trouvée');
    const depart = dep || pts[0].g, { route, km } = meilleurOrdre(depart, pts);
    const ordre = route.map((x) => x.p.key).concat(sans.sort((a, b) => cleRangement(a).localeCompare(cleRangement(b))).map((p) => p.key));
    DB.put('cfg:tournee', Object.assign({}, T, { ordre, depart: dep || T.depart || null, calculeLe: new Date().toISOString(), km: Math.round(km) }));
    toast(`Ordre calculé : environ ${Math.round(km * 1.3)} km de route.${sans.length ? ` ${sans.length} adresse${sans.length > 1 ? 's' : ''} non trouvée${sans.length > 1 ? 's' : ''} (à la fin).` : ''}`, 6000);
  } catch (e) { toast('Calcul impossible : ' + e.message + '. Ordre par NPA et rue à la place.', 6000); }
  ACTIONS.pcTournee();
};
ACTIONS.pcMonter = (el) => {
  const l = ordreTournee().map((p) => p.key), i = l.indexOf(el.dataset.key), j = i + Number(el.dataset.d); if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; DB.put('cfg:tournee', Object.assign({}, cfgTournee(), { ordre: l })); ACTIONS.pcTournee();
};
ACTIONS.pcOrdreNpa = () => { DB.put('cfg:tournee', Object.assign({}, cfgTournee(), { ordre: [], calculeLe: '', km: 0 })); ACTIONS.pcTournee(); };
function aChargerTxt(l) { const o = {}; for (const p of l) for (const x of p.lignes || []) o[x.prod] = (o[x.prod] || 0) + num(x.qte); return Object.entries(o).map(([k, q]) => `${qteTxt(q, (DB.get(k) || {}).unite)} ${esc((DB.get(k) || { nom: '?' }).nom)}`).join(' · '); }
ACTIONS.pcTournee = () => {
  PC.retourTournee = true;
  const l = ordreTournee(), T = cfgTournee(), sansAdr = l.filter((p) => !adresseOk(contactPc(p))).length;
  if (!l.length) { PC.retourTournee = false; closeSheet(); toast('Tout est livré 🎉'); return; }
  openSheet(`${sheetHead('🚚 Tournée de livraison', `${l.length} arrêt${l.length > 1 ? 's' : ''} · à charger : ${aChargerTxt(l).replace(/<[^>]+>/g, '')}`)}<div class="sbody" data-tournee="1">
    <p class="hint">Départ : ${esc(departTxt() || 'adresse de la ferme à remplir dans Réglages')}. ${T.calculeLe ? `Ordre calculé le ${fmtDate(String(T.calculeLe).slice(0, 10))} (≈ ${Math.round(num(T.km) * 1.3)} km).` : 'Rangé par NPA et par rue ; « Calculer » cherche le trajet le plus court.'}</p>
    ${sansAdr ? `<p class="pc-alerte">⚠️ ${sansAdr} adresse${sansAdr > 1 ? 's' : ''} manquante${sansAdr > 1 ? 's' : ''} : touche le nom pour la compléter.</p>` : ''}
    <div class="row"><button class="btn primary small" type="button" data-act="pcCalculer">📍 Calculer le meilleur ordre</button><button class="btn small" type="button" data-act="pcImprimer">🖨 Imprimer la feuille</button>${T.calculeLe ? '<button class="btn small" type="button" data-act="pcOrdreNpa">Ranger par NPA</button>' : ''}</div>
    <ol class="pc-tournee">${l.map((p, i) => { const c = contactPc(p) || {}, ok = adresseOk(c), tel = String(c.telephone || '').match(/\+?\d[\d\s]{7,}\d/);
      return `<li><div class="pc-arret"><button type="button" class="pc-nom" data-act="pcEdit" data-key="${esc(p.key)}"><b>${esc(nomContactPc(p))}</b></button>${tel ? ` <a class="hint" href="tel:${esc(tel[0].replace(/[^+\d]/g, ''))}">${esc(c.telephone)}</a>` : ''}
        <div>${ok ? esc(adresseTxt(c)) : '<span class="bad">⚠️ adresse manquante</span>'}</div>
        <div class="hint">${quoiPc(p)} · ${chf(totalPc(p))}${p.remarque ? ' · 📝 ' + esc(p.remarque) : ''}</div></div>
        <div class="pc-arret-act"><button class="btn small" type="button" data-act="pcMonter" data-key="${esc(p.key)}" data-d="-1" aria-label="Monter"${i ? '' : ' disabled'}>↑</button><button class="btn small" type="button" data-act="pcMonter" data-key="${esc(p.key)}" data-d="1" aria-label="Descendre"${i < l.length - 1 ? '' : ' disabled'}>↓</button><button class="btn small primary" type="button" data-act="pcLivree" data-key="${esc(p.key)}">✓ Livrée</button></div></li>`; }).join('')}</ol>
    ${itinerairesHtml(l)}</div>`);
};
/* Itinéraire dans Google Maps, par étapes de 9 arrêts (limite des liens) */
function itinerairesHtml(l) {
  const adr = l.filter((p) => adresseOk(contactPc(p))).map((p) => adresseTxt(contactPc(p))); if (!adr.length) return '';
  const dep = departTxt(), liens = [];
  for (let i = 0; i < adr.length; i += 9) {
    const morceau = adr.slice(i, i + 9), origine = i === 0 ? dep : adr[i - 1], fin = i + 9 >= adr.length && dep ? dep : morceau[morceau.length - 1];
    const ways = i + 9 >= adr.length && dep ? morceau : morceau.slice(0, -1);
    liens.push(`<a class="btn small" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&travelmode=driving${origine ? '&origin=' + encodeURIComponent(origine) : ''}&destination=${encodeURIComponent(fin)}${ways.length ? '&waypoints=' + encodeURIComponent(ways.join('|')) : ''}">🗺 ${adr.length > 9 ? `Arrêts ${i + 1}–${i + morceau.length}` : 'Itinéraire dans Google Maps'}</a>`);
  }
  return `<div class="row" style="margin-top:10px">${liens.join('')}</div>`;
}
/* La feuille à imprimer : une page propre, ouverte à part */
ACTIONS.pcImprimer = () => {
  const l = ordreTournee(), s = cfg(), tot = l.reduce((a, p) => a + totalPc(p), 0);
  const lignes = l.map((p, i) => { const c = contactPc(p) || {}; return `<tr><td class="n">${i + 1}</td><td><b>${esc(nomContactPc(p))}</b>${c.telephone ? `<br>${esc(c.telephone)}` : ''}</td><td>${adresseOk(c) ? `${esc(street(c))}<br>${esc(place(c))}` : '<b>⚠ adresse manquante</b>'}</td><td>${quoiPc(p)}</td><td class="r">${money(totalPc(p))}</td><td>${esc(p.remarque || '')}</td><td class="ck">☐</td></tr>`; }).join('');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tournée de livraison</title><style>
    body{font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0 8px}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #bbb;padding:6px 5px;vertical-align:top;text-align:left}th{font-size:11px;text-transform:uppercase;color:#555;border-bottom:2px solid #333}
    td.n{font-weight:700;font-size:14px;width:22px}td.r,th.r{text-align:right;white-space:nowrap}td.ck{font-size:18px;width:26px;text-align:center}tr{page-break-inside:avoid}
    .charge{border:1px solid #333;padding:6px 8px;display:inline-block;margin-top:4px}@page{size:A4;margin:12mm}@media print{body{margin:0}.noprint{display:none}}</style></head><body>
    <h1>Tournée de livraison · ${esc(s.nom || 'Gamins de Talus')}</h1><p>${fmtDate(todayISO())} · ${l.length} arrêts${departTxt() ? ' · départ : ' + esc(departTxt()) : ''}</p>
    <div class="charge"><b>À charger :</b> ${aChargerTxt(l)} · à encaisser au plus : <b>${chf(tot)}</b></div>
    <table><thead><tr><th>#</th><th>Client</th><th>Adresse</th><th>Quoi</th><th class="r">CHF</th><th>Remarque</th><th>✓</th></tr></thead><tbody>${lignes}</tbody></table>
    <p class="noprint" style="margin-top:16px"><button onclick="print()">Imprimer</button></p><script>setTimeout(function(){print()},300)<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); } else downloadFile('Tournée de livraison ' + todayISO() + '.html', html, 'text/html;charset=utf-8');
};
/* Fermer la tournée : ne plus y revenir après « Livrée » */
new MutationObserver(() => { if ($('scrim') && $('scrim').hidden) PC.retourTournee = false; }).observe(document.getElementById('scrim') || document.body, { attributes: true, attributeFilter: ['hidden'] });
