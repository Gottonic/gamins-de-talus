/* Gamins de Talus — Drive interne : dossiers et fichiers, rangés dans le stockage privé Supabase (dossier « drive/ »).
   drv:<id> { type: 'dossier' | 'fichier', nom, parent ('' = racine), chemin (stockage), taille, mime, par, le }
   Supprimer = corbeille ; au bout de 6 mois, l'élément et son fichier sont effacés pour de bon. */
'use strict';

const DRV = { dossier: '', envoi: '' };
const DRIVE_MAX = 25 * 1024 * 1024;
const drv = () => DB.all('drv:');
const enfants = (p) => drv().filter((x) => (x.parent || '') === (p || '')).sort((a, b) => (a.type === 'dossier' ? 0 : 1) - (b.type === 'dossier' ? 0 : 1) || String(a.nom).localeCompare(String(b.nom), 'fr'));
const tailleTxt = (o) => { o = num(o); return o < 1024 ? o + ' o' : o < 1048576 ? fmtNum(o / 1024, 0) + ' Ko' : fmtNum(o / 1048576, 1) + ' Mo'; };
function chemin(id) { const l = []; let x = DB.get(id); while (x) { l.unshift(Object.assign({ key: id }, x)); id = x.parent; x = id ? DB.get(id) : null; } return l; }
const ICO = (x) => x.type === 'dossier' ? '📁' : /^image\//.test(x.mime) ? '🖼️' : /pdf/.test(x.mime) ? '📕' : /sheet|excel|csv|ods/.test(x.mime + x.nom) ? '📊' : /word|document|odt|text/.test(x.mime + x.nom) ? '📄' : '📎';

