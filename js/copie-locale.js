/* Gamins de Talus — copie des fichiers dans un dossier de l'ordinateur (Réglages → Données).
   Chrome et Edge sur ordinateur seulement (le navigateur doit pouvoir écrire dans un dossier choisi).
   Copiés : le Drive (avec ses dossiers), les justificatifs des dépenses (par année), les bulletins signés.
   Le dossier choisi est retenu ; à chaque ouverture de l'app, les nouveaux fichiers y sont copiés tout seuls
   si le navigateur le permet encore (sinon l'accueil propose de toucher pour copier). Rien n'est jamais effacé du dossier. */
'use strict';

const COPIE = { en: false, dernier: null };
const copiePossible = () => typeof window.showDirectoryPicker === 'function' && !LOCAL_MODE;
/* Le dossier choisi est gardé dans IndexedDB (un « handle » ne se range pas ailleurs) */
const idbCopie = (mode, fn) => new Promise((ok, ko) => {
  const r = indexedDB.open('gdt-copie', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('h');
  r.onerror = () => ko(r.error);
  r.onsuccess = () => { const tx = r.result.transaction('h', mode), q = fn(tx.objectStore('h')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error); };
});
const dossierCopie = () => idbCopie('readonly', (s) => s.get('dossier')).catch(() => null);
const nomSur = (s) => String(s || 'fichier').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'fichier';
/* Ce qu'il y a à copier : [{ chemin (stockage), dossiers: [..], nom }] */
function fichiersACopier() {
  const out = [];
  for (const x of DB.all('drv:')) if (x.type === 'fichier' && x.chemin) {
    const ds = []; let p = x.parent; while (p) { const d = DB.get(p); if (!d) break; ds.unshift(nomSur(d.nom)); p = d.parent; }
    out.push({ chemin: x.chemin, dossiers: ['Drive', ...ds], nom: nomSur(x.nom) });
  }
  for (const d of DB.all('dep:')) (d.fichiers || []).forEach((f, i) => { if (f.chemin && !f.expire) out.push({ chemin: f.chemin, dossiers: ['Justificatifs', yearOf(d.date) || 'sans date'], nom: nomSur(`${d.date || ''} ${d.n ? 'n°' + d.n + ' ' : ''}${d.objet || ''}${(d.fichiers || []).length > 1 ? ' (' + (i + 1) + ')' : ''}`) + '.' + (String(f.chemin).split('.').pop() || 'pdf') }); });
  for (const v of DB.all('fac:')) (v.blSigne || []).forEach((f, i) => { if (f.chemin && !f.expire) out.push({ chemin: f.chemin, dossiers: ['Bulletins signés', yearOf(v.date) || 'sans date'], nom: nomSur(`${v.blNumero || v.numero || v.date} ${(v.client && v.client.nom) || ''}${i ? ' (' + (i + 1) + ')' : ''}`) + '.' + (String(f.chemin).split('.').pop() || 'jpg') }); });
  return out;
}
const copiesFaites = () => { try { return new Set(JSON.parse(ls.get('gdt.copie.faits') || '[]')); } catch (e) { return new Set(); } };
const aCopier = () => { const f = copiesFaites(); return fichiersACopier().filter((x) => !f.has(x.chemin)); };
async function copierFichiers(dir, silencieux) {
  if (COPIE.en) return; COPIE.en = true;
  const l = aCopier(), faits = copiesFaites(); let n = 0, err = 0;
  try {
    for (let i = 0; i < l.length; i += 20) {
      const lot = l.slice(i, i + 20); await Fichiers.liensPour(lot.map((x) => x.chemin));
      for (const x of lot) {
        try {
          let d = dir; for (const s of x.dossiers) d = await d.getDirectoryHandle(s, { create: true });
          const u = Fichiers.enCache(x.chemin); if (!u) { err++; continue; }
          const b = await (await fetch(u)).blob(), fh = await d.getFileHandle(x.nom, { create: true }), w = await fh.createWritable();
          await w.write(b); await w.close(); faits.add(x.chemin); n++;
        } catch (e) { err++; }
      }
      ls.set('gdt.copie.faits', JSON.stringify([...faits]));
    }
    COPIE.dernier = { le: new Date().toISOString(), n, err };
    if (!silencieux || n) toast(n ? `📁 ${n} fichier${n > 1 ? 's' : ''} copié${n > 1 ? 's' : ''} dans « ${dir.name} »${err ? ` (${err} impossible${err > 1 ? 's' : ''})` : ''}.` : err ? `${err} fichier${err > 1 ? 's' : ''} pas copié${err > 1 ? 's' : ''} (réseau ?).` : 'Tout est déjà copié.', 5000);
  } finally { COPIE.en = false; if (ROUTE.mod === 'reglages') render(); }
}
ACTIONS.copieChoisir = async () => {
  try {
    const dir = await window.showDirectoryPicker({ id: 'gdt-copie', mode: 'readwrite' });
    await idbCopie('readwrite', (s) => s.put(dir, 'dossier'));
    await copierFichiers(dir);
  } catch (e) { if (e && e.name !== 'AbortError') toast('Dossier impossible : ' + e.message, 6000); }
};
ACTIONS.copieMaintenant = async () => {
  const dir = await dossierCopie(); if (!dir) { ACTIONS.copieChoisir(); return; }
  try { if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') { toast('Le navigateur n\'a pas donné l\'accès au dossier.'); return; } } catch (e) { toast('Accès au dossier impossible : ' + e.message); return; }
  await copierFichiers(dir);
};
ACTIONS.copieOublier = async () => { await idbCopie('readwrite', (s) => s.delete('dossier')).catch(() => {}); COPIE.nom = ''; toast('Le dossier n\'est plus utilisé (rien n\'y est effacé).'); render(); };
/* Le cadre dans Réglages → Données */
function copieLocaleHtml() {
  if (!copiePossible()) return `<div class="panel"><h2>📁 Copie sur l'ordinateur</h2><p class="hint">Possible avec Chrome ou Edge sur un ordinateur : les fichiers (Drive, justificatifs, bulletins signés) sont copiés tout seuls dans un dossier de ton choix.</p></div>`;
  const n = aCopier().length;
  setTimeout(async () => { const d = await dossierCopie(), el = $('copie-dossier'); if (el) el.textContent = d ? `Dossier : « ${d.name} »` : 'Pas encore de dossier choisi.'; const o = $('copie-oublier'); if (o) o.hidden = !d; }, 0);
  return `<div class="panel"><h2>📁 Copie sur l'ordinateur</h2>
    <p><b id="copie-dossier">…</b><br><span class="hint">${n ? `${n} fichier${n > 1 ? 's' : ''} à copier` : 'Tout est copié'}${COPIE.dernier ? ` · dernière copie : ${new Date(COPIE.dernier.le).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></p>
    <div class="row"><button class="btn primary" type="button" data-act="copieMaintenant"${COPIE.en ? ' disabled' : ''}>${COPIE.en ? 'Copie…' : 'Copier maintenant'}</button><button class="btn" type="button" data-act="copieChoisir">Choisir le dossier…</button><button class="btn link small" type="button" id="copie-oublier" data-act="copieOublier" hidden>Ne plus copier</button></div>
    <p class="hint">Drive (avec ses dossiers), justificatifs des dépenses par année, bulletins signés. À chaque ouverture de l'app, les nouveaux fichiers sont copiés tout seuls quand le navigateur le permet (choisis « Autoriser à chaque visite » s'il le propose). Rien n'est effacé du dossier.</p></div>`;
}
/* À l'ouverture : copie silencieuse si l'accès est toujours donné */
setTimeout(async () => {
  if (!copiePossible()) return;
  const dir = await dossierCopie(); if (!dir) return;
  try { if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted' && aCopier().length) copierFichiers(dir, true); } catch (e) { /* */ }
}, 20000);
