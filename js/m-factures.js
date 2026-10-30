/* Gamins de Talus — ventes : chaque vente (fac:) peut avoir une facture (QR ou comptant), un bulletin de livraison,
   ou aucun document (vente au marché, payée sur place). Elle fait baisser le stock si on le veut. Produits et prix. */
'use strict';

const factures = () => DB.all('fac:').map((f) => Object.assign(f, { total: r2(f.total) }));
const produits = () => DB.all('prod:').sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || String(a.nom).localeCompare(b.nom, 'fr'));
const UNITES = ['kg', 'pièce', 'caisse', 'botte', 'forfait'];
const facStatut = (f) => factureStatut(f, todayISO());
const FAC_LABEL = { ouverte: 'Ouverte', retard: 'En retard', payee: 'Payée', annulee: 'Annulée', groupee: 'Facturée' };
function facLabel(f) { const s = facStatut(f); if (s === 'groupee') return 'Facturée (mois)'; if (s === 'payee') return 'Payée' + (f.payeePar === 'especes' ? ' comptant' : f.payeePar === 'twint' ? ' TWINT' : '') + (f.payeeLe ? ' le ' + fmtDate(f.payeeLe) : ''); return FAC_LABEL[s]; }
function numerosEnDouble() { const c = {}; for (const f of factures()) if (f.statut !== 'annulee' && f.numero) c[f.numero] = (c[f.numero] || 0) + 1; return c; }
const nomVente = (f) => f.numero ? 'Facture ' + f.numero : f.blNumero ? 'Bulletin ' + f.blNumero : 'Vente';
function prochainBL(dateIso) {
  const y = (dateIso || todayISO()).slice(0, 4); let max = 0;
  for (const f of factures()) { const m = String(f.blNumero || '').match(/^BL-(\d{4})-(\d+)$/); if (m && m[1] === y) max = Math.max(max, Number(m[2])); }
  return `BL-${y}-${String(max + 1).padStart(3, '0')}`;
}
function prochainNumero(dateIso) {
  const y = (dateIso || todayISO()).slice(0, 4), pre = (cfg().prefixe || 'GDT').replace(/[^A-Za-z0-9]/g, '') || 'GDT';
  let max = 0; for (const f of factures()) if (String(f.annee) === y && Number(f.seq) > max) max = Number(f.seq);
  return { numero: `${pre}-${y}-${String(max + 1).padStart(3, '0')}`, seq: max + 1, annee: y };
}
function problemesReglages(cash) {
  const s = cfg(), p = [];
  if (!s.nom) p.push("le nom de l'activité");
  if (!cash) { if (!s.titulaire) p.push('le titulaire du compte'); if (!s.rue) p.push('ta rue'); if (!s.npa || !s.localite) p.push('ton NPA et ta localité'); if (!ibanCheck(s.iban).ok) p.push('un IBAN valide'); }
  return p;
}

/* ---------- Brouillon de facture ---------- */
const draftF = { clientId: '', date: todayISO(), livraison: '', bulletin: '', remarque: '', paiement: 'virement', lignes: [], facture: true, bl: false, stock: true, moyen: 'especes' };
const EXAMPLE_CLIENT = { nom: 'Exemple : Grossiste SA', attn: '', rue: "Route de l'Exemple", numero: '1', npa: '1700', localite: 'Fribourg' };
/* Prix d'un produit selon le type de client ; sinon le prix par défaut. Modifiable ensuite sur chaque facture. */
const vide = (v) => v === '' || v == null;
/* Trois niveaux de prix, calculés depuis la fourchette min–max du produit (et modifiables à la main dans le produit) :
   grossistes et restauration collective = le minimum ; restaurants et épiceries = un tiers de la fourchette ; particuliers = le maximum.
   Les anciens prix par type (prixParType, prix) ne servent plus que pour les produits sans fourchette. */
const NIVEAUX = [['gros', 'Grossiste & restauration collective'], ['resto', 'Restaurant & épicerie'], ['part', 'Particuliers & vente directe']];
const NIVEAU_COURT = { gros: 'Grossiste', resto: 'Resto & épicerie', part: 'Particulier' };
const niveauDeType = (t) => (t === 'grossiste' || t === 'collectivite' ? 'gros' : t === 'pro' ? 'resto' : 'part');
const arrondi5 = (x) => Math.round(x * 20) / 20;
function prixAuto(p, niv) {
  const a = vide(p.prixMin) ? null : num(p.prixMin), b = vide(p.prixMax) ? null : num(p.prixMax);
  if (a == null && b == null) return ''; if (a == null || b == null) return a == null ? b : a;
  return niv === 'gros' ? a : niv === 'resto' ? arrondi5(a + (b - a) / 3) : b;
}
function prixAncien(p, niv) { const t = p.prixParType || {}, c = niv === 'gros' ? [t.grossiste, t.collectivite] : niv === 'resto' ? [t.pro] : [t.particulier]; const x = c.concat([p.prix]).find((v) => !vide(v)); return x == null ? '' : x; }
const prixManuel = (p, niv) => !vide((p.prixNiveau || {})[niv]);
function prixNiveau(p, niv) { if (!p) return ''; if (prixManuel(p, niv)) return p.prixNiveau[niv]; const a = prixAuto(p, niv); return a !== '' ? a : prixAncien(p, niv); }
function prixPour(p, type) { return prixNiveau(p, niveauDeType(type)); }
/* Calibres : jusqu'à 3 tailles d'un produit vendu au kg, avec un poids moyen par pièce. On vend à la pièce,
   le stock baisse du nombre de pièces × poids moyen. Prix d'une pièce = prix au kg × poids (arrondi à 50 ct en vente directe),
   ou le prix fixé à la main pour la vente directe. */
