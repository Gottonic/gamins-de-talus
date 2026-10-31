/* Gamins de Talus — réglages, export / import des données, corbeille et historique. */
'use strict';

MODULES.reglages = {
  titre: 'Réglages',
  tuile() { return { line: DB.dirty.size ? `${DB.dirty.size} changement(s) à envoyer` : 'Coordonnées, associés, données' }; },
  render(sub) {
    /* Notifications d'abord (onglet par défaut), puis Associés, Données, Entreprise */
    if (sub === 'notifications') sub = '';
    const t = tabs('reglages', [['', 'Notifications'], ['associes', 'Associés'], ['donnees', 'Données'], ['entreprise', 'Entreprise'], ['categories', 'Catégories']], sub);
    if (sub === 'categories') return t + renderCategories();
    if (sub === 'associes') return t + renderRegAssocies();
    if (sub === 'donnees') return t + renderDonnees();
    if (sub === 'entreprise') return t + renderEntreprise();
    return t + renderNotifs();
  },
  after(sub) {
    if (sub === 'donnees' && typeof chargerUsage === 'function') chargerUsage();
    if (!sub || sub === 'notifications') etatPush().then((e) => { NOTIF.etat = e; const b = $('notif-appareil'); if (b) b.innerHTML = appareilHtml(); });
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
      ${sel('s-compte', 'Le compte appartient à', s.compteDe, persOptions(), { name: 'compteDe', sub: 'Les virements reçus comptent comme encaissés par cette personne, et c\'est sur son tableau de bord qu\'apparaissent les factures échues à vérifier.' })}
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
const PREFIX_LABEL = { 'fac:': 'Factures', 'ct:': 'Contacts', 'prod:': 'Produits', 'dep:': 'Dépenses', 'rec:': 'Recettes', 'reg:': 'Remboursements', 'h:': 'Heures', 'jour:': 'Remarques du calendrier', 't:': 'Tâches', 'cul:': 'Cultures', 'inv:': 'Inventaire', 'achat:': 'Achats prévus', 'ev:': 'Événements du calendrier', 'fiche:': 'Fiches cultures', 'irr:': 'Irrigation (semaines)', 'msg:': 'Messages', 'mail:': 'Mails', 'mvt:': 'Mouvements de stock', 'self:': 'Mises en vente', 'jnl:': 'Journal de cultures', 'drv:': 'Drive', 'tw:': 'Paiements TWINT importés', 'push:': 'Appareils (notifications)', 'vote:': 'Réponses aux sondages', 'lu:': 'Messages lus', 'cfg:': 'Réglages' };
const prefixOf = (k) => Object.keys(PREFIX_LABEL).find((p) => k.startsWith(p)) || '';
function libelleDe(k, d) { d = d || {}; return d.numero ? 'Facture ' + d.numero : d.texte ? trunc(d.texte, 60) : d.objet || d.titre || d.nom || d.organisation || d.client || d.remarque || (d.date ? fmtDate(d.date) : '') || k; }

function renderDonnees() {
  const counts = {}; for (const k in DB.data) { const p = prefixOf(k); counts[p] = (counts[p] || 0) + 1; }
  const trash = Object.entries(DB.trash).sort((a, b) => String(b[1]._supprimeLe || '').localeCompare(String(a[1]._supprimeLe || '')));
  return `<div class="split"><div class="panel"><h2>Sauvegarde</h2>
      <div id="usage-box"></div>
      <p class="hint">Toutes les données sont dans la base Supabase, avec l'historique de chaque modification. Une copie chez vous chaque mois (l'accueil le rappelle) : rangez-la dans votre Proton Drive.</p>
      <div class="table-wrap"><table class="list"><tbody>${Object.entries(PREFIX_LABEL).filter(([p]) => counts[p]).map(([p, l]) => `<tr><td>${l}</td><td class="r num">${counts[p]}</td></tr>`).join('')}</tbody></table></div>
      ${sauvegardeHtml()}
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
/* ---------- Sauvegarde : les données sont toujours complètes (un seul fichier suffit, le plus récent) ;
   les fichiers ne sont pris que s'ils ont été ajoutés depuis la dernière sauvegarde des fichiers (pas de doublons).
   cfg:sauvegarde = { le, par, fichiersJusqua } est partagé : le rappel mensuel disparaît dès qu'un associé l'a faite. */
const SAUV = { fichiers: false, tous: false, enCours: false, etape: '' };
function fichiersASauver() {
  const out = [], vus = {};
  const add = (ch, dossier, nom, date, avecExt) => {
    if (!ch) return; let n = `${dossier}/${nomZip(nom)}`; if (vus[n]) n += ' ' + (++vus[n]); else vus[n] = 1;
    out.push({ chemin: ch, nom: avecExt ? n : `${n}.${ch.split('.').pop() || 'bin'}`, date: String(date || '') });
  };
  if (typeof drv === 'function') for (const d of drv()) if (d.type === 'fichier' && d.chemin) add(d.chemin, ['Drive'].concat(chemin(d.parent).map((c) => nomZip(c.nom))).join('/'), d.nom, d.le, true);
  for (const d of depenses()) { const fs = (d.fichiers || []).filter((x) => !x.expire); fs.forEach((x, i) => add(x.chemin, 'Justificatifs', `${d.date} D${String(d.n || '').padStart(3, '0')} ${trunc(d.objet || '', 40)}${fs.length > 1 ? ' (' + (i + 1) + ')' : ''}`, x.ajoute)); }
  for (const f of factures()) { const fs = (f.blSigne || []).filter((x) => !x.expire); fs.forEach((x, i) => add(x.chemin, 'Bulletins signés', `${f.blNumero || 'BL'} ${(f.client && f.client.nom) || ''}${fs.length > 1 ? ' (' + (i + 1) + ')' : ''}`, x.ajoute)); }
  for (const m of DB.all('msg:')) if (m.photo && m.photo.chemin && !m.photo.expire) add(m.photo.chemin, 'Photos des messages', `${String(m.cree || '').slice(0, 10)} ${nomDe(m.de)}`, m.cree);
  if (typeof journal === 'function') for (const j of journal()) if (j.photo && j.photo.chemin) add(j.photo.chemin, 'Photos du journal', `${j.date} ${trunc(j.texte || '', 30)}`, j.cree || j.date);
  return out;
}
function sauvegardeHtml() {
  const e = DB.get('cfg:sauvegarde') || {}, tous = fichiersASauver(), nouveaux = e.fichiersJusqua ? tous.filter((f) => f.date > e.fichiersJusqua) : tous;
  return `<p class="hint">${e.le ? `Dernière sauvegarde le ${fmtDate(e.le.slice(0, 10))}${e.par ? ' par ' + esc(nomDe(e.par)) : ''}.` : 'Pas encore de sauvegarde.'}</p>
    <label class="row" style="font-size:14px"><input type="checkbox" id="sv-fich"${SAUV.fichiers ? ' checked' : ''}> Aussi les fichiers (photos, justificatifs, bulletins signés, Drive)</label>
    ${SAUV.fichiers ? `<p class="hint">${e.fichiersJusqua ? `Seulement les ${nouveaux.length} fichier${nouveaux.length > 1 ? 's' : ''} ajouté${nouveaux.length > 1 ? 's' : ''} depuis la dernière sauvegarde des fichiers (${fmtDate(e.fichiersJusqua.slice(0, 10))}) : rien n'est téléchargé deux fois.
      <label class="row"><input type="checkbox" id="sv-tous"${SAUV.tous ? ' checked' : ''}> Tous les fichiers (${tous.length}), pour une copie complète</label>` : `Première sauvegarde des fichiers : ${tous.length > 1 ? 'les ' + tous.length + ' fichiers' : tous.length ? 'le seul fichier' : 'aucun fichier pour l\'instant'}.`}</p>` : ''}
    <div class="row"><button class="btn primary" type="button" data-act="exportJson"${SAUV.enCours ? ' disabled' : ''}>${SAUV.enCours ? esc(SAUV.etape || 'Préparation…') : SAUV.fichiers ? 'Sauvegarder (fichier .zip)' : 'Sauvegarder les données (fichier .json)'}</button></div>
    <p class="hint">Les données sont toujours complètes : gardez seulement la plus récente. Les fichiers .zip se complètent : gardez-les tous, ils ne contiennent jamais deux fois le même fichier.</p>`;
}
document.addEventListener('change', (e) => { if (e.target.id === 'sv-fich') { SAUV.fichiers = e.target.checked; render(); } if (e.target.id === 'sv-tous') { SAUV.tous = e.target.checked; render(); } });
ACTIONS.exportJson = async () => {
  if (SAUV.enCours) return;
  const e = DB.get('cfg:sauvegarde') || {}, maint = new Date().toISOString(), base = `Gamins de Talus sauvegarde ${todayISO()}`;
  const donnees = JSON.stringify({ app: 'gamins-de-talus', version: 1, exporte: maint, par: Sync.me || '', rows: DB.data }, null, 1);
  if (!SAUV.fichiers) { downloadFile(base + '.json', donnees, 'application/json'); DB.put('cfg:sauvegarde', Object.assign({}, e, { le: maint, par: Sync.me || '' })); toast('Sauvegarde téléchargée. Range-la dans votre drive.'); return; }
  if (!window.JSZip) { toast("L'outil d'archive n'est pas chargé. Recharge la page."); return; }
  if (!navigator.onLine && !LOCAL_MODE) { toast('Il faut du réseau pour récupérer les fichiers.'); return; }
  const depuis = SAUV.tous ? '' : e.fichiersJusqua || '', fs = fichiersASauver().filter((f) => !depuis || f.date > depuis);
  SAUV.enCours = true; SAUV.etape = 'Préparation…'; render();
  const etape = (t) => { SAUV.etape = t; const b = document.querySelector('[data-act="exportJson"]'); if (b) b.textContent = t; };
  try {
    const z = new window.JSZip(), dir = z.folder(base), manquants = [];
    dir.file('donnees.json', donnees);
    let i = 0;
    for (const f of fs) { etape(`Fichiers ${++i}/${fs.length}…`); try { dir.file(f.nom, await telechargerFichier(f.chemin)); } catch (err) { manquants.push(f.nom); } }
    dir.file('LISEZ-MOI.txt', [`Gamins de Talus — sauvegarde du ${fmtDate(todayISO())} par ${nomDe(Sync.me)}.`, '', 'donnees.json : toutes les données de l\'app (se réimporte dans Réglages → Données).',
      depuis ? `Fichiers : seulement ceux ajoutés depuis le ${fmtDate(depuis.slice(0, 10))} (les plus anciens sont dans les sauvegardes précédentes).` : 'Fichiers : tous les fichiers de l\'app.',
      manquants.length ? '\nFichiers qui n\'ont pas pu être ajoutés :\n- ' + manquants.join('\n- ') : ''].join('\r\n'));
    etape('Compression…');
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    downloadFile(base + (depuis ? ` (fichiers depuis le ${fmtDate(depuis.slice(0, 10))})` : '') + '.zip', blob, 'application/zip');
    /* Si des fichiers ont manqué, la prochaine sauvegarde repart de l'ancienne date pour les reprendre */
    DB.put('cfg:sauvegarde', Object.assign({}, e, { le: maint, par: Sync.me || '', fichiersJusqua: manquants.length ? e.fichiersJusqua || '' : maint }));
    toast(manquants.length ? `Sauvegarde téléchargée, mais ${manquants.length} fichier(s) manquent (voir LISEZ-MOI).` : `Sauvegarde téléchargée (${fs.length} fichier${fs.length > 1 ? 's' : ''}). Range-la dans votre drive.`, 6000);
  } catch (err) { console.error(err); toast("La sauvegarde n'a pas pu être créée : " + (err.message || err), 6000); }
  SAUV.enCours = false; SAUV.etape = ''; render();
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

/* ---------- Catégories de la Planification (tâches, événements, heures) ---------- */
const HEURES_CHOIX = [['cultures', 'Cultures'], ['ventes', 'Ventes & livraisons'], ['admin', 'Admin'], ['', '— (ne compte pas)']];
function renderCategories() {
  const cs = categories();
  return `<div class="panel"><h2>Catégories</h2>
    <p class="hint">Elles servent aux tâches, aux événements et aux heures. ⏱ = pour quoi comptent les heures : quand tu notes tes heures après une journée, la catégorie pré-coche Admin, Ventes ou Cultures (pour les marges). Les catégories et précisions marquées 🔒 servent à l'app (rappel de récolte, facture de livraison, congés) : on peut les renommer, pas les supprimer.</p>
    <div class="cat-ed">${cs.map((c, i) => `<div class="cat-it" style="--c:${esc(c.couleur)}">
      <div class="row cat-l1"><input class="cat-ico" value="${esc(c.icone || '')}" data-cat="${i}" data-f="icone" maxlength="4" aria-label="Icône"><input value="${esc(c.nom)}" data-cat="${i}" data-f="nom" maxlength="30" aria-label="Nom" style="flex:1;min-width:120px">
        <input type="color" value="${esc(c.couleur)}" data-cat="${i}" data-f="couleur" aria-label="Couleur">
        <label class="hint" style="display:flex;gap:6px;align-items:center;white-space:nowrap" title="Heures comptées pour (marges)">⏱ <select data-cat="${i}" data-f="heures">${HEURES_CHOIX.map(([k, l]) => `<option value="${k}"${(c.heures || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        ${c.fixe ? '<span title="Utilisée par l\'app">🔒</span>' : `<button class="btn small danger" type="button" data-act="catSuppr" data-i="${i}">Supprimer</button>`}</div>
      <div class="row cat-sous">${(c.sous || []).map((s, j) => `<span class="tpill">${esc(s.nom)}${s.fixe ? ' 🔒' : ''}<button type="button" class="btn link small" data-act="catSousRen" data-i="${i}" data-j="${j}" aria-label="Renommer">✎</button>${s.fixe ? '' : `<button type="button" class="btn link small" data-act="catSousOff" data-i="${i}" data-j="${j}" aria-label="Retirer">×</button>`}</span>`).join('')}
        <input placeholder="+ précision (ex. Taille, Paillage)" data-sous-new="${i}" maxlength="30" style="max-width:220px"></div></div>`).join('')}</div>
    <div class="row"><input id="cat-new" placeholder="Nouvelle catégorie (ex. Formation)" maxlength="30"><button class="btn" type="button" data-act="catAjout">+ Catégorie</button></div>
    <p class="hint">Une tâche ou un événement d'une catégorie supprimée passe dans « Autre ».</p></div>`;
}
const sauverCats = (cs) => { DB.put('cfg:categories', { liste: cs }); };
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset && (e.target.dataset.sousNew != null || e.target.id === 'cat-new' || e.target.dataset.cat != null)) { e.preventDefault(); if (e.target.id === 'cat-new') ACTIONS.catAjout(); else e.target.blur(); } });
document.addEventListener('change', (e) => {
  const el = e.target; if (!el.dataset) return;
  if (el.dataset.cat != null && el.dataset.f) { const cs = categories(), c = cs[Number(el.dataset.cat)]; if (!c) return; c[el.dataset.f] = el.dataset.f === 'nom' ? (el.value.trim() || c.nom) : el.value; sauverCats(cs); toast('Enregistré.'); }
  else if (el.dataset.sousNew != null && el.value.trim()) { const cs = categories(), c = cs[Number(el.dataset.sousNew)]; c.sous = (c.sous || []).concat([{ k: uid('s'), nom: el.value.trim() }]); sauverCats(cs); }
});
ACTIONS.catAjout = () => { const n = $('cat-new'); if (!n || !n.value.trim()) return; const cs = categories(); cs.splice(cs.findIndex((c) => c.k === 'autre'), 0, { k: uid('c'), nom: n.value.trim(), icone: '•', couleur: '#B4237A', heures: '', sous: [] }); sauverCats(cs); };
ACTIONS.catSuppr = (el) => { const cs = categories(), c = cs[Number(el.dataset.i)]; if (!c || c.fixe) return; confirmSheet(`Supprimer « ${c.nom} » ?`, 'Ses tâches et événements passent dans « Autre ».', 'catSupprOk', 'Supprimer', { i: el.dataset.i }); };
ACTIONS.catSupprOk = (el) => { const cs = categories(); cs.splice(Number(el.dataset.i), 1); sauverCats(cs); closeSheet(); };
ACTIONS.catSousOff = (el) => { const cs = categories(), c = cs[Number(el.dataset.i)]; if (!c || (c.sous[Number(el.dataset.j)] || {}).fixe) return; c.sous.splice(Number(el.dataset.j), 1); sauverCats(cs); };
ACTIONS.catSousRen = (el) => {
  const c = categories()[Number(el.dataset.i)], s = c && c.sous[Number(el.dataset.j)]; if (!s) return;
  openSheet(`${sheetHead('Renommer la précision', c.nom)}<form class="sbody form" data-form="catSousRen"><input type="hidden" name="i" value="${el.dataset.i}"><input type="hidden" name="j" value="${el.dataset.j}">${inp('cs-n', 'Nom', s.nom, { name: 'nom', req: true, attrs: { maxlength: 30, autofocus: '' } })}<div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.catSousRen = (v) => { const cs = categories(), s = (cs[Number(v.i)] || { sous: [] }).sous[Number(v.j)]; if (s && v.nom.trim()) { s.nom = v.nom.trim(); sauverCats(cs); } closeSheet(); };

/* ---------- Notifications « pop-up » sur le téléphone ou l'ordinateur (Web Push) ----------
   Chaque appareil s'abonne (ligne push:<personne>:<appareil>) ; chacun choisit ce qu'il reçoit (cfg:notif:<personne>).
   C'est la fonction Supabase « notifier » qui envoie : à chaque nouveau message ou mail, et le matin pour les tâches et événements du jour. */
const VAPID_PUBLIC = 'BEWBqzH3etLZ-_g1_ZUOTJSyD-qECUilmuXsm9MIw6COqRTe4Ynqgu75jrlmAW3PGTVDD5VdjtL5zHWpBDUkCi0';
const NOTIF = { etat: null, enCours: false };
const NOTIF_CHOIX = [['messages', 'Nouveaux messages de la discussion', 'Sauf les tiens.'], ['mails', 'Nouveaux mails de la boîte', 'Dès qu\'ils sont relevés.'], ['jour', 'Le matin vers 7 h : tes tâches et événements du jour', 'Seulement s\'il y en a.']];
/* messages / mails / jour : notification sur les appareils ; d_messages / d_mails / d_jour : sur Discord */
const prefsNotif = (p) => Object.assign({ messages: true, mails: true, jour: true, d_messages: true, d_mails: false, d_jour: false }, DB.get('cfg:notif:' + (p || Sync.me)) || {});
const idAppareil = () => { let i = ls.get('gdt-appareil'); if (!i) { i = uid('a'); ls.set('gdt-appareil', i); } return i; };
const nomAppareil = () => { const u = navigator.userAgent; return (/iPhone|iPad/.test(u) ? 'iPhone/iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Appareil') + ' · ' + (/Firefox/.test(u) ? 'Firefox' : /Edg\//.test(u) ? 'Edge' : /Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : 'navigateur'); };
const b64uVersOctets = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function etatPush() {
  if (LOCAL_MODE) return { ok: false, raison: 'Pas en mode essai.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent), app = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return { ok: false, raison: ios && !app ? "Sur iPhone : d'abord Partager → « Sur l'écran d'accueil », puis ouvrir l'app depuis son icône et revenir ici." : "Ce navigateur ne sait pas recevoir de notifications." };
  }
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); return { ok: true, permission: Notification.permission, abonne: !!sub && !!DB.get('push:' + Sync.me + ':' + idAppareil()) }; }
  catch (e) { return { ok: false, raison: e.message }; }
}
function appareilHtml() {
  const e = NOTIF.etat; if (!e) return '<p class="hint">Vérification…</p>';
  if (!e.ok) return `<p class="hint">${esc(e.raison)}</p>`;
  if (e.permission === 'denied') return '<p class="errors">Les notifications sont bloquées pour ce site dans le navigateur. Autorise-les dans les réglages du navigateur (icône à gauche de l\'adresse), puis reviens ici.</p>';
  return e.abonne ? `<p><b>✓ Cet appareil reçoit les notifications.</b></p><div class="row"><button class="btn" type="button" data-act="notifTest"${NOTIF.enCours ? ' disabled' : ''}>Envoyer un test</button><button class="btn" type="button" data-act="notifOff">Arrêter sur cet appareil</button></div>`
    : `<div class="row"><button class="btn primary" type="button" data-act="notifOn"${NOTIF.enCours ? ' disabled' : ''}>${NOTIF.enCours ? 'Activation…' : 'Activer sur cet appareil'}</button></div><p class="hint">Le navigateur demande la permission. À faire sur chaque téléphone ou ordinateur où tu veux les recevoir.</p>`;
}
function renderNotifs() {
  if (!Sync.me) return '<div class="panel"><p class="empty">Connecte-toi pour régler tes notifications.</p></div>';
  const p = prefsNotif(), mes = DB.all('push:' + Sync.me + ':'), dOn = !!(DB.get('cfg:discord:' + Sync.me) || {}).webhook;
  return `<div class="split"><div class="panel"><h2>Sur cet appareil</h2><div id="notif-appareil">${appareilHtml()}</div>
      ${mes.length ? `<h3>Tes appareils abonnés</h3><div class="items">${mes.map((a) => `<div class="item" style="cursor:default"><span class="who"><strong>${esc(a.appareil || 'Appareil')}</strong><span class="meta">depuis le ${fmtDate(String(a.le || '').slice(0, 10))}${a.key.endsWith(':' + idAppareil()) ? ' · celui-ci' : ''}</span></span><button class="btn small" type="button" data-act="notifRetirer" data-key="${esc(a.key)}">Retirer</button></div>`).join('')}</div>` : ''}
      <p class="hint">Les notifications arrivent même app fermée (Android, ordinateur ; iPhone : app ajoutée à l'écran d'accueil).</p>
      <h3>Discord</h3>${dOn ? `<p><b>✓ Ton salon Discord est relié.</b></p>` : '<p class="hint">Facultatif : l\'app peut aussi poster dans ton propre salon Discord.</p>'}
      <div class="row"><button class="btn${dOn ? '' : ' primary'}" type="button" data-act="discordSheet">${dOn ? 'Changer ou tester' : 'Relier mon Discord'}</button></div></div>
    <div class="panel"><h2>Ce que ${esc(nomDe(Sync.me))} reçoit</h2>
      <table class="notif-choix"><thead><tr><th></th><th>📱 Appareils</th><th>Discord</th></tr></thead><tbody>
      ${NOTIF_CHOIX.map(([k, l, sub]) => `<tr><td>${esc(l)}<br><span class="hint">${esc(sub)}</span></td>
        <td><input type="checkbox" data-notif="${k}" aria-label="${esc(l)} sur les appareils"${p[k] ? ' checked' : ''}></td>
        <td><input type="checkbox" data-notif="d_${k}" aria-label="${esc(l)} sur Discord"${p['d_' + k] && dOn ? ' checked' : ''}${dOn ? '' : ' disabled'}></td></tr>`).join('')}</tbody></table>
      <p class="hint">Ces choix valent pour tous tes appareils. Chacun règle les siens.${dOn ? '' : ' Pour cocher Discord, relie d\'abord ton salon (à gauche).'}</p></div></div>`;
}
document.addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.notif; if (!k || !Sync.me) return; DB.put('cfg:notif:' + Sync.me, Object.assign(prefsNotif(), { [k]: e.target.checked })); toast('Enregistré.'); });
ACTIONS.notifOn = async () => {
  NOTIF.enCours = true; render();
  try {
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('permission refusée');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uVersOctets(VAPID_PUBLIC) });
    const j = sub.toJSON();
    DB.put('push:' + Sync.me + ':' + idAppareil(), { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: nomAppareil(), le: new Date().toISOString() });
    toast('Notifications activées sur cet appareil.');
  } catch (e) { toast("Activation impossible : " + e.message, 6000); }
  NOTIF.enCours = false; NOTIF.etat = await etatPush(); render();
};
ACTIONS.notifOff = async () => {
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* */ }
  const k = 'push:' + Sync.me + ':' + idAppareil(); if (DB.get(k)) DB.del(k);
  NOTIF.etat = await etatPush(); render(); toast('Plus de notifications sur cet appareil.');
};
ACTIONS.notifRetirer = (el) => { if (el.dataset.key.endsWith(':' + idAppareil())) { ACTIONS.notifOff(); return; } DB.del(el.dataset.key); toast('Appareil retiré.'); };
ACTIONS.notifTest = async () => {
  NOTIF.enCours = true; render();
  await Sync.push().catch(() => {}); // l'abonnement doit être dans la base avant le test
  try {
    const { data, error } = await Sync.sb.functions.invoke('notifier', { body: { test: true } });
    if (error) { let m = error.message; try { const b = await error.context.clone().json(); if (b && b.erreur) m = b.erreur; } catch (_) { /* */ } throw new Error(m); }
    toast(data && data.envoyes ? 'Test envoyé : la notification devrait arriver.' : 'Envoyé à aucun appareil' + (data && data.erreurs && data.erreurs.length ? ' : ' + data.erreurs[0] : '.'), 6000);
  } catch (e) { toast('Test impossible : ' + e.message + ' (fonction « notifier » installée dans Supabase ?)', 8000); }
  NOTIF.enCours = false; render();
};