MODULES.drive = {
  titre: 'Drive',
  tuile() { const f = drv().filter((x) => x.type === 'fichier'); return { line: f.length ? `${f.length} fichier${f.length > 1 ? 's' : ''} · ${tailleTxt(f.reduce((a, x) => a + num(x.taille), 0))}` : 'Dossiers et fichiers partagés' }; },
  render(sub, id) { DRV.dossier = sub === 'd' && id && DB.get(id) ? id : ''; return renderDrive(); },
  after() {
    const f = $('drv-file'); if (f) f.addEventListener('change', () => envoyerDrive([...f.files]));
    const z = $('drv-zone'); if (z) { z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('drag'); }); z.addEventListener('dragleave', () => z.classList.remove('drag')); z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('drag'); envoyerDrive([...e.dataTransfer.files]); }); }
    chargerUsage();
  },
};
function renderDrive() {
  const d = DRV.dossier, l = enfants(d), fil = chemin(d);
  const bc = `<nav class="fil"><a href="#/drive">Drive</a>${fil.map((x) => ` / <a href="#/drive/d/${encodeURIComponent(x.key)}">${esc(x.nom)}</a>`).join('')}</nav>`;
  const ligne = (x) => x.type === 'dossier'
    ? `<div class="drv-it"><a class="drv-nom" href="#/drive/d/${encodeURIComponent(x.key)}">${ICO(x)} <b>${esc(x.nom)}</b></a><span class="hint">${enfants(x.key).length} élément${enfants(x.key).length > 1 ? 's' : ''}</span><button class="btn small" type="button" data-act="drvMenu" data-key="${esc(x.key)}" aria-label="Options">⋯</button></div>`
    : `<div class="drv-it">${/^image\/|pdf/.test(x.mime) ? `<button type="button" class="drv-nom" data-act="voirFichier" data-fichier="${esc(x.chemin)}" data-titre="${esc(x.nom)}">${ICO(x)} ${esc(x.nom)}</button>` : `<a class="drv-nom" data-fichier="${esc(x.chemin)}" download="${esc(x.nom)}" target="_blank" rel="noopener">${ICO(x)} ${esc(x.nom)}</a>`}
        <span class="hint">${tailleTxt(x.taille)} · ${fmtDate(String(x.le || '').slice(0, 10))}${x.par ? ' · ' + esc(nomDe(x.par)) : ''}</span><button class="btn small" type="button" data-act="drvMenu" data-key="${esc(x.key)}" aria-label="Options">⋯</button></div>`;
  const ancien = cfg().drive ? `<p class="hint">Ancien lien : <a href="${esc(cfg().drive)}" target="_blank" rel="noopener noreferrer">Proton Drive</a></p>` : '';
  return `<div id="usage-box"></div>
    <div class="panel" id="drv-zone"><div class="between">${bc}<div class="row"><button class="btn small" type="button" data-act="drvDossier">+ Dossier</button><label class="btn primary small">Ajouter des fichiers<input id="drv-file" type="file" multiple hidden></label></div></div>
      ${DRV.envoi ? `<p class="banner">${esc(DRV.envoi)}</p>` : ''}
      ${l.length ? `<div class="drv-liste">${l.map(ligne).join('')}</div>` : `<p class="empty">${d ? 'Dossier vide.' : 'Le Drive est vide.'} Glisse des fichiers ici ou utilise « Ajouter des fichiers » (25 Mo au plus par fichier).</p>`}
      ${ancien}</div>`;
}
async function envoyerDrive(files) {
  if (!files.length) return;
  let ok = 0; const err = [];
  for (const [i, f] of files.entries()) {
    DRV.envoi = `Envoi ${i + 1}/${files.length} : ${f.name}…`; render();
    try {
      if (f.size > DRIVE_MAX) throw new Error('plus de 25 Mo');
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
      const ch = await Fichiers.envoyer(f, `drive/${uid('f')}.${ext}`);
      DB.put('drv:' + uid('d'), { type: 'fichier', nom: f.name, parent: DRV.dossier, chemin: ch, taille: f.size, mime: f.type || '', par: Sync.me || '', le: new Date().toISOString() });
      ok++;
    } catch (e) { err.push(`${f.name} (${e.message})`); }
  }
  DRV.envoi = ''; USAGE.t = 0; render();
  toast(err.length ? `${ok} envoyé(s). Pas envoyés : ${err.join(', ')}` : `${ok} fichier${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}.`, err.length ? 8000 : 3000);
}
ACTIONS.drvDossier = () => {
  openSheet(`${sheetHead('Nouveau dossier')}<form class="sbody form" data-form="drvDossier">${inp('dd-n', 'Nom', '', { name: 'nom', req: true, attrs: { autofocus: '' } })}<div class="row-end"><button class="btn primary" type="submit">Créer</button></div></form>`);
};
FORMS.drvDossier = (v) => { if (!v.nom) return; DB.put('drv:' + uid('d'), { type: 'dossier', nom: v.nom, parent: DRV.dossier, par: Sync.me || '', le: new Date().toISOString() }); closeSheet(); };
ACTIONS.drvMenu = (el) => {
  const k = el.dataset.key, x = DB.get(k); if (!x) return;
  const dossiers = drv().filter((d) => d.type === 'dossier' && d.key !== k && !chemin(d.key).some((c) => c.key === k));
  openSheet(`${sheetHead(x.nom)}<form class="sbody form" data-form="drvModif"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('dm-n', 'Nom', x.nom, { name: 'nom', req: true })}
    ${sel('dm-p', 'Dans le dossier', x.parent || '', [['', 'Drive (racine)']].concat(dossiers.map((d) => [d.key, chemin(d.key).map((c) => c.nom).join(' / ')])), { name: 'parent' })}
    <div class="row-end">${x.type === 'fichier' ? `<a class="btn" data-fichier="${esc(x.chemin)}" download="${esc(x.nom)}" target="_blank" rel="noopener">Télécharger</a>` : ''}<button class="btn danger" type="button" data-act="drvSuppr" data-key="${esc(k)}">Supprimer</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  hydraterFichiers($('sheet'));
};
FORMS.drvModif = (v) => { const x = DB.get(v.key); if (!x || !v.nom) return; DB.put(v.key, Object.assign({}, x, { nom: v.nom, parent: v.parent || '' })); closeSheet(); };
ACTIONS.drvSuppr = (el) => {
  const k = el.dataset.key, x = DB.get(k); if (!x) return;
  const tout = []; const rec = (id) => { tout.push(id); for (const e of enfants(id)) rec(e.key); }; rec(k);
  confirmSheet(`Supprimer « ${x.nom} » ?`, `${tout.length > 1 ? `Avec son contenu (${tout.length - 1} élément${tout.length > 2 ? 's' : ''}). ` : ''}Récupérable dans la corbeille (Réglages → Données) pendant 6 mois, puis effacé pour de bon.`, 'drvSupprOk', 'Supprimer', { keys: tout.join(',') });
};
ACTIONS.drvSupprOk = (el) => { for (const k of el.dataset.keys.split(',')) DB.del(k); USAGE.t = 0; closeSheet(); toast('Mis à la corbeille.'); };

/* ---------- Place utilisée (fonction SQL « utilisation » ; sinon estimation depuis l'appareil) ---------- */
const USAGE = { d: null, t: 0 };
async function chargerUsage() {
  const box = $('usage-box'); if (!box) return;
  if (!USAGE.d || Date.now() - USAGE.t > 300000) {
    let d = null;
    if (!LOCAL_MODE && Sync.sb) { try { const r = await Sync.sb.rpc('utilisation'); if (!r.error && r.data) d = Object.assign({ exact: true }, r.data); } catch (e) { /* */ } }
    if (!d) {
      const parDossier = {}; for (const x of drv()) if (x.type === 'fichier') parDossier.drive = (parDossier.drive || 0) + num(x.taille);
      d = { exact: false, donnees: new Blob([JSON.stringify(DB.data)]).size, fichiers: parDossier };
    }
    USAGE.d = d; USAGE.t = Date.now();
  }
  const b = $('usage-box'); if (b) b.innerHTML = usageHtml(USAGE.d);
}
function usageHtml(d) {
  const f = d.fichiers || {}, MB = 1048576, base = num(d.base) || num(d.donnees) + num(d.historique), totF = Object.values(f).reduce((a, x) => a + num(x), 0);
  const barre = (parts, max) => `<span class="ubar">${parts.map(([v, c, t]) => `<span style="width:${Math.min(100, v / max * 100).toFixed(2)}%;background:${c}" title="${esc(t)}"></span>`).join('')}</span>`;
  const cats = [['drive', 'Drive', 'var(--c-reglages)'], ['justificatifs', 'Justificatifs', 'var(--c-finances)'], ['messages', 'Photos des messages', 'var(--c-messages)'], ['journal', 'Photos du journal', 'var(--c-cultures)']];
  const autres = totF - cats.reduce((a, [k]) => a + num(f[k]), 0);
  return `<div class="panel usage"><h2>Place utilisée${d.exact ? '' : ' (estimation)'}</h2>
    <div class="ulig"><span>Base de données Gamins de Talus</span>${barre([[base, 'var(--c-factures)', 'Données']], 500 * MB)}<span class="num">${tailleTxt(base)} / 500 Mo</span></div>
    <div class="ulig"><span>Fichiers</span>${barre(cats.map(([k, t, c]) => [num(f[k]), c, t]).concat([[autres, '#999', 'Autres']]), 1024 * MB)}<span class="num">${tailleTxt(totF)} / 1 Go</span></div>
    <p class="legend">${cats.filter(([k]) => num(f[k])).map(([k, t, c]) => `<span><i style="background:${c}"></i>${t} ${tailleTxt(f[k])}</span>`).join('') || '<span class="hint">Aucun fichier pour l\'instant.</span>'}</p>
    <p class="hint">Limites du plan gratuit Supabase pour ce projet. Vos autres sites sont dans un autre projet Supabase, avec leurs propres limites : ils ne prennent pas de place ici.${d.exact ? '' : ' Chiffres exacts une fois la fonction « utilisation » installée (voir le README).'}</p></div>`;
}
