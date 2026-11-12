/* Gamins de Talus — précommandes (ventes spéciales : biscômes, cacahuètes…), dans Ventes → Précommandes.
   pcmd:<id> = { contactId, lignes: [{ prod, qte }], retrait (date prévue), qui (qui s'en occupe), remarque,
                 statut: 'reservee' | 'livree' | 'annulee', vente (clé fac: une fois livrée), cree, creePar }
   Le stock ne bouge qu'à la livraison : « Livrer » prépare une vente normale (stock, prix, recette, facture si besoin).
   En attendant, chaque produit montre : en stock, réservé, encore libre. */
'use strict';

const PC = { lignes: null, voirLivrees: false };
const precommandes = () => DB.all('pcmd:').sort((a, b) => String(a.retrait || '9999').localeCompare(String(b.retrait || '9999')) || String(a.cree).localeCompare(String(b.cree)));
const pcOuvertes = () => precommandes().filter((p) => p.statut === 'reservee');
const nomContactPc = (p) => { const c = DB.get(p.contactId); return c ? displayName(Object.assign({ key: p.contactId }, c)) : '(contact supprimé)'; };
const prixPc = (prodKey, contactId) => { const p = DB.get(prodKey); if (!p) return 0; const pc = typeof prixClient === 'function' ? prixClient(contactId, prodKey) : null; if (pc) return num(pc.prix); const c = DB.get(contactId); return num(prixPour(p, c ? (c.type || 'autre') : 'particulier')); };
const totalPc = (p) => r2((p.lignes || []).reduce((a, l) => a + num(l.qte) * prixPc(l.prod, p.contactId), 0));
const qteTxt = (q, u) => `${fmtQty(r2(q))} ${u === 'pièce' ? 'pc' : esc(u || '')}`.trim();
/* Ce qui est réservé, par produit (précommandes pas encore livrées) */
function reserves() { const o = {}; for (const p of pcOuvertes()) for (const l of p.lignes || []) o[l.prod] = (o[l.prod] || 0) + num(l.qte); return o; }

