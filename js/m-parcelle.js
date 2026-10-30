/* Gamins de Talus — secteurs et planches numérotées, journal de cultures et rapport de fin d'année.
   cfg:parcelle  { secteurs: [{ k, nom, planches (nombre), longueur? }] }
   cul:<id>      + emplacements: ['<secteur>:<n°>', …] : où la culture est placée cette saison
   jnl:<id>      { date, par, texte, type, fiche?, culture?, emplacement?, photo? } */
'use strict';

const PARC = { peindre: '', jFiche: '', jType: '', jAnnee: '' };
const parcelle = () => Object.assign({ secteurs: [] }, DB.get('cfg:parcelle') || {});
const nomPlanche = (e) => { const [k, n] = String(e).split(':'); const s = parcelle().secteurs.find((x) => x.k === k); return (s ? s.nom : k) + ' ' + n; };
const chevauche = (a, b) => { const pa = periodeCulture(a), pb = periodeCulture(b); if (!pa || !pb) return true; return pa.debut <= pb.fin && pb.debut <= pa.fin; };
/* « A1–A4, B7 » : liste compacte des emplacements d'une culture */
function resumeEmplacements(l) {
  const parS = {}; for (const e of l || []) { const [k, n] = String(e).split(':'); (parS[k] = parS[k] || []).push(Number(n)); }
  return Object.entries(parS).map(([k, ns]) => {
    const s = parcelle().secteurs.find((x) => x.k === k), nom = s ? s.nom : k; ns.sort((a, b) => a - b); const r = []; let d = ns[0], p = ns[0];
    for (const n of ns.slice(1).concat([null])) { if (n === p + 1) { p = n; continue; } r.push(d === p ? `${d}` : `${d}–${p}`); d = n; p = n; }
    return `${nom} ${r.join(', ')}`;
  }).join(' · ');
}

