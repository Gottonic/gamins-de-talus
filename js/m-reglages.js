/* Gamins de Talus — réglages, export / import des données, corbeille et historique. */
'use strict';

MODULES.reglages = {
  titre: 'Réglages',
  tuile() { return { line: DB.dirty.size ? `${DB.dirty.size} changement(s) à envoyer` : 'Coordonnées, associés, données' }; },
  render(sub) {
    const t = tabs('reglages', [['', 'Entreprise'], ['associes', 'Associés'], ['donnees', 'Données']], sub);
    if (sub === 'associes') return t + renderRegAssocies();
    if (sub === 'donnees') return t + renderDonnees();
    return t + renderEntreprise();
  },
  after(sub) {
    if (sub === 'donnees' && typeof chargerUsage === 'function') chargerUsage();
    const ib = $('s-iban'); if (ib) { const upd = () => { const r = ibanCheck(ib.value); const el = $('s-iban-check'); el.textContent = ib.value.trim() ? r.msg : ''; el.className = 'sub check ' + (r.ok ? 'ok' : 'bad'); }; ib.addEventListener('input', upd); upd(); }
    const f = $('imp-file'); if (f) f.addEventListener('change', () => lireImport(f.files[0]));
  },
};

function renderEntreprise() {
  const s = cfg();
  return `<form class="panel form" data-form="cfgEnt"><h2>Coordonnées sur les factures</h2>
    <div class="grid2">
      ${inp('s-nom', "Nom de l'activité", s.nom, { name: 'nom' })}${inp('s-tit', 'Titulaire du compte', s.titulaire, { name: 'titulaire' })}
      ${inp('s-rue', 'Rue', s.rue, { name: 'rue' })}${inp('s-num', 'N°', s.numero, { name: 'numero' })}
      ${inp('s-npa', 'NPA', s.npa, { name: 'npa' })}${inp('s-loc', 'Localité', s.localite, { name: 'localite' })}
      ${inp('s-tel', 'Téléphone', s.telephone, { name: 'telephone' })}${inp('s-mail', 'E-mail', s.email, { name: 'email' })}
    </div>
    ${fld('s-iban', 'IBAN (compte BAS)', `<input id="s-iban" name="iban" class="num" value="${esc(fmtIban(s.iban))}" autocomplete="off" maxlength="30">`, '<span id="s-iban-check"></span>')}
    <div class="grid2">
      ${sel('s-compte', 'Le compte appartient à', s.compteDe, persOptions(), { name: 'compteDe', sub: 'Les virements reçus comptent comme encaissés par cette personne.' })}
      ${inp('s-delai', 'Délai de paiement (jours)', s.delai, { name: 'delai', type: 'number', attrs: { min: 0, max: 120 } })}
      ${inp('s-pre', 'Préfixe des numéros', s.prefixe, { name: 'prefixe', attrs: { maxlength: 6 }, sub: `Ex. ${esc(s.prefixe || 'GDT')}-${todayISO().slice(0, 4)}-001` })}
    </div>
    ${inp('s-mention', 'Mention TVA', s.mention, { name: 'mention', sub: "Gamins de Talus n'est pas assujetti à la TVA : aucune TVA n'est ajoutée." })}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>
    <form class="panel form" data-form="cfgDrive"><h2>Lien externe (facultatif)</h2>
    ${inp('s-drive', 'Lien de partage (Proton Drive)', s.drive, { name: 'drive', type: 'url', attrs: { placeholder: 'https://drive.proton.me/urls/…', autocomplete: 'off' }, sub: 'Par exemple votre ancien Proton Drive : un lien s\'affiche dans le Drive de l\'app.' })}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`;
}
FORMS.cfgDrive = (v) => {
  const l = String(v.drive || '').trim();
  if (l && !/^https:\/\//.test(l)) { toast('Le lien doit commencer par https://'); return; }
  DB.put('cfg:reglages', Object.assign({}, DB.get('cfg:reglages') || {}, { drive: l }));
  toast(l ? 'Lien du drive enregistré.' : 'Lien du drive retiré.'); render();
};
FORMS.cfgEnt = (v) => {
  if (v.iban && !ibanCheck(v.iban).ok) { toast("Corrige l'IBAN avant d'enregistrer."); return; }
  const o = Object.assign({}, DB.get('cfg:reglages') || {}, v, { iban: cleanIban(v.iban), delai: Math.max(0, Math.min(120, parseInt(v.delai, 10) || 0)), prefixe: (v.prefixe || 'GDT').replace(/[^A-Za-z0-9]/g, '') || 'GDT' });
  DB.put('cfg:reglages', o); toast('Réglages enregistrés.');
};

function renderRegAssocies() {
  const s = cfg(), ps = personnes();
  const inv26 = typeof bilanAnnee === 'function' ? bilanAnnee('2026').invest : 0;
  const val26 = DB.all('inv:').filter((i) => yearOf(i.dateAchat) === '2026').reduce((a, i) => a + valeurFinAnnee(i, 2026, !!s.amortirDesAchat), 0);
  return `<form class="panel form" data-form="cfgAss"><h2>Associés et partage</h2>
    <p class="hint">Les dépenses et les recettes sont partagées selon ces parts. Le décompte « qui doit quoi » en dépend.
      « Associé dès le » : avant cette date, la personne ne partage ni les dépenses ni les recettes (elle peut quand même noter ses heures et avoir des tâches). Vide = depuis le début.</p>
    ${ps.map((p, i) => `<fieldset class="pers"><legend>${esc(p.nom)} <span class="meta">identifiant : ${esc(p.k)}</span></legend><div class="grid2">
      ${inp('pa-n' + i, 'Prénom', p.nom, { name: 'nom_' + i })}${inp('pa-p' + i, 'Part', p.part ?? 1, { name: 'part_' + i, type: 'number', attrs: { step: 'any', min: 0 }, sub: '1, 1 et 1 = un tiers chacun · 0 = pas associé' })}
      ${inp('pa-d' + i, 'Associé dès le', p.associeDes || '', { name: 'des_' + i, type: 'date' })}
      ${inp('pa-r' + i, 'Reprise de parts CHF', p.reprise || '', { name: 'rep_' + i, type: 'number', attrs: { step: '0.05', min: 0, inputmode: 'decimal' }, sub: 'Ce que la personne rachète en entrant. Partagé entre les associés d\'avant, compté dès la date d\'entrée.' })}
    </div></fieldset>`).join('')}
    ${ps.some((p) => p.associeDes) ? `<p class="hint">Repères pour la reprise : investissements 2026 ${chf(inv26)} (un tiers : ${chf(inv26 / 3)}) ·
      valeur restante fin 2026 des objets achetés en 2026 ${chf(val26)} (un tiers : ${chf(val26 / 3)}).</p>` : ''}
    <h3>Ajouter une personne</h3>
    ${inp('pa-new', 'Prénom', '', { name: 'nouveau', attrs: { placeholder: 'Ex. Marc', autocomplete: 'off' }, sub: 'Elle apparaît dans les heures, les tâches et le calendrier, sans part dans les comptes. Pour en faire un associé : sa part et sa date d\'entrée, ci-dessus.' })}
    <h3>Objectifs et calculs</h3>
    ${inp('pa-obj', 'Objectif de revenu annuel CHF', s.objectifAnnuel, { name: 'objectifAnnuel', type: 'number', attrs: { step: 100, min: 0 }, sub: 'Sert à calculer « objectif par heure » dans les heures.' })}
    <label class="row" style="font-size:14px"><input type="checkbox" name="amortirDesAchat"${s.amortirDesAchat ? ' checked' : ''}> Amortir dès l'année d'achat (sinon, comme l'ancien tableur : dès l'année suivante)</label>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`;
}
const cleDePrenom = (n) => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'personne';
FORMS.cfgAss = (v) => {
  const ps = personnes().map((p, i) => {
    const o = Object.assign({}, p, { nom: (v['nom_' + i] || '').trim() || p.nom, part: num(v['part_' + i]) });
    if (v['des_' + i]) o.associeDes = v['des_' + i]; else delete o.associeDes;
    const r = num(v['rep_' + i]); if (r > 0) o.reprise = r2(r); else delete o.reprise;
    return o;
  });
  const avant = personnes();
  const sansDate = ps.find((p, i) => p.part > 0 && !p.associeDes && !(num(avant[i].part ?? 1) > 0));
  if (sansDate) { toast(`Indique la date à partir de laquelle ${sansDate.nom} est associé·e, sinon il partagerait aussi les comptes du passé.`); return; }
  const nv = String(v.nouveau || '').trim();
  if (nv) {
    let k = cleDePrenom(nv), n = 2; const base = k;
    while (ps.some((p) => p.k === k) || k === 'ensemble') k = base + n++;
    ps.push({ k, nom: nv, part: 0 });
  }
  if (!ps.some((p) => p.part > 0)) { toast('Au moins une part doit être positive.'); return; }
  DB.put('cfg:reglages', Object.assign({}, DB.get('cfg:reglages') || {}, { personnes: ps, objectifAnnuel: num(v.objectifAnnuel), amortirDesAchat: !!v.amortirDesAchat }));
  toast(nv ? `${nv} est ajouté·e.` : 'Réglages enregistrés.'); render();
};

/* ---------- Données ---------- */
const PREFIX_LABEL = { 'fac:': 'Factures', 'ct:': 'Contacts', 'prod:': 'Produits', 'dep:': 'Dépenses', 'rec:': 'Recettes', 'reg:': 'Remboursements', 'h:': 'Heures', 'jour:': 'Remarques du calendrier', 't:': 'Tâches', 'cul:': 'Cultures', 'inv:': 'Inventaire', 'achat:': 'Achats prévus', 'ev:': 'Événements du calendrier', 'fiche:': 'Fiches cultures', 'irr:': 'Irrigation (semaines)', 'msg:': 'Messages', 'mail:': 'Mails', 'mvt:': 'Mouvements de stock', 'self:': 'Mises en vente', 'jnl:': 'Journal de cultures', 'drv:': 'Drive', 'lu:': 'Messages lus', 'cfg:': 'Réglages' };
const prefixOf = (k) => Object.keys(PREFIX_LABEL).find((p) => k.startsWith(p)) || '';
function libelleDe(k, d) { d = d || {}; return d.numero ? 'Facture ' + d.numero : d.texte ? trunc(d.texte, 60) : d.objet || d.titre || d.nom || d.organisation || d.client || d.remarque || (d.date ? fmtDate(d.date) : '') || k; }

function renderDonnees() {
  const counts = {}; for (const k in DB.data) { const p = prefixOf(k); counts[p] = (counts[p] || 0) + 1; }
  const trash = Object.entries(DB.trash).sort((a, b) => String(b[1]._supprimeLe || '').localeCompare(String(a[1]._supprimeLe || '')));
  return `<div class="split"><div class="panel"><h2>Sauvegarde</h2>
      <div id="usage-box"></div>
      <p class="hint">Toutes les données sont dans la base Supabase, avec l'historique de chaque modification. Pour une copie chez toi, exporte un fichier de temps en temps (par exemple chaque mois).</p>
      <div class="table-wrap"><table class="list"><tbody>${Object.entries(PREFIX_LABEL).filter(([p]) => counts[p]).map(([p, l]) => `<tr><td>${l}</td><td class="r num">${counts[p]}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn primary" type="button" data-act="exportJson">Exporter tout (fichier JSON)</button></div>
      <h3>Importer</h3>
      <p class="hint">Ajoute les éléments d'un fichier exporté (ou du fichier de reprise de l'Excel). Ce qui existe déjà n'est jamais écrasé.</p>
      <input type="file" id="imp-file" accept=".json,application/json">
      <div id="imp-res"></div></div>
    <div class="panel"><h2>Corbeille</h2>
      ${trash.length ? `<div class="items">${trash.slice(0, 60).map(([k, d]) => `<div class="item" style="cursor:default"><span class="who"><strong>${esc(trunc(libelleDe(k, d), 60))}</strong><span class="meta">${esc(PREFIX_LABEL[prefixOf(k)] || '')}${d._supprimeLe ? ' · supprimé le ' + fmtDate(d._supprimeLe.slice(0, 10)) : ''}${d._supprimePar ? ' par ' + esc(nomDe(d._supprimePar)) : ''}${d._supprimeLe ? ' · effacé pour de bon le ' + fmtDate(addDays(d._supprimeLe.slice(0, 10), 183)) : ''}</span></span><button class="btn small" type="button" data-act="restore" data-key="${esc(k)}">Restaurer</button></div>`).join('')}</div>`
        : '<p class="empty">La corbeille est vide.</p>'}
      <p class="hint">Ce qui est dans la corbeille depuis 6 mois est effacé pour de bon, historique compris (chaque nuit, par Supabase). Avant ça, tout se restaure.</p></div></div>`;
}
ACTIONS.restore = (el) => { if (DB.restore(el.dataset.key)) toast('Restauré.'); };
ACTIONS.exportJson = () => {
  const out = { app: 'gamins-de-talus', version: 1, exporte: new Date().toISOString(), par: Sync.me || '', rows: DB.data };
  downloadFile(`Gamins de Talus sauvegarde ${todayISO()}.json`, JSON.stringify(out, null, 1), 'application/json');
};
let IMPORT = null;
/* Compléter un élément existant : seuls les champs vides sont remplis, jamais une valeur déjà saisie.
   « forcer » liste les champs que le fichier peut remplacer explicitement. */
function completer(old, add, forcer) {
  const o = JSON.parse(JSON.stringify(old)); let ch = 0;
  const vide = (x) => x === '' || x == null || (Array.isArray(x) && !x.length);
  for (const [f, v] of Object.entries(add)) {
    if ((forcer || []).includes(f)) { if (JSON.stringify(o[f]) !== JSON.stringify(v)) { o[f] = v; ch++; } continue; }
    if (v && typeof v === 'object' && !Array.isArray(v) && o[f] && typeof o[f] === 'object' && !Array.isArray(o[f])) {
      for (const [g, w] of Object.entries(v)) if (vide(o[f][g]) && !vide(w)) { o[f][g] = w; ch++; }
    } else if (vide(o[f]) && !vide(v)) { o[f] = v; ch++; }
  }
  return ch ? o : null;
}
function planImport(o) {
  const rows = o.rows || (o.app ? {} : o), fusion = o.fusion || {};
  const nouv = {}, plan = { ajouts: [], completes: [], ignores: 0 };
  for (const k of Object.keys(rows)) { const p = prefixOf(k); if (!p || !rows[k]) continue; if (k in DB.data || k in DB.trash) plan.ignores++; else { plan.ajouts.push([k, rows[k]]); nouv[p] = (nouv[p] || 0) + 1; } }
  for (const [k, f] of Object.entries(fusion)) { if (!(k in DB.data)) continue; const r = completer(DB.data[k], f.data || {}, f.forcer); if (r) plan.completes.push([k, r, f.libelle || libelleDe(k, DB.data[k])]); }
  plan.nouv = nouv; return plan;
}
function lireImport(file) {
  const res = $('imp-res'); if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const o = JSON.parse(fr.result);
      if (!o || typeof o !== 'object') throw new Error('format inconnu');
      const plan = planImport(o); IMPORT = plan;
      const n = plan.ajouts.length + plan.completes.length;
      res.innerHTML = `<div class="panel" style="padding:12px"><p><b>${plan.ajouts.length} nouvel(s) élément(s)</b> à ajouter${plan.completes.length ? `, <b>${plan.completes.length} à compléter</b>` : ''}${plan.ignores ? `, ${plan.ignores} déjà présent(s) (ignorés)` : ''}.</p>
        <p class="hint">${Object.entries(plan.nouv).map(([p, k]) => `${PREFIX_LABEL[p]} : ${k}`).join(' · ') || 'Rien de nouveau.'}</p>
        ${plan.completes.length ? `<p class="hint">Complétés (seuls les champs vides sont remplis) : ${plan.completes.map((x) => esc(x[2])).join(' · ')}</p>` : ''}
        ${o.controle ? `<p class="hint">Contrôle du fichier : ${esc(o.controle)}</p>` : ''}
        ${n ? '<div class="row"><button class="btn primary" type="button" data-act="importOk">Importer</button></div>' : ''}</div>`;
    } catch (e) { res.innerHTML = `<p class="errors">Ce fichier n'a pas pu être lu : ${esc(e.message)}.</p>`; }
  };
  fr.readAsText(file);
}
ACTIONS.importOk = () => {
  if (!IMPORT) return; let n = 0, c = 0;
  for (const [k, v] of IMPORT.ajouts) { if (k in DB.data || k in DB.trash) continue; DB.data[k] = v; DB.sig[k] = canon(v); DB.dirty.add(k); n++; }
  for (const [k, v] of IMPORT.completes) { if (!(k in DB.data)) continue; DB.data[k] = v; DB.sig[k] = canon(v); DB.dirty.add(k); c++; }
  IMPORT = null; Sync.changed(); toast(`${n} élément(s) importé(s)${c ? `, ${c} complété(s)` : ''}.`); render();
};
