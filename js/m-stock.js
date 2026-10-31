/* Gamins de Talus — stock, récoltes et vente directe (self-service).
   Le stock d'un produit n'est jamais une case qu'on écrase : c'est la somme de ses mouvements, chacun une ligne à part
   (deux personnes peuvent noter en même temps sans s'écraser).
   mvt:<id>   { date, prod, qte (+ entrée / − sortie, dans l'unité du produit), type, culture?, ref?, par, note?, horsStock? }
              type : recolte | vente | self (mis au stand) | retour (invendus repris) | perte | ajout | inventaire (compte : qte = total)
              Clés fixes pour ce qui découle d'autre chose : mvt:fac:<facture>:<ligne>, mvt:self:<mise>:<ligne>, mvt:ev:<événement>:<date>.
   prod:<id>  + { fiche (culture liée), dispo (en stock sans quantité), auChamp } — la vente directe prend le prix « particuliers »
   self:<id>  mise en vente directe { date, lieu, lignes: [{ prod, qte, prix }], retours: { i: qte }, statut: ouverte | close, note }
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
  return `<div class="row"><button class="btn primary" type="button" data-act="mvtNouveau" data-type="recolte">+ Noter une récolte</button><a class="btn" href="#/factures/selfservice">Vente directe (self-service)</a><button class="btn" type="button" data-act="grilleSheet">Grille de prix (PDF)</button></div>
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

/* Noter un mouvement : récolte, sortie (perte), comptage */
ACTIONS.mvtNouveau = (el) => {
  const type = el.dataset.type || 'recolte', s = typeof saisonCourante === 'function' ? saisonCourante() : todayISO().slice(0, 4);
  const culs = typeof cultures === 'function' ? cultures(s) : [];
  let prod = el.dataset.prod || '', cul = el.dataset.culture || '';
  const ref = el.dataset.ref || '', date = el.dataset.date || todayISO();
  if (!prod && cul) { const p = produitDeCulture(DB.get(cul)); if (p) prod = p.key; }
  if (prod && !cul && type === 'recolte') { const p = DB.get(prod), c = culs.find((x) => p && ((p.fiche && ficheDe(x) === p.fiche) || sansAccentsS(x.nom) === sansAccentsS(p.nom))); if (c) cul = c.key; }
  const titres = { recolte: 'Noter une récolte', perte: 'Sortie de stock', inventaire: 'Compter le stock', ajout: 'Ajouter au stock' };
  openSheet(`${sheetHead(titres[type] || 'Mouvement de stock')}<form class="sbody form" data-form="mvt"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="ref" value="${esc(ref)}">
    <div class="grid2">${inp('mv-date', 'Date', date, { name: 'date', type: 'date' })}
      ${type === 'recolte' ? sel('mv-cul', `Culture (plan ${s})`, cul, [['', '—']].concat(culs.map((c) => [c.key, c.nom])), { name: 'culture' }) : ''}
      ${sel('mv-prod', 'Produit', prod, [['', type === 'recolte' ? '— (pas de produit)' : 'Choisir…']].concat(produits().map((p) => [p.key, p.nom + ' (' + (p.unite || '') + ')'])), { name: 'prod' })}
      ${inp('mv-q', type === 'inventaire' ? 'Quantité comptée' : 'Quantité', '', { name: 'qte', type: 'number', attrs: { autofocus: '' } })}</div>
    ${type === 'recolte' ? `<label class="row" style="font-size:14px"><input type="checkbox" name="enStock" checked> Ajouter au stock</label><p class="hint">La récolte compte aussi dans la récolte réelle de la culture (Cultures). Sans produit, elle n'entre pas dans le stock.</p>` : ''}
    ${type === 'perte' ? `<p class="hint">Abîmé, mangé, donné… Pour une vente, passe plutôt par « Nouvelle vente » : le stock baisse tout seul.</p>` : ''}
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
function renderSelfService() {
  const l = misesEnVente(), ouv = l.filter((s) => s.statut !== 'close'), clo = l.filter((s) => s.statut === 'close');
  const tot = clo.reduce((a, s) => { const b = bilanSelf(Object.assign({ key: s.key }, s)); return { v: a.v + b.vendu, e: a.e + b.enc }; }, { v: 0, e: 0 });
  const carte = (s) => {
    const b = bilanSelf(s), recs = recettesDirectes().filter((r) => r.self === s.key).sort((a, c) => String(a.date).localeCompare(c.date));
    return `<div class="panel self${s.statut === 'close' ? ' close' : ''}"><div class="between"><h3 style="margin:0">${esc(s.lieu || 'Self-service')} · ${fmtDate(s.date)}</h3><span class="tpill">${s.statut === 'close' ? 'bouclée' : 'en cours'}</span></div>
      <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th class="r">Mis</th><th class="r">Prix</th>${s.statut === 'close' ? '<th class="r">Invendus</th><th class="r">Vendus</th>' : ''}<th class="r">Valeur</th></tr></thead><tbody>
      ${(s.lignes || []).map((x, i) => { const p = DB.get(x.prod) || {}, r = num((s.retours || {})[i]), v = Math.max(0, num(x.qte) - r); return `<tr><td>${esc(x.nom || p.nom || '?')}${x.calibre && !x.nom ? ' ' + esc(String(x.calibre).toLowerCase()) : ''}</td><td class="r num">${fmtQ(num(x.qte), x.unite || p.unite)}</td><td class="r num">${money(x.prix)}</td>${s.statut === 'close' ? `<td class="r num">${fmtNum(r, 0)}</td><td class="r num">${fmtNum(v, 0)}</td>` : ''}<td class="r num">${money((s.statut === 'close' ? v : num(x.qte)) * num(x.prix))}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p>Encaissé : <b>${chf(b.enc)}</b>${b.msg ? ` <span class="hint">(dont ${chf(b.msg)} payés par message, à facturer)</span>` : ''}${s.statut === 'close' ? ` sur ${chf(b.vendu)} vendus · <b class="${b.taux > 0.1 ? 'bad' : ''}">${b.ecart > 0 ? `${chf(b.ecart)} manquants (${Math.round(b.taux * 100)} %)` : 'rien ne manque'}</b>` : ` · au plus ${chf(b.mis)} si tout part`}</p>
      ${recs.length ? `<p class="hint">${recs.map((r) => `${fmtDate(r.date)} ${esc(r.moyen || '')} ${money(r.montant)}`).join(' · ')}</p>` : ''}
      ${(() => { const t = twintPourSelf(s); return t.n ? `<div class="banner">TWINT importé pendant cette vente : <b>${chf(t.total)}</b> (${t.n} paiement${t.n > 1 ? 's' : ''}, du ${fmtDateCourt(t.de)} au ${fmtDateCourt(t.a)}). <button class="btn small primary" type="button" data-act="twEncaisser" data-key="${esc(s.key)}">Ajouter comme encaissement</button></div>` : ''; })()}
      <div class="row">${s.statut !== 'close' ? `<button class="btn primary small" type="button" data-act="selfEnc" data-key="${esc(s.key)}">+ Encaissement</button><button class="btn small" type="button" data-act="ardNouveau" data-self="${esc(s.key)}">+ Payé par message</button><button class="btn small" type="button" data-act="selfClore" data-key="${esc(s.key)}">Boucler (invendus)</button>` : `<button class="btn small" type="button" data-act="selfRouvrir" data-key="${esc(s.key)}">Rouvrir</button>`}<button class="btn small" type="button" data-act="delItem" data-key="${esc(s.key)}" data-what="cette mise en vente">Supprimer</button></div></div>`;
  };
  return `${articlesHtml()}${paiementsMessageHtml()}<div class="row"><button class="btn primary" type="button" data-act="selfNouveau">+ Mise en vente directe</button><button class="btn" type="button" data-act="twImport">Importer le relevé TWINT</button>${DB.all('tw:').length ? `<button class="btn" type="button" data-act="twListe">Paiements TWINT (${DB.all('tw:').length})</button>` : ''}</div>
    <div class="stats"><div class="stat"><span class="k">Ventes directes bouclées</span><span class="v">${clo.length}</span></div>
      <div class="stat good"><span class="k">Vendu (selon les invendus)</span><span class="v">${chf(tot.v)}</span></div>
      <div class="stat blue"><span class="k">Encaissé (TWINT, espèces)</span><span class="v">${chf(tot.e)}</span></div>
      <div class="stat ${tot.v && (tot.v - tot.e) / tot.v > 0.1 ? 'bad' : ''}"><span class="k">Manque (vol, erreurs)</span><span class="v">${tot.v ? Math.round(Math.max(0, tot.v - tot.e) / tot.v * 100) + ' %' : '—'}</span><span class="s">${chf(Math.max(0, tot.v - tot.e))}</span></div></div>
    <p class="hint">1. « Mise en vente » : ce qui part au stand, au prix de vente directe (le stock baisse). 2. « Encaissement » à chaque relevé TWINT ou de la caisse : il entre dans les recettes. 3. « Boucler » : on compte les invendus (ils reviennent au stock) et l'app compare ce qui est parti à ce qui a été payé.</p>
    ${ouv.map(carte).join('')}${clo.slice(0, 12).map(carte).join('')}${!l.length ? '<div class="panel"><p class="empty">Aucune mise en vente pour l\'instant.</p></div>' : ''}`;
}
ACTIONS.selfNouveau = () => {
  /* Prix de vente directe = prix « Particuliers & vente directe » du produit (haut de la fourchette, ou fixé à la main) */
  const ps = produits().filter((p) => num(prixNiveau(p, 'part')) > 0), arts = articles().filter((a) => a.actif !== false);
  if (!ps.length && !arts.length) { toast('Crée d\'abord un article de vente directe, ou mets une fourchette de prix sur un produit.', 5000); return; }
  const lgnArt = arts.map((a) => { const p = DB.get(a.prod) || {}, q = stockDe(a.prod); return `<tr><td><b>${esc(a.nom)}</b> <span class="hint">${esc(descArticle(a))}</span></td><td><input class="cell-in" name="qa_${esc(a.key)}" inputmode="numeric" placeholder="0" style="width:70px"> <span class="hint">${a.mode === 'lot' ? 'lots' : 'pièces'}</span></td><td><input class="cell-in" name="pa_${esc(a.key)}" inputmode="decimal" value="${esc(String(prixArticle(a)).replace('.', ','))}" style="width:70px"></td><td class="r hint">${q == null ? (p.dispo ? 'dispo' : '—') : fmtQ(q, p.unite)}</td></tr>`; }).join('');
  openSheet(`${sheetHead('Mise en vente directe')}<form class="sbody form" data-form="self">
    <div class="grid2">${inp('sf-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('sf-lieu', 'Où', 'Self-service', { name: 'lieu' })}</div>
    ${arts.length ? `<h3>Articles</h3><div class="table-wrap"><table class="list"><thead><tr><th>Article</th><th>Quantité</th><th>Prix</th><th class="r">Stock</th></tr></thead><tbody>${lgnArt}</tbody></table></div>` : ''}
    ${ps.length ? `<details${arts.length ? '' : ' open'}><summary class="hint" style="cursor:pointer">${arts.length ? 'Autres produits (au kg ou par calibre)' : 'Produits'}</summary>` : ''}
    <div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th>Quantité</th><th>Prix</th><th class="r">Stock</th></tr></thead><tbody>
    ${ps.map((p) => { const q = stockDe(p.key), st = `<td class="r hint">${q == null ? (p.dispo ? 'dispo' : '—') : fmtQ(q, p.unite)}</td>`, cs = calibresDe(p);
      const ligne = (id, nom, unite, prix, stock) => `<tr><td>${nom}</td><td><input class="cell-in" name="q_${esc(id)}" inputmode="decimal" placeholder="0" style="width:70px"> <span class="hint">${esc(unite)}</span></td><td><input class="cell-in" name="p_${esc(id)}" inputmode="decimal" value="${esc(String(prix).replace('.', ','))}" style="width:70px"></td>${stock}</tr>`;
      return cs.map((c, j) => ligne(p.key + '|' + j, `${esc(p.nom)} <b>${esc(c.nom)}</b> <span class="hint">≈ ${fmtNum(c.poids, 2)} kg</span>`, 'pièces', prixPiece(p, c, 'part'), j === 0 ? st : '<td></td>')).join('')
        + ligne(p.key, esc(p.nom) + (cs.length ? ' <span class="hint">au ' + esc(p.unite) + '</span>' : ''), p.unite, prixNiveau(p, 'part'), cs.length ? '<td></td>' : st); }).join('')}
    </tbody></table></div>${ps.length ? '</details>' : ''}
    ${inp('sf-note', 'Note', '', { name: 'note' })}
    <p class="hint">Prix proposé : le prix « Particuliers & vente directe » du produit, modifiable ici pour cette fois. Le stock baisse de ces quantités.</p>
    <div class="row-end"><button class="btn primary" type="submit">Mettre en vente</button></div></form>`);
};
FORMS.self = (v) => {
  const lignes = [];
  for (const a of articles()) { const q = num(v['qa_' + a.key]); if (q > 0) lignes.push({ prod: a.prod, art: a.key, nom: a.nom, qte: q, prix: r2(num(v['pa_' + a.key])), unite: a.mode === 'lot' ? 'lot' : 'pièce', poids: poidsArticle(a) }); }
  for (const p of produits()) {
    calibresDe(p).forEach((c, j) => { const id = p.key + '|' + j; if (num(v['q_' + id]) > 0) lignes.push({ prod: p.key, qte: num(v['q_' + id]), prix: r2(num(v['p_' + id])), unite: 'pièce', calibre: c.nom, poids: num(c.poids) }); });
    if (num(v['q_' + p.key]) > 0) lignes.push({ prod: p.key, qte: num(v['q_' + p.key]), prix: r2(num(v['p_' + p.key])), unite: p.unite });
  }
  if (!lignes.length) { toast('Indique au moins une quantité.'); return; }
  const k = 'self:' + uid('s'), s = { date: v.date || todayISO(), lieu: v.lieu || 'Self-service', lignes, retours: {}, statut: 'ouverte', note: v.note, par: Sync.me || '', cree: new Date().toISOString() };
  DB.put(k, s); stockPourSelf(k, s); closeSheet(); toast('Mise en vente enregistrée.');
};
/* Quantité vendue exprimée dans l'unité du stock : pièces × poids moyen pour un calibre, sinon même unité seulement */
function enUniteDeStock(p, qte, unite, poids) { if (num(poids) > 0 && (p.unite || 'kg') === 'kg') return r2(num(qte) * num(poids)); return !unite || !p.unite || unite === p.unite ? num(qte) : null; }
function stockPourSelf(k, s) {
  (s.lignes || []).forEach((l, i) => {
    const p = DB.get(l.prod); if (!p || stockDe(l.prod) == null) return;
    const q = enUniteDeStock(p, l.qte, l.unite, l.poids); if (q == null) return;
    DB.put(`mvt:self:${k.slice(5)}:${i}`, { date: s.date, prod: l.prod, qte: -q, type: 'self', ref: k, par: s.par || '', note: num(l.poids) ? `${fmtNum(num(l.qte), 0)} pièce(s) ${l.calibre || ''}`.trim() : '' });
    const r = num((s.retours || {})[i]), kr = `mvt:selfr:${k.slice(5)}:${i}`;
    if (s.statut === 'close' && r > 0) DB.put(kr, { date: s.closeLe || todayISO(), prod: l.prod, qte: enUniteDeStock(p, r, l.unite, l.poids) ?? r, type: 'retour', ref: k, par: Sync.me || '' }); else if (DB.get(kr)) DB.del(kr);
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
  return `<div class="panel"><div class="between"><h2>Articles de vente directe</h2><button class="btn small" type="button" data-act="artEdit">+ Article</button></div>
    ${l.length ? `<div class="items">${l.map((a) => { const p = DB.get(a.prod) || {}, q = stockDe(a.prod), auto = !(num(a.prix) > 0);
      return `<button type="button" class="item${a.actif === false ? ' off' : ''}" data-act="artEdit" data-key="${esc(a.key)}"><span class="who"><strong>${esc(a.nom)}</strong><span class="meta">${esc(descArticle(a))} · ${esc(p.nom || 'produit ?')}${q != null ? ' · stock ' + esc(fmtQ(q, p.unite)) : ''}${a.actif === false ? ' · pas en vente' : ''}</span></span><span class="amt">${chf(prixArticle(a))}${auto ? '<br><span class="hint">auto</span>' : ''}</span></button>`; }).join('')}</div>`
      : '<p class="hint">Par exemple « Butternut moyenne » (pièce de 900 g à 1,4 kg, prix calculé tout seul) ou « Sachet de patates douces » (1,3 kg à 10 CHF). Mettre un article en vente retire son poids du stock du produit.</p>'}</div>`;
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
function paiementsMessageHtml() {
  const l = paiementsMessage(), af = l.filter((x) => !x.facture);
  if (!l.length) return `<div class="panel"><div class="between"><h2>Payé par message</h2><button class="btn small" type="button" data-act="ardNouveau">+ Paiement par message</button></div><p class="hint">Quelqu'un se sert au stand et t'envoie un SMS ou un WhatsApp avec le montant (au lieu de TWINT) : note le numéro et le montant. Comme pour TWINT, ça compte comme encaissé dans le bilan de la vente directe. En fin de saison, « Facturer » fait une facture par personne.</p></div>`;
  const parC = {}; for (const x of af) { (parC[x.contactId] = parC[x.contactId] || []).push(x); }
  return `<div class="panel"><div class="between"><h2>Payé par message · à facturer ${chf(af.reduce((a, x) => a + num(x.montant), 0))}</h2><span class="row"><button class="btn small" type="button" data-act="ardNouveau">+ Paiement par message</button>${af.length ? '<button class="btn small primary" type="button" data-act="ardFacturer">Facturer…</button>' : ''}</span></div>
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
    <div class="grid2" id="ad-nouveau" hidden>${inp('ad-pre', 'Prénom (nouveau contact)', '', { name: 'prenom' })}${inp('ad-nom', 'Nom', '', { name: 'nomFamille' })}</div>
    <div class="grid2">${inp('ad-m', 'Montant CHF', x.montant ?? '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal' } })}${inp('ad-d', 'Date', x.date, { name: 'date', type: 'date' })}</div>
    ${ouvertes.length ? sel('ad-self', 'Mise en vente', x.self || '', [['', '—']].concat(ouvertes.map((s) => [s.key, `${s.lieu || 'Self-service'} · ${fmtDate(s.date)}`])), { name: 'self', sub: 'Compte comme payé dans le bilan de cette vente directe.' }) : ''}
    ${x.facture ? `<p class="hint">Déjà facturé (${esc((DB.get(x.facture) || {}).numero || '')}).</p>` : ''}
    <div class="row-end">${k && !x.facture ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="ce paiement">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const t = $('ad-tel'), maj = () => { const cc = contactParTel(t.value); $('ad-qui').textContent = cc ? '👤 ' + displayName(cc) : chiffresTel(t.value).length >= 9 ? 'Nouveau numéro : un contact sera créé.' : ''; $('ad-nouveau').hidden = !!cc || chiffresTel(t.value).length < 9; };
  t.addEventListener('input', maj); maj();
};
FORMS.ard = (v) => {
  const m = num(v.montant); if (!(m > 0)) { toast('Indique le montant.'); return; }
  if (chiffresTel(v.tel).length < 9) { toast('Indique un numéro de téléphone complet.'); return; }
  let c = contactParTel(v.tel), ck = c ? c.key : '';
  if (!c) { ck = 'ct:' + uid('c'); const nom = nomComplet(v.prenom, v.nomFamille) || String(v.tel).trim(); DB.put(ck, { prenom: v.prenom || '', nomFamille: v.nomFamille || '', nom, telephone: String(v.tel).trim(), type: 'particulier', notes: 'Créé depuis un paiement par message (vente directe).', cree: new Date().toISOString() }); }
  const k = v.key || 'ard:' + uid('d');
  DB.put(k, Object.assign({}, DB.get(k) || { cree: new Date().toISOString(), par: Sync.me || '' }, { date: v.date || todayISO(), contactId: ck, montant: r2(m), self: v.self || '' }));
  closeSheet(); toast(`${chf(m)} noté pour ${displayName(DB.get(ck))}.`);
};
/* Fin de saison : une facture par personne (une ligne par mois), avec le QR pour payer */
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
(() => { const del = ACTIONS.delItemOk; ACTIONS.delItemOk = (el) => { const k = el.dataset.key; del(el); if (String(k).startsWith('self:')) for (const m of mouvements()) if (m.ref === k) DB.del(m.key); }; })();

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
  };
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
  res.innerHTML = `<div class="grid2">${[['date', 'Colonne date'], ['montant', 'Colonne montant'], ['ref', 'Référence (facultatif)'], ['texte', 'Texte (facultatif)']].map(([k, l]) => `<div class="field"><label for="tw-${k}">${l}</label><select id="tw-${k}" data-twc="${k}">${opts(c[k])}</select></div>`).join('')}</div>
    <p class="hint">${tx.length} paiement${tx.length > 1 ? 's' : ''} reconnu${tx.length > 1 ? 's' : ''}${tx.length ? `, du ${fmtDate(tx[0].date)} au ${fmtDate(tx[tx.length - 1].date)}, total ${chf(tx.reduce((a, t) => a + t.montant, 0))}` : ''}.</p>
    ${tx.length ? `<div class="table-wrap"><table class="list"><tbody>${tx.slice(0, 5).map((t) => `<tr><td class="num">${fmtDate(t.date)}</td><td>${esc(trunc(t.texte || t.ref, 40))}</td><td class="r num">${money(t.montant)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="row-end"><button class="btn primary" type="button" data-act="twImportOk"${tx.length ? '' : ' disabled'}>Importer</button></div>`;
  res.querySelectorAll('select[data-twc]').forEach((el) => el.addEventListener('change', () => { TW.cols[el.dataset.twc] = Number(el.value); twApercu(); }));
}
function twTransactions() {
  const c = TW.cols; if (!TW.lignes || c.date < 0 || c.montant < 0) return [];
  return TW.lignes.map((l) => ({ date: twDate(l[c.date]), montant: r2(twNombre(l[c.montant])), ref: c.ref >= 0 ? String(l[c.ref] || '').trim() : '', texte: c.texte >= 0 ? String(l[c.texte] || '').trim() : '' }))
    .filter((t) => t.date && isFinite(t.montant) && t.montant !== 0).sort((a, b) => a.date.localeCompare(b.date));
}
ACTIONS.twImportOk = () => {
  const tx = twTransactions(); let n = 0, lies = 0; const deja = new Set(DB.all('tw:').map((t) => t.cle)), vus = {};
  const ventes = factures().filter((f) => f.payeePar === 'twint' && f.statut === 'payee'), prises = new Set(DB.all('tw:').map((t) => t.utilise).filter(Boolean));
  for (const t of tx) {
    const base = t.ref || `${t.date}|${t.montant}|${t.texte}`; vus[base] = (vus[base] || 0) + 1; const cle = t.ref ? t.ref : base + '|' + vus[base];
    if (deja.has(cle)) continue;
    const o = Object.assign({ cle, importe: new Date().toISOString(), par: Sync.me || '' }, t);
    const v = ventes.find((f) => !prises.has(f.key) && (f.payeeLe || f.date) === t.date && Math.abs(num(f.total) - t.montant) < 0.01);
    if (v) { o.utilise = v.key; prises.add(v.key); lies++; }
    DB.put('tw:' + uid('w'), o); n++;
  }
  closeSheet(); toast(n ? `${n} paiement${n > 1 ? 's' : ''} TWINT importé${n > 1 ? 's' : ''}${lies ? `, dont ${lies} rattaché${lies > 1 ? 's' : ''} à des ventes` : ''}.` : 'Rien de nouveau : ces paiements étaient déjà importés.', 5000);
};
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
