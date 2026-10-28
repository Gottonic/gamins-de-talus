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
