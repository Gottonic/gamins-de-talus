/* Gamins de Talus — stock, récoltes et vente directe (self-service).
   Le stock d'un produit n'est jamais une case qu'on écrase : c'est la somme de ses mouvements, chacun une ligne à part
   (deux personnes peuvent noter en même temps sans s'écraser).
   mvt:<id>   { date, prod, qte (+ entrée / − sortie, dans l'unité du produit), type, culture?, ref?, par, note?, horsStock? }
              type : recolte | vente | self (mis au stand) | retour (invendus repris) | perte | ajout | inventaire (compte : qte = total)
              Clés fixes pour ce qui découle d'autre chose : mvt:fac:<facture>:<ligne>, mvt:self:<mise>:<ligne>, mvt:ev:<événement>:<date>.
   prod:<id>  + { fiche (culture liée), dispo (en stock sans quantité), auChamp, direct: { prix, unite } (vente directe) }
   self:<id>  mise en vente directe { date, lieu, lignes: [{ prod, qte, prix }], retours: { i: qte }, statut: ouverte | close, note }
              Les encaissements sont des recettes (rec:) avec self: <id> : ils comptent dans les finances. */
'use strict';

const mouvements = () => DB.all('mvt:');
const misesEnVente = () => DB.all('self:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
const STK = { voirTout: false };
const TYPES_MVT = { recolte: 'Récolte', vente: 'Vente', self: 'Mis en vente directe', retour: 'Invendus repris', perte: 'Perte', ajout: 'Ajout', inventaire: 'Compté' };

/* Quantité en stock : dernier comptage + mouvements suivants. null = quantité pas suivie. */
function stockDe(prodKey, ms) {
  const l = (ms || mouvements()).filter((m) => m.prod === prodKey && !m.horsStock).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.cree || '').localeCompare(String(b.cree || '')));
  if (!l.length) return null;
  let q = 0; for (const m of l) q = m.type === 'inventaire' ? num(m.qte) : q + num(m.qte);
  return Math.round(q * 1000) / 1000;
}
const produitDeCulture = (c) => { if (!c) return null; const fk = typeof ficheDe === 'function' ? ficheDe(c) : ''; const n = sansAccentsS(c.nom); return produits().find((p) => p.fiche && p.fiche === fk) || produits().find((p) => sansAccentsS(p.nom) === n || sansAccentsS(p.nom).startsWith(n)) || null; };
const sansAccentsS = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fmtQ = (q, u) => (q == null ? '' : `${fmtNum(q, Number.isInteger(q) ? 0 : 1)} ${u || ''}`.trim());

/* Récoltes d'une culture : récoltes notées (stock ou non) + kg notés au calendrier sans mouvement lié (anciennes saisies) */
function recoltesDeCulture(cultureKey) {
  let kg = 0; const vus = new Set();
  for (const m of mouvements()) if (m.type === 'recolte' && m.culture === cultureKey) { kg += num(m.qte); if (m.ref) vus.add(m.ref); }
  if (typeof evenements === 'function') for (const e of evenements()) if (e.type === 'recolte' && e.cultureId === cultureKey) for (const [d, o] of Object.entries(e.occ || {})) if (!vus.has('ev:' + e.key + ':' + d)) kg += num(o.kg);
  return kg;
}