const calibresDe = (p) => (p && Array.isArray(p.calibres) ? p.calibres.filter((c) => num(c.poids) > 0) : []);
function prixPiece(p, cal, niv) {
  if (niv === 'part' && cal.prix != null && cal.prix !== '') return num(cal.prix);
  const kg = num(prixNiveau(p, niv)); if (!kg) return '';
  const x = kg * num(cal.poids); return niv === 'part' ? Math.max(0.5, Math.round(x * 2) / 2) : arrondi5(x);
}
const nomCalibre = (p, cal) => `${p.nom} ${String(cal.nom || '').toLowerCase()}`.trim();
const prixNiveauxTxt = (p) => NIVEAUX.map(([n]) => [n, prixNiveau(p, n)]).filter(([, x]) => !vide(x)).map(([n, x]) => `${NIVEAU_COURT[n]} ${money(x)}`).join(' · ');
/* Le prix d'un client = celui de sa dernière vente (non annulée) pour ce produit */
function prixClient(clientId, prodKey, calibre) {
  if (!clientId || !prodKey) return null; const cb = calibre == null ? '' : String(calibre);
  let best = null;
  for (const f of factures()) {
    if (!f.client || f.client.id !== clientId || facStatut(f) === 'annulee') continue;
    const d = String(f.date || '') + String(f.cree || '');
    for (const l of f.lignes || []) if (l.produitId === prodKey && String(l.calibre ?? '') === cb && !vide(l.prix) && (!best || d > best.d)) best = { prix: num(l.prix), date: f.date, d };
  }
  return best;
}
function prixLigne(p, key, calibre) {
  const pc = prixClient(draftF.clientId, key || p.key, calibre); if (pc) return pc.prix;
  const cal = calibre == null || calibre === '' ? null : calibresDe(p)[Number(calibre)];
  return cal ? prixPiece(p, cal, niveauDeType(typeClientBrouillon())) : prixPour(p, typeClientBrouillon());
}
function fourchette(p) { if (vide(p.prixMin) && vide(p.prixMax)) return ''; if (vide(p.prixMax) || num(p.prixMin) === num(p.prixMax)) return money(vide(p.prixMin) ? p.prixMax : p.prixMin); if (vide(p.prixMin)) return 'jusqu\'à ' + money(p.prixMax); return money(p.prixMin) + ' – ' + money(p.prixMax); }
const typeClientBrouillon = () => { const c = DB.get(draftF.clientId); return c ? (c.type || 'autre') : ''; };
function nouvelleLigne() { const p = produits()[0]; return p ? { produitId: p.key, designation: p.nom, quantite: '', unite: p.unite || 'kg', prix: prixLigne(p), auto: true } : { produitId: '', designation: '', quantite: '', unite: 'kg', prix: '' }; }
function factureDepuisBrouillon() {
  const s = cfg(), n = prochainNumero(draftF.date), client = DB.get(draftF.clientId);
  const lignes = draftF.lignes.filter((l) => (l.designation || '').trim() && num(l.quantite) > 0).map((l) => Object.assign({ designation: l.designation.trim(), quantite: r2(num(l.quantite)), unite: l.unite || 'kg', prix: r2(num(l.prix)) }, l.produitId ? { produitId: l.produitId } : {}, l.calibre != null && l.calibre !== '' && num(l.poids) > 0 ? { calibre: Number(l.calibre), poids: num(l.poids) } : {}));
  let example = false, shown = lignes;
  if (!shown.length) { example = true; shown = [{ designation: 'Patates douces', quantite: 100, unite: 'kg', prix: 2.5 }]; }
  const cash = draftF.paiement === 'especes';
  const emetteur = { nom: s.nom, titulaire: s.titulaire, rue: s.rue, numero: s.numero, npa: s.npa, localite: s.localite, telephone: s.telephone, email: s.email, iban: cleanIban(s.iban), mention: s.mention };
  if (!cash && !ibanCheck(emetteur.iban).ok) { example = true; emetteur.iban = 'CH9300762011623852957'; }
  if (!client && draftF.facture) example = true;
  const delai = num(s.delai) >= 0 ? num(s.delai) : 30, date = draftF.date || todayISO();
  return {
    example, lignes,
    inv: {
      numero: n.numero, seq: n.seq, annee: n.annee, date, livraison: draftF.livraison || '', bulletin: (draftF.bulletin || '').trim(),
      echeance: cash ? date : addDays(date, delai), delai,
      client: client ? { id: draftF.clientId, nom: billName(client), attn: attnName(client), rue: client.rue || '', numero: client.numero || '', npa: client.npa || '', localite: client.localite || '' } : draftF.facture ? EXAMPLE_CLIENT : { nom: 'Vente directe' },
      emetteur, lignes: shown, total: r2(shown.reduce((a, l) => a + r2(l.quantite * l.prix), 0)), remarque: (draftF.remarque || '').trim(),
      paiement: cash ? 'especes' : 'virement', statut: cash ? 'payee' : 'ouverte', payeeLe: cash ? date : '', payeePar: cash ? 'especes' : '', encaissePar: cash ? (Sync.me || '') : '',
    },
  };
}
function problemesBrouillon() {
  const cash = draftF.paiement === 'especes';
  const p = draftF.facture ? problemesReglages(cash).map((x) => 'Réglages : il manque ' + x) : [];
  const c = DB.get(draftF.clientId);
  if (!c && (draftF.facture || draftF.bl)) p.push('Choisis un client (nécessaire pour une facture ou un bulletin).');
  else if (c && draftF.facture && !cash && (!c.npa || !c.localite)) p.push(`${displayName(c)} n'a pas de NPA ou de localité : complète sa fiche (obligatoire pour le QR-code).`);
  const lines = draftF.lignes.filter((l) => (l.designation || '').trim() || num(l.quantite) > 0);
  if (!lines.length) p.push('Ajoute au moins une ligne avec une quantité.');
  lines.forEach((l, i) => {
    if (!(l.designation || '').trim()) p.push(`Ligne ${i + 1} : désignation manquante.`);
    if (!(num(l.quantite) > 0)) p.push(`Ligne ${i + 1} : quantité manquante.`);
    if (l.prix === '' || l.prix == null) p.push(`Ligne ${i + 1} : prix manquant.`);
  });
  return p;
}

/* ---------- Écrans ---------- */
MODULES.factures = {
  titre: 'Ventes',
  tuile() {
    const f = factures(); const open = f.filter((x) => ['ouverte', 'retard'].includes(facStatut(x)));
    const late = f.filter((x) => facStatut(x) === 'retard');
    if (late.length) return { line: `${late.length} facture${late.length > 1 ? 's' : ''} en retard · ${chf(late.reduce((a, x) => a + x.total, 0))}`, warn: true, badge: late.length };
    if (open.length) return { line: `À encaisser : ${chf(open.reduce((a, x) => a + x.total, 0))}` };
    return { line: f.length ? `${f.length} vente${f.length > 1 ? 's' : ''}, tout est payé` : 'Ventes, stock et prix' };
  },
  render(sub, id) {
    /* La prospection est maintenant dans Contacts : les anciennes adresses y mènent */
    if (['prospection', 'prospect', 'convertir', 'pmodifier'].includes(sub)) { setTimeout(() => location.replace(`#/contacts/${sub}${id ? '/' + encodeURIComponent(id) : ''}`), 0); return ''; }
    if (sub === 'produits') { setTimeout(() => location.replace('#/factures/stock'), 0); return ''; }
    const t = tabs('factures', [['', 'Ventes'], ['nouvelle', 'Nouvelle vente'], ['selfservice', 'Vente directe'], ['stock', 'Stock et prix']], sub === 'voir' ? '' : sub);
    if (sub === 'nouvelle') return t + renderNouvelleFacture(id);
    if (sub === 'stock') return t + renderStock();
    if (sub === 'selfservice') return t + renderSelfService();
    return t + renderListeFactures(sub === 'voir' ? id : '');
  },
  after(sub) { if (sub === 'nouvelle') brancherBrouillon(); if (sub === 'stock') brancherStock(); },
};

