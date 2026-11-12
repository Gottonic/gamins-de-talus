/* Gamins de Talus — stock, récoltes et vente directe (self-service).
   Le stock d'un produit n'est jamais une case qu'on écrase : c'est la somme de ses mouvements, chacun une ligne à part
   (deux personnes peuvent noter en même temps sans s'écraser).
   mvt:<id>   { date, prod, qte (+ entrée / − sortie, dans l'unité du produit), type, culture?, ref?, par, note?, horsStock? }
              type : recolte | vente | self (mis au stand) | retour (invendus repris) | perte | ajout | inventaire (compte : qte = total)
              Clés fixes pour ce qui découle d'autre chose : mvt:fac:<facture>:<ligne>, mvt:self:<mise>:<ligne>, mvt:ev:<événement>:<date>.
   prod:<id>  + { fiche (culture liée), dispo (en stock sans quantité), auChamp } — la vente directe prend le prix « particuliers »
   self:<id>  mise en vente directe { date, lieu, lignes: [{ prod, qte, prix, recolte? }], retours: { i: qte }, statut: ouverte | close, note }
              Les encaissements sont des recettes (rec:) avec self: <id> : ils comptent dans les finances. */
'use strict';

const mouvements = () => DB.all('mvt:');
const misesEnVente = () => DB.all('self:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
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
  const prix = (p) => [fourchette(p) ? `fourchette ${fourchette(p)}` : '', prixNiveauxTxt(p), calibresDe(p).length ? 'à la pièce : ' + calibresDe(p).map((c) => `${c.nom} ${money(prixPiece(p, c, 'part'))}`).join(', ') : ''].filter(Boolean).join(' · ');
  const ligne = ({ p, q }) => `<div class="stk${q != null && q < 0 ? ' neg' : ''}">
      <div class="stk-nom"><b>${esc(p.nom)}</b>${p.auChamp ? ' <span class="tpill champ">🌱 au champ</span>' : ''}${p.dispo && (q == null || q <= 0) ? ' <span class="tpill">disponible</span>' : ''}<br><span class="hint">${prix(p) || 'Prix à définir'}</span></div>
      <div class="stk-q num">${q != null ? fmtQ(q, p.unite) : '—'}</div>
      <div class="row stk-act"><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="recolte">+ Récolte</button><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="perte">− Sortie</button><button class="btn small" type="button" data-act="mvtNouveau" data-prod="${esc(p.key)}" data-type="inventaire">Compter</button><button class="btn small" type="button" data-act="stkHist" data-prod="${esc(p.key)}" aria-label="Historique">⋯</button></div></div>`;
  const recents = ms.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || ''))).slice(0, 8);
  return `<div class="row"><button class="btn primary" type="button" data-act="mvtNouveau" data-type="recolte">+ Noter une récolte</button><button class="btn" type="button" data-act="grilleSheet">Grille de prix (PDF)</button></div>
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
      <p class="hint">Touche un produit pour ses prix (fourchette et prix par type de client) et la culture dont il vient. Les prix s'affichent en haut dès qu'il y a du stock.</p></div>`;
}
function brancherStock() {
  $('view').querySelectorAll('input[data-stk]').forEach((el) => el.addEventListener('change', () => { const p = DB.get(el.dataset.key); if (p) DB.put(el.dataset.key, Object.assign({}, p, { [el.dataset.stk]: el.checked })); }));
}