/* ---------- Onglet « Stock et prix » ---------- */
function renderStock() {
  const ps = produits(), ms = mouvements();
  const st = ps.map((p) => ({ p, q: stockDe(p.key, ms) }));
  const enStock = st.filter((x) => (x.q != null && x.q > 0) || x.p.dispo || x.p.auChamp);
  const prix = (p) => [fourchette(p) ? `fourchette ${fourchette(p)}` : '', ...TARIFS.filter(([k]) => !vide((p.prixParType || {})[k])).map(([k, l]) => `${l.replace(/ \(.*\)/, '')} ${money(p.prixParType[k])}`), p.direct && p.direct.prix ? `vente directe ${money(p.direct.prix)} / ${esc(p.direct.unite || p.unite)}` : ''].filter(Boolean).join(' · ');
  const ligne = ({ p, q }) => `<div class="stk${q != null && q < 0 ? ' neg' : ''}">
      <div class="stk-nom"><b>${esc(p.nom)}</b>${p.auChamp ? ' <span class="tpill champ">🌱 au champ</span>' : ''}${p.dispo && (q == null || q <= 0) ? ' <span class="tpill">disponible</span>' : ''}<br><span class="hint">${prix(p) || 'Prix à définir'}</span></div>
      <div class="stk-q num">${q != null ? fmtQ(q, p.unite) : '—'}</div>
      <div class="row stk-act"><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="recolte">+ Récolte</button><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="perte">− Sortie</button><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="inventaire">Compter</button><button class="btn small" type="button" data-act="stkHist" data-prod="${esc(p.key)}" aria-label="Historique">⋯</button></div></div>`;
  const recents = ms.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || ''))).slice(0, 8);
  return `<div class="row"><button class="btn primary" type="button" data-act="mvtNouveau" data-type="recolte">+ Noter une récolte</button><a class="btn" href="#/factures/selfservice">Vente directe (self-service)</a></div>
    <div class="split">
      <div class="panel"><h2>En stock${enStock.length ? ' · ' + enStock.length : ''}</h2>
        ${enStock.length ? enStock.map(ligne).join('') : '<p class="empty">Rien en stock. Note une récolte, ou marque un produit « disponible » ou « au champ » dans la liste plus bas.</p>'}
        <p class="hint">Quantité « — » : pas suivie (produit simplement disponible) ; les ventes ne la font pas baisser. « Compter » fixe la quantité réelle ; ensuite récoltes et ventes la font bouger.</p></div>
      <div class="panel"><h2>Derniers mouvements</h2>${recents.length ? `<div class="items">${recents.map((m) => { const p = DB.get(m.prod) || {}; return `<div class="item" style="cursor:default"><span class="who"><strong>${esc(p.nom || '?')} · ${esc(TYPES_MVT[m.type] || m.type)}</strong><span class="meta">${fmtDate(m.date)}${m.par ? ' · ' + esc(nomDe(m.par)) : ''}${m.horsStock ? ' · pas compté dans le stock' : ''}${m.note ? ' · ' + esc(m.note) : ''}</span></span><span class="amt">${m.type === 'inventaire' ? '= ' : num(m.qte) > 0 ? '+' : ''}${fmtQ(num(m.qte), p.unite)}</span></div>`; }).join('')}</div>` : '<p class="empty">Aucun mouvement.</p>'}</div>
    </div>
    <div class="panel"><div class="between"><h2>Tous les produits</h2><button class="btn primary small" type="button" data-act="prodEdit">+ Produit</button></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th>Unité</th><th class="r">Stock</th><th>Disponible</th><th>Au champ</th></tr></thead><tbody>
      ${st.map(({ p, q }) => `<tr><td><a href="#" data-act="prodEdit" data-key="${esc(p.key)}">${esc(p.nom)}</a>${p.fiche && DB.get(p.fiche) ? ` <span class="hint">· ${esc(DB.get(p.fiche).nom)}</span>` : ''}</td><td>${esc(p.unite || '')}</td><td class="r num">${q != null ? fmtQ(q, '') : '—'}</td>
        <td><input type="checkbox" data-stk="dispo" data-key="${esc(p.key)}"${p.dispo ? ' checked' : ''} aria-label="${esc(p.nom)} disponible"></td><td><input type="checkbox" data-stk="auChamp" data-key="${esc(p.key)}"${p.auChamp ? ' checked' : ''} aria-label="${esc(p.nom)} au champ"></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aucun produit.</td></tr>'}
      </tbody></table></div>
      <p class="hint">Touche un produit pour ses prix (fourchette, par type de client, vente directe) et la culture dont il vient. Les prix s'affichent en haut dès qu'il y a du stock.</p></div>`;
}
function brancherStock() {
  $('view').querySelectorAll('input[data-stk]').forEach((el) => el.addEventListener('change', () => { const p = DB.get(el.dataset.key); if (p) DB.put(el.dataset.key, Object.assign({}, p, { [el.dataset.stk]: el.checked })); }));
}

/* Noter un mouvement : récolte, sortie (perte), comptage */
ACTIONS.mvtNouveau = (el) => {
  const type = el.dataset.type || 'recolte', s = typeof saisonCourante === 'function' ? saisonCourante() : todayISO().slice(0, 4);
  const culs = typeof cultures === 'function' ? cultures(s) : [];
  let prod = el.dataset.prod || '', cul = el.dataset.culture || '';
  if (!prod && cul) { const p = produitDeCulture(DB.get(cul)); if (p) prod = p.key; }
  if (prod && !cul && type === 'recolte') { const p = DB.get(prod), c = culs.find((x) => p && ((p.fiche && ficheDe(x) === p.fiche) || sansAccentsS(x.nom) === sansAccentsS(p.nom))); if (c) cul = c.key; }
  const titres = { recolte: 'Noter une récolte', perte: 'Sortie de stock', inventaire: 'Compter le stock', ajout: 'Ajouter au stock' };
  openSheet(`${sheetHead(titres[type] || 'Mouvement de stock')}<form class="sbody form" data-form="mvt"><input type="hidden" name="type" value="${esc(type)}">
    <div class="grid2">${inp('mv-date', 'Date', todayISO(), { name: 'date', type: 'date' })}
      ${type === 'recolte' ? sel('mv-cul', `Culture (plan ${s})`, cul, [['', '—']].concat(culs.map((c) => [c.key, c.nom])), { name: 'culture' }) : ''}
      ${sel('mv-prod', 'Produit', prod, [['', type === 'recolte' ? '— (pas de produit)' : 'Choisir…']].concat(produits().map((p) => [p.key, p.nom + ' (' + (p.unite || '') + ')'])), { name: 'prod' })}
      ${inp('mv-q', type === 'inventaire' ? 'Quantité comptée' : 'Quantité', '', { name: 'qte', type: 'number', attrs: { autofocus: '' } })}</div>
    ${type === 'recolte' ? `<label class="row" style="font-size:14px"><input type="checkbox" name="enStock" checked> Ajouter au stock</label><p class="hint">La récolte compte aussi dans la récolte réelle de la culture (Cultures). Sans produit, elle n'entre pas dans le stock.</p>` : ''}
    ${type === 'perte' ? `<p class="hint">Abîmé, mangé, donné… Pour une vente, passe plutôt par « Nouvelle vente » : le stock baisse tout seul.</p>` : ''}
    ${inp('mv-note', 'Note', '', { name: 'note', attrs: { placeholder: 'facultatif' } })}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const cs = $('mv-cul'); if (cs) cs.addEventListener('change', () => { const p = produitDeCulture(DB.get(cs.value)); if (p) $('mv-prod').value = p.key; });
};
FORMS.mvt = (v) => {
  const q = num(v.qte); if (!(q > 0) && !(v.type === 'inventaire' && v.qte !== '')) { toast('Indique une quantité.'); return; }
  if (v.type !== 'recolte' && !v.prod) { toast('Choisis le produit.'); return; }
  if (v.type === 'recolte' && !v.prod && !v.culture) { toast('Choisis une culture ou un produit.'); return; }
  const o = { date: v.date || todayISO(), prod: v.prod || '', qte: v.type === 'perte' ? -q : q, type: v.type, par: Sync.me || '', note: v.note || '', cree: new Date().toISOString() };
  if (v.culture) o.culture = v.culture;
  if (v.type === 'recolte' && (!v.enStock || !v.prod)) o.horsStock = true;
  DB.put('mvt:' + uid('m'), o); closeSheet();
  const p = DB.get(v.prod); toast(v.type === 'recolte' ? `Récolte notée${o.horsStock ? '' : ' et ajoutée au stock'}.` : v.type === 'inventaire' ? `Stock de ${p ? p.nom : ''} : ${fmtQ(q, p && p.unite)}.` : 'Enregistré.');
};
ACTIONS.stkHist = (el) => {
  const p = DB.get(el.dataset.prod); if (!p) return;
  const l = mouvements().filter((m) => m.prod === el.dataset.prod).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  openSheet(`${sheetHead(p.nom, 'Stock : ' + (stockDe(el.dataset.prod) == null ? 'non suivi' : fmtQ(stockDe(el.dataset.prod), p.unite)))}<div class="sbody">
    ${l.length ? `<div class="items">${l.slice(0, 60).map((m) => `<div class="item" style="cursor:default"><span class="who"><strong>${esc(TYPES_MVT[m.type] || m.type)}</strong><span class="meta">${fmtDate(m.date)}${m.par ? ' · ' + esc(nomDe(m.par)) : ''}${m.note ? ' · ' + esc(m.note) : ''}${m.horsStock ? ' · hors stock' : ''}</span></span><span class="amt">${m.type === 'inventaire' ? '= ' : num(m.qte) > 0 ? '+' : ''}${fmtQ(num(m.qte), p.unite)}</span>${!String(m.key).match(/^mvt:(fac|self|ev):/) ? `<button class="btn small" type="button" data-act="delItem" data-key="${esc(m.key)}" data-what="ce mouvement">×</button>` : ''}</div>`).join('')}</div>` : '<p class="empty">Aucun mouvement.</p>'}
    <div class="row-end"><button class="btn" type="button" data-act="prodEdit" data-key="${esc(el.dataset.prod)}">Modifier le produit</button></div></div>`);
};