function renderListeFactures(selKey) {
  const list = factures().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.seq || 0) - (a.seq || 0) || String(b.cree).localeCompare(String(a.cree)));
  const y = todayISO().slice(0, 4); let open = 0, late = 0, nLate = 0, year = 0;
  for (const f of list) { const s = facStatut(f); if (s === 'ouverte' || s === 'retard') open += f.total; if (s === 'retard') { late += f.total; nLate++; } if (s !== 'annulee' && s !== 'groupee' && String(f.date || '').slice(0, 4) === y) year += f.total; }
  const dbl = numerosEnDouble();
  const probs = problemesReglages(false);
  const setup = probs.length ? `<div class="errors">Pour facturer par virement, il manque ${esc(probs.join(', '))}. <a href="#/reglages">Compléter les réglages</a></div>` : '';
  const table = list.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Facture / BL</th><th>Client</th><th>Date</th><th class="r">Montant</th><th>Statut</th></tr></thead><tbody>${list.map((f) => {
    const s = facStatut(f);
    return `<tr class="click${f.key === selKey ? ' sel' : ''}" data-act="go" data-href="#/factures/voir/${encodeURIComponent(f.key)}"><td class="num">${f.numero ? esc(f.numero) : `<span class="hint">${esc(f.blNumero || 'vente')}</span>`}${f.numero && dbl[f.numero] > 1 && s !== 'annulee' ? ' <span class="pill retard">double</span>' : ''}</td><td>${esc(trunc(f.client && f.client.nom, 28))}</td><td class="num">${fmtDate(f.date)}</td><td class="r num">${money(f.total)}</td><td><span class="pill ${s}">${esc(facLabel(f))}</span></td></tr>`;
  }).join('')}</tbody></table></div>` : `<p class="empty">Aucune vente pour l'instant. <a href="#/factures/nouvelle">Enregistrer la première</a></p>`;
  const sel = DB.get(selKey);
  return `${setup}<div class="stats">
      <div class="stat good"><span class="k">À encaisser</span><span class="v">${chf(open)}</span></div>
      <div class="stat bad"><span class="k">En retard</span><span class="v">${nLate ? `${nLate} · ${chf(late)}` : 'Aucune'}</span></div>
      <div class="stat"><span class="k">Vendu en ${y}</span><span class="v">${chf(year)}</span></div></div>
    <div class="split">
      <div class="panel"><div class="between"><h2>Ventes</h2><div class="row"><button class="btn small" type="button" data-act="facCsv">Exporter (CSV)</button><button class="btn small" type="button" data-act="facMois">Facture du mois</button><a class="btn primary small" href="#/factures/nouvelle">+ Vente</a></div></div>${table}</div>
      <div>${sel ? renderDetailFacture(Object.assign({ key: selKey }, sel), dbl) : (list.length ? '<div class="panel"><p class="hint">Choisis une vente pour voir sa facture ou son bulletin, ou la marquer comme payée.</p></div>' : '')}</div>
    </div>`;
}
function renderDetailFacture(f, dbl) {
  const s = facStatut(f), acts = [];
  acts.push(`<button class="btn primary" type="button" data-act="papiersPdf" data-key="${esc(f.key)}">Facture & bulletin PDF</button>`);
  if (s === 'ouverte' || s === 'retard') acts.push(`<button class="btn" type="button" data-act="facPaid" data-key="${esc(f.key)}">Marquer comme payée</button>`);
  if (s === 'payee' && f.paiement !== 'especes') acts.push(`<button class="btn" type="button" data-act="facReopen" data-key="${esc(f.key)}">Remettre en ouverte</button>`);
  if (s !== 'annulee' && s !== 'groupee' && (s !== 'payee' || f.paiement === 'especes')) acts.push(`<button class="btn danger" type="button" data-act="facCancel" data-key="${esc(f.key)}">Annuler</button>`);
  const warn = dbl[f.numero] > 1 && s !== 'annulee' ? `<div class="errors">Deux factures portent le numéro ${esc(f.numero)} (créées en même temps, hors ligne ?). <button class="btn link" type="button" data-act="facRenum" data-key="${esc(f.key)}">Donner un nouveau numéro à celle-ci</button></div>` : '';
  const grp = s === 'groupee' ? (() => { const g = DB.get(f.groupe); return `<p class="hint">Reprise dans la facture du mois <a href="#/factures/voir/${encodeURIComponent(f.groupe)}">${esc((g && g.numero) || '')}</a> : c'est elle qui sera payée.</p>`; })()
    : (f.regroupe || []).length ? `<p class="hint">Regroupe ${f.regroupe.length} vente${f.regroupe.length > 1 ? 's' : ''} : ${f.regroupe.map((k) => { const x = DB.get(k) || {}; return `<a href="#/factures/voir/${encodeURIComponent(k)}">${esc(x.blNumero || fmtDateCourt(x.date || ''))}</a>`; }).join(', ')}.</p>` : '';
  const enc = s === 'payee' ? `<p class="hint">Encaissée par ${esc(nomDe(f.encaissePar || cfg().compteDe))}${f.payeePar === 'especes' ? ', en espèces' : f.payeePar === 'twint' ? ', par TWINT' : ', par virement'}.</p>` : '';
  const mv = mouvements().filter((m) => m.ref === f.key);
  const stockTxt = mv.length ? `<p class="hint">Stock : ${mv.map((m) => `${esc((DB.get(m.prod) || {}).nom || '?')} ${fmtQ(num(m.qte), (DB.get(m.prod) || {}).unite)}`).join(', ')}.</p>` : f.stock === false && !(f.regroupe || []).length ? '<p class="hint">Cette vente ne touche pas au stock.</p>' : '';
  return `<div class="panel"><h3 style="margin-top:0">${esc(nomVente(f))}${f.numero && f.blNumero ? ' · ' + esc(f.blNumero) : ''}</h3><div class="row">${acts.join('')}<span class="pill ${s}">${esc(facLabel(f))}</span></div>${warn}${grp}${enc}${stockTxt}${f.blNumero ? blSigneHtml(f) : ''}
    <div class="paper">${f.numero ? invoiceSvg(f) : bulletinSvg(f, true)}</div></div>`;
}

