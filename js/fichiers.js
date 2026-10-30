/* Gamins de Talus — photos et PDF (messages, justificatifs).
   Les fichiers vont dans le stockage privé Supabase (seau « fichiers ») : seuls les membres les voient.
   Dans les données, on garde seulement le chemin ; pour afficher, on demande un lien temporaire (1 h).
   Rien n'est jamais effacé du stockage (comme pour les données). */
'use strict';

const FICHIERS_SEAU = 'fichiers';
const FICHIER_MAX = 10 * 1024 * 1024;
const Fichiers = {
  liens: {},  // chemin → { url, exp }
  local: {},  // mode essai : chemin → adresse locale
  async envoyer(blob, chemin) {
    if (LOCAL_MODE) { this.local[chemin] = URL.createObjectURL(blob); return chemin; }
    if (!navigator.onLine) throw new Error("pas de réseau : la photo partira quand tu seras connecté, réessaie à ce moment-là");
    if (!Sync.sb) throw new Error('pas connecté');
    const { error } = await Sync.sb.storage.from(FICHIERS_SEAU).upload(chemin, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(/bucket|not found/i.test(error.message) ? "l'espace photos n'est pas encore créé dans Supabase (voir le README)" : error.message);
    return chemin;
  },
  enCache(chemin) {
    if (LOCAL_MODE) return this.local[chemin] || '';
    const c = this.liens[chemin]; return c && c.exp > Date.now() ? c.url : '';
  },
  async liensPour(chemins) {
    const manque = [...new Set(chemins)].filter((c) => c && !this.enCache(c));
    if (!manque.length || LOCAL_MODE || !Sync.sb || !navigator.onLine) return;
    const { data, error } = await Sync.sb.storage.from(FICHIERS_SEAU).createSignedUrls(manque, 3600);
    if (error || !data) return;
    for (const x of data) if (x.signedUrl && !x.error) this.liens[x.path] = { url: x.signedUrl, exp: Date.now() + 50 * 60000 };
  },
};

/* Donne une adresse à toutes les images et liens marqués data-fichier qui n'en ont pas encore */
async function hydraterFichiers(root) {
  root = root || document;
  const els = [...root.querySelectorAll('img[data-fichier]:not([src]), a[data-fichier]:not([href])')];
  if (!els.length) return;
  await Fichiers.liensPour(els.map((e) => e.dataset.fichier));
  for (const e of els) {
    const u = Fichiers.enCache(e.dataset.fichier); if (!u) continue;
    if (e.tagName === 'IMG') e.src = u; else e.href = u;
  }
}
new MutationObserver(() => { clearTimeout(hydraterFichiers.t); hydraterFichiers.t = setTimeout(() => hydraterFichiers(), 30); })
  .observe(document.documentElement, { childList: true, subtree: true });

/* Une photo de téléphone (3–6 Mo) devient un JPEG de quelques centaines de Ko, bien orienté. */
async function reduireImage(file, maxCote, qualite) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { return null; }
  const r = Math.min(1, maxCote / Math.max(img.width, img.height));
  const w = Math.round(img.width * r), h = Math.round(img.height * r);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', qualite));
  return blob ? { blob, w, h } : null;
}

/* usage 'photo' (messages) : 1600 px ; usage 'justif' (tickets, factures) : 2600 px, plus net pour lire les petits chiffres.
   Les PDF passent tels quels. */