/* ---------- Ventes → stock ---------- */
/* Une vente (facture ou non) fait baisser le stock des produits suivis ; les lignes de mouvement suivent la vente. */
function stockPourVente(facKey, f) {
  const avant = mouvements().filter((m) => String(m.key).startsWith('mvt:fac:' + facKey + ':'));
  const garder = new Set();
  if (f && f.stock && f.statut !== 'annulee') {
    (f.lignes || []).forEach((l, i) => {
      if (!l.produitId || !(num(l.quantite) > 0) || stockDe(l.produitId) == null) return;
      const p = DB.get(l.produitId); if (!p || (l.unite && p.unite && l.unite !== p.unite)) return;
      const k = 'mvt:fac:' + facKey + ':' + i; garder.add(k);
      DB.put(k, { date: f.livraison || f.date, prod: l.produitId, qte: -num(l.quantite), type: 'vente', ref: facKey, par: f.creePar || Sync.me || '', note: f.client ? f.client.nom : '' });
    });
  }
  for (const m of avant) if (!garder.has(m.key)) DB.del(m.key);
}

/* ---------- Vente directe (self-service) ---------- */
function bilanSelf(s) {
  const ls = s.lignes || [], ret = s.retours || {};
  const mis = ls.reduce((a, l) => a + num(l.qte) * num(l.prix), 0);
  const vendu = ls.reduce((a, l, i) => a + Math.max(0, num(l.qte) - num(ret[i])) * num(l.prix), 0);
  const enc = recettesDirectes().filter((r) => r.self === s.key).reduce((a, r) => a + num(r.montant), 0);
  return { mis, vendu, enc, ecart: vendu - enc, taux: vendu > 0 ? (vendu - enc) / vendu : 0 };
}
function renderSelfService() {
  const l = misesEnVente(), ouv = l.filter((s) => s.statut !== 'close'), clo = l.filter((s) => s.statut === 'close');
  const tot = clo.reduce((a, s) => { const b = bilanSelf(Object.assign({ key: s.key }, s)); return { v: a.v + b.vendu, e: a.e + b.enc }; }, { v: 0, e: 0 });
  const carte = (s) => {
    const b = bilanSelf(s), recs = recettesDirectes().filter((r) => r.self === s.key).sort((a, c) => String(a.date).localeCompare(c.date));
    return `<div class="panel self${s.statut === 'close' ? ' close' : ''}"><div class="between"><h3 style="margin:0">${esc(s.lieu || 'Self-service')} · ${fmtDate(s.date)}</h3><span class="tpill">${s.statut === 'close' ? 'bouclée' : 'en cours'}</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th class="r">Mis</th><th class="r">Prix</th>${s.statut === 'close' ? '<th class="r">Invendus</th><th class="r">Vendus</th>' : ''}<th class="r">Valeur</th></tr></thead><tbody>
      ${(s.lignes || []).map((x, i) => { const p = DB.get(x.prod) || {}, r = num((s.retours || {})[i]), v = Math.max(0, num(x.qte) - r); return `<tr><td>${esc(p.nom || '?')}</td><td class="r num">${fmtQ(num(x.qte), x.unite || (p.direct && p.direct.unite) || p.unite)}</td><td class="r num">${money(x.prix)}</td>${s.statut === 'close' ? `<td class="r num">${fmtNum(r, 0)}</td><td class="r num">${fmtNum(v, 0)}</td>` : ''}<td class="r num">${money((s.statut === 'close' ? v : num(x.qte)) * num(x.prix))}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p>Encaissé : <b>${chf(b.enc)}</b>${s.statut === 'close' ? ` sur ${chf(b.vendu)} vendus · <b class="${b.taux > 0.1 ? 'bad' : ''}">${b.ecart > 0 ? `${chf(b.ecart)} manquants (${Math.round(b.taux * 100)} %)` : 'rien ne manque'}</b>` : ` · au plus ${chf(b.mis)} si tout part`}</p>
      ${recs.length ? `<p class="hint">${recs.map((r) => `${fmtDate(r.date)} ${esc(r.moyen || '')} ${money(r.montant)}`).join(' · ')}</p>` : ''}
      <div class="row">${s.statut !== 'close' ? `<button class="btn primary small" type="button" data-act="selfEnc" data-key="${esc(s.key)}">+ Encaissement</button><button class="btn small" type="button" data-act="selfClore" data-key="${esc(s.key)}">Boucler (invendus)</button>` : `<button class="btn small" type="button" data-act="selfRouvrir" data-key="${esc(s.key)}">Rouvrir</button>`}<button class="btn small" type="button" data-act="delItem" data-key="${esc(s.key)}" data-what="cette mise en vente">Supprimer</button></div></div>`;
  };
  return `<div class="row"><button class="btn primary" type="button" data-act="selfNouveau">+ Mise en vente directe</button></div>
    <div class="stats"><div class="stat"><span class="k">Ventes directes bouclées</span><span class="v">${clo.length}</span></div>
      <div class="stat good"><span class="k">Vendu (selon les invendus)</span><span class="v">${chf(tot.v)}</span></div>
      <div class="stat blue"><span class="k">Encaissé (TWINT, espèces)</span><span class="v">${chf(tot.e)}</span></div>
      <div class="stat ${tot.v && (tot.v - tot.e) / tot.v > 0.1 ? 'bad' : ''}"><span class="k">Manque (vol, erreurs)</span><span class="v">${tot.v ? Math.round(Math.max(0, tot.v - tot.e) / tot.v * 100) + ' %' : '—'}</span><span class="s">${chf(Math.max(0, tot.v - tot.e))}</span></div></div>
    <p class="hint">1. « Mise en vente » : ce qui part au stand, au prix de vente directe (le stock baisse). 2. « Encaissement » à chaque relevé TWINT ou de la caisse : il entre dans les recettes. 3. « Boucler » : on compte les invendus (ils reviennent au stock) et l'app compare ce qui est parti à ce qui a été payé.</p>
    ${ouv.map(carte).join('')}${clo.slice(0, 12).map(carte).join('')}${!l.length ? '<div class="panel"><p class="empty">Aucune mise en vente pour l\'instant.</p></div>' : ''}`;
}
ACTIONS.selfNouveau = () => {
  const ps = produits().filter((p) => p.direct && num(p.direct.prix) > 0);
  if (!ps.length) { toast('Mets d\'abord un prix de vente directe sur un produit (Stock et prix → produit).', 5000); return; }
  openSheet(`${sheetHead('Mise en vente directe')}<form class="sbody form" data-form="self">
    <div class="grid2">${inp('sf-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('sf-lieu', 'Où', 'Self-service', { name: 'lieu' })}</div>
    <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th>Quantité</th><th>Prix</th><th class="r">Stock</th></tr></thead><tbody>
    ${ps.map((p) => { const q = stockDe(p.key); return `<tr><td>${esc(p.nom)}</td><td><input class="cell-in" name="q_${esc(p.key)}" inputmode="decimal" placeholder="0" style="width:70px"> <span class="hint">${esc(p.direct.unite || p.unite)}</span></td><td><input class="cell-in" name="p_${esc(p.key)}" inputmode="decimal" value="${esc(String(p.direct.prix).replace('.', ','))}" style="width:70px"></td><td class="r hint">${q == null ? (p.dispo ? 'dispo' : '—') : fmtQ(q, p.unite)}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${inp('sf-note', 'Note', '', { name: 'note' })}
    <p class="hint">Si l'unité de vente directe est la même que celle du stock, le stock baisse de ces quantités.</p>
    <div class="row-end"><button class="btn primary" type="submit">Mettre en vente</button></div></form>`);
};
FORMS.self = (v) => {
  const lignes = produits().filter((p) => num(v['q_' + p.key]) > 0).map((p) => ({ prod: p.key, qte: num(v['q_' + p.key]), prix: r2(num(v['p_' + p.key])), unite: (p.direct && p.direct.unite) || p.unite }));
  if (!lignes.length) { toast('Indique au moins une quantité.'); return; }
  const k = 'self:' + uid('s'), s = { date: v.date || todayISO(), lieu: v.lieu || 'Self-service', lignes, retours: {}, statut: 'ouverte', note: v.note, par: Sync.me || '', cree: new Date().toISOString() };
  DB.put(k, s); stockPourSelf(k, s); closeSheet(); toast('Mise en vente enregistrée.');
};
function stockPourSelf(k, s) {
  (s.lignes || []).forEach((l, i) => {
    const p = DB.get(l.prod); if (!p || stockDe(l.prod) == null || (l.unite && l.unite !== p.unite)) return;
    DB.put(`mvt:self:${k.slice(5)}:${i}`, { date: s.date, prod: l.prod, qte: -num(l.qte), type: 'self', ref: k, par: s.par || '' });
    const r = num((s.retours || {})[i]), kr = `mvt:selfr:${k.slice(5)}:${i}`;
    if (s.statut === 'close' && r > 0) DB.put(kr, { date: s.closeLe || todayISO(), prod: l.prod, qte: r, type: 'retour', ref: k, par: Sync.me || '' }); else if (DB.get(kr)) DB.del(kr);
  });
}
ACTIONS.selfEnc = (el) => {
  const s = DB.get(el.dataset.key); if (!s) return;
  openSheet(`${sheetHead('Encaissement', (s.lieu || 'Self-service') + ' · ' + fmtDate(s.date))}<form class="sbody form" data-form="selfEnc"><input type="hidden" name="key" value="${esc(el.dataset.key)}">
    <div class="grid2">${inp('se-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('se-m', 'Montant CHF', '', { name: 'montant', type: 'number', attrs: { autofocus: '' } })}
      ${sel('se-moy', 'Moyen', 'TWINT', [['TWINT', 'TWINT'], ['Espèces', 'Espèces (caisse)']], { name: 'moyen' })}${sel('se-par', 'Encaissé par', Sync.me, persOptions(), { name: 'par', sub: 'Le compte TWINT ou la personne qui a pris la caisse.' })}</div>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.selfEnc = (v) => {
  const m = num(v.montant); if (!(m > 0)) { toast('Indique un montant.'); return; }
  const s = DB.get(v.key) || {};
  DB.put('rec:' + uid('r'), { date: v.date || todayISO(), montant: r2(m), moyen: v.moyen, par: v.par, client: s.lieu || 'Self-service', libelle: 'Vente directe ' + fmtDate(s.date), self: v.key, cree: new Date().toISOString() });
  closeSheet(); toast('Encaissement ajouté aux recettes.');
};
ACTIONS.selfClore = (el) => {
  const k = el.dataset.key, s = DB.get(k); if (!s) return;
  openSheet(`${sheetHead('Boucler la vente directe', 'Compte ce qui reste au stand')}<form class="sbody form" data-form="selfClore"><input type="hidden" name="key" value="${esc(k)}">
    ${(s.lignes || []).map((l, i) => { const p = DB.get(l.prod) || {}; return inp('sc-' + i, `${p.nom || '?'} : invendus (sur ${fmtQ(num(l.qte), l.unite)})`, (s.retours || {})[i] ?? '', { name: 'r_' + i, type: 'number' }); }).join('')}
    <p class="hint">Les invendus en bon état reviennent au stock. Ajoute d'abord les derniers encaissements.</p>
    <div class="row-end"><button class="btn primary" type="submit">Boucler</button></div></form>`);
};
FORMS.selfClore = (v) => {
  const s = DB.get(v.key); if (!s) return; const retours = {};
  (s.lignes || []).forEach((l, i) => { const r = Math.min(num(l.qte), num(v['r_' + i])); if (r > 0) retours[i] = r; });
  const o = Object.assign({}, s, { retours, statut: 'close', closeLe: todayISO() }); DB.put(v.key, o); stockPourSelf(v.key, o);
  const b = bilanSelf(Object.assign({ key: v.key }, o)); closeSheet();
  toast(b.ecart > 0.05 ? `Bouclé : ${chf(b.ecart)} manquants sur ${chf(b.vendu)} (${Math.round(b.taux * 100)} %).` : 'Bouclé : rien ne manque.', 6000);
};
ACTIONS.selfRouvrir = (el) => { const s = DB.get(el.dataset.key); if (!s) return; const o = Object.assign({}, s, { statut: 'ouverte' }); DB.put(el.dataset.key, o); stockPourSelf(el.dataset.key, o); };
/* Supprimer une mise en vente retire aussi ses mouvements de stock (les encaissements restent : c'est de l'argent reçu) */
(() => { const del = ACTIONS.delItemOk; ACTIONS.delItemOk = (el) => { const k = el.dataset.key; del(el); if (String(k).startsWith('self:')) for (const m of mouvements()) if (m.ref === k) DB.del(m.key); }; })();