/* La culture du plan d'une saison qui donne ce produit (fiche liée, sinon même nom) */
function cultureDuProduit(p, saison) {
  if (!p || typeof cultures !== 'function') return null;
  const cs = cultures(String(saison)), n = sansAccentsS(p.nom);
  /* La fiche liée au produit, sinon le produit que la culture désigne, sinon le même nom (« Courge butternut » → Courge) */
  return cs.find((x) => p.fiche && ficheDe(x) === p.fiche) || cs.find((x) => { const pr = produitDeCulture(x); return pr && pr.key === p.key; })
    || cs.find((x) => sansAccentsS(x.nom) === n) || cs.find((x) => n.startsWith(sansAccentsS(x.nom)) || sansAccentsS(x.nom).startsWith(n)) || null;
}
/* Noter un mouvement : récolte, sortie (perte), comptage */
ACTIONS.mvtNouveau = (el) => {
  const type = el.dataset.type || 'recolte', s = typeof saisonCourante === 'function' ? saisonCourante() : todayISO().slice(0, 4);
  const culs = typeof cultures === 'function' ? cultures(s) : [];
  let prod = el.dataset.prod || '', cul = el.dataset.culture || '';
  const ref = el.dataset.ref || '', date = el.dataset.date || todayISO();
  if (!prod && cul) { const p = produitDeCulture(DB.get(cul)); if (p) prod = p.key; }
  if (prod && !cul && type === 'recolte') { const c = cultureDuProduit(DB.get(prod), s); if (c) cul = c.key; }
  const titres = { recolte: 'Noter une récolte', perte: 'Sortie de stock', inventaire: 'Compter le stock', ajout: 'Ajouter au stock' };
  openSheet(`${sheetHead(titres[type] || 'Mouvement de stock')}<form class="sbody form" data-form="mvt"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="ref" value="${esc(ref)}">
    <div class="grid2">${inp('mv-date', 'Date', date, { name: 'date', type: 'date' })}
      ${type === 'recolte' ? sel('mv-cul', `Culture (plan ${s})`, cul, [['', '—']].concat(culs.map((c) => [c.key, c.nom])), { name: 'culture' }) : ''}
      ${sel('mv-prod', 'Produit', prod, [['', type === 'recolte' ? '— (pas de produit)' : 'Choisir…']].concat(produits().map((p) => [p.key, p.nom + ' (' + (p.unite || '') + ')'])), { name: 'prod' })}
      ${inp('mv-q', type === 'inventaire' ? 'Quantité comptée' : 'Quantité', '', { name: 'qte', type: 'number', attrs: { autofocus: '' } })}</div>
    ${type === 'recolte' ? `<label class="row" style="font-size:14px"><input type="checkbox" name="enStock" checked> Ajouter au stock</label><p class="hint">La récolte compte aussi dans la récolte réelle de la culture (Cultures). Sans produit, elle n'entre pas dans le stock.</p>` : ''}
    ${type === 'perte' ? `<p class="hint">Abîmé, mangé, donné… Pour une vente, passe plutôt par « + Vente » (Ventes) : le stock baisse tout seul.</p>` : ''}
    ${inp('mv-note', 'Note', '', { name: 'note', attrs: { placeholder: 'facultatif' } })}
    <div class="row-end">${ref ? `<button class="btn" type="button" data-act="recolteSans" data-ref="${esc(ref)}">Pas récolté</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const cs = $('mv-cul'); if (cs) cs.addEventListener('change', () => { const p = produitDeCulture(DB.get(cs.value)); if (p) $('mv-prod').value = p.key; });
};
FORMS.mvt = (v) => {
  const q = num(v.qte); if (!(q > 0) && !(v.type === 'inventaire' && v.qte !== '')) { toast('Indique une quantité.'); return; }
  if (v.type !== 'recolte' && !v.prod) { toast('Choisis le produit.'); return; }
  if (v.type === 'recolte' && !v.prod && !v.culture) { toast('Choisis une culture ou un produit.'); return; }
  const o = { date: v.date || todayISO(), prod: v.prod || '', qte: v.type === 'perte' ? -q : q, type: v.type, par: Sync.me || '', note: v.note || '', cree: new Date().toISOString() };
  if (v.culture) o.culture = v.culture;
  if (v.ref) { o.ref = v.ref; marquerOccRecolte(v.ref, { fait: true }); }
  if (v.type === 'recolte' && (!v.enStock || !v.prod)) o.horsStock = true;
  DB.put('mvt:' + uid('m'), o); closeSheet();
  const p = DB.get(v.prod); toast(v.type === 'recolte' ? `Récolte notée${o.horsStock ? '' : ' et ajoutée au stock'}.` : v.type === 'inventaire' ? `Stock de ${p ? p.nom : ''} : ${fmtQ(q, p && p.unite)}.` : 'Enregistré.');
};
/* ---------- Récoltes prévues au calendrier (« Chantier de récolte ») ----------
   Le jour J et ensuite, tant que personne ne l'a enregistrée, la récolte apparaît sur l'accueil (14 jours au plus). */
function recolteDeLEvenement(k, occ) { const r = 'ev:' + k + ':' + occ; return mouvements().filter((m) => m.type === 'recolte' && m.ref === r).reduce((a, m) => a + num(m.qte), 0); }
function recoltesAEnregistrer() {
  if (typeof itemsPeriode !== 'function') return [];
  const today = todayISO(), refs = new Set(mouvements().filter((m) => m.type === 'recolte' && m.ref).map((m) => m.ref)), out = [];
  const it = itemsPeriode(addDays(today, -14), today);
  for (const d of Object.keys(it).sort()) for (const x of it[d]) {
    if (x.kind !== 'ev') continue; const e = DB.get(x.key); if (!e || e.type !== 'recolte') continue;
    const st = (e.occ || {})[x.occ] || {}; if (st.sansRecolte || refs.has('ev:' + x.key + ':' + x.occ)) continue;
    out.push({ key: x.key, occ: x.occ, titre: x.titre, qui: e.qui, culture: e.cultureId || '', ref: 'ev:' + x.key + ':' + x.occ });
  }
  /* Les tâches « Champ · Récolte » faites ces 14 derniers jours, sans récolte notée */
  if (typeof taches === 'function') for (const t of taches()) {
    if (t.statut !== 'termine' || catTache(t).sous !== 'recolte' || t.sansRecolte || !t.termineLe || t.termineLe < addDays(today, -14) || refs.has('tache|' + t.key)) continue;
    out.push({ key: t.key, occ: t.termineLe, titre: t.titre, qui: t.terminePar || t.responsable, culture: (t.cultures || [])[0] || '', ref: 'tache|' + t.key });
  }
  return out;
}
function marquerOccRecolte(ref, champs) {
  if (String(ref).startsWith('tache|')) { const k = String(ref).slice(6), t = DB.get(k); if (t && champs.sansRecolte) DB.put(k, Object.assign({}, t, { sansRecolte: true })); return; }
  const m = String(ref).match(/^ev:(.+):(\d{4}-\d{2}-\d{2})$/); if (!m) return; const e = DB.get(m[1]); if (!e) return;
  DB.put(m[1], Object.assign({}, e, { occ: Object.assign({}, e.occ || {}, { [m[2]]: Object.assign({}, (e.occ || {})[m[2]] || {}, champs) }) }));
}
ACTIONS.recolteEv = (el) => {
  if (String(el.dataset.key).startsWith('t:')) { const t = DB.get(el.dataset.key); if (!t) return; closeSheet(); ACTIONS.mvtNouveau({ dataset: { type: 'recolte', culture: (t.cultures || [])[0] || '', date: t.termineLe || todayISO(), ref: 'tache|' + el.dataset.key } }); return; }
  const e = DB.get(el.dataset.key); if (!e) return; closeSheet();
  ACTIONS.mvtNouveau({ dataset: { type: 'recolte', culture: e.cultureId || '', date: el.dataset.occ, ref: 'ev:' + el.dataset.key + ':' + el.dataset.occ } });
};
ACTIONS.recolteSans = (el) => { marquerOccRecolte(el.dataset.ref, { sansRecolte: true, fait: true }); closeSheet(); toast('Noté : pas de récolte ce jour-là.'); };
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
      const p = DB.get(l.produitId); if (!p) return;
      const q = enUniteDeStock(p, l.quantite, l.unite, l.poids); if (q == null) return;
      const k = 'mvt:fac:' + facKey + ':' + i; garder.add(k);
      DB.put(k, { date: f.livraison || f.date, prod: l.produitId, qte: -q, type: 'vente', ref: facKey, par: f.creePar || Sync.me || '', note: (f.client ? f.client.nom : '') + (num(l.poids) ? ` · ${fmtNum(num(l.quantite), 0)} pièce(s)` : '') });
    });
  }
  for (const m of avant) if (!garder.has(m.key)) DB.del(m.key);
}

/* ---------- Vente directe (self-service) ---------- */
function bilanSelf(s) {
  const ls = s.lignes || [], ret = s.retours || {};
  const mis = ls.reduce((a, l) => a + num(l.qte) * num(l.prix), 0);
  const vendu = ls.reduce((a, l, i) => a + Math.max(0, num(l.qte) - num(ret[i])) * num(l.prix), 0);
  const msg = paiementsMessage().filter((x) => x.self === s.key).reduce((a, x) => a + num(x.montant), 0);
  const enc = recettesDirectes().filter((r) => r.self === s.key).reduce((a, r) => a + num(r.montant), 0) + msg;
  return { mis, vendu, enc, msg, ecart: vendu - enc, taux: vendu > 0 ? (vendu - enc) / vendu : 0 };
}
/* Mises en vente d'avant le comptage automatique : les produits d'une culture du plan, pas encore comptés comme récolte (ni écartés) */
function rattrapagesRecolte() {
  const out = [];
  for (const s of misesEnVente()) (s.lignes || []).forEach((l, i) => {
    if (l.recolte != null) return; const p = DB.get(l.prod); if (!p) return;
    out.push({ s, i, l, p, c: cultureDuProduit(p, String(s.date).slice(0, 4)) });
  });
  return out;
}
ACTIONS.selfRattrapage = () => {
  const r = rattrapagesRecolte(); if (!r.length) { toast('Rien à rattraper.'); return; }
  openSheet(`${sheetHead('Compter comme récolte')}<form class="sbody form" data-form="selfRattrapage">
    <p class="hint">Mises en vente enregistrées avant le comptage automatique. Coche ce qui a été récolté pour l'occasion (les produits 🌱 au champ dont la culture est trouvée sont cochés d'office) et vérifie la culture. Décoche ce qui venait d'une récolte déjà notée, pour ne pas la compter deux fois.</p>
    <div class="table-wrap"><table class="list"><thead><tr><th></th><th>Date</th><th>Produit</th><th class="r">Quantité</th><th>Culture</th></tr></thead><tbody>
    ${r.map((x) => { const y = String(x.s.date).slice(0, 4), cs = typeof cultures === 'function' ? cultures(y) : [];
      return `<tr><td><input type="checkbox" name="r_${esc(x.s.key)}|${x.i}"${x.p.auChamp && x.c ? ' checked' : ''} aria-label="Compter"></td><td class="num">${fmtDate(x.s.date)}</td><td>${esc(x.l.nom || x.p.nom)}${x.l.calibre && !x.l.nom ? ' ' + esc(String(x.l.calibre).toLowerCase()) : ''}${x.p.auChamp ? ' 🌱' : ''}</td><td class="r num">${esc(fmtQ(num(x.l.qte), x.l.unite === 'pièce' ? 'pc' : x.l.unite))}</td>
        <td>${cs.length ? `<select class="cell-in" name="c_${esc(x.s.key)}|${x.i}" aria-label="Culture"><option value="">— aucune —</option>${cs.map((c) => `<option value="${esc(c.key)}"${x.c && x.c.key === c.key ? ' selected' : ''}>${esc(c.nom)}</option>`).join('')}</select>` : `<span class="hint">pas de plan ${esc(y)}</span>`}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.selfRattrapage = (v) => {
  const r = rattrapagesRecolte(), parS = {}; let n = 0;
  for (const x of r) { const on = !!v['r_' + x.s.key + '|' + x.i], cu = v['c_' + x.s.key + '|' + x.i] || ''; (parS[x.s.key] = parS[x.s.key] || {})[x.i] = { on, cu }; if (on) n++; }
  for (const [k, m] of Object.entries(parS)) {
    const s = DB.get(k); if (!s) continue;
    const s2 = Object.assign({}, s, { lignes: (s.lignes || []).map((l, i) => (i in m ? Object.assign({}, l, { recolte: m[i].on }, m[i].on && m[i].cu ? { culture: m[i].cu } : {}) : l)) });
    DB.put(k, s2); stockPourSelf(k, s2);
  }
  closeSheet(); toast(n ? `${n} vente${n > 1 ? 's' : ''} comptée${n > 1 ? 's' : ''} comme récolte.` : 'Noté : rien à compter.');
};
/* ---------- Le stand (vente directe en continu) ----------
   Sur le stand ≈ dernier point compté + ce qu'on y a mis depuis − ce qui a été payé depuis (TWINT, espèces, par message).
   stp:<id> = point du stand { date, cree, lignes: [{ prod, art, nom, reste, repris, prix, unite, poids }], valeur (restée sur le stand), estime (avant), manque }
   cfg:stand = { seuil } : en dessous, l'onglet Vente directe prévient qu'il faut remplir le stand. */
const reglagesStand = () => Object.assign({ seuil: 350 }, DB.get('cfg:stand') || {});
const encaissementsVD = () => recettesDirectes().filter(estVenteDirecte);
const pointsStand = () => DB.all('stp:').sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.cree || '').localeCompare(String(b.cree || '')));
const valeurMise = (s) => (s.lignes || []).reduce((a, l, i) => a + Math.max(0, num(l.qte) - num((s.retours || {})[i])) * num(l.prix), 0);
const apresPoint = (x, p) => !p || String(x.date) > p.date || (String(x.date) === p.date && String(x.cree || '') > String(p.cree || ''));
function etatStand(avant) {
  const ps = pointsStand().filter((p) => !avant || (p.key !== avant.key && !apresPoint(p, avant))), p = ps[ps.length - 1];
  const dans = (x) => apresPoint(x, p) && (!avant || !apresPoint(x, avant));
  const mis = misesEnVente().filter(dans).reduce((a, x) => a + valeurMise(x), 0);
  const enc = encaissementsVD().filter(dans).reduce((a, r) => a + num(r.montant), 0), msg = paiementsMessage().filter(dans).reduce((a, x) => a + num(x.montant), 0);
  const base = p ? num(p.valeur) : 0, estime = r2(base + mis - enc - msg);
  return { p, base, mis: r2(mis), enc: r2(enc), msg: r2(msg), estime, aRemplir: (misesEnVente().length > 0) && estime < num(reglagesStand().seuil) };
}
const standARemplir = () => { try { return etatStand().aRemplir; } catch (e) { return false; } };
/* « Je m'en occupe » : qui va remplir le stand (cfg:stand.charge = { par, le }) ; plus valable dès le remplissage suivant */
function priseStand() {
  const c = (DB.get('cfg:stand') || {}).charge; if (!c || !c.par) return null;
  const dernier = misesEnVente().map((x) => String(x.cree || x.date || '')).sort().pop() || '';
  return String(c.le) > dernier ? c : null;
}
ACTIONS.standPrise = (el) => { DB.put('cfg:stand', Object.assign({}, DB.get('cfg:stand') || {}, { charge: el.dataset.off ? null : { par: Sync.me || '', le: new Date().toISOString() } })); };
/* Paiements TWINT pas encore comptés nulle part, depuis la première mise en vente */
const twLibresVD = () => { const d0 = (misesEnVente().slice(-1)[0] || {}).date; return d0 ? DB.all('tw:').filter((t) => (!t.utilise || !DB.get(t.utilise)) && t.montant > 0 && t.date >= d0).sort((a, b) => a.date.localeCompare(b.date)) : []; };
/* Le self-service, semaine par semaine (lundi → dimanche) : encaissé + payé par message pas encore facturé (une facture le montre ensuite) */
function semainesSelf() {
  const m = {};
  const add = (d, v, msg) => { d = String(d || '').slice(0, 10); if (!d || !(v > 0)) return; const l = lundiDe(d), o = m[l] || (m[l] = { lundi: l, total: 0, msg: 0, date: d }); o.total += v; if (msg) o.msg += v; if (d > o.date) o.date = d; };
  for (const r of encaissementsVD()) add(r.date, num(r.montant));
  for (const x of paiementsMessage()) if (!x.facture) add(x.date, num(x.montant), true);
  return Object.values(m).map((o) => Object.assign(o, { total: r2(o.total), msg: r2(o.msg), sem: semaineISO(o.lundi).semaine }));
}
const SD = { an: '' };
/* Une boîte qu'on ouvre ou ferme et qui s'en souvient (data-garde = clé) */
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('summary [data-act]')) e.preventDefault(); }, true);
document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.dataset && d.dataset.garde) ls.set(d.dataset.garde, d.open ? '1' : '0'); }, true);
ACTIONS.sdAn = (el) => { SD.an = el.dataset.y; render(); };
function renderSelfService() {
  const rat = rattrapagesRecolte().length, E = etatStand(), R = reglagesStand(), tl = twLibresVD();
  const ys = [...new Set(misesEnVente().map((x) => yearOf(x.date)).concat([todayISO().slice(0, 4)]))].sort().reverse(), y = SD.an && ys.includes(SD.an) ? SD.an : ys[0];
  const misY = misesEnVente().filter((x) => yearOf(x.date) === y), encY = encaissementsVD().filter((r) => yearOf(r.date) === y), msgY = paiementsMessage().filter((x) => yearOf(x.date) === y);
  const tMis = misY.reduce((a, x) => a + valeurMise(x), 0), tEnc = encY.reduce((a, r) => a + num(r.montant), 0), tMsg = msgY.reduce((a, x) => a + num(x.montant), 0);
  const ptsY = pointsStand().filter((p) => yearOf(p.date) === y), manque = ptsY.reduce((a, p) => a + Math.max(0, num(p.manque)), 0);
  /* Tous les articles mis en vente cette année, cumulés */
  const agg = new Map();
  for (const m of misY) (m.lignes || []).forEach((l, i) => { const p = DB.get(l.prod) || {}, nom = l.nom || ((p.nom || '?') + (l.calibre ? ' ' + String(l.calibre).toLowerCase() : '')), u = l.nom ? (l.unite || 'pièce') : (l.unite || p.unite || ''), k = nom + '|' + u;
    const o = agg.get(k) || { nom, u, q: 0, v: 0 }, q = Math.max(0, num(l.qte) - num((m.retours || {})[i])); o.q += q; o.v += q * num(l.prix); agg.set(k, o); });
  const aggL = [...agg.values()].sort((a, b) => b.v - a.v);
  return `${articlesHtml()}
    <div class="row"><button class="btn primary" type="button" data-act="selfNouveau">Remplir le stand</button><button class="btn" type="button" data-act="ardNouveau">+ Payé par message</button><button class="btn" type="button" data-act="twImport">Importer le relevé TWINT</button></div>
    ${rat ? `<div class="panel between"><span>🌱 ${rat} produit${rat > 1 ? 's' : ''} d'anciennes mises en vente : à compter comme récolte, ou pas.</span><button class="btn primary small" type="button" data-act="selfRattrapage">Voir et compter</button></div>` : ''}
    <div class="panel stand${E.aRemplir ? ' a-remplir' : ''}"><div class="between"><h2>Sur le stand</h2><span class="v-stand">≈ ${chf(Math.max(0, E.estime))}</span></div>
      ${E.aRemplir ? (() => { const pr = priseStand(); return `<div class="banner stand-alerte"><span>🧺 Le stand est presque vide (moins de ${chf(R.seuil)} de marchandise)${pr ? ` : <b>${esc(pr.par === Sync.me ? 'tu t\'en occupes' : nomDe(pr.par) + ' s\'en occupe')}</b>.` : ' : il est temps de le remplir.'}</span>${pr ? (pr.par === Sync.me ? '<button class="btn small" type="button" data-act="standPrise" data-off="1">Annuler</button>' : '') : '<button class="btn small primary" type="button" data-act="standPrise">Je m\'en occupe</button>'}</div>`; })() : ''}
      <p class="hint">${E.p ? `Compté le ${fmtDate(E.p.date)} : ${chf(E.base)}` : 'Pas encore de point'} + mis depuis ${chf(E.mis)} − encaissé ${chf(E.enc)}${E.msg ? ` − payé par message ${chf(E.msg)}` : ''}. Les paiements TWINT reçus par mail comptent dès qu'on les enregistre. Un vol ou une perte n'est pas visible : « Remplir le stand » commence par compter ce qui reste, ce qui remet le compteur juste.</p>
      <form class="row stand-seuil" data-form="standSeuil"><label for="st-seuil" class="hint">Prévenir sous</label><input id="st-seuil" name="seuil" class="cell-in" inputmode="decimal" value="${esc(String(R.seuil))}" style="width:80px"><span class="hint">CHF</span><button class="btn small" type="submit">OK</button></form></div>
    ${tl.length ? `<div class="banner">💳 ${tl.length} paiement${tl.length > 1 ? 's' : ''} TWINT importé${tl.length > 1 ? 's' : ''} pas encore compté${tl.length > 1 ? 's' : ''} (${chf(tl.reduce((a, t) => a + t.montant, 0))}). <button class="btn small primary" type="button" data-act="twLibresVD">Voir et compter</button></div>` : ''}
    <div class="panel"><div class="between"><h2>Self-service ${y}</h2>${ys.length > 1 ? `<div class="row">${ys.map((x) => `<button class="chip${x === y ? ' on' : ''}" type="button" data-act="sdAn" data-y="${x}">${x}</button>`).join('')}</div>` : ''}</div>
      <div class="stats"><div class="stat"><span class="k">Mis en vente</span><span class="v">${chf(tMis)}</span><span class="s">${misY.length} remplissage${misY.length > 1 ? 's' : ''}</span></div>
        <div class="stat blue"><span class="k">Encaissé (TWINT, espèces)</span><span class="v">${chf(tEnc)}</span><span class="s">${encY.length} paiement${encY.length > 1 ? 's' : ''}</span></div>
        <div class="stat good"><span class="k">Vendu</span><span class="v">${chf(tEnc + tMsg)}</span><span class="s">${tMsg ? `dont ${chf(tMsg)} payés par message` : 'encaissé + payé par message'}</span></div>
        <div class="stat ${tEnc + tMsg && manque / (tEnc + tMsg) > 0.1 ? 'bad' : ''}"><span class="k">Manque (vol, pertes)</span><span class="v">${ptsY.length ? chf(manque) : '—'}</span><span class="s">${ptsY.length ? `relevé à ${ptsY.length} comptage${ptsY.length > 1 ? 's' : ''}` : 'connu en comptant ce qui reste'}</span></div></div>
      ${aggL.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Article</th><th class="r">Mis en vente</th><th class="r">Valeur</th></tr></thead><tbody>
        ${aggL.map((o) => `<tr><td>${esc(o.nom)}</td><td class="r num">${esc(fmtQ(r2(o.q), o.u === 'pièce' ? 'pc' : o.u))}</td><td class="r num">${money(o.v)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td></td><td class="r num">${money(tMis)}</td></tr></tfoot></table></div>` : '<p class="empty">Rien mis en vente cette année.</p>'}
      <details class="sd-hist"><summary class="hint">Historique : remplissages, comptages et encaissements</summary>${historiqueStandHtml(y)}</details></div>
    ${paiementsMessageHtml()}`;
}
function historiqueStandHtml(y) {
  const ev = [].concat(
    misesEnVente().filter((x) => yearOf(x.date) === y).map((x) => ({ date: x.date, cree: x.cree, t: `Remplissage${x.lieu && x.lieu !== 'Self-service' ? ' · ' + x.lieu : ''}`, d: (x.lignes || []).map((l) => `${fmtNum(num(l.qte), 0)} ${l.nom || (DB.get(l.prod) || {}).nom || '?'}`).join(', '), v: valeurMise(x), key: x.key, what: 'ce remplissage', modif: 'selfModifier' })),
    pointsStand().filter((p) => yearOf(p.date) === y).map((p) => ({ date: p.date, cree: p.cree, t: 'Comptage du stand', d: `restait ${chf(p.valeur)}${num(p.manque) > 0.05 ? ` · manque ${chf(p.manque)}` : ''}`, v: null, key: p.key, what: 'ce comptage', modif: 'standPoint' })),
    encaissementsVD().filter((r) => yearOf(r.date) === y).map((r) => ({ date: r.date, cree: r.cree, t: `Encaissement ${r.moyen || ''}`, d: r.libelle || '', v: -num(r.montant), key: r.key, rec: true })),
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || '')));
  return ev.length ? `<div class="table-wrap"><table class="list"><tbody>${ev.slice(0, 200).map((e) => `<tr><td class="num">${fmtDate(e.date)}</td><td><b>${esc(e.t)}</b><br><span class="hint">${esc(trunc(e.d, 120))}</span></td><td class="r num">${e.v == null ? '' : money(e.v)}</td><td class="r">${e.rec ? `<button class="btn link small" type="button" data-act="recEdit" data-key="${esc(e.key)}">modifier</button>` : `<button class="btn link small" type="button" data-act="${e.modif}" data-key="${esc(e.key)}">modifier</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Rien cette année.</p>';
}
FORMS.standSeuil = (v) => { const x = num(v.seuil); if (!(x >= 0)) { toast('Indique un montant.'); return; } DB.put('cfg:stand', Object.assign({}, DB.get('cfg:stand') || {}, { seuil: r2(x) })); toast(`Alerte sous ${chf(x)}.`); };
/* Faire le point : on compte ce qui reste sur le stand (et ce qu'on reprend au stock) */
function lignesStand() {
  const out = [];
  for (const a of articles().filter((x) => x.actif !== false)) out.push({ id: 'a_' + a.key, art: a.key, prod: a.prod, nom: a.nom, prix: prixArticle(a), unite: a.mode === 'lot' ? 'lot' : 'pièce', poids: poidsArticle(a) });
  for (const p of produits().filter((x) => num(prixNiveau(x, 'part')) > 0)) {
    calibresDe(p).forEach((c, j) => out.push({ id: 'c_' + p.key + '|' + j, prod: p.key, nom: p.nom + ' ' + String(c.nom).toLowerCase(), prix: r2(num(prixPiece(p, c, 'part'))), unite: 'pièce', poids: num(c.poids) }));
    out.push({ id: 'p_' + p.key, prod: p.key, nom: p.nom, prix: r2(num(prixNiveau(p, 'part'))), unite: p.unite || 'kg' });
  }
  /* Ce qui a été mis en vente depuis le dernier point d'abord */
  const E = etatStand(), mis = new Set(misesEnVente().filter((x) => apresPoint(x, E.p)).flatMap((x) => (x.lignes || []).map((l) => l.art || l.prod)));
  return out.sort((a, b) => (mis.has(b.art || b.prod) ? 1 : 0) - (mis.has(a.art || a.prod) ? 1 : 0));
}
ACTIONS.standPoint = (el) => {
  const k = (el && el.dataset && el.dataset.key) || '', p = k ? DB.get(k) : null, suite = !k && !!(el && el.dataset && el.dataset.suite);
  const E = p ? { estime: p.estime } : etatStand(), deja = {}; for (const l of (p && p.lignes) || []) deja[l.art ? 'a_' + l.art : l.nom] = l;
  const ls = lignesStand(); for (const l of (p && p.lignes) || []) if (!ls.some((x) => (x.art && x.art === l.art) || (!x.art && x.nom === l.nom))) ls.push({ id: 'x_' + ls.length, art: l.art, prod: l.prod, nom: l.nom, prix: l.prix, unite: l.unite, poids: l.poids });
  const val = (l, f) => { const d = deja[l.art ? 'a_' + l.art : l.nom]; return d && num(d[f]) ? String(d[f]).replace('.', ',') : ''; };
  if (!ls.length) { toast('Crée d\'abord un article de vente directe.'); return; }
  openSheet(`${sheetHead(p ? 'Modifier le comptage' : suite ? 'Remplir le stand' : 'Compter le stand', `${suite ? '1 / 2 · Ce qui reste · ' : ''}estimé : ${chf(Math.max(0, E.estime))}`)}<form class="sbody form" data-form="standPoint"><input type="hidden" name="suite" value="${suite ? '1' : ''}"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('sp-d', 'Date', p ? p.date : todayISO(), { name: 'date', type: 'date' })}
    <div class="table-wrap"><table class="list"><thead><tr><th>Article</th><th>Il en reste</th><th>Dont repris au stock</th><th class="r">Prix</th></tr></thead><tbody>
    ${ls.map((l) => `<tr><td>${esc(l.nom)}</td><td><input class="cell-in" name="r_${esc(l.id)}" inputmode="decimal" placeholder="0" value="${esc(val(l, 'reste'))}" style="width:64px"> <span class="hint">${esc(l.unite === 'pièce' ? 'pc' : l.unite)}</span></td><td><input class="cell-in" name="k_${esc(l.id)}" inputmode="decimal" placeholder="0" style="width:64px" value="${esc(val(l, 'repris'))}"></td><td class="r num">${money(l.prix)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint">Compte ce qui reste sur le stand (vide = il n'en reste pas). L'app compare à ce qui devrait rester : la différence est le manque (vol, pertes, erreurs). Ce qui est repris au stock quitte le stand.${suite ? ' Pas le temps de compter ? « Passer ».' : ''}</p>
    <div class="row-end">${p ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="ce comptage">Supprimer</button>` : ''}${suite ? '<button class="btn" type="button" data-act="selfRemplir">Passer</button>' : ''}<button class="btn primary" type="submit">${suite ? 'Suivant' : 'Enregistrer'}</button></div></form>`);
};
FORMS.standPoint = (v) => {
  const old = v.key ? DB.get(v.key) : null, ls = lignesStand(), lignes = [];
  for (const l of (old && old.lignes) || []) if (!ls.some((x) => (x.art && x.art === l.art) || (!x.art && x.nom === l.nom))) ls.push({ id: 'x_' + ls.length, art: l.art, prod: l.prod, nom: l.nom, prix: l.prix, unite: l.unite, poids: l.poids });
  for (const l of ls) { const r = num(v['r_' + l.id]), k = Math.min(r, num(v['k_' + l.id])); if (r > 0) lignes.push({ prod: l.prod, art: l.art || '', nom: l.nom, reste: r, repris: k, prix: l.prix, unite: l.unite, poids: l.poids || 0 }); }
  const k = v.key || 'stp:' + uid('p'), date = v.date || todayISO(), cree = (old && old.cree) || new Date().toISOString();
  if (old) for (const m of mouvements()) if (m.ref === k) DB.del(m.key); /* ses reprises au stock sont refaites */
  const E = etatStand({ key: k, date, cree }), compte = lignes.reduce((a, l) => a + l.reste * l.prix, 0), reste = lignes.reduce((a, l) => a + (l.reste - l.repris) * l.prix, 0);
  const o = Object.assign({}, old || {}, { date, cree, lignes, valeur: r2(reste), estime: E.estime, manque: r2(E.estime - compte), par: (old && old.par) || Sync.me || '' }, old ? { modifiePar: Sync.me || '', modifieLe: new Date().toISOString() } : {});
  DB.put(k, o);
  lignes.forEach((l, i) => { if (!(l.repris > 0)) return; const p = DB.get(l.prod); if (!p || stockDe(l.prod) == null) return; const q = enUniteDeStock(p, l.repris, l.unite, l.poids); if (q == null) return;
    DB.put(`mvt:stpr:${k.slice(4)}:${i}`, { date, prod: l.prod, qte: q, type: 'retour', ref: k, par: Sync.me || '', note: 'Repris du stand' }); });
  closeSheet(); toast(o.manque > 0.05 ? `Compté : il manque ${chf(o.manque)} par rapport à l'estimation.` : o.manque < -0.05 ? `Compté : ${chf(-o.manque)} de plus que l'estimation (un paiement noté en trop ?).` : 'Compté : tout correspond.', 6000);
  if (v.suite) setTimeout(() => ACTIONS.selfRemplir(), 60);
};
ACTIONS.twLibresVD = () => {
  const l = twLibresVD(); if (!l.length) return;
  openSheet(`${sheetHead('Paiements TWINT pas encore comptés')}<form class="sbody form" data-form="twLibresVD">
    <div class="table-wrap"><table class="list"><thead><tr><th></th><th>Date</th><th>Texte</th><th class="r">Montant</th></tr></thead><tbody>
    ${l.map((t) => `<tr><td><input type="checkbox" name="t_${esc(t.key)}" checked aria-label="Compter"></td><td class="num">${fmtDate(t.date)}</td><td>${esc(trunc(t.texte || t.ref || '', 40))}</td><td class="r num">${money(t.montant)}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Les paiements cochés deviennent des encaissements de la vente directe (dans les recettes). Décoche ceux qui payaient autre chose.</p>
    <div class="row-end"><button class="btn primary" type="submit">Compter</button></div></form>`);
};
FORMS.twLibresVD = (v) => {
  let n = 0, tot = 0;
  for (const t of twLibresVD()) { if (!v['t_' + t.key]) continue; const rk = 'rec:' + uid('r');
    DB.put(rk, { date: t.date, montant: r2(t.montant), moyen: 'TWINT', par: cfg().compteDe || Sync.me || '', client: 'Vente directe', libelle: `Vente directe · TWINT${t.texte ? ' ' + trunc(t.texte, 40) : ''}`, vd: true, cree: new Date().toISOString() });
    DB.put(t.key, Object.assign({}, DB.get(t.key), { utilise: rk })); n++; tot += t.montant; }
  closeSheet(); toast(n ? `${chf(tot)} comptés (${n} paiement${n > 1 ? 's' : ''}).` : 'Rien de compté.');
};
/* Modifier un remplissage : quantités, prix, date ; le stock et la récolte suivent */
ACTIONS.selfModifier = (el) => {
  const k = el.dataset.key, s = DB.get(k); if (!s) return;
  openSheet(`${sheetHead('Modifier le remplissage', fmtDate(s.date))}<form class="sbody form" data-form="selfModifier"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('sm-d', 'Date', s.date, { name: 'date', type: 'date' })}
    <div class="table-wrap"><table class="list"><thead><tr><th>Article</th><th>Quantité</th><th>Prix</th></tr></thead><tbody>
    ${(s.lignes || []).map((l, i) => { const p = DB.get(l.prod) || {}; return `<tr><td>${esc(l.nom || p.nom || '?')}${l.calibre && !l.nom ? ' ' + esc(String(l.calibre).toLowerCase()) : ''}</td><td><input class="cell-in" name="q_${i}" inputmode="decimal" value="${esc(String(l.qte).replace('.', ','))}" style="width:64px"> <span class="hint">${esc(l.unite === 'pièce' ? 'pc' : l.unite || p.unite || '')}</span></td><td><input class="cell-in" name="p_${i}" inputmode="decimal" value="${esc(String(l.prix).replace('.', ','))}" style="width:70px"></td></tr>`; }).join('')}
    </tbody></table></div><p class="hint">Quantité 0 : la ligne est retirée. Le stock (et la récolte d'un produit au champ) suivent.</p>
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="ce remplissage">Supprimer</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.selfModifier = (v) => {
  const k = v.key, s = DB.get(k); if (!s) return;
  const lignes = [], retours = {};
  (s.lignes || []).forEach((l, i) => { const q = num(v['q_' + i]); if (!(q > 0)) return; if ((s.retours || {})[i] != null) retours[lignes.length] = Math.min(q, num(s.retours[i])); lignes.push(Object.assign({}, l, { qte: q, prix: r2(num(v['p_' + i])) })); });
  if (!lignes.length) { toast('Plus aucune ligne : utilise « Supprimer ».'); return; }
  for (const m of mouvements()) if (m.ref === k) DB.del(m.key);
  const s2 = Object.assign({}, s, { date: v.date || s.date, lignes, retours, modifiePar: Sync.me || '', modifieLe: new Date().toISOString() });
  DB.put(k, s2); stockPourSelf(k, s2); closeSheet(); toast('Remplissage modifié.');
};
/* Remplir le stand : 1. compter ce qui reste (ou passer), 2. ce qu'on ajoute */
ACTIONS.selfNouveau = () => { if (misesEnVente().length && articles().length + produits().length) ACTIONS.standPoint({ dataset: { suite: '1' } }); else ACTIONS.selfRemplir(); };
ACTIONS.selfRemplir = () => {
  /* Prix de vente directe = prix « Particuliers & vente directe » du produit (haut de la fourchette, ou fixé à la main) */
  const ps = produits().filter((p) => num(prixNiveau(p, 'part')) > 0), arts = articles().filter((a) => a.actif !== false);
  if (!ps.length && !arts.length) { toast('Crée d\'abord un article de vente directe, ou mets une fourchette de prix sur un produit.', 5000); return; }
  const lgnArt = arts.map((a) => { const p = DB.get(a.prod) || {}, q = stockDe(a.prod); return `<tr><td><b>${esc(a.nom)}</b> <span class="hint">${esc(descArticle(a))}</span></td><td><input class="cell-in" name="qa_${esc(a.key)}" inputmode="numeric" placeholder="0" style="width:70px"> <span class="hint">${a.mode === 'lot' ? 'lots' : 'pièces'}</span></td><td><input class="cell-in" name="pa_${esc(a.key)}" inputmode="decimal" value="${esc(String(prixArticle(a)).replace('.', ','))}" style="width:70px"></td><td class="r hint">${p.auChamp ? '🌱 au champ' : q == null ? (p.dispo ? 'dispo' : '—') : fmtQ(q, p.unite)}</td></tr>`; }).join('');
  openSheet(`${sheetHead('Remplir le stand', misesEnVente().length ? '2 / 2 · Ce que tu ajoutes' : '')}<form class="sbody form" data-form="self">
    <div class="grid2">${inp('sf-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('sf-lieu', 'Où', 'Self-service', { name: 'lieu' })}</div>
    ${arts.length ? `<h3>Articles</h3><div class="table-wrap"><table class="list"><thead><tr><th>Article</th><th>Quantité</th><th>Prix</th><th class="r">Stock</th></tr></thead><tbody>${lgnArt}</tbody></table></div>` : ''}
    ${ps.length ? `<details${arts.length ? '' : ' open'}><summary class="hint" style="cursor:pointer">${arts.length ? 'Autres produits (au kg ou par calibre)' : 'Produits'}</summary>` : ''}
    <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th>Quantité</th><th>Prix</th><th class="r">Stock</th></tr></thead><tbody>
    ${ps.map((p) => { const q = stockDe(p.key), st = `<td class="r hint">${p.auChamp ? '🌱 au champ' : q == null ? (p.dispo ? 'dispo' : '—') : fmtQ(q, p.unite)}</td>`, cs = calibresDe(p);
      const ligne = (id, nom, unite, prix, stock) => `<tr><td>${nom}</td><td><input class="cell-in" name="q_${esc(id)}" inputmode="decimal" placeholder="0" style="width:70px"> <span class="hint">${esc(unite)}</span></td><td><input class="cell-in" name="p_${esc(id)}" inputmode="decimal" value="${esc(String(prix).replace('.', ','))}" style="width:70px"></td>${stock}</tr>`;
      return cs.map((c, j) => ligne(p.key + '|' + j, `${esc(p.nom)} <b>${esc(c.nom)}</b> <span class="hint">≈ ${fmtNum(c.poids, 2)} kg</span>`, 'pièces', prixPiece(p, c, 'part'), j === 0 ? st : '<td></td>')).join('')
        + ligne(p.key, esc(p.nom) + (cs.length ? ' <span class="hint">au ' + esc(p.unite) + '</span>' : ''), p.unite, prixNiveau(p, 'part'), cs.length ? '<td></td>' : st); }).join('')}
    </tbody></table></div>${ps.length ? '</details>' : ''}
    ${inp('sf-note', 'Note', '', { name: 'note' })}
    <p class="hint">Prix proposé : le prix « Particuliers & vente directe » du produit, modifiable ici pour cette fois. Le stock baisse de ces quantités. Ce qui est 🌱 au champ est récolté pour l'occasion : c'est compté comme récolte du jour (pour la culture du plan).</p>
    <div class="row-end"><button class="btn primary" type="submit">Mettre sur le stand</button></div></form>`);
};
FORMS.self = (v) => {
  const lignes = [];
  for (const a of articles()) { const q = num(v['qa_' + a.key]); if (q > 0) lignes.push({ prod: a.prod, art: a.key, nom: a.nom, qte: q, prix: r2(num(v['pa_' + a.key])), unite: a.mode === 'lot' ? 'lot' : 'pièce', poids: poidsArticle(a) }); }
  for (const p of produits()) {
    calibresDe(p).forEach((c, j) => { const id = p.key + '|' + j; if (num(v['q_' + id]) > 0) lignes.push({ prod: p.key, qte: num(v['q_' + id]), prix: r2(num(v['p_' + id])), unite: 'pièce', calibre: c.nom, poids: num(c.poids) }); });
    if (num(v['q_' + p.key]) > 0) lignes.push({ prod: p.key, qte: num(v['q_' + p.key]), prix: r2(num(v['p_' + p.key])), unite: p.unite });
  }
  if (!lignes.length) { toast('Indique au moins une quantité.'); return; }
  /* Un produit « au champ » mis en vente est récolté pour l'occasion : ça compte comme une récolte */
  for (const l of lignes) { const p = DB.get(l.prod); l.recolte = !!(p && p.auChamp); }
  const k = 'self:' + uid('s'), s = { date: v.date || todayISO(), lieu: v.lieu || 'Self-service', lignes, retours: {}, statut: 'ouverte', note: v.note, par: Sync.me || '', cree: new Date().toISOString() };
  DB.put(k, s); stockPourSelf(k, s); closeSheet();
  const nr = lignes.filter((l) => l.recolte).length; toast(`Mise en vente enregistrée.${nr ? ` ${nr > 1 ? nr + ' produits au champ comptés' : 'Produit au champ compté'} comme récolte.` : ''}`, nr ? 4000 : undefined);
};
/* Quantité vendue exprimée dans l'unité du stock : pièces × poids moyen pour un calibre, sinon même unité seulement */
function enUniteDeStock(p, qte, unite, poids) { if (num(poids) > 0 && (p.unite || 'kg') === 'kg') return r2(num(qte) * num(poids)); return !unite || !p.unite || unite === p.unite ? num(qte) : null; }
function stockPourSelf(k, s) {
  (s.lignes || []).forEach((l, i) => {
    const p = DB.get(l.prod); if (!p) return;
    /* Récolte du jour pour un produit au champ : dans le stock s'il est suivi (puis la mise en vente l'en sort), sinon seulement comptée comme récolte */
    const kh = `mvt:selfh:${k.slice(5)}:${i}`, h0 = DB.get(kh);
    if (l.recolte) {
      const q = enUniteDeStock(p, l.qte, l.unite, l.poids) ?? num(l.qte), c = (l.culture && DB.get(l.culture) ? Object.assign({ key: l.culture }, DB.get(l.culture)) : null) || cultureDuProduit(p, String(s.date).slice(0, 4));
      const o = { date: s.date, prod: l.prod, qte: q, type: 'recolte', ref: k, par: s.par || '', note: 'Mis en vente directe' + (s.lieu ? ' · ' + s.lieu : ''), cree: (h0 && h0.cree) || s.cree || new Date().toISOString() };
      if (c) o.culture = c.key;
      if (h0 ? h0.horsStock : stockDe(l.prod) == null) o.horsStock = true;
      DB.put(kh, o);
    } else if (h0) DB.del(kh);
    if (stockDe(l.prod) == null) return;
    const q = enUniteDeStock(p, l.qte, l.unite, l.poids); if (q == null) return;
    DB.put(`mvt:self:${k.slice(5)}:${i}`, { date: s.date, prod: l.prod, qte: -q, type: 'self', ref: k, par: s.par || '', note: num(l.poids) ? `${fmtNum(num(l.qte), 0)} pièce(s) ${l.calibre || ''}`.trim() : '' });
    const r = num((s.retours || {})[i]), kr = `mvt:selfr:${k.slice(5)}:${i}`;
    if (s.statut === 'close' && r > 0) DB.put(kr, { date: s.closeLe || todayISO(), prod: l.prod, qte: enUniteDeStock(p, r, l.unite, l.poids) ?? r, type: 'retour', ref: k, par: Sync.me || '' }); else if (DB.get(kr)) DB.del(kr);
  });
}
/* Vente spontanée : vendu sur place sans facture, payé cash (une recette, compte 3200 Vente directe) */
ACTIONS.venteSpontanee = (el) => {
  const k = (el && el.dataset && el.dataset.key) || '', r = k ? DB.get(k) : { date: todayISO(), par: Sync.me || '' };
  openSheet(`${sheetHead(k ? 'Vente spontanée' : 'Nouvelle vente spontanée', 'Sans facture, payée cash')}<form class="sbody form" data-form="venteSpontanee"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${inp('vs-m', 'Montant CHF', r.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { autofocus: k ? undefined : '', step: '0.05', inputmode: 'decimal' } })}${inp('vs-d', 'Date', r.date, { name: 'date', type: 'date' })}
      ${sel('vs-par', 'Encaissé par', r.par || Sync.me, persOptions(), { name: 'par', sub: 'Qui a pris l\'argent.' })}${inp('vs-c', 'Client (facultatif)', r.client === 'Vente spontanée' ? '' : r.client || '', { name: 'client' })}</div>
    ${inp('vs-q', 'Ce qui a été vendu (facultatif)', r.quoi || '', { name: 'quoi', attrs: { placeholder: 'ex. 3 kg de carottes, 2 courges' } })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette vente">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.venteSpontanee = (v) => {
  const m = num(v.montant); if (!(m > 0)) { toast('Indique le montant.'); return; }
  const k = v.key || 'rec:' + uid('r'), old = DB.get(k) || { cree: new Date().toISOString(), creePar: Sync.me || '' };
  DB.put(k, Object.assign({}, old, { date: v.date || todayISO(), montant: r2(m), moyen: 'Espèces', par: v.par, client: v.client || 'Vente spontanée', quoi: v.quoi || '', libelle: 'Vente spontanée' + (v.quoi ? ' · ' + v.quoi : ''), compte: '3200', spontanee: true }));
  closeSheet(); toast(`Vente spontanée de ${chf(m)} enregistrée dans les recettes.`);
};
ACTIONS.selfEnc = () => {
  openSheet(`${sheetHead('Encaissement', 'Vente directe')}<form class="sbody form" data-form="selfEnc">
    <div class="grid2">${inp('se-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('se-m', 'Montant CHF', '', { name: 'montant', type: 'number', attrs: { autofocus: '', step: '0.05', inputmode: 'decimal' } })}
      ${sel('se-moy', 'Moyen', 'Espèces', [['Espèces', 'Espèces (caisse)'], ['TWINT', 'TWINT']], { name: 'moyen' })}${sel('se-par', 'Encaissé par', Sync.me, persOptions(), { name: 'par', sub: 'Le compte TWINT ou la personne qui a pris la caisse.' })}</div>
    <p class="hint">Les paiements TWINT arrivent d'habitude tout seuls (mail TWINT, ou relevé importé) : ici, surtout la caisse.</p>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.selfEnc = (v) => {
  const m = num(v.montant); if (!(m > 0)) { toast('Indique un montant.'); return; }
  DB.put('rec:' + uid('r'), { date: v.date || todayISO(), montant: r2(m), moyen: v.moyen, par: v.par, client: 'Vente directe', libelle: 'Vente directe · ' + (v.moyen || ''), vd: true, cree: new Date().toISOString() });
  closeSheet(); toast('Encaissement ajouté aux recettes.');
};
ACTIONS.selfClore = (el) => {
  const k = el.dataset.key, s = DB.get(k); if (!s) return;
  openSheet(`${sheetHead('Boucler la vente directe', 'Compte ce qui reste au stand')}<form class="sbody form" data-form="selfClore"><input type="hidden" name="key" value="${esc(k)}">
    ${(s.lignes || []).map((l, i) => { const p = DB.get(l.prod) || {}; return inp('sc-' + i, `${l.nom || p.nom || '?'}${l.calibre && !l.nom ? ' ' + String(l.calibre).toLowerCase() : ''} : invendus (sur ${fmtQ(num(l.qte), l.unite)})`, (s.retours || {})[i] ?? '', { name: 'r_' + i, type: 'number' }); }).join('')}
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
/* ---------- Articles de vente directe ----------
   art:<id> = { nom, prod (produit lié : le stock baisse de la quantité × poids moyen), mode: 'piece' | 'lot',
                min, max (kg, à la pièce) ou poids (kg, sachet / lot), prix ('' = automatique), actif }
   Prix automatique : poids moyen × prix « Particuliers & vente directe » du produit, arrondi à 50 ct. */
const articles = () => DB.all('art:').sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
const poidsArticle = (a) => a.mode === 'lot' ? num(a.poids) : r2((num(a.min) + num(a.max)) / 2);
function prixAutoArticle(a) {
  const p = DB.get(a.prod); if (!p) return ''; const pk = num(prixNiveau(p, 'part')); if (!(pk > 0)) return '';
  const base = (p.unite || 'kg') === 'kg' ? pk * poidsArticle(a) : pk; return base > 0 ? Math.max(0.5, Math.round(base * 2) / 2) : '';
}
const prixArticle = (a) => (a.prix !== '' && a.prix != null && num(a.prix) > 0 ? r2(num(a.prix)) : prixAutoArticle(a) || 0);
const kgTxt = (x) => (num(x) < 1 ? fmtNum(num(x) * 1000, 0) + ' g' : fmtNum(num(x), 2).replace(/0$/, '').replace(/[.,]$/, '') + ' kg');
const descArticle = (a) => a.mode === 'lot' ? `lot de ${kgTxt(a.poids)}` : `pièce de ${kgTxt(a.min)} à ${kgTxt(a.max)}`;
function articlesHtml() {
  const l = articles();
  return `<details class="panel art-box" data-garde="gdt-art-ouvert"${ls.get('gdt-art-ouvert') === '1' ? ' open' : ''}><summary class="between"><h2>Articles de vente directe <span class="hint">· ${l.length}</span></h2><button class="btn small" type="button" data-act="artEdit">+ Article</button></summary>
    ${l.length ? `<div class="items">${l.map((a) => { const p = DB.get(a.prod) || {}, q = stockDe(a.prod), auto = !(num(a.prix) > 0);
      return `<button type="button" class="item${a.actif === false ? ' off' : ''}" data-act="artEdit" data-key="${esc(a.key)}"><span class="who"><strong>${esc(a.nom)}</strong><span class="meta">${esc(descArticle(a))} · ${esc(p.nom || 'produit ?')}${q != null ? ' · stock ' + esc(fmtQ(q, p.unite)) : ''}${a.actif === false ? ' · pas en vente' : ''}</span></span><span class="amt">${chf(prixArticle(a))}${auto ? '<br><span class="hint">auto</span>' : ''}</span></button>`; }).join('')}</div>`
      : '<p class="hint">Par exemple « Butternut moyenne » (pièce de 900 g à 1,4 kg, prix calculé tout seul) ou « Sachet de patates douces » (1,3 kg à 10 CHF). Mettre un article en vente retire son poids du stock du produit.</p>'}</details>`;
}
ACTIONS.artEdit = (el) => {
  const k = el.dataset.key || '', a = k ? DB.get(k) : { mode: 'piece', actif: true, prix: '' };
  const ps = produits().sort((x, y) => String(x.nom).localeCompare(String(y.nom), 'fr'));
  if (!ps.length) { toast('Crée d\'abord le produit (Stock et prix).'); return; }
  openSheet(`${sheetHead(k ? 'Article de vente directe' : 'Nouvel article de vente directe')}<form class="sbody form" data-form="art" id="art-form"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ar-nom', 'Nom', a.nom || '', { name: 'nom', req: true, attrs: { placeholder: 'Ex. Butternut moyenne, Sachet de patates douces', autofocus: '' } })}
    ${sel('ar-prod', 'Produit (pour le stock et le prix)', a.prod || ps[0].key, ps.map((p) => [p.key, `${p.nom} (${p.unite || 'kg'})`]), { name: 'prod' })}
    <div class="field"><span class="flabel">Vendu</span><div class="seg"><label><input type="radio" name="mode" value="piece"${a.mode !== 'lot' ? ' checked' : ''}> À la pièce (calibre)</label><label><input type="radio" name="mode" value="lot"${a.mode === 'lot' ? ' checked' : ''}> En sachet / lot (poids fixe)</label></div></div>
    <div class="grid2" id="ar-piece"${a.mode === 'lot' ? ' hidden' : ''}>${inp('ar-min', 'Poids min. (kg)', a.min ?? '', { name: 'min', type: 'number', attrs: { step: '0.01', min: '0', placeholder: '0,9' } })}${inp('ar-max', 'Poids max. (kg)', a.max ?? '', { name: 'max', type: 'number', attrs: { step: '0.01', min: '0', placeholder: '1,4' } })}</div>
    <div id="ar-lot"${a.mode === 'lot' ? '' : ' hidden'}>${inp('ar-poids', 'Poids du lot (kg)', a.poids ?? '', { name: 'poids', type: 'number', attrs: { step: '0.01', min: '0', placeholder: '1,3' } })}</div>
    ${inp('ar-prix', 'Prix CHF', num(a.prix) > 0 ? a.prix : '', { name: 'prix', type: 'number', attrs: { step: '0.05', min: '0' }, sub: '<span id="ar-auto"></span>' })}
    <label class="row" style="font-size:14px"><input type="checkbox" name="actif"${a.actif !== false ? ' checked' : ''}> En vente (proposé dans les mises en vente)</label>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet article">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const f = $('art-form'), maj = () => {
    const mode = (f.querySelector('input[name=mode]:checked') || {}).value || 'piece';
    $('ar-piece').hidden = mode === 'lot'; $('ar-lot').hidden = mode !== 'lot';
    const auto = prixAutoArticle({ prod: $('ar-prod').value, mode, min: $('ar-min').value, max: $('ar-max').value, poids: $('ar-poids').value }), p = DB.get($('ar-prod').value) || {};
    $('ar-auto').textContent = auto ? `Vide = prix automatique : ${chf(auto)} (${mode === 'lot' ? 'poids du lot' : 'poids moyen'} × ${money(prixNiveau(p, 'part'))} CHF/${p.unite || 'kg'}, arrondi à 50 ct).` : 'Mets une fourchette de prix au produit pour avoir un prix automatique.';
    $('ar-prix').placeholder = auto ? String(auto) : '';
  };
  f.addEventListener('input', maj); f.addEventListener('change', maj); maj();
};
FORMS.art = (v) => {
  if (!v.nom) return; const mode = v.mode === 'lot' ? 'lot' : 'piece';
  if (mode === 'piece' && !(num(v.min) > 0 && num(v.max) >= num(v.min))) { toast('Indique le poids min. et max. d\'une pièce (en kg).'); return; }
  if (mode === 'lot' && !(num(v.poids) > 0)) { toast('Indique le poids du lot (en kg).'); return; }
  const k = v.key || 'art:' + uid('a');
  DB.put(k, Object.assign({}, DB.get(k) || {}, { nom: v.nom.trim(), prod: v.prod, mode, min: mode === 'piece' ? r2(num(v.min)) : '', max: mode === 'piece' ? r2(num(v.max)) : '', poids: mode === 'lot' ? r2(num(v.poids)) : '', prix: num(v.prix) > 0 ? r2(num(v.prix)) : '', actif: !!v.actif }));
  closeSheet(); toast('Article enregistré.');
};

/* ---------- Payé par message (SMS / WhatsApp) : à facturer en fin de saison ----------
   ard:<id> = { date, contactId, montant, note, self (mise en vente, facultatif), par, facture (clé de la facture une fois faite) }
   Ce n'est pas encore une recette : la recette, c'est la facture (payée). */
const paiementsMessage = () => DB.all('ard:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
const chiffresTel = (s) => String(s || '').replace(/\D/g, '').replace(/^(0041|41)/, '0').slice(-9);
const contactParTel = (t) => { const c = chiffresTel(t); return c.length >= 9 ? tousContacts().find((x) => chiffresTel(x.telephone) === c) : null; };
/* Fin du mois (3 derniers jours) ou mois passé : les paiements par message pas encore facturés sont à facturer */
function ardAFacturer() {
  try {
    const t = todayISO(), mois = t.slice(0, 7), finMois = addDays(addDays(mois + '-01', 32).slice(0, 7) + '-01', -1), fin = t >= addDays(finMois, -2);
    return paiementsMessage().filter((x) => !x.facture && (String(x.date).slice(0, 7) < mois || (fin && String(x.date).slice(0, 7) === mois)));
  } catch (e) { return []; }
}
function paiementsMessageHtml() {
  const l = paiementsMessage(), af = l.filter((x) => !x.facture);
  if (!l.length) return '';
  const parC = {}; for (const x of af) { (parC[x.contactId] = parC[x.contactId] || []).push(x); }
  const du = ardAFacturer();
  return `<div class="panel"><div class="between"><h2>Payé par message · à facturer ${chf(af.reduce((a, x) => a + num(x.montant), 0))}</h2>${af.length ? '<button class="btn small primary" type="button" data-act="ardFacturer">Facturer…</button>' : ''}</div>
    ${du.length ? `<p class="banner">🧾 Fin du mois : ${du.length} achat${du.length > 1 ? 's' : ''} payé${du.length > 1 ? 's' : ''} par message à facturer (${chf(du.reduce((a, x) => a + num(x.montant), 0))}).</p>` : ''}
    ${Object.entries(parC).map(([ck, xs]) => { const c = DB.get(ck) || {}; return `<details class="ard"><summary><b>${esc(displayName(c))}</b> <span class="hint">${esc(c.telephone || '')}</span> · ${xs.length} achat${xs.length > 1 ? 's' : ''} · <b>${chf(xs.reduce((a, x) => a + num(x.montant), 0))}</b></summary>
      ${xs.map((x) => `<div class="row ard-l"><span>${fmtDate(x.date)}</span><span style="flex:1" class="hint">${x.self && DB.get(x.self) ? esc((DB.get(x.self).lieu || 'Self-service') + ' du ' + fmtDateCourt(DB.get(x.self).date)) : ''}</span><b>${chf(x.montant)}</b><button class="btn link small" type="button" data-act="ardEdit" data-key="${esc(x.key)}">modifier</button></div>`).join('')}</details>`; }).join('') || '<p class="hint">Tout est facturé.</p>'}
    ${l.length > af.length ? `<p class="hint">${l.length - af.length} paiement(s) déjà facturé(s).</p>` : ''}</div>`;
}
ACTIONS.ardNouveau = (el) => ACTIONS.ardEdit({ dataset: { key: '', self: el.dataset.self || '' } });
ACTIONS.ardEdit = (el) => {
  const k = el.dataset.key || '', x = k ? DB.get(k) : { date: todayISO(), self: el.dataset.self || (misesEnVente().find((s) => s.statut !== 'close') || {}).key || '' };
  const c = x.contactId ? DB.get(x.contactId) : null, ouvertes = misesEnVente().filter((s) => s.statut !== 'close' || s.key === x.self);
  const avecTel = tousContacts().filter((t) => t.telephone).sort(byName);
  openSheet(`${sheetHead(k ? 'Paiement par message' : 'Nouveau paiement par message')}<form class="sbody form" data-form="ard" id="ard-form"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ad-tel', 'Numéro de téléphone', c ? c.telephone : '', { name: 'tel', type: 'tel', req: true, attrs: { list: 'ad-tels', autocomplete: 'off', placeholder: '079 123 45 67', autofocus: k ? undefined : '' } })}
    <datalist id="ad-tels">${avecTel.map((t) => `<option value="${esc(t.telephone)}">${esc(displayName(t))}</option>`).join('')}</datalist>
    <p class="hint" id="ad-qui">${c ? '👤 ' + esc(displayName(c)) : ''}</p>
    <fieldset class="ta-partie" id="ad-nouveau" hidden><legend>Nouveau contact</legend>
      <div class="grid2">${inp('ad-pre', 'Prénom', '', { name: 'prenom' })}${inp('ad-nom', 'Nom', '', { name: 'nomFamille' })}</div>
      <div class="grid2">${inp('ad-rue', 'Rue', '', { name: 'rue' })}${inp('ad-no', 'N°', '', { name: 'numero' })}${inp('ad-npa', 'NPA', '', { name: 'npa', attrs: { inputmode: 'numeric' } })}${inp('ad-loc', 'Localité', '', { name: 'localite' })}</div>
      ${inp('ad-mail', 'E-mail (facultatif)', '', { name: 'email', type: 'email' })}
      ${txt('ad-rem', 'Remarque (facultatif)', '', { name: 'remarque', rows: 2 })}
      <p class="hint">L'adresse sert à la facture des achats par message (en fin de mois) ; avec l'e-mail, on peut la lui envoyer directement.</p></fieldset>
    <div class="grid2">${inp('ad-m', 'Montant CHF', x.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}${inp('ad-d', 'Date', x.date, { name: 'date', type: 'date' })}</div>
    <input type="hidden" name="self" value="${esc(x.self || '')}">
    ${x.facture ? `<p class="hint">Déjà facturé (${esc((DB.get(x.facture) || {}).numero || '')}).</p>` : ''}
    <div class="row-end">${k && !x.facture ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="ce paiement">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const t = $('ad-tel'), maj = () => { const cc = contactParTel(t.value); $('ad-qui').textContent = cc ? '👤 ' + displayName(cc) : chiffresTel(t.value).length >= 9 ? 'Nouveau numéro : un contact sera créé.' : ''; $('ad-nouveau').hidden = !!cc || chiffresTel(t.value).length < 9; };
  t.addEventListener('input', maj); maj();
};
FORMS.ard = (v) => {
  const m = num(v.montant); if (!(m > 0)) { toast('Indique le montant.'); return; }
  if (chiffresTel(v.tel).length < 9) { toast('Indique un numéro de téléphone complet.'); return; }
  let c = contactParTel(v.tel), ck = c ? c.key : '';
  if (!c) {
    const manque = [!String(v.prenom || v.nomFamille || '').trim() && 'le nom', !String(v.rue || '').trim() && 'la rue', !String(v.npa || '').trim() && 'le NPA', !String(v.localite || '').trim() && 'la localité', String(v.email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.email || '').trim()) && 'un e-mail valide (ou laisse vide)'].filter(Boolean);
    if (manque.length) { toast('Nouveau contact : il manque ' + manque.join(', ') + '.', 5000); return; }
  }
  if (!c) { ck = 'ct:' + uid('c'); const nom = nomComplet(v.prenom, v.nomFamille) || String(v.tel).trim(); DB.put(ck, { prenom: v.prenom || '', nomFamille: v.nomFamille || '', nom, telephone: String(v.tel).trim(), rue: String(v.rue || '').trim(), numero: String(v.numero || '').trim(), npa: String(v.npa || '').trim(), localite: String(v.localite || '').trim(), email: String(v.email || '').trim(), type: 'particulier', notes: (v.remarque ? v.remarque.trim() + '\n' : '') + 'Créé depuis un paiement par message (self-service).', cree: new Date().toISOString() }); }
  const k = v.key || 'ard:' + uid('d');
  DB.put(k, Object.assign({}, DB.get(k) || { cree: new Date().toISOString(), par: Sync.me || '' }, { date: v.date || todayISO(), contactId: ck, montant: r2(m), self: v.self || '' }));
  closeSheet(); toast(`${chf(m)} noté pour ${displayName(DB.get(ck))}.`);
};
/* Facturer (chaque fin de mois) : une facture par personne (une ligne par mois), avec le QR pour payer */
ACTIONS.ardFacturer = () => {
  const af = paiementsMessage().filter((x) => !x.facture), parC = {};
  for (const x of af) (parC[x.contactId] = parC[x.contactId] || []).push(x);
  openSheet(`${sheetHead('Facturer les paiements par message')}<form class="sbody form" data-form="ardFacturer">
    ${inp('af-d', 'Date des factures', todayISO(), { name: 'date', type: 'date' })}
    ${Object.entries(parC).map(([ck, xs]) => { const c = DB.get(ck) || {}, ok = c.npa && c.localite; return `<label class="row" style="font-size:15px;align-items:flex-start"><input type="checkbox" name="c_${esc(ck)}"${ok ? ' checked' : ' disabled'}> <span><b>${esc(displayName(c))}</b> · ${xs.length} achat${xs.length > 1 ? 's' : ''} · ${chf(xs.reduce((a, x) => a + num(x.montant), 0))}${ok ? '' : `<br><span class="bad">Adresse manquante (NPA, localité) : <a href="#/contacts/modifier/${encodeURIComponent(ck)}" data-act="close">compléter la fiche</a></span>`}</span></label>`; }).join('')}
    <p class="hint">Une facture par personne avec une ligne par mois (ex. « Ventes directes septembre 2026 · 4 achats »), à envoyer ensuite par mail ou à imprimer depuis Ventes.</p>
    <div class="row-end"><button class="btn primary" type="submit">Créer les factures</button></div></form>`);
};
FORMS.ardFacturer = (v) => {
  const pb = problemesReglages(false); if (pb.length) { toast('Réglages : il manque ' + pb.join(', ')); return; }
  const date = v.date || todayISO(), s = cfg(), delai = num(s.delai) >= 0 ? num(s.delai) : 30, faites = [];
  const af = paiementsMessage().filter((x) => !x.facture);
  for (const ck of Object.keys(v).filter((x) => x.startsWith('c_')).map((x) => x.slice(2))) {
    const c = DB.get(ck), xs = af.filter((x) => x.contactId === ck).sort((a, b) => String(a.date).localeCompare(b.date)); if (!c || !xs.length || !c.npa || !c.localite) continue;
    const mois = new Map(); for (const x of xs) { const m = x.date.slice(0, 7), o = mois.get(m) || { n: 0, t: 0 }; o.n++; o.t = r2(o.t + num(x.montant)); mois.set(m, o); }
    const lignes = [...mois.entries()].map(([m, o]) => ({ designation: `Ventes directes ${MOIS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)} · ${o.n} achat${o.n > 1 ? 's' : ''}`, quantite: 1, unite: 'forfait', prix: o.t }));
    const n = prochainNumero(date), emetteur = { nom: s.nom, titulaire: s.titulaire, rue: s.rue, numero: s.numero, npa: s.npa, localite: s.localite, telephone: s.telephone, email: s.email, iban: cleanIban(s.iban), mention: s.mention };
    const inv = Object.assign({}, n, { date, livraison: '', bulletin: '', delai, echeance: addDays(date, delai), emetteur,
      client: { id: ck, nom: billName(c), attn: attnName(c), rue: c.rue || '', numero: c.numero || '', npa: c.npa || '', localite: c.localite || '' }, lignes,
      remarque: trunc(`Achats en vente directe payés par message, du ${fmtDateCourt(xs[0].date)} au ${fmtDate(xs[xs.length - 1].date)}`, 110),
      paiement: 'virement', statut: 'ouverte', payeeLe: '', payeePar: '', encaissePar: '', facture: true, stock: false, cree: new Date().toISOString(), creePar: Sync.me || '' });
    inv.total = factureTotal(inv); const fk = 'fac:' + uid('f'); DB.put(fk, inv); faites.push(n.numero);
    for (const x of xs) DB.put(x.key, Object.assign({}, DB.get(x.key), { facture: fk }));
  }
  closeSheet(); toast(faites.length ? `${faites.length} facture${faites.length > 1 ? 's' : ''} créée${faites.length > 1 ? 's' : ''} : ${faites.join(', ')}. Elles sont dans Ventes.` : 'Aucune facture créée.', 6000);
  if (faites.length) go('#/factures');
};
ACTIONS.selfRouvrir = (el) => { const s = DB.get(el.dataset.key); if (!s) return; const o = Object.assign({}, s, { statut: 'ouverte' }); DB.put(el.dataset.key, o); stockPourSelf(el.dataset.key, o); };
/* Supprimer une mise en vente retire aussi ses mouvements de stock (les encaissements restent : c'est de l'argent reçu) */
(() => { const del = ACTIONS.delItemOk; ACTIONS.delItemOk = (el) => { const k = el.dataset.key; del(el); if (String(k).startsWith('self:') || String(k).startsWith('stp:')) for (const m of mouvements()) if (m.ref === k) DB.del(m.key); }; })();

/* ---------- Grille de prix (PDF) : produits disponibles, prix par type de client, calibres à la pièce ---------- */
const GRILLE = { dispo: true, niveaux: { part: true, resto: true, gros: true } };
ACTIONS.grilleSheet = () => {
  openSheet(`${sheetHead('Grille de prix', 'PDF à imprimer ou à envoyer')}<form class="sbody form" data-form="grille">
    <div class="field"><span class="flabel">Colonnes</span>${NIVEAUX.slice().reverse().map(([k, l]) => `<label class="row" style="font-size:14px"><input type="checkbox" name="n_${k}"${GRILLE.niveaux[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}
      <span class="sub">Pour un restaurant, ne cochez par exemple que « Restaurant & épicerie ».</span></div>
    <label class="row" style="font-size:14px"><input type="checkbox" name="dispo"${GRILLE.dispo ? ' checked' : ''}> Seulement ce qui est disponible (en stock, disponible ou au champ)</label>
    <div class="row-end"><button class="btn primary" type="submit">Télécharger le PDF</button></div></form>`);
};
FORMS.grille = (v) => {
  GRILLE.dispo = !!v.dispo; for (const [k] of NIVEAUX) GRILLE.niveaux[k] = !!v['n_' + k];
  const niv = NIVEAUX.slice().reverse().filter(([k]) => GRILLE.niveaux[k]);
  if (!niv.length) { toast('Coche au moins une colonne.'); return; }
  if (!window.jspdf) { toast("Le générateur PDF n'a pas pu se charger. Recharge la page."); return; }
  const ms = mouvements();
  const ps = produits().filter((p) => NIVEAUX.some(([k]) => !vide(prixNiveau(p, k)))).filter((p) => { if (!GRILLE.dispo) return true; const q = stockDe(p.key, ms); return (q != null && q > 0) || p.dispo || p.auChamp; });
  if (!ps.length) { toast(GRILLE.dispo ? 'Aucun produit disponible avec un prix.' : 'Aucun produit avec un prix.'); return; }
  const cv = pdfCanvas(); dessinerGrille(cv, ps, niv);
  closeSheet(); downloadFile(`Grille de prix ${cfg().nom || 'Gamins de Talus'} ${todayISO()}.pdf`, cv.doc.output('blob'), 'application/pdf');
};
function dessinerGrille(cv, ps, niv) {
  const s = cfg(), larg = 170, x0 = 20, colN = 70, colW = (larg - colN) / niv.length;
  cv.text(s.nom || 'Gamins de Talus', x0, 24, { size: 18, bold: true });
  cv.text('Grille de prix', x0, 33, { size: 13, bold: true });
  cv.text(`Valable dès le ${fmtDate(todayISO())}, selon disponibilité. Prix en CHF.`, x0, 39.5, { size: 9 });
  let y = 52;
  const tete = () => {
    cv.text('Produit', x0, y, { size: 9, bold: true });
    const T = { part: ['Particuliers', 'vente directe'], resto: ['Restaurants', 'épiceries'], gros: ['Grossistes', 'collectivités'] };
    niv.forEach(([k], i) => { const xs = x0 + colN + colW * (i + 1) - 2; cv.text(T[k][0], xs, y - 3.6, { size: 8.5, bold: true, align: 'right' }); cv.text(T[k][1], xs, y, { size: 8, align: 'right' }); });
    cv.line(x0, y + 2, x0 + larg, y + 2, { w: 0.4 }); y += 8;
  };
  tete();
  for (const p of ps) {
    if (y > 270) { cv.doc.addPage(); y = 24; tete(); }
    cv.text(trunc(p.nom, 38), x0, y, { size: 10, bold: true });
    niv.forEach(([k], i) => { const x = prixNiveau(p, k); cv.text(vide(x) ? '—' : `${money(x)} / ${p.unite || 'kg'}`, x0 + colN + colW * (i + 1) - 2, y, { size: 10, align: 'right' }); });
    y += 5.2;
    for (const c of calibresDe(p)) {
      if (y > 275) { cv.doc.addPage(); y = 24; tete(); }
      cv.text(`  ${c.nom}, à la pièce (env. ${fmtNum(c.poids, 2)} kg)`, x0, y, { size: 8.5 });
      niv.forEach(([k], i) => { const x = prixPiece(p, c, k); cv.text(x === '' ? '—' : `${money(x)} / pièce`, x0 + colN + colW * (i + 1) - 2, y, { size: 8.5, align: 'right' }); });
      y += 4.6;
    }
    if (p.remarque) { cv.text('  ' + trunc(p.remarque, 90), x0, y, { size: 8 }); y += 4.4; }
    cv.line(x0, y - 2.2, x0 + larg, y - 2.2, { w: 0.1 }); y += 2;
  }
  y += 4;
  cv.text('Les clients réguliers gardent le prix de leur dernière commande.', x0, Math.min(y, 282), { size: 8.5 });
  cv.text([s.nom, s.email, s.telephone].filter(Boolean).join(' · '), x0, 287, { size: 8.5 });
}

/* ---------- Relevé TWINT : import du fichier exporté de TWINT Business (Excel .xlsx, ou .csv) ----------
   tw:<id> = { date, montant, ref, texte, utilise? (clé de la vente ou de l'encaissement qui l'a pris) }
   À l'import : un paiement qui correspond à une vente payée par TWINT (même jour, même montant) lui est rattaché.
   Le reste se propose comme encaissement de la vente directe en cours à ces dates : le taux de vol devient exact. */
const TW = { lignes: null, entete: [], cols: {} };
/* Lecture d'un .xlsx sans bibliothèque de plus : c'est un zip de fichiers XML (JSZip est déjà là) */
async function lireXlsx(file) {
  const z = await window.JSZip.loadAsync(file), parse = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const ss = z.file('xl/sharedStrings.xml') ? [...parse(await z.file('xl/sharedStrings.xml').async('string')).getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join('')) : [];
  const nom = Object.keys(z.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]; if (!nom) throw new Error('feuille introuvable');
  const lignes = [];
  for (const row of parse(await z.file(nom).async('string')).getElementsByTagName('row')) {
    const l = [];
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '', col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0], is = c.getElementsByTagName('is')[0];
      l[col < 0 ? l.length : col] = t === 's' ? ss[Number(v && v.textContent)] : t === 'inlineStr' ? (is ? is.textContent : '') : v ? (t === 'str' || t === 'b' ? v.textContent : Number(v.textContent)) : '';
    }
    lignes.push([...l].map((x) => (x == null ? '' : x)));
  }
  return lignes;
}
function lireCsv(texte) {
  const sep = (texte.split('\n')[0].match(/;/g) || []).length >= (texte.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const out = []; let l = [], cur = '', q = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (q) { if (ch === '"' && texte[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { l.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texte[i + 1] === '\n') i++; l.push(cur); out.push(l); l = []; cur = ''; } else cur += ch;
  }
  if (cur || l.length) { l.push(cur); out.push(l); }
  return out.filter((r) => r.some((x) => String(x).trim()));
}
const twNombre = (x) => { if (typeof x === 'number') return x; const t = String(x || '').replace(/CHF|Fr\.|\s|'|’/g, ''); if (!t) return NaN; return Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); };
function twDate(x) {
  if (typeof x === 'number' && x > 20000 && x < 80000) return isoDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(x) * 864e5 + 12 * 3600e3)); // date Excel (la partie décimale est l'heure)
  const t = String(x || '').trim(); let m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
function twDevine(entete, lignes) {
  const h = entete.map((x) => sansAccentsS(x));
  const trouve = (res, test) => { let i = h.findIndex((x) => res.some((r) => r.test(x))); if (i < 0 && test) i = entete.findIndex((_, j) => lignes.slice(0, 20).filter((l) => test(l[j])).length >= Math.min(3, lignes.length)); return i; };
  return {
    date: trouve([/^date/, /datum/, /date.*trans/, /zeit/, /time/], (v) => !!twDate(v)),
    montant: trouve([/montant(?!.*frais)/, /betrag/, /amount/, /brut/, /total/], (v) => isFinite(twNombre(v)) && twNombre(v) !== 0 && !twDate(v)),
    ref: trouve([/^ref|referen|^id\b|transaction.?id|transaktions.?id/]),
    texte: trouve([/description|beschreibung|message|nachricht|texte|libelle|magasin|store|point/]),
    frais: trouve([/frais|gebuhr|fee|commission|kommission|taxe/]),
    net: trouve([/\bnet/]),
  };
}
/* Une ligne du relevé → paiement { date, montant (brut), ref, texte, frais } ; les frais TWINT : colonne « frais », ou brut − net */
function twLigne(l, c) {
  const brutOuNet = r2(twNombre(l[c.montant])), fr = c.frais >= 0 ? Math.abs(twNombre(l[c.frais])) || 0 : 0;
  const montantEstNet = c.net >= 0 && c.net === c.montant;
  const montant = montantEstNet && fr && brutOuNet > 0 ? r2(brutOuNet + fr) : brutOuNet;
  const frais = fr ? r2(fr) : (c.net >= 0 && c.net !== c.montant && montant > 0 ? Math.max(0, r2(montant - Math.abs(twNombre(l[c.net]) || montant))) : 0);
  return { date: twDate(l[c.date]), montant, ref: c.ref >= 0 ? String(l[c.ref] || '').trim() : '', texte: c.texte >= 0 ? String(l[c.texte] || '').trim() : '', frais: montant > 0 && isFinite(frais) ? frais : 0 };
}
ACTIONS.twImport = () => {
  openSheet(`${sheetHead('Importer le relevé TWINT', 'Fichier exporté de TWINT Business')}<div class="sbody">
    <p class="hint">Dans l'app TWINT Business : Transactions → icône de téléchargement → choisir la période → format Excel (.xlsx). Puis choisis le fichier ici. Un paiement déjà importé n'est jamais compté deux fois.</p>
    <input type="file" id="tw-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="tw-res"></div></div>`);
  $('tw-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; const res = $('tw-res'); res.innerHTML = '<p class="hint">Lecture…</p>';
    try {
      const rows = /\.csv$/i.test(f.name) || f.type === 'text/csv' ? lireCsv(await f.text()) : await lireXlsx(f);
      let hi = rows.findIndex((r) => r.filter((x) => typeof x === 'string' && x.trim() && !twDate(x) && !isFinite(twNombre(x))).length >= 2); if (hi < 0) hi = 0;
      TW.entete = rows[hi].map((x, j) => String(x || 'Colonne ' + (j + 1))); TW.lignes = rows.slice(hi + 1).filter((r) => r.some((x) => String(x).trim())); TW.cols = twDevine(TW.entete, TW.lignes);
      twApercu();
    } catch (err) { res.innerHTML = `<p class="errors">Fichier illisible : ${esc(err.message)}</p>`; }
  });
};
function twApercu() {
  const res = $('tw-res'); if (!res) return; const c = TW.cols, opts = (v) => `<option value="-1">—</option>${TW.entete.map((h, j) => `<option value="${j}"${j === v ? ' selected' : ''}>${esc(h)}</option>`).join('')}`;
  const tx = twTransactions();
  const fr = r2(tx.reduce((a, t) => a + (t.frais || 0), 0));
  res.innerHTML = `<div class="grid2">${[['date', 'Colonne date'], ['montant', 'Colonne montant'], ['frais', 'Frais TWINT (facultatif)'], ['ref', 'Référence (facultatif)'], ['texte', 'Texte (facultatif)']].map(([k, l]) => `<div class="field"><label for="tw-${k}">${l}</label><select id="tw-${k}" data-twc="${k}">${opts(c[k])}</select></div>`).join('')}</div>
    <p class="hint">${tx.length} paiement${tx.length > 1 ? 's' : ''} reconnu${tx.length > 1 ? 's' : ''}${tx.length ? `, du ${fmtDate(tx[0].date)} au ${fmtDate(tx[tx.length - 1].date)}, total ${chf(tx.reduce((a, t) => a + t.montant, 0))}` : ''}.${fr ? ` Frais TWINT : <b>${chf(fr)}</b> (enregistrés en dépense, un total par mois, compte 6900 Frais bancaires).` : tx.length ? ' Pas de colonne de frais trouvée : choisis-la ci-dessus si le fichier en a une.' : ''}</p>
    ${tx.length ? `<div class="table-wrap"><table class="list"><tbody>${tx.slice(0, 5).map((t) => `<tr><td class="num">${fmtDate(t.date)}</td><td>${esc(trunc(t.texte || t.ref, 40))}</td><td class="r num">${money(t.montant)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="row-end"><button class="btn primary" type="button" data-act="twImportOk"${tx.length ? '' : ' disabled'}>Importer</button></div>`;
  res.querySelectorAll('select[data-twc]').forEach((el) => el.addEventListener('change', () => { TW.cols[el.dataset.twc] = Number(el.value); twApercu(); }));
}
function twTransactions() {
  const c = TW.cols; if (!TW.lignes || c.date < 0 || c.montant < 0) return [];
  return TW.lignes.map((l) => twLigne(l, c))
    .filter((t) => t.date && isFinite(t.montant) && t.montant !== 0).sort((a, b) => a.date.localeCompare(b.date));
}
ACTIONS.twImportOk = () => {
  const r = importerTransactionsTwint(twTransactions());
  closeSheet(); toast((r.n ? `${r.n} paiement${r.n > 1 ? 's' : ''} TWINT importé${r.n > 1 ? 's' : ''}${r.lies ? `, dont ${r.lies} rattaché${r.lies > 1 ? 's' : ''} à des ventes` : ''}.` : 'Rien de nouveau : ces paiements étaient déjà importés.') + (r.frais ? ` Frais TWINT : ${chf(r.frais)} en dépense.` : ''), 6000);
};
/* Ajoute les paiements d'un relevé TWINT (sans doublon) ; aussi utilisé par la vérification des relevés de fin d'année */
function importerTransactionsTwint(tx) {
  let n = 0, lies = 0; const deja = new Set(DB.all('tw:').flatMap((t) => [t.cle, t.apparie]).filter(Boolean)), vus = {};
  const ventes = factures().filter((f) => f.payeePar === 'twint' && f.statut === 'payee'), prises = new Set(DB.all('tw:').map((t) => t.utilise).filter(Boolean));
  const mois = new Set();
  for (const t of tx) {
    const base = t.ref || `${t.date}|${t.montant}|${t.texte}`; vus[base] = (vus[base] || 0) + 1; const cle = t.ref ? t.ref : base + '|' + vus[base];
    if (t.frais) mois.add(t.date.slice(0, 7));
    if (deja.has(cle)) { if (t.frais) { const x = DB.all('tw:').find((y) => y.cle === cle || y.apparie === cle); if (x && x.frais !== t.frais) DB.put(x.key, Object.assign({}, DB.get(x.key), { frais: t.frais })); } continue; }
    /* Déjà enregistré depuis le mail TWINT (même jour, même montant) : on le relie, sans le recompter */
    const viaMail = DB.all('tw:').find((x) => x.src === 'mail' && !x.apparie && x.date === t.date && Math.abs(num(x.montant) - t.montant) < 0.01);
    if (viaMail) { DB.put(viaMail.key, Object.assign({}, viaMail, { apparie: cle, ref: t.ref || viaMail.ref }, t.frais ? { frais: t.frais } : {})); deja.add(cle); continue; }
    const o = Object.assign({ cle, importe: new Date().toISOString(), par: Sync.me || '' }, t);
    const v = ventes.find((f) => !prises.has(f.key) && (f.payeeLe || f.date) === t.date && Math.abs(num(f.total) - t.montant) < 0.01);
    if (v) { o.utilise = v.key; prises.add(v.key); lies++; }
    if (!o.frais) delete o.frais;
    DB.put('tw:' + uid('w'), o); n++;
  }
  return { n, lies, frais: majFraisTwint(mois) };
}
/* Frais TWINT Business → une dépense par mois (dep:twfrais-AAAA-MM, compte 6900), recalculée à chaque import : jamais en double */
function majFraisTwint(mois) {
  let tot = 0;
  for (const m of mois) {
    const l = DB.all('tw:').filter((t) => String(t.date).slice(0, 7) === m && num(t.frais) > 0), f = r2(l.reduce((a, t) => a + num(t.frais), 0));
    const k = 'dep:twfrais-' + m, old = DB.get(k); if (!f && !old) continue; tot += f;
    const [Y, M] = m.split('-').map(Number), fin = isoDate(new Date(Y, M, 0, 12)), d = fin > todayISO() ? todayISO() : fin;
    const nomMois = new Date(m + '-15T12:00').toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
    DB.put(k, Object.assign({ cree: new Date().toISOString(), creePar: Sync.me || '', n: 1 + Math.max(0, ...depenses().map((x) => x.n || 0)) }, old || {}, {
      date: d, montant: f, objet: `Frais TWINT ${nomMois}`, type: 'charge', compte: '6900', par: (typeof titulaireCompte === 'function' && titulaireCompte()) || Sync.me || '',
      justificatif: 'Relevé TWINT', remarque: `${l.length} paiement${l.length > 1 ? 's' : ''} : frais retenus par TWINT sur les versements (calculé depuis le relevé).`, auto: 'twint' }));
  }
  return r2(tot);
}
/* Paiements TWINT libres pendant une vente directe (de la mise en vente à la clôture, ou aujourd'hui) */
function twintPourSelf(s) {
  const fin = s.closeLe || todayISO(), l = DB.all('tw:').filter((t) => (!t.utilise || !DB.get(t.utilise)) && t.montant > 0 && t.date >= s.date && t.date <= fin).sort((a, b) => a.date.localeCompare(b.date));
  return { n: l.length, total: r2(l.reduce((a, t) => a + t.montant, 0)), de: l.length ? l[0].date : '', a: l.length ? l[l.length - 1].date : '', l };
}
ACTIONS.twEncaisser = (el) => {
  const k = el.dataset.key, s = DB.get(k); if (!s) return; const t = twintPourSelf(Object.assign({ key: k }, s)); if (!t.n) return;
  const rk = 'rec:' + uid('r');
  DB.put(rk, { date: t.a, montant: t.total, moyen: 'TWINT', par: cfg().compteDe || Sync.me || '', client: s.lieu || 'Self-service', libelle: `Vente directe ${fmtDate(s.date)} · ${t.n} paiements TWINT importés`, self: k, cree: new Date().toISOString() });
  for (const x of t.l) DB.put(x.key, Object.assign({}, DB.get(x.key), { utilise: rk }));
  toast(`${chf(t.total)} ajoutés aux encaissements.`);
};
ACTIONS.twListe = () => {
  const l = DB.all('tw:').sort((a, b) => b.date.localeCompare(a.date));
  const lib = (t) => { if (!t.utilise) return '<span class="hint">libre</span>'; const x = DB.get(t.utilise); return x ? (String(t.utilise).startsWith('fac:') ? esc(nomVente(x)) : 'vente directe') : '<span class="hint">libre</span>'; };
  openSheet(`${sheetHead('Paiements TWINT importés', `${l.length} · ${chf(l.reduce((a, t) => a + t.montant, 0))}`)}<div class="sbody"><div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>Texte</th><th class="r">Montant</th><th>Compté dans</th></tr></thead><tbody>
    ${l.slice(0, 300).map((t) => `<tr><td class="num">${fmtDate(t.date)}</td><td>${esc(trunc(t.texte || t.ref || '', 40))}</td><td class="r num">${money(t.montant)}</td><td>${lib(t)}</td></tr>`).join('')}</tbody></table></div>
    <p class="hint">« Libre » : pas encore compté. Il se propose comme encaissement de la vente directe en cours à cette date.</p></div>`);
};