function renderPrecommandes() {
  const ouv = pcOuvertes(), res = reserves(), autres = precommandes().filter((p) => p.statut !== 'reservee').reverse();
  const prods = Object.keys(res).map((k) => Object.assign({ key: k }, DB.get(k) || { nom: '?' }));
  const resume = prods.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th class="r">En stock</th><th class="r">Réservé</th><th class="r">Encore libre</th></tr></thead><tbody>${prods.map((p) => {
    const st = typeof stockDe === 'function' ? stockDe(p.key) : null, libre = st == null ? null : r2(num(st) - res[p.key]);
    return `<tr><td>${esc(p.nom)}</td><td class="r num">${st == null ? '<span class="hint">pas compté</span>' : qteTxt(st, p.unite)}</td><td class="r num">${qteTxt(res[p.key], p.unite)}</td><td class="r num${libre != null && libre < 0 ? ' bad' : ''}"><b>${libre == null ? '—' : qteTxt(libre, p.unite)}</b>${libre != null && libre < 0 ? ' ⚠️' : ''}</td></tr>`;
  }).join('')}</tbody></table></div>` : '';
  const carte = (p) => `<button type="button" class="item" data-act="pcEdit" data-key="${esc(p.key)}"><span class="who"><strong>${esc(nomContactPc(p))}</strong><span class="meta">${(p.lignes || []).map((l) => `${qteTxt(l.qte, (DB.get(l.prod) || {}).unite)} ${esc((DB.get(l.prod) || { nom: '?' }).nom)}`).join(' · ')}${p.qui ? ` · 👤 ${esc(p.qui === Sync.me ? 'toi' : nomDe(p.qui))}` : ''}${p.remarque ? ' · 📝' : ''}</span></span>
    <span class="num">${p.statut === 'reservee' ? (p.retrait ? `<span class="${p.retrait < todayISO() ? 'bad' : ''}">${fmtDateCourt(p.retrait)}</span>` : '<span class="hint">date ?</span>') : p.statut === 'livree' ? '<span class="pill payee">livrée</span>' : '<span class="pill annulee">annulée</span>'}<br>${chf(totalPc(p))}</span></button>`;
  return `<div class="panel"><div class="between"><h2>Précommandes</h2><button class="btn primary small" type="button" data-act="pcEdit">+ Précommande</button></div>
    <p class="hint">Pour une vente spéciale (biscômes, cacahuètes…) : note qui commande quoi. Le stock du produit montre ce qui est déjà réservé ; à la remise, « Livrer » enregistre la vente (stock, prix, recette).</p>
    ${resume}
    <h3>À livrer${ouv.length ? ` · ${ouv.length} · ${chf(ouv.reduce((a, p) => a + totalPc(p), 0))}` : ''}</h3>
    ${ouv.length ? `<div class="items">${ouv.map(carte).join('')}</div>` : '<p class="empty">Aucune précommande en attente.</p>'}
    ${autres.length ? `<button type="button" class="btn link small" data-act="pcLivrees">${PC.voirLivrees ? 'Cacher' : 'Voir'} les livrées et annulées (${autres.length})</button>${PC.voirLivrees ? `<div class="items">${autres.slice(0, 100).map(carte).join('')}</div>` : ''}` : ''}</div>`;
}
ACTIONS.pcLivrees = () => { PC.voirLivrees = !PC.voirLivrees; render(); };

/* ---------- La fiche (nouvelle ou existante) ---------- */
function pcLignesForm() { const f = $('pc-form'); if (!f) return null; return [...f.querySelectorAll('.pc-ligne')].map((r) => ({ prod: r.querySelector('select').value, qte: r.querySelector('input').value })); }
function pcFeuille(k, garder) {
  const p = k ? DB.get(k) : null, o = p || { contactId: '', lignes: [], retrait: '', qui: Sync.me || '', remarque: '', statut: 'reservee' };
  if (!garder) PC.lignes = (o.lignes || []).map((l) => ({ prod: l.prod, qte: l.qte }));
  if (!PC.lignes.length) PC.lignes.push({ prod: '', qte: '' });
  const ps = produits(), res = reserves(), cl = contacts().sort(byName);
  const optP = (v) => `<option value="">Choisir…</option>${ps.map((x) => { const st = typeof stockDe === 'function' ? stockDe(x.key) : null, libre = st == null ? '' : ` · libre ${fmtQty(r2(num(st) - (res[x.key] || 0)))}`; return `<option value="${esc(x.key)}"${x.key === v ? ' selected' : ''}>${esc(x.nom)}${esc(libre)}</option>`; }).join('')}`;
  openSheet(`${sheetHead(k ? 'Précommande' : 'Nouvelle précommande', p ? `${p.statut === 'livree' ? 'livrée' : p.statut === 'annulee' ? 'annulée' : 'à livrer'} · notée par ${nomDe(p.creePar)}` : '')}
    <form class="sbody form" data-form="pc" id="pc-form"><input type="hidden" name="key" value="${esc(k || '')}">
    ${sel('pc-contact', 'Pour qui (contact)', o.contactId, [['', '➕ Nouveau contact…']].concat(cl.map((c) => [c.key, displayName(c)])), { name: 'contactId' })}
    <div id="pc-nouveau"${o.contactId ? ' hidden' : ''}><div class="grid2">${inp('pc-nom', 'Nom', '', { name: 'nom', attrs: { placeholder: 'Prénom Nom' } })}${inp('pc-tel', 'Téléphone', '', { name: 'tel', type: 'tel' })}</div></div>
    <div class="field"><span class="flabel">Quoi</span>
      ${PC.lignes.map((l, i) => `<div class="row pc-ligne"><select aria-label="Produit" name="p_${i}">${optP(l.prod)}</select><input class="cell-in" name="q_${i}" inputmode="decimal" placeholder="Qté" value="${esc(l.qte ?? '')}" style="width:70px">${PC.lignes.length > 1 ? `<button type="button" class="btn small" data-act="pcLigneOff" data-i="${i}" data-key="${esc(k || '')}" aria-label="Retirer">×</button>` : ''}</div>`).join('')}
      <button type="button" class="btn link small" data-act="pcLigne" data-key="${esc(k || '')}">+ un autre produit</button>
      <span class="sub">Un produit qui manque ? Ajoute-le dans <a href="#/factures/stock" data-act="closeGo" data-href="#/factures/stock">Stock et prix</a> (par ex. « Biscôme 500 g », à la pièce), avec son stock.</span></div>
    <div class="grid2">${inp('pc-retrait', 'Retrait ou livraison prévu le', o.retrait, { name: 'retrait', type: 'date' })}${sel('pc-qui', "Qui s'en occupe", o.qui || '', [['', 'Personne en particulier']].concat(persOptions()), { name: 'qui' })}</div>
    ${txt('pc-rem', 'Remarque', o.remarque, { name: 'remarque', rows: 2 })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette précommande">Supprimer</button>` : ''}
      ${p && p.statut === 'reservee' ? `<button class="btn" type="button" data-act="pcStatut" data-key="${esc(k)}" data-s="annulee">Annulée</button>` : ''}
      ${p && p.statut !== 'reservee' ? `<button class="btn" type="button" data-act="pcStatut" data-key="${esc(k)}" data-s="reservee">Remettre à livrer</button>` : ''}
      ${p && p.vente && DB.get(p.vente) ? `<a class="btn" href="#/factures/voir/${encodeURIComponent(p.vente)}" data-act="closeGo" data-href="#/factures/voir/${encodeURIComponent(p.vente)}">Voir la vente</a>` : ''}
      <button class="btn${p && p.statut === 'reservee' ? '' : ' primary'}" type="submit">Enregistrer</button>
      ${!p || p.statut === 'reservee' ? `<button class="btn primary" type="submit" name="ensuite" value="livrer">Livrer → vente</button>` : ''}</div></form>`);
  const s = $('pc-contact'); if (s) s.addEventListener('change', () => { $('pc-nouveau').hidden = !!s.value; });
}
ACTIONS.pcEdit = (el) => pcFeuille(el.dataset.key || '');
/* Ajouter / retirer une ligne sans perdre ce qui est déjà rempli */
const pcRelire = () => { const l = pcLignesForm(); if (l) PC.lignes = l; };
const pcRouvrir = (k) => { const f = $('pc-form'), v = f ? formValues(f) : {}; pcFeuille(k, true); for (const [n, x] of Object.entries(v)) { const e = $('pc-form') && $('pc-form').elements[n]; if (e && !/^[pq]_/.test(n) && n !== 'key') e.value = x; } const s = $('pc-contact'); if (s) $('pc-nouveau').hidden = !!s.value; };
ACTIONS.pcLigne = (el) => { pcRelire(); PC.lignes.push({ prod: '', qte: '' }); pcRouvrir(el.dataset.key); };
ACTIONS.pcLigneOff = (el) => { pcRelire(); PC.lignes.splice(Number(el.dataset.i), 1); pcRouvrir(el.dataset.key); };
ACTIONS.pcStatut = (el) => { const p = DB.get(el.dataset.key); if (!p) return; DB.put(el.dataset.key, Object.assign({}, p, { statut: el.dataset.s })); closeSheet(); toast(el.dataset.s === 'annulee' ? 'Précommande annulée : sa réservation est libérée.' : 'Remise à livrer.'); };
FORMS.pc = (v, form) => {
  const lignes = [...form.querySelectorAll('.pc-ligne')].map((r) => ({ prod: r.querySelector('select').value, qte: r2(num(r.querySelector('input').value)) })).filter((l) => l.prod && l.qte > 0);
  if (!lignes.length) { toast('Choisis au moins un produit et sa quantité.'); return; }
  let ck = v.contactId;
  if (!ck) {
    const nom = String(v.nom || '').trim(); if (!nom) { toast('Choisis le contact, ou écris le nom du nouveau.'); return; }
    ck = 'ct:' + uid('c'); DB.put(ck, { nom, telephone: String(v.tel || '').trim(), type: 'particulier', notes: 'Créé depuis une précommande.', cree: new Date().toISOString() });
  }
  const k = v.key || 'pcmd:' + uid('p'), old = DB.get(k) || { statut: 'reservee', cree: new Date().toISOString(), creePar: Sync.me || '' };
  const o = Object.assign({}, old, { contactId: ck, lignes, retrait: v.retrait || '', qui: v.qui || '', remarque: String(v.remarque || '').trim() });
  DB.put(k, o); PC.lignes = null;
  if (v.ensuite === 'livrer') { closeSheet(); pcLivrer(k); return; }
  closeSheet(); toast(v.key ? 'Précommande mise à jour.' : 'Précommande notée.');
};
/* Livrer : une vente normale est préparée (client, produits, prix) ; à l'enregistrement, la précommande passe en « livrée » */
function pcLivrer(k) {
  const p = DB.get(k); if (!p) return;
  viderBrouillon();
  draftF.clientId = p.contactId; draftF.facture = false; draftF.moyen = 'especes'; draftF.precommande = k; draftF.remarque = p.remarque || '';
  draftF.lignes = (p.lignes || []).map((l) => { const pr = DB.get(l.prod) || {}; return { produitId: l.prod, designation: pr.nom || '?', quantite: String(l.qte), unite: pr.unite || 'pièce', prix: prixLigne(Object.assign({ key: l.prod }, pr), l.prod), auto: true }; });
  go('#/factures/nouvelle'); toast('Vérifie le paiement (espèces, TWINT…) puis enregistre la vente.', 5000);
}
ACTIONS.pcLivrer = (el) => pcLivrer(el.dataset.key);
/* Appelée par creerVente une fois la vente enregistrée */
function pcVenteEnregistree(venteKey) {
  const k = draftF.precommande; if (!k) return; draftF.precommande = '';
  const p = DB.get(k); if (p) DB.put(k, Object.assign({}, p, { statut: 'livree', vente: venteKey, livreeLe: todayISO() }));
}