function renderNouvelleFacture(contactKey) {
  if (contactKey) { try { history.replaceState(null, '', '#/factures/nouvelle'); render._last = location.hash; } catch (e) { /* */ } }
  if (contactKey && DB.get(contactKey) && draftF.clientId !== contactKey) { draftF.clientId = contactKey; const c = DB.get(contactKey); if (!c.npa || !c.localite) draftF.paiement = 'especes'; for (const l of draftF.lignes) { const pr = DB.get(l.produitId); if (pr && l.auto) l.prix = prixLigne(pr, l.produitId); } }
  if (!draftF.lignes.length) draftF.lignes.push(nouvelleLigne());
  const cl = contacts().sort(byName);
  const groups = [[{ label: '★ Favoris' }, cl.filter((c) => c.favori)]].concat(TYPES.map((t) => [t, cl.filter((c) => (c.type || 'autre') === t.k && !c.favori)])).filter(([, l]) => l.length);
  const c = DB.get(draftF.clientId);
  const addr = c ? [street(c), place(c)].filter(Boolean).join(', ') : '';
  return `<div class="split"><form class="panel form" id="draft" onsubmit="return false">
      <h2 id="d-title">Nouvelle vente</h2>
      <div class="field"><span class="flabel">Pour cette vente</span><div class="seg wrap">
        <label><input type="checkbox" id="d-opt-facture"${draftF.facture ? ' checked' : ''}> Facture</label>
        <label><input type="checkbox" id="d-opt-bl"${draftF.bl ? ' checked' : ''}> Bulletin de livraison</label>
        <label><input type="checkbox" id="d-opt-stock"${draftF.stock ? ' checked' : ''}> Déduire du stock</label></div>
        <span class="sub">${draftF.facture ? 'Facture numérotée (QR ou payée comptant).' : 'Sans facture : vente au marché, au stand, ou facturée plus tard.'}${draftF.bl ? ' Bulletin numéroté automatiquement, à faire signer à la livraison.' : ''}${draftF.stock ? ' Le stock des produits suivis baisse.' : ''}</span></div>
      ${aideLivraison()}
      ${fld('d-client', 'Client', `<select id="d-client"><option value="">${cl.length ? 'Choisir un client…' : 'Aucun contact : ajoute-en un'}</option>${groups.map(([t, l]) => `<optgroup label="${esc(t.label)}">${l.map((x) => `<option value="${esc(x.key)}"${x.key === draftF.clientId ? ' selected' : ''}>${esc(billName(x) + (attnName(x) ? ' (' + attnName(x) + ')' : ''))}</option>`).join('')}</optgroup>`).join('')}</select>`,
        c ? esc(addr || "Pas d'adresse : nécessaire pour un virement QR, pas pour un paiement comptant.") : `<a href="#/contacts/nouveau">Ajouter un contact</a>`)}
      <div class="grid2">
        ${inp('d-date', 'Date de la facture', draftF.date, { type: 'date' })}
        ${inp('d-livraison', 'Date de livraison', draftF.livraison, { type: 'date' })}
        ${draftF.bl || !draftF.facture ? '' : inp('d-bulletin', 'Bulletin de livraison n° (le vôtre)', draftF.bulletin, { attrs: { placeholder: 'facultatif' } })}
      </div>
      ${draftF.facture ? `<div class="field"><span class="flabel">Paiement</span><div class="seg" role="radiogroup" aria-label="Mode de paiement">
        <label for="d-pay-virement"><input type="radio" name="d-paiement" id="d-pay-virement" value="virement"${draftF.paiement !== 'especes' ? ' checked' : ''}> Virement (QR-facture)</label>
        <label for="d-pay-especes"><input type="radio" name="d-paiement" id="d-pay-especes" value="especes"${draftF.paiement === 'especes' ? ' checked' : ''}> Payé comptant (espèces)</label></div>
        <span class="sub">${draftF.paiement === 'especes' ? 'Déjà payé : la facture est marquée payée, avec « Acquittée » et une ligne de signature, sans QR-code.' : 'Le client paie par virement avec le QR-code, dans le délai prévu.'}</span></div>`
      : `<div class="field"><span class="flabel">Paiement</span><div class="seg wrap" role="radiogroup" aria-label="Paiement">
        ${[['especes', 'Espèces'], ['twint', 'TWINT'], ['virement', 'Virement reçu'], ['plustard', 'À payer plus tard']].map(([k, l]) => `<label><input type="radio" name="d-moyen" value="${k}"${draftF.moyen === k ? ' checked' : ''}> ${l}</label>`).join('')}</div>
        <span class="sub">${draftF.moyen === 'plustard' ? 'La vente reste « à encaisser » ; tu pourras faire la facture plus tard.' : 'Payé sur place : la vente entre tout de suite dans les recettes.'}</span></div>`}
      <div><h3>Lignes</h3><div class="lines" id="d-lines">${draftF.lignes.map(ligneHtml).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn" type="button" id="d-addline"${draftF.lignes.length >= 6 ? ' disabled' : ''}>+ Ajouter une ligne</button>${draftF.lignes.length >= 6 ? '<span class="hint">6 lignes au maximum.</span>' : ''}</div></div>
      ${inp('d-remarque', 'Remarque sur la facture', draftF.remarque, { attrs: { maxlength: 110, placeholder: 'facultatif' } })}
      <div class="total-row"><strong>Total</strong><span class="v" id="d-total"></span></div>
      <div id="d-errors" class="errors" hidden></div>
      <div class="row-end"><button class="btn" type="button" id="d-save" hidden title="Enregistrer sans télécharger de PDF (ils restent disponibles dans la vente)">Enregistrer</button><button class="btn primary" type="button" id="d-create">Enregistrer la vente</button></div>
    </form>
    <div class="paper-wrap"><div class="paper" id="d-paper"></div><span class="badge-ex" id="d-badge" hidden>Valeurs d'exemple</span></div></div>`;
}
function ligneHtml(l, i) {
  const opts = `<option value="">Libre…</option>` + produits().map((p) => `<option value="${esc(p.key)}"${p.key === l.produitId ? ' selected' : ''}>${esc(p.nom)}</option>`).join('');
  return `<div class="line" data-i="${i}">
    <div class="field f-desc"><label for="l-p-${i}">Produit</label><select id="l-p-${i}" data-k="produitId">${opts}</select>
      ${(() => { const p = l.produitId && DB.get(l.produitId), cs = calibresDe(p); return cs.length ? `<select id="l-c-${i}" data-k="calibre" aria-label="Calibre ligne ${i + 1}"><option value="">au ${esc(p.unite || 'kg')}</option>${cs.map((c, j) => `<option value="${j}"${String(l.calibre ?? '') === String(j) ? ' selected' : ''}>à la pièce : ${esc(c.nom || 'calibre ' + (j + 1))} (≈ ${fmtNum(c.poids, 2)} kg)</option>`).join('')}</select>` : ''; })()}
      <input id="l-d-${i}" data-k="designation" value="${esc(l.designation)}" placeholder="Désignation" maxlength="46" aria-label="Désignation ligne ${i + 1}"></div>
    <div class="field"><label for="l-q-${i}">Quantité</label><input id="l-q-${i}" data-k="quantite" type="text" inputmode="decimal" autocomplete="off" value="${esc(l.quantite)}"></div>
    <div class="field"><label for="l-u-${i}">Unité</label><select id="l-u-${i}" data-k="unite">${UNITES.map((u) => `<option${u === l.unite ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
    <div class="field"><label for="l-x-${i}">Prix CHF</label><input id="l-x-${i}" data-k="prix" type="text" inputmode="decimal" autocomplete="off" value="${esc(l.prix)}"><span class="lt" id="l-t-${i}"></span></div>
    <button class="icon-btn" type="button" data-rm="${i}" aria-label="Retirer la ligne ${i + 1}" title="Retirer la ligne">×</button></div>`;
}
function majApercu() {
  const d = factureDepuisBrouillon();
  $('d-paper').innerHTML = draftF.facture ? invoiceSvg(d.inv) : bulletinSvg(Object.assign({}, d.inv, { numero: '', blNumero: draftF.bl ? prochainBL(draftF.date) : '' }), true); $('d-badge').hidden = !d.example || !draftF.facture;
  $('d-total').textContent = chf(d.lignes.reduce((a, l) => a + r2(l.quantite * l.prix), 0));
  $('d-title').textContent = draftF.facture ? 'Nouvelle vente · facture ' + d.inv.numero : 'Nouvelle vente'; $('d-create').textContent = draftF.facture ? 'Enregistrer et faire la facture ' + d.inv.numero : draftF.bl ? 'Enregistrer et faire le bulletin' : 'Enregistrer la vente';
  $('d-save').hidden = !(draftF.facture || draftF.bl);
  draftF.lignes.forEach((l, i) => {
    const t = $('l-t-' + i); if (!t) return;
    const p = DB.get(l.produitId), f = p ? fourchette(p) : '';
    const parKg = num(l.poids) > 0 && !vide(l.prix) ? num(l.prix) / num(l.poids) : null, pk = parKg ?? num(l.prix); // à la pièce : on compare le prix ramené au kg
    const hors = p && f && !vide(l.prix) && ((!vide(p.prixMin) && pk < num(p.prixMin) - 0.005) || (!vide(p.prixMax) && pk > num(p.prixMax) + 0.005));
    const pc = p && draftF.clientId ? prixClient(draftF.clientId, l.produitId, l.calibre) : null, egal = (x) => !vide(l.prix) && Math.abs(num(l.prix) - num(x)) < 0.005;
    const origine = !p || vide(l.prix) ? '' : pc ? (egal(pc.prix) ? 'prix habituel de ce client' : `<span class="err">⚠ différent du prix habituel de ce client (${money(pc.prix)}, le ${fmtDate(pc.date)})</span>`)
      : (() => { const ref = prixLigne(p, l.produitId, l.calibre), niv = NIVEAU_COURT[niveauDeType(typeClientBrouillon())]; return egal(ref) ? 'tarif ' + niv + (num(l.poids) ? ' à la pièce' : '') : `prix modifié (tarif ${niv} : ${money(ref)})`; })();
    t.innerHTML = [num(l.quantite) > 0 && l.prix !== '' ? '= ' + money(r2(num(l.quantite) * num(l.prix))) : '', origine, f ? `<span class="${hors ? 'err' : ''}">${parKg != null ? `≈ ${money(parKg)}/kg, ` : ''}fourchette ${f}${hors ? ' : hors fourchette' : ''}</span>` : ''].filter(Boolean).join(' · ');
  });
}
function brancherBrouillon() {
  majApercu();
  $('d-client').addEventListener('change', (e) => {
    draftF.clientId = e.target.value; const c = DB.get(draftF.clientId); if (c && (!c.npa || !c.localite)) draftF.paiement = 'especes';
    const ty = typeClientBrouillon(); let n = 0;
    let hab = 0;
    for (const l of draftF.lignes) { const p = DB.get(l.produitId); if (p && l.auto) { if (prixClient(draftF.clientId, l.produitId, l.calibre)) hab++; const np = prixLigne(p, l.produitId, l.calibre); if (String(np) !== String(l.prix)) { l.prix = np; n++; } } }
    render(); if (n && c) toast(hab ? 'Prix habituels de ce client appliqués.' : `Prix « ${NIVEAU_COURT[niveauDeType(ty)]} » appliqués.`);
  });
  for (const k of ['date', 'livraison', 'bulletin', 'remarque']) { const el = $('d-' + k); if (el) el.addEventListener('input', (e) => { draftF[k] = e.target.value; majApercu(); }); }
  for (const r of document.querySelectorAll('input[name="d-paiement"]')) r.addEventListener('change', (e) => { draftF.paiement = e.target.value; render(); });
  for (const r of document.querySelectorAll('input[name="d-moyen"]')) r.addEventListener('change', (e) => { draftF.moyen = e.target.value; render(); });
  for (const [id, k] of [['d-opt-facture', 'facture'], ['d-opt-bl', 'bl'], ['d-opt-stock', 'stock']]) { const el = $(id); if (el) el.addEventListener('change', () => { draftF[k] = el.checked; render(); }); }
  $('d-addline').addEventListener('click', () => { draftF.lignes.push(nouvelleLigne()); render(); const q = $('l-q-' + (draftF.lignes.length - 1)); if (q) q.focus(); });
  $('d-lines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; draftF.lignes.splice(Number(b.dataset.rm), 1); render(); });
  $('d-lines').addEventListener('input', (e) => {
    const el = e.target.closest('.line'); if (!el) return;
    const i = Number(el.dataset.i), k = e.target.dataset.k, l = draftF.lignes[i]; if (!l || !k) return;
    if (k === 'produitId') {
      const p = DB.get(e.target.value); l.produitId = e.target.value; l.calibre = ''; l.poids = null;
      if (p) { l.designation = p.nom; l.unite = p.unite || 'kg'; l.prix = prixLigne(p, e.target.value); l.auto = true; $('l-d-' + i).value = l.designation; $('l-u-' + i).value = l.unite; $('l-x-' + i).value = l.prix; }
      render(); return; // affiche (ou retire) le choix du calibre
    } else if (k === 'calibre') {
      const p = DB.get(l.produitId), cal = e.target.value === '' ? null : calibresDe(p)[Number(e.target.value)];
      l.calibre = e.target.value; l.poids = cal ? num(cal.poids) : null; l.unite = cal ? 'pièce' : p.unite || 'kg'; l.designation = cal ? nomCalibre(p, cal) : p.nom; l.prix = prixLigne(p, l.produitId, l.calibre); l.auto = true;
      render(); return;
    } else { l[k] = e.target.value; if (k === 'prix') l.auto = false; }
    majApercu();
  });
  /* « Enregistrer » : la vente est enregistrée (facture et bulletin numérotés si cochés), sans télécharger de PDF */
  $('d-create').addEventListener('click', () => creerVente(true));
  $('d-save').addEventListener('click', () => creerVente(false));
}
function creerVente(pdf) {
  {
    const p = problemesBrouillon(), box = $('d-errors');
    if (p.length) { box.innerHTML = `<strong>Il manque encore :</strong><ul>${p.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; box.hidden = false; return; }
    const d = factureDepuisBrouillon();
    const inv = Object.assign({}, d.inv, { lignes: d.lignes, cree: new Date().toISOString(), creePar: Sync.me || '', facture: !!draftF.facture, stock: !!draftF.stock });
    inv.total = factureTotal(inv);
    if (!draftF.facture) {
      delete inv.numero; delete inv.seq; delete inv.annee; delete inv.bulletin;
      const m = draftF.moyen || 'especes', date = inv.date;
      Object.assign(inv, m === 'plustard' ? { paiement: 'virement', statut: 'ouverte', payeeLe: '', payeePar: '', encaissePar: '' } : { paiement: m === 'especes' ? 'especes' : 'virement', statut: 'payee', payeeLe: date, payeePar: m, encaissePar: m === 'virement' ? (cfg().compteDe || Sync.me || '') : (Sync.me || ''), echeance: date });
    }
    if (draftF.bl) { inv.blNumero = prochainBL(inv.date); if (!inv.bulletin && inv.numero) inv.bulletin = inv.blNumero; }
    const key = 'fac:' + uid('f');
    /* Prix qui changent pour ce client (ils deviennent ses nouveaux prix habituels) */
    const changes = inv.client && inv.client.id ? d.lignes.map((l) => { const pc = l.produitId ? prixClient(inv.client.id, l.produitId, l.calibre) : null; return pc && Math.abs(pc.prix - num(l.prix)) >= 0.005 ? `${l.designation} ${money(l.prix)} (avant ${money(pc.prix)})` : ''; }).filter(Boolean) : [];
    DB.put(key, inv); stockPourVente(key, inv);
    Object.assign(draftF, { lignes: [], bulletin: '', remarque: '', livraison: '', paiement: 'virement' });
    toast((inv.numero ? `Vente enregistrée, facture ${inv.numero}.` : 'Vente enregistrée.') + (changes.length ? ` Nouveau prix pour ce client : ${changes.join(', ')}.` : '') + (!pdf && (inv.numero || inv.blNumero) ? ' Les PDF : bouton « Facture & bulletin PDF ».' : ''), changes.length ? 7000 : 4500);
    go('#/factures/voir/' + encodeURIComponent(key));
    if (!pdf) return;
    if (inv.numero) telechargerFacture(key);
    if (inv.blNumero) setTimeout(() => downloadFile(bulletinFileName(inv), bulletinPdfBlob(inv, true)), 400);
  }
}