async function preparerFichier(file, usage) {
  if (!file) return null;
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (pdf) {
    if (usage !== 'justif') throw new Error('seules les photos sont acceptées ici');
    if (file.size > FICHIER_MAX) throw new Error('PDF trop lourd (10 Mo au plus)');
    return { blob: file, ext: 'pdf', type: 'application/pdf', nom: file.name || 'document.pdf' };
  }
  const r = await reduireImage(file, usage === 'justif' ? 2600 : 1600, usage === 'justif' ? 0.88 : 0.82);
  if (r) return { blob: r.blob, ext: 'jpg', type: 'image/jpeg', w: r.w, h: r.h, nom: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg' };
  if (/^image\//.test(file.type) && file.size <= FICHIER_MAX) return { blob: file, ext: (file.name || '').split('.').pop() || 'img', type: file.type, nom: file.name || 'image' };
  throw new Error("ce fichier n'a pas pu être lu comme une photo");
}
const cheminFichier = (dossier, ext) => `${dossier}/${todayISO().slice(0, 7)}/${uid('f')}.${ext}`;

/* Grande vue d'une photo, ou ouverture d'un PDF */
ACTIONS.voirFichier = (el) => {
  const c = el.dataset.fichier, pdf = /\.pdf$/i.test(c);
  openSheet(`${sheetHead(pdf ? 'Document' : 'Photo', el.dataset.titre || '')}<div class="sbody">
    ${pdf ? '<p class="hint">PDF : il s\'ouvre dans un nouvel onglet.</p>' : `<img class="grande-photo" data-fichier="${esc(c)}" alt="${esc(el.dataset.titre || 'Photo')}">`}
    <div class="row-end"><a class="btn${pdf ? ' primary' : ''}" data-fichier="${esc(c)}" target="_blank" rel="noopener">${pdf ? 'Ouvrir le PDF' : 'Ouvrir en grand / enregistrer'}</a></div></div>`);
  hydraterFichiers($('sheet'));
};

/* ---------- Durée de conservation dans l'app ----------
   Photos des messages : 6 mois. Justificatifs : 2 ans, et seulement si l'archive de l'année de la dépense a été téléchargée.
   Supabase n'autorise d'ailleurs à effacer que les fichiers assez vieux (règle dans schema.sql) : une erreur ici ne peut rien effacer d'autre.
   Une fois par jour, le premier appareil connecté fait le ménage ; l'élément garde la trace « expire ». */
async function nettoyerFichiers() {
  if (LOCAL_MODE || !Sync.sb || !navigator.onLine || !Sync.uid) return;
  if (ls.get('gdt-nettoyage') === todayISO()) return; ls.set('gdt-nettoyage', todayISO());
  const avant = (mois) => { const d = new Date(); d.setMonth(d.getMonth() - mois); d.setDate(d.getDate() - 2); return d.toISOString(); };
  const effacer = async (chemins) => {
    if (!chemins.length) return new Set();
    const { data, error } = await Sync.sb.storage.from(FICHIERS_SEAU).remove(chemins);
    return error ? new Set() : new Set((data || []).map((x) => x.name));
  };
  /* Corbeille : ce qui y est depuis plus de 6 mois est effacé pour de bon par Supabase (chaque nuit) ; on l'oublie aussi ici,
     et on efface les fichiers du Drive correspondants (la règle de Supabase ne l'autorise que pour eux). */
  try {
    const lim = avant(6), vieux = Object.entries(DB.trash).filter(([, d]) => d._supprimeLe && d._supprimeLe < lim);
    const fichiersDrive = vieux.filter(([k, d]) => k.startsWith('drv:') && d.chemin).map(([, d]) => d.chemin);
    if (fichiersDrive.length) await effacer(fichiersDrive);
    for (const [k] of vieux) delete DB.trash[k];
    if (vieux.length) Sync.persist();
  } catch (e) { console.warn('Corbeille :', e); }
  try {
    const m6 = avant(6), msgs = DB.all('msg:').filter((m) => m.photo && !m.photo.expire && String(m.cree) < m6);
    /* Photos des messages déjà à la corbeille : on les efface aussi au bout de 6 mois */
    const tr = Object.values(DB.trash).filter((m) => m && m.photo && m.photo.chemin && !m.photo.expire && String(m.cree || '') < m6).map((m) => m.photo.chemin);
    if (tr.length) await effacer(tr);
    const ok = await effacer(msgs.map((m) => m.photo.chemin));
    for (const m of msgs) if (ok.has(m.photo.chemin)) { const o = DB.get(m.key); if (o) DB.put(m.key, Object.assign({}, o, { photo: Object.assign({}, o.photo, { expire: todayISO() }) })); }
    const a2 = avant(24);
    const deps = DB.all('dep:').filter((d) => typeof archiveDe === 'function' && archiveDe(yearOf(d.date)) && (d.fichiers || []).some((f) => !f.expire && f.ajoute && f.ajoute < a2));
    const ok2 = await effacer(deps.flatMap((d) => d.fichiers.filter((f) => !f.expire && f.ajoute && f.ajoute < a2).map((f) => f.chemin)));
    for (const d of deps) {
      const o = DB.get(d.key); if (!o) continue;
      const fs = (o.fichiers || []).map((f) => (ok2.has(f.chemin) ? Object.assign({}, f, { expire: todayISO() }) : f));
      if (fs.some((f, i) => f !== o.fichiers[i])) DB.put(d.key, Object.assign({}, o, { fichiers: fs }));
    }
  } catch (e) { console.warn('Nettoyage des fichiers :', e); }
}