/* ---------- Onglet Planches ---------- */
function renderPlanches() {
  const s = saisonCourante(), ss = saisons(), list = cultures(s), secs = parcelle().secteurs;
  const coul = (c) => (DB.get(ficheDe(c)) || {}).couleur || couleurCulture(c, (c.ordre || 1) - 1);
  const occ = {}; for (const c of list) for (const e of c.emplacements || []) (occ[e] = occ[e] || []).push(c);
  const chips = ss.map((x) => `<button class="chip${x === s ? ' on' : ''}" type="button" data-act="cuSaison" data-s="${x}">${x}</button>`).join('');
  const peint = PARC.peindre && DB.get(PARC.peindre);
  const barre = `<div class="panel peindre"><div class="row">${sel('pa-cul', 'Placer', PARC.peindre, [['', 'Choisir une culture, puis touche les planches…']].concat(list.map((c) => [c.key, `${c.nom} · ${(c.emplacements || []).length}/${f0(c.planches)} placées`])), {})}
      ${peint ? `<span class="hint">Touche une planche pour y mettre ou en retirer <b>${esc(peint.nom)}</b>.</span><button class="btn small" type="button" data-act="paFin">Terminé</button>` : ''}</div></div>`;
  const grille = secs.length ? secs.map((sec) => `<div class="panel secteur"><div class="between"><h3 style="margin:0">${esc(sec.nom)} <span class="hint">· ${f0(sec.planches)} planches${sec.longueur ? ' de ' + fmtNum(sec.longueur, 1) + ' m' : ''}</span></h3></div>
      <div class="planches">${Array.from({ length: Math.round(num(sec.planches)) }, (_, i) => {
        const e = `${sec.k}:${i + 1}`, cs = occ[e] || [];
        const conflit = cs.length > 1 && cs.some((a, j) => cs.some((b, m) => m > j && chevauche(a, b)));
        const fond = cs.length ? `linear-gradient(90deg, ${cs.map((c, j) => `${coul(c)} ${j / cs.length * 100}% ${(j + 1) / cs.length * 100}%`).join(', ')})` : '';
        return `<button type="button" class="planche${cs.length ? ' pleine' : ''}${conflit ? ' conflit' : ''}${peint && cs.includes(peint) ? ' sel' : ''}" data-act="paClic" data-e="${esc(e)}" style="${fond ? `background:${fond}` : ''}" title="${esc(sec.nom + ' ' + (i + 1) + (cs.length ? ' : ' + cs.map((c) => c.nom).join(' puis ') : ' : libre'))}"><b>${i + 1}</b><span>${esc(cs.map((c) => c.nom.slice(0, 4)).join('/'))}</span></button>`;
      }).join('')}</div></div>`).join('')
    : '<div class="panel"><p class="empty">Aucun secteur pour l\'instant. Crée tes secteurs (ex. « Champ du haut », 12 planches) : les planches sont numérotées automatiquement.</p></div>';
  const recap = list.length ? `<div class="panel"><h2>Où sont les cultures ${s}</h2><div class="table-wrap"><table class="list"><thead><tr><th>Culture</th><th class="r">Prévues</th><th class="r">Placées</th><th>Planches</th></tr></thead><tbody>
      ${list.map((c) => { const n = (c.emplacements || []).length, pr = Math.round(num(c.planches)); return `<tr><td><span class="sw" style="background:${coul(c)}"></span>${esc(c.nom)}</td><td class="r num">${pr}</td><td class="r num ${n !== pr ? 'bad' : ''}">${n}</td><td>${esc(resumeEmplacements(c.emplacements)) || '<span class="hint">pas encore placée</span>'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="hint">Une planche peut porter deux cultures qui se suivent dans l'année (couleurs partagées). En rouge : deux cultures qui y seraient en même temps.</p></div>` : '';
  return `<div class="between"><div class="row">${chips}</div><button class="btn small" type="button" data-act="paSecteurs">Secteurs</button></div>${barre}${grille}${recap}`;
}
function brancherPlanches() { const s = $('pa-cul'); if (s) s.addEventListener('change', () => { PARC.peindre = s.value; render(); }); }
ACTIONS.paFin = () => { PARC.peindre = ''; render(); };
ACTIONS.paClic = (el) => {
  const e = el.dataset.e;
  if (PARC.peindre) {
    const c = DB.get(PARC.peindre); if (!c) return; const l = (c.emplacements || []).slice(), i = l.indexOf(e);
    if (i >= 0) l.splice(i, 1); else l.push(e);
    DB.put(PARC.peindre, Object.assign({}, c, { emplacements: l })); return;
  }
  const s = saisonCourante(), list = cultures(s);
  openSheet(`${sheetHead('Planche ' + nomPlanche(e), 'Saison ' + s)}<form class="sbody form" data-form="paPlanche"><input type="hidden" name="e" value="${esc(e)}">
    ${list.length ? list.map((c) => `<label class="row" style="font-size:15px"><input type="checkbox" name="c_${esc(c.key)}"${(c.emplacements || []).includes(e) ? ' checked' : ''}> ${esc(c.nom)} <span class="hint">${esc(c.semPlantation ? 'sem. ' + c.semPlantation + (c.semRecolte ? ' → ' + c.semRecolte : '') : '')}</span></label>`).join('') : '<p class="empty">Aucune culture dans le plan.</p>'}
    <div class="row-end"><button class="btn" type="button" data-act="jnlNouveau" data-e="${esc(e)}">Note au journal</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.paPlanche = (v) => {
  for (const c of cultures(saisonCourante())) {
    const l = (c.emplacements || []).slice(), i = l.indexOf(v.e), on = !!v['c_' + c.key];
    if (on && i < 0) l.push(v.e); else if (!on && i >= 0) l.splice(i, 1); else continue;
    DB.put(c.key, Object.assign({}, DB.get(c.key), { emplacements: l }));
  }
  closeSheet();
};
ACTIONS.paSecteurs = () => {
  const secs = parcelle().secteurs.concat([{ k: '', nom: '', planches: '' }]);
  openSheet(`${sheetHead('Secteurs')}<form class="sbody form" data-form="paSecteurs">
    <p class="hint">Un secteur = un groupe de planches (champ, serre, parcelle…). Les planches y sont numérotées de 1 à N. Nom vide : secteur retiré (les cultures déjà placées gardent leur trace).</p>
    ${secs.map((x, i) => `<div class="grid4"><input type="hidden" name="k_${i}" value="${esc(x.k)}">${inp('ps-n' + i, x.k ? 'Secteur' : 'Nouveau secteur', x.nom, { name: 'n_' + i, attrs: { placeholder: x.k ? '' : 'ex. Champ du haut' } })}${inp('ps-p' + i, 'Planches', x.planches, { name: 'p_' + i, type: 'number' })}${inp('ps-l' + i, 'Longueur m', x.longueur ?? '', { name: 'l_' + i, type: 'number', attrs: { placeholder: 'hypothèses' } })}</div>`).join('')}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.paSecteurs = (v) => {
  const out = [];
  for (let i = 0; ('n_' + i) in v; i++) {
    const nom = String(v['n_' + i] || '').trim(); if (!nom) continue;
    let k = v['k_' + i] || sansAccentsS(nom).replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'sec'; while (out.some((x) => x.k === k)) k += '2';
    out.push({ k, nom, planches: Math.max(1, Math.round(num(v['p_' + i])) || 1), longueur: v['l_' + i] === '' ? null : num(v['l_' + i]) });
  }
  DB.put('cfg:parcelle', Object.assign({}, DB.get('cfg:parcelle') || {}, { secteurs: out })); closeSheet(); toast('Secteurs enregistrés.');
};

/* ---------- Journal de cultures ---------- */
const JNL_TYPES = [['observation', 'Observation'], ['maladie', 'Maladie'], ['ravageur', 'Ravageur'], ['meteo', 'Météo'], ['travail', 'Travail fait'], ['recolte', 'Récolte'], ['idee', 'Idée / à changer'], ['autre', 'Autre']];
const journal = () => DB.all('jnl:').sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || '')));
const typeJnl = (k) => (JNL_TYPES.find((t) => t[0] === k) || ['', k || ''])[1];
function renderJournal() {
  const all = journal(), ans = [...new Set(all.map((j) => String(j.date).slice(0, 4)).concat([todayISO().slice(0, 4)]))].sort().reverse();
  const an = PARC.jAnnee || ans[0];
  let l = all.filter((j) => String(j.date).slice(0, 4) === an);
  if (PARC.jFiche) l = l.filter((j) => j.fiche === PARC.jFiche);
  if (PARC.jType) l = l.filter((j) => j.type === PARC.jType);
  const fs = fiches();
  const ligne = (j) => { const f = DB.get(j.fiche); return `<div class="jnl"><div class="between"><span><b>${fmtDate(j.date)}</b> · <span class="tpill">${esc(typeJnl(j.type))}</span>${f ? ` <span class="sw" style="background:${f.couleur || '#999'}"></span>${esc(f.nom)}` : ''}${j.emplacement ? ` · ${esc(nomPlanche(j.emplacement))}` : ''}</span><span class="hint">${esc(nomDe(j.par))} <button class="msg-menu" type="button" data-act="jnlEdit" data-key="${esc(j.key)}" aria-label="Modifier">⋯</button></span></div>
      ${j.photo && j.photo.chemin ? `<button type="button" class="msg-photo" data-act="voirFichier" data-fichier="${esc(j.photo.chemin)}"><img data-fichier="${esc(j.photo.chemin)}" alt="Photo" style="max-height:160px"></button>` : ''}<p style="white-space:pre-wrap;margin:4px 0 0">${esc(j.texte)}</p></div>`; };
  return `<div class="panel"><form class="form" data-form="jnlRapide">
      <div class="grid2">${sel('jr-type', 'Type', 'observation', JNL_TYPES, { name: 'type' })}${sel('jr-fiche', 'Culture', PARC.jFiche, [['', 'Général']].concat(fs.map((f) => [f.key, f.nom])), { name: 'fiche' })}</div>
      ${txt('jr-txt', 'Note', '', { name: 'texte', rows: 3 })}
      <div class="row-end"><span class="hint">Date : aujourd'hui (modifiable ensuite)</span><button class="btn primary" type="submit">Ajouter au journal</button></div></form></div>
    <div class="between"><div class="row">${ans.map((x) => `<button class="chip${x === an ? ' on' : ''}" type="button" data-act="jnlAn" data-y="${x}">${x}</button>`).join('')}</div><button class="btn primary small" type="button" data-act="jnlRapport" data-y="${an}">Rapport ${an}</button></div>
    <div class="chips"><button class="chip${!PARC.jType ? ' on' : ''}" type="button" data-act="jnlType" data-k="">Tout</button>${JNL_TYPES.map(([k, t]) => `<button class="chip${PARC.jType === k ? ' on' : ''}" type="button" data-act="jnlType" data-k="${k}">${t}</button>`).join('')}</div>
    <div class="panel">${l.length ? l.map(ligne).join('') : '<p class="empty">Pas encore de note pour ce filtre.</p>'}</div>`;
}
ACTIONS.jnlAn = (el) => { PARC.jAnnee = el.dataset.y; render(); };
ACTIONS.jnlType = (el) => { PARC.jType = el.dataset.k; render(); };
FORMS.jnlRapide = (v) => {
  if (!v.texte) { toast('Écris la note.'); return; }
  DB.put('jnl:' + uid('j'), { date: todayISO(), par: Sync.me || '', texte: v.texte, type: v.type, fiche: v.fiche || '', cree: new Date().toISOString() });
  PARC.jFiche = v.fiche || ''; toast('Note ajoutée.');
};
ACTIONS.jnlNouveau = (el) => ACTIONS.jnlEdit({ dataset: { e: el.dataset.e || '', fiche: el.dataset.fiche || '' } });
ACTIONS.jnlEdit = (el) => {
  const k = el.dataset.key || '', j = k ? DB.get(k) : { date: todayISO(), type: 'observation', fiche: el.dataset.fiche || '', emplacement: el.dataset.e || '' };
  const empl = [['', '—']].concat(parcelle().secteurs.flatMap((s) => Array.from({ length: Math.round(num(s.planches)) }, (_, i) => [`${s.k}:${i + 1}`, `${s.nom} ${i + 1}`])));
  openSheet(`${sheetHead(k ? 'Note du journal' : 'Nouvelle note')}<form class="sbody form" data-form="jnl"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${inp('jn-d', 'Date', j.date, { name: 'date', type: 'date' })}${sel('jn-t', 'Type', j.type, JNL_TYPES, { name: 'type' })}
      ${sel('jn-f', 'Culture', j.fiche || '', [['', 'Général']].concat(fiches().map((f) => [f.key, f.nom])), { name: 'fiche' })}${sel('jn-e', 'Planche', j.emplacement || '', empl, { name: 'emplacement' })}</div>
    ${txt('jn-x', 'Note', j.texte, { name: 'texte', rows: 5 })}
    <label class="btn justif-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg>${j.photo ? 'Changer la photo' : 'Ajouter une photo'}<input id="jn-ph" type="file" accept="image/*" hidden></label><span class="hint" id="jn-ph-etat">${j.photo ? 'Une photo est jointe.' : ''}</span>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette note">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  PARC.photo = j.photo || null;
  const f = $('jn-ph'); if (f) f.addEventListener('change', async () => {
    const et = $('jn-ph-etat'); et.textContent = 'Envoi de la photo…';
    try { const r = await preparerFichier(f.files[0], 'photo'); const ch = await Fichiers.envoyer(r.blob, cheminFichier('journal', r.ext)); PARC.photo = { chemin: ch, w: r.w, h: r.h }; et.textContent = 'Photo prête.'; }
    catch (e) { et.textContent = 'Photo impossible : ' + e.message; }
  });
};
FORMS.jnl = (v) => {
  if (!v.texte) { toast('Écris la note.'); return; }
  const k = v.key || 'jnl:' + uid('j'), old = DB.get(k) || { par: Sync.me || '', cree: new Date().toISOString() };
  const o = Object.assign({}, old, { date: v.date || todayISO(), type: v.type, fiche: v.fiche, emplacement: v.emplacement, texte: v.texte });
  if (PARC.photo) o.photo = PARC.photo;
  DB.put(k, o); closeSheet(); toast('Note enregistrée.');
};

/* ---------- Rapport de fin d'année (texte à relire ou à donner à une IA) ---------- */
function rapportAnnee(y) {
  const l = cultures(y), P = paramsCultures(y), notes = journal().filter((j) => String(j.date).slice(0, 4) === y).reverse();
  const lignes = [`# Gamins de Talus — rapport de saison ${y}`, '', `Établi le ${fmtDate(todayISO())} à partir de l'app (plan de cultures, récoltes, journal).`, ''];
  lignes.push('## Plan et résultats', '');
  if (!l.length) lignes.push('Aucune culture dans le plan.');
  for (const c of l) {
    const reel = c.recolteReelle == null || c.recolteReelle === '' ? recolteNotee(c.key) : num(c.recolteReelle), o = culture(c, P);
    lignes.push(`- **${c.nom}** : ${f0(c.planches)} planches (${f1(o.surface)} m²)${c.emplacements && c.emplacements.length ? ', ' + resumeEmplacements(c.emplacements) : ''} · plantation sem. ${c.semPlantation || '?'}, récolte sem. ${c.semRecolte || '?'} · variété ${c.variete || '?'}`);
    lignes.push(`  récolte prévue ${f0(o.recolte)} kg, réelle ${reel ? f0(reel) + ' kg' : 'non notée'}${reel && o.surface ? ` (${fmtNum(reel / o.surface, 2)} kg/m² pour ${fmtNum(c.rendement, 1)} prévus)` : ''} · prix direct ${money(c.prixDirect)} CHF/kg`);
  }
  const parFiche = {}; for (const j of notes) (parFiche[j.fiche || ''] = parFiche[j.fiche || ''] || []).push(j);
  lignes.push('', '## Journal', '');
  if (!notes.length) lignes.push('Aucune note dans le journal cette année.');
  for (const [fk, js] of Object.entries(parFiche).sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0) || String((DB.get(a) || {}).nom).localeCompare(String((DB.get(b) || {}).nom)))) {
    lignes.push(`### ${fk ? (DB.get(fk) || {}).nom || 'Culture' : 'Général'}`, '');
    for (const j of js) lignes.push(`- ${fmtDate(j.date)} [${typeJnl(j.type)}]${j.emplacement ? ' (' + nomPlanche(j.emplacement) + ')' : ''} ${j.texte.replace(/\s*\n\s*/g, ' / ')} — ${nomDe(j.par)}`);
    lignes.push('');
  }
  lignes.push('## À demander à une IA', '', `« Voici le rapport de saison ${y} de notre maraîchage (Marly, Suisse). Dégage les points importants : ce qui a bien marché, les problèmes qui reviennent (maladies, ravageurs, météo, organisation), les écarts entre prévu et réel, et propose 5 à 10 changements concrets pour la saison ${Number(y) + 1}. »`);
  return lignes.join('\n');
}
ACTIONS.jnlRapport = (el) => {
  const y = el.dataset.y, t = rapportAnnee(y);
  openSheet(`${sheetHead('Rapport de saison ' + y)}<div class="sbody"><p class="hint">À relire, à garder, ou à coller dans une IA (la question à lui poser est à la fin).</p>
    <textarea id="rap-txt" rows="16" style="width:100%;font-family:var(--font-mono);font-size:12.5px">${esc(t)}</textarea>
    <div class="row-end"><button class="btn" type="button" data-act="rapCopier">Copier</button><button class="btn primary" type="button" data-act="rapTel" data-y="${esc(y)}">Télécharger (.md)</button></div></div>`);
};
ACTIONS.rapCopier = async () => { try { await navigator.clipboard.writeText($('rap-txt').value); toast('Rapport copié.'); } catch (e) { $('rap-txt').select(); toast('Sélectionné : copie avec Ctrl+C.'); } };
ACTIONS.rapTel = (el) => downloadFile(`Rapport de saison ${el.dataset.y} Gamins de Talus.md`, $('rap-txt').value, 'text/markdown;charset=utf-8');