function telechargerFacture(key) {
  const f = DB.get(key); if (!f) return;
  if (!window.jspdf) { toast("Le générateur PDF n'a pas pu se charger. Recharge la page."); return; }
  downloadFile(invoiceFileName(f), invoicePdfBlob(f));
}
ACTIONS.facPdf = (el) => telechargerFacture(el.dataset.key);
ACTIONS.facShare = async (el) => {
  const f = DB.get(el.dataset.key); if (!f) return;
  try { const file = new File([invoicePdfBlob(f)], invoiceFileName(f), { type: 'application/pdf' }); if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Facture ' + f.numero }); else telechargerFacture(el.dataset.key); }
  catch (e) { if (e && e.name !== 'AbortError') { toast('Partage impossible : le PDF est téléchargé à la place.'); telechargerFacture(el.dataset.key); } }
};
ACTIONS.facPaid = (el) => {
  const f = DB.get(el.dataset.key); if (!f) return;
  openSheet(`${sheetHead('Facture ' + f.numero + ' payée', chf(f.total))}<form class="sbody form" data-form="facPaid">
    <input type="hidden" name="key" value="${esc(el.dataset.key)}">
    ${inp('fp-date', 'Payée le', todayISO(), { type: 'date', name: 'date' })}
    <div class="field"><span class="flabel">Comment</span><div class="seg">
      <label><input type="radio" name="mode" value="virement" checked> Virement</label><label><input type="radio" name="mode" value="twint"> TWINT</label><label><input type="radio" name="mode" value="especes"> Espèces</label></div></div>
    ${sel('fp-par', 'Encaissé par', cfg().compteDe || Sync.me, persOptions(), { name: 'par', sub: 'Pour un virement : la personne à qui appartient le compte.' })}
    <div class="row-end"><button class="btn" type="button" data-act="close">Annuler</button><button class="btn primary" type="submit">Enregistrer le paiement</button></div></form>`);
};
FORMS.facPaid = (v) => {
  const f = DB.get(v.key); if (!f) return;
  DB.put(v.key, Object.assign({}, f, { statut: 'payee', payeeLe: v.date || todayISO(), payeePar: v.mode, encaissePar: v.par }));
  closeSheet(); toast(`${nomVente(f)} marquée comme payée.`);
};
ACTIONS.facReopen = (el) => { const f = DB.get(el.dataset.key); if (!f) return; DB.put(el.dataset.key, Object.assign({}, f, { statut: 'ouverte', payeeLe: '', payeePar: '', encaissePar: '' })); toast(`${f.numero} remise en ouverte.`); };
ACTIONS.facCancel = (el) => { const f = DB.get(el.dataset.key); confirmSheet('Annuler ' + nomVente(f) + ' ?', (f.numero ? 'Le numéro reste utilisé et la facture reste dans la liste, barrée.' : 'La vente reste dans la liste, barrée.') + ' Le stock est rendu.', 'facCancelOk', 'Oui, annuler', { key: el.dataset.key }); };
ACTIONS.facCancelOk = (el) => { const f = DB.get(el.dataset.key); if (!f) return; const o = Object.assign({}, f, { statut: 'annulee' }); DB.put(el.dataset.key, o); stockPourVente(el.dataset.key, o);
  for (const k of f.regroupe || []) { const x = DB.get(k); if (x && x.groupe === el.dataset.key) { const y = Object.assign({}, x); delete y.groupe; DB.put(k, y); } } /* les ventes du mois redeviennent à facturer */
  closeSheet(); toast(`${nomVente(f)} annulée${mouvements().some((m) => m.ref === el.dataset.key) ? '' : ' (le stock est rendu)'}.`); };
/* Aide-mémoire : quel papier laisser au client, qui signe quoi */
function aideLivraison() {
  return `<details class="fold aide-liv"><summary>Que laisser au client, et qui signe quoi ?</summary>
    <p><b>Bulletin de livraison</b> : signé par <b>le client</b> (« Marchandise reçue en bon état ») = votre preuve de livraison.<br>
    <b>Facture acquittée</b> : signée par <b>vous</b> (« Reçu par ») = sa preuve de paiement, seulement pour les espèces.</p>
    <ul>
      <li><b>Payé en espèces à la livraison</b> : laisser la facture acquittée, signée par vous. Rien à garder sur papier, l'app a tout. Pour un particulier, pas besoin de bulletin.</li>
      <li><b>Payé plus tard (facture QR)</b> : laisser le bulletin + la facture QR (ou l'envoyer par mail). Garder la photo du bulletin signé par le client.</li>
      <li><b>Client régulier facturé au mois</b> : laisser le bulletin. Garder la photo du bulletin signé ; la facture du mois suit.</li>
    </ul>
    <p class="hint">Pas besoin de double : imprimer un seul bulletin, le faire signer, le photographier avec « 📷 Photo du bulletin signé » (dans la vente), puis le laisser au client.</p></details>`;
}
/* Facture & bulletin d'une vente : une seule fenêtre pour choisir le papier (le bulletin porte toujours les prix) */
ACTIONS.papiersPdf = (el) => {
  const k = el.dataset.key, f = DB.get(k); if (!f) return;
  const annulee = facStatut(f) === 'annulee', b = [];
  if (f.numero) {
    b.push(`<button class="btn primary" type="button" data-act="facPdfOk" data-key="${esc(k)}">Facture ${esc(f.numero)}</button>`);
    if (navigator.canShare) b.push(`<button class="btn" type="button" data-act="facShare" data-key="${esc(k)}">Partager la facture</button>`);
  } else if (!annulee && !f.groupe) b.push(`<button class="btn" type="button" data-act="venteFacturer" data-key="${esc(k)}">Faire la facture</button>`);
  b.push(`<button class="btn${f.numero ? '' : ' primary'}" type="button" data-act="blPdfOk" data-key="${esc(k)}">${f.blNumero ? 'Bulletin ' + esc(f.blNumero) : 'Faire un bulletin'}</button>`);
  openSheet(`${sheetHead('Facture & bulletin', nomVente(f))}<div class="sbody">
    <p class="hint">${f.numero ? '' : 'Pas encore de facture pour cette vente. '}${f.blNumero ? '' : 'Le bulletin reçoit son numéro au premier téléchargement. '}Le bulletin indique toujours les prix.</p>
    <div class="row">${b.join('')}</div>
    ${aideLivraison()}</div>`);
};
ACTIONS.blPdf = ACTIONS.papiersPdf;
ACTIONS.facPdfOk = (el) => { closeSheet(); telechargerFacture(el.dataset.key); };
ACTIONS.blPdfOk = (el) => {
  const k = el.dataset.key; let f = DB.get(k); if (!f) return;
  if (!f.blNumero) { f = Object.assign({}, f, { blNumero: prochainBL(f.date) }); DB.put(k, f); }
  closeSheet(); downloadFile(bulletinFileName(f), bulletinPdfBlob(f, true));
};
/* Photo du bulletin signé par le client : preuve de livraison. Rangée avec les justificatifs (même durée de conservation),
   et mise dans l'archive de fin d'année. f.blSigne = [{ chemin, nom, type, ajoute, par, expire? }] */
function blSigneHtml(f) {
  const fs = f.blSigne || [];
  const vign = fs.map((x, i) => `<span class="fich">
    <button type="button" class="fich-voir" data-act="${x.expire ? 'aucun' : 'voirFichier'}" data-fichier="${esc(x.chemin)}" data-titre="${esc('Bulletin ' + f.blNumero + ' signé')}">${x.expire ? '<span class="fich-pdf" style="color:var(--muted);font-size:11px;text-align:center">dans l\'archive</span>' : x.type === 'application/pdf' ? '<span class="fich-pdf">PDF</span>' : `<img data-fichier="${esc(x.chemin)}" alt="Bulletin signé">`}<small>${esc(fmtDate(String(x.ajoute || '').slice(0, 10)))}</small></button>
    ${x.expire ? '' : `<button type="button" class="fich-x" data-act="blSigneOff" data-key="${esc(f.key)}" data-i="${i}" aria-label="Retirer cette photo">×</button>`}</span>`).join('');
  return `<div class="bl-signe"><span class="flabel">Bulletin signé</span>${fs.length ? `<div class="fich-list">${vign}</div>` : '<p class="hint" style="margin:2px 0 6px">Pas encore de photo. Utile pour les clients livrés régulièrement : c\'est votre preuve de livraison.</p>'}
    <label class="btn small justif-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>${fs.length ? 'Ajouter une page' : 'Photo du bulletin signé'}<input type="file" accept="image/*,application/pdf" data-bl-signe="${esc(f.key)}" hidden></label>
    <span class="sub" id="bl-signe-etat"></span></div>`;
}
document.addEventListener('change', async (e) => {
  const inp = e.target; if (!inp || !inp.dataset || !inp.dataset.blSigne) return;
  const k = inp.dataset.blSigne, file = inp.files && inp.files[0]; inp.value = ''; if (!file) return;
  const et = $('bl-signe-etat'); if (et) et.textContent = 'Envoi de la photo…';
  try {
    const p = await preparerFichier(file, 'justif');
    const chemin = await Fichiers.envoyer(p.blob, cheminFichier('justificatifs', p.ext));
    if (!LOCAL_MODE) Fichiers.liens[chemin] = { url: URL.createObjectURL(p.blob), exp: Date.now() + 50 * 60000 };
    const f = DB.get(k); if (!f) return;
    DB.put(k, Object.assign({}, f, { blSigne: (f.blSigne || []).concat([{ chemin, nom: p.nom, type: p.type, ajoute: new Date().toISOString(), par: Sync.me || '' }]) }));
    toast('Bulletin signé enregistré.'); render();
  } catch (err) { if (et) et.textContent = ''; toast("La photo n'est pas partie : " + err.message, 6000); }
});
ACTIONS.blSigneOff = (el) => confirmSheet('Retirer cette photo ?', 'La photo du bulletin signé sera retirée de cette vente.', 'blSigneOffOk', 'Retirer', { key: el.dataset.key, i: el.dataset.i });
ACTIONS.blSigneOffOk = (el) => {
  const k = el.dataset.key, f = DB.get(k); closeSheet(); if (!f) return;
  const fs = (f.blSigne || []).slice(); fs.splice(Number(el.dataset.i), 1);
  DB.put(k, Object.assign({}, f, { blSigne: fs })); render();
};
/* ---------- Facture du mois : les ventes livrées sans facture d'un client (bulletins), regroupées en une facture QR ----------
   La facture porte le total par produit et la liste des bulletins ; chaque vente reprise est marquée « groupe » (elle ne compte plus
   à part : ni à encaisser, ni dans le chiffre d'affaires). Le stock a déjà bougé à la livraison. Annuler la facture libère les ventes. */
const aFacturer = (clientId) => factures().filter((f) => f.client && f.client.id === clientId && !f.numero && !f.groupe && f.statut !== 'annulee' && f.statut !== 'payee');
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const FM = { client: '', mois: '' };
ACTIONS.facMois = () => {
  const parClient = {}; for (const f of factures()) if (f.client && f.client.id && !f.numero && !f.groupe && f.statut !== 'annulee' && f.statut !== 'payee') parClient[f.client.id] = (parClient[f.client.id] || 0) + 1;
  const ids = Object.keys(parClient).filter((k) => DB.get(k));
  if (!ids.length) { toast('Aucune vente à facturer : les ventes enregistrées sans facture (avec un client, « paiement plus tard ») apparaissent ici.', 6000); return; }
  if (!ids.includes(FM.client)) FM.client = ids[0];
  const ventes = aFacturer(FM.client).sort((a, b) => String(a.date).localeCompare(b.date));
  const mois = [...new Set(ventes.map((f) => String(f.date).slice(0, 7)))];
  if (FM.mois && !mois.includes(FM.mois) && FM.mois !== 'tout') FM.mois = '';
  const m = FM.mois || 'tout', choisies = ventes.filter((f) => m === 'tout' || String(f.date).slice(0, 7) === m);
  openSheet(`${sheetHead('Facture du mois', 'Ventes livrées sans facture')}<form class="sbody form" data-form="facMois">
    ${sel('fm-client', 'Client', FM.client, ids.map((k) => [k, `${displayName(DB.get(k))} (${parClient[k]})`]), { name: 'client' })}
    ${sel('fm-mois', 'Période', m, [['tout', 'Toutes les ventes pas encore facturées']].concat(mois.map((x) => [x, MOIS_FR[Number(x.slice(5)) - 1] + ' ' + x.slice(0, 4)])), { name: 'mois' })}
    <div class="items">${choisies.map((f) => `<label class="item" style="cursor:pointer"><input type="checkbox" name="v_${esc(f.key)}" checked> <span class="who"><strong>${esc(f.blNumero || 'Vente')} · ${fmtDate(f.date)}</strong><span class="meta">${esc((f.lignes || []).map((l) => l.designation).join(', '))}</span></span><span class="amt">${chf(f.total)}</span></label>`).join('')}</div>
    <div class="grid2">${inp('fm-date', 'Date de la facture', todayISO(), { name: 'date', type: 'date' })}</div>
    <p class="hint">La facture reprend le total par produit et cite les bulletins. Chaque vente reprise est marquée « Facturée » ; annuler la facture la libère.</p>
    <div class="row-end"><button class="btn primary" type="submit">Faire la facture</button></div></form>`);
  for (const id of ['fm-client', 'fm-mois']) $(id).addEventListener('change', (e) => { if (id === 'fm-client') { FM.client = e.target.value; FM.mois = ''; } else FM.mois = e.target.value; ACTIONS.facMois(); });
};
FORMS.facMois = (v) => {
  const c = DB.get(v.client); if (!c) return;
  const ventes = aFacturer(v.client).filter((f) => v['v_' + f.key]).sort((a, b) => String(a.date).localeCompare(b.date));
  if (!ventes.length) { toast('Coche au moins une vente.'); return; }
  const pb = problemesReglages(false); if (pb.length) { toast('Réglages : il manque ' + pb.join(', ')); return; }
  if (!c.npa || !c.localite) { toast(`${displayName(c)} n'a pas de NPA ou de localité (obligatoire pour le QR).`); return; }
  /* Une ligne par produit et par prix (les quantités du mois s'additionnent) */
  const agg = new Map();
  for (const f of ventes) for (const l of f.lignes || []) {
    const k = [l.designation, l.unite, r2(num(l.prix))].join('|'), a = agg.get(k);
    if (a) a.quantite = r2(a.quantite + num(l.quantite)); else agg.set(k, Object.assign({ designation: l.designation, quantite: r2(num(l.quantite)), unite: l.unite, prix: r2(num(l.prix)) }, l.produitId ? { produitId: l.produitId } : {}, l.calibre != null ? { calibre: l.calibre, poids: l.poids } : {}));
  }
  const lignes = [...agg.values()];
  if (lignes.length > 11) { toast(`${lignes.length} lignes : c'est trop pour une page. Fais deux factures (par exemple par quinzaine).`, 6000); return; }
  const s = cfg(), date = v.date || todayISO(), n = prochainNumero(date), delai = num(s.delai) >= 0 ? num(s.delai) : 30;
  const nums = ventes.map((f) => f.blNumero || fmtDateCourt(f.date)), d0 = ventes[0].date, d1 = ventes[ventes.length - 1].date;
  const emetteur = { nom: s.nom, titulaire: s.titulaire, rue: s.rue, numero: s.numero, npa: s.npa, localite: s.localite, telephone: s.telephone, email: s.email, iban: cleanIban(s.iban), mention: s.mention };
  const inv = Object.assign({}, n, { date, livraison: '', bulletin: '', delai, echeance: addDays(date, delai), emetteur,
    client: { id: v.client, nom: billName(c), attn: attnName(c), rue: c.rue || '', numero: c.numero || '', npa: c.npa || '', localite: c.localite || '' },
    lignes, remarque: trunc(`Livraisons du ${fmtDateCourt(d0)} au ${fmtDate(d1)} · bulletins ${nums.join(', ')}`, 110),
    paiement: 'virement', statut: 'ouverte', payeeLe: '', payeePar: '', encaissePar: '', facture: true, stock: false, regroupe: ventes.map((f) => f.key), cree: new Date().toISOString(), creePar: Sync.me || '' });
  inv.total = factureTotal(inv);
  const key = 'fac:' + uid('f'); DB.put(key, inv);
  for (const f of ventes) DB.put(f.key, Object.assign({}, DB.get(f.key), { groupe: key }));
  closeSheet(); toast(`Facture ${n.numero} faite : ${ventes.length} vente${ventes.length > 1 ? 's' : ''}, ${chf(inv.total)}.`, 5000);
  go('#/factures/voir/' + encodeURIComponent(key)); telechargerFacture(key);
};
/* Faire la facture d'une vente enregistrée sans facture */
ACTIONS.venteFacturer = (el) => {
  const k = el.dataset.key, f = DB.get(k); if (!f) return; closeSheet();
  const c = f.client && f.client.id ? DB.get(f.client.id) : null, paye = f.statut === 'payee';
  if (!c) { toast('Cette vente n\'a pas de client : impossible de la facturer.'); return; }
  const pb = problemesReglages(paye); if (pb.length) { toast('Réglages : il manque ' + pb.join(', ')); return; }
  if (!paye && (!c.npa || !c.localite)) { toast(`${displayName(c)} n'a pas de NPA ou de localité (obligatoire pour le QR).`); return; }
  const s = cfg(), n = prochainNumero(f.date), delai = num(s.delai) >= 0 ? num(s.delai) : 30;
  const emetteur = { nom: s.nom, titulaire: s.titulaire, rue: s.rue, numero: s.numero, npa: s.npa, localite: s.localite, telephone: s.telephone, email: s.email, iban: cleanIban(s.iban), mention: s.mention };
  const o = Object.assign({}, f, n, { facture: true, emetteur, delai, client: Object.assign({}, f.client, { attn: attnName(c), rue: c.rue || '', numero: c.numero || '', npa: c.npa || '', localite: c.localite || '' }), paiement: paye ? 'especes' : 'virement', echeance: paye ? f.date : addDays(todayISO(), delai), bulletin: f.bulletin || f.blNumero || '' });
  DB.put(k, o); toast(`Facture ${n.numero} faite.`); telechargerFacture(k);
};
ACTIONS.facRenum = (el) => { const f = DB.get(el.dataset.key); if (!f) return; const n = prochainNumero(f.date); DB.put(el.dataset.key, Object.assign({}, f, n)); toast(`Nouveau numéro : ${n.numero}.`); };
ACTIONS.facCsv = () => {
  const rows = factures().sort((a, b) => (a.annee - b.annee) || (a.seq - b.seq)).map((f) => [f.numero, fmtDate(f.date), f.client && f.client.nom, r2(f.total).toFixed(2), fmtDate(f.echeance), FAC_LABEL[facStatut(f)], fmtDate(f.payeeLe), f.payeePar === 'especes' ? 'Espèces' : f.statut === 'payee' ? 'Virement' : '', f.statut === 'payee' ? nomDe(f.encaissePar || cfg().compteDe) : '']);
  downloadFile(`Factures Gamins de Talus ${todayISO()}.csv`, csv(['Numéro', 'Date', 'Client', 'Montant CHF', 'Échéance', 'Statut', 'Payée le', 'Paiement', 'Encaissé par'], rows), 'text/csv;charset=utf-8');
};

/* ---------- Produits ---------- */
ACTIONS.prodEdit = (el) => {
  const k = el.dataset.key || '', p = k ? DB.get(k) : { unite: 'kg' };
  const pn = p.prixNiveau || {};
  const n = (id, label, val, name, sub) => inp(id, label, vide(val) ? '' : val, { name, type: 'number', sub });
  openSheet(`${sheetHead(k ? 'Modifier ' + p.nom : 'Nouveau produit')}<form class="sbody form" data-form="prod"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('pr-nom', 'Désignation', p.nom, { name: 'nom', req: true, attrs: { maxlength: 46 } })}
    ${sel('pr-unite', 'Unité', p.unite, UNITES.map((u) => [u, u]), { name: 'unite' })}
    <h3>Fourchette de prix (CHF par ${esc(p.unite || 'unité')})</h3>
    <div class="grid2">${n('pr-min', 'Minimum', p.prixMin, 'prixMin')}${n('pr-max', 'Maximum', p.prixMax, 'prixMax')}</div>
    <h3>Prix selon le client</h3>
    <p class="hint">Calculés depuis la fourchette : grossistes = minimum, restaurants = un tiers de la fourchette, particuliers = maximum (arrondi à 5 ct). Laisser vide pour le calcul automatique, ou écrire un prix pour le fixer à la main.</p>
    <div class="grid2">${NIVEAUX.map(([key, label]) => inp('pr-n-' + key, label, vide(pn[key]) ? '' : pn[key], { name: 'n_' + key, type: 'number', sub: `<span id="pr-auto-${key}"></span>` })).join('')}</div>
    <p class="hint">Un client qui a déjà acheté ce produit garde son prix habituel (celui de sa dernière vente).</p>
    <h3>Calibres (vente à la pièce)</h3>
    <p class="hint">Facultatif, pour un produit au kg vendu à la pièce : jusqu'à 3 tailles avec leur poids moyen. En vente directe ou sur une facture, on compte les pièces ; le stock baisse de pièces × poids. Prix d'une pièce : prix au kg × poids, arrondi à 50 ct en vente directe (ou le prix écrit ici).</p>
    ${[0, 1, 2].map((j) => { const c = (p.calibres || [])[j] || {}; return `<div class="grid3">${inp('pr-cn-' + j, j ? '' : 'Calibre', c.nom || '', { name: 'cn_' + j, attrs: { placeholder: ['Petit', 'Moyen', 'Gros'][j] } })}${inp('pr-cp-' + j, j ? '' : 'Poids moyen kg', c.poids ?? '', { name: 'cp_' + j, type: 'number', attrs: { placeholder: 'ex. ' + ['0,8', '1,5', '2,5'][j] } })}${inp('pr-cx-' + j, j ? '' : 'Prix pièce, vente directe', c.prix ?? '', { name: 'cx_' + j, type: 'number', sub: `<span id="pr-cauto-${j}"></span>` })}</div>`; }).join('')}
    <h3>Stock</h3>
    ${sel('pr-fiche', 'Vient de la culture', p.fiche || '', [['', '—']].concat((typeof fiches === 'function' ? fiches() : []).map((f) => [f.key, f.nom])), { name: 'fiche', sub: 'Les récoltes de cette culture peuvent entrer dans le stock de ce produit.' })}
    <label class="row" style="font-size:14px"><input type="checkbox" name="dispo"${p.dispo ? ' checked' : ''}> Disponible (sans compter la quantité)</label>
    <label class="row" style="font-size:14px"><input type="checkbox" name="auChamp"${p.auChamp ? ' checked' : ''}> Au champ (à récolter à la demande)</label>
    ${txt('pr-rem', 'Remarque', p.remarque, { name: 'remarque', rows: 2, sub: 'Ex. 4.50 dès 200 kg' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="prodDel" data-key="${esc(k)}">Retirer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  /* Les prix automatiques se recalculent pendant qu'on tape la fourchette */
  const maj = () => {
    const q = { prixMin: $('pr-min').value === '' ? '' : num($('pr-min').value), prixMax: $('pr-max').value === '' ? '' : num($('pr-max').value), prixParType: p.prixParType, prix: p.prix };
    for (const [key] of NIVEAUX) {
      const a = prixAuto(q, key), x = a !== '' ? a : prixAncien(q, key), i = $('pr-n-' + key), sp = $('pr-auto-' + key);
      i.placeholder = vide(x) ? '' : money(x);
      sp.textContent = i.value !== '' ? (vide(x) ? 'fixé à la main' : `fixé à la main (auto : ${money(x)})`) : vide(x) ? 'mettre une fourchette' : 'auto';
    }
  };
  const majCal = () => {
    const q = { prixMin: $('pr-min').value === '' ? '' : num($('pr-min').value), prixMax: $('pr-max').value === '' ? '' : num($('pr-max').value), prixParType: p.prixParType, prix: p.prix, prixNiveau: { part: $('pr-n-part').value === '' ? '' : num($('pr-n-part').value) } };
    for (const j of [0, 1, 2]) { const w = num($('pr-cp-' + j).value), x = w > 0 ? prixPiece(q, { poids: w }, 'part') : ''; $('pr-cx-' + j).placeholder = x === '' ? '' : money(x); $('pr-cauto-' + j).textContent = w > 0 ? ($('pr-cx-' + j).value ? 'fixé à la main' : 'auto') : ''; }
  };
  for (const id of ['pr-min', 'pr-max', ...NIVEAUX.map(([key]) => 'pr-n-' + key)]) $(id).addEventListener('input', () => { maj(); majCal(); });
  for (const j of [0, 1, 2]) for (const x of ['cp', 'cx']) $(`pr-${x}-${j}`).addEventListener('input', majCal);
  majCal();
  maj();
};
FORMS.prod = (v) => {
  if (!v.nom) { toast('La désignation est obligatoire.'); return; }
  const val = (x) => (x === '' ? null : r2(num(x)));
  const k = v.key || 'prod:' + uid('p'), old = DB.get(k) || {};
  const o = Object.assign({}, old, { nom: v.nom, unite: v.unite, prixMin: val(v.prixMin), prixMax: val(v.prixMax), remarque: v.remarque || '', prixNiveau: {}, fiche: v.fiche || '', dispo: !!v.dispo, auChamp: !!v.auChamp });
  o.calibres = [0, 1, 2].map((j) => ({ nom: (v['cn_' + j] || '').trim() || ['Petit', 'Moyen', 'Gros'][j], poids: val(v['cp_' + j]), prix: val(v['cx_' + j]) })).filter((c) => c.poids > 0);
  for (const [key] of NIVEAUX) { const x = val(v['n_' + key]); if (x != null && Math.abs(x - num(prixAuto(o, key))) >= 0.005) o.prixNiveau[key] = x; } // égal au calcul : on garde l'automatique
  if (o.prixMin != null && o.prixMax != null && o.prixMin > o.prixMax) { toast('Le minimum dépasse le maximum.'); return; }
  const hors = NIVEAUX.map(([key, l]) => [l, o.prixNiveau[key]]).filter(([, x]) => x != null && ((o.prixMin != null && x < o.prixMin) || (o.prixMax != null && x > o.prixMax)));
  DB.put(k, o); closeSheet();
  toast(hors.length ? `Produit enregistré. Attention : ${hors.map(([l]) => l).join(', ')} hors fourchette.` : 'Produit enregistré.', hors.length ? 5000 : 3200);
};
ACTIONS.prodDel = (el) => { DB.del(el.dataset.key); closeSheet(); toast('Produit retiré (récupérable dans la corbeille).'); };

