/* Gamins de Talus — catégories communes aux tâches, aux événements et aux heures (Planification).
   cfg:categories = { liste: [{ k, nom, icone, couleur, heures: 'cultures' | 'ventes' | 'admin' | '', evSeul, fixe, sous: [{ k, nom, fixe }] }] }
   Modifiables dans Réglages → Catégories. Les catégories et sous-catégories « fixes » ne se suppriment pas (l'app s'en sert :
   une récolte rappelle de l'enregistrer, une livraison crée la facture, un congé compte dans les vacances). */
'use strict';

const CATS_DEFAUT = [
  { k: 'champ', nom: 'Champ', icone: '🌱', couleur: '#4F7D17', heures: 'cultures', fixe: true, sous: [
    { k: 'recolte', nom: 'Récolte', fixe: true }, { k: 'plantation', nom: 'Plantation & semis' }, { k: 'desherbage', nom: 'Désherbage' },
    { k: 'irrigation', nom: 'Irrigation' }, { k: 'soins', nom: 'Soins & traitements' }, { k: 'entretien', nom: 'Entretien & matériel' }] },
  { k: 'ventes', nom: 'Ventes & livraisons', icone: '🚚', couleur: '#2563A8', heures: 'ventes', fixe: true, sous: [
    { k: 'livraison', nom: 'Livraison', fixe: true }, { k: 'marche', nom: 'Marché & vente', fixe: true }, { k: 'prospection', nom: 'Prospection' }] },
  { k: 'admin', nom: 'Admin', icone: '🗂️', couleur: '#A35C00', heures: 'admin', fixe: true, sous: [] },
  { k: 'conge', nom: 'Congé', icone: '🏖️', couleur: '#8E5BB5', heures: '', evSeul: true, fixe: true, sous: [] },
  { k: 'autre', nom: 'Autre', icone: '•', couleur: '#6B7480', heures: '', fixe: true, sous: [] },
];
/* La liste réglée, en gardant toujours les catégories et sous-catégories fixes */
function categories() {
  const c = (DB.get('cfg:categories') || {}).liste;
  if (!Array.isArray(c) || !c.length) return CATS_DEFAUT.map((x) => Object.assign({}, x, { sous: x.sous.slice() }));
  const out = c.map((x) => Object.assign({ sous: [] }, x));
  for (const d of CATS_DEFAUT) {
    let x = out.find((y) => y.k === d.k);
    if (!x) { x = Object.assign({}, d, { sous: d.sous.slice() }); out.push(x); }
    x.fixe = true;
    for (const s of d.sous) if (s.fixe && !x.sous.some((y) => y.k === s.k)) x.sous.push(Object.assign({}, s));
  }
  return out;
}
const catInfo = (k) => categories().find((c) => c.k === k) || categories().find((c) => c.k === 'autre');
const sousInfo = (cat, s) => (catInfo(cat).sous || []).find((x) => x.k === s) || null;
const catsTaches = () => categories().filter((c) => !c.evSeul);

/* Les anciennes fiches (avant les catégories) : type d'événement et domaine de tâche → catégorie */
const EV_VERS_CAT = { travail: ['champ', ''], recolte: ['champ', 'recolte'], livraison: ['ventes', 'livraison'], vente: ['ventes', 'marche'], vacances: ['conge', ''], autre: ['autre', ''] };
const TAG_VERS_CAT = { agri: ['champ', ''], materiel: ['champ', 'entretien'], admin: ['admin', ''], vente: ['ventes', ''], autre: ['autre', ''] };
function catEv(e) { if (e && e.cat) return { cat: e.cat, sous: e.sous || '' }; const m = EV_VERS_CAT[(e && e.type) || 'autre'] || EV_VERS_CAT.autre; return { cat: m[0], sous: m[1] }; }
function catTache(t) { if (t && t.cat) return { cat: t.cat, sous: t.sous || '' }; const m = TAG_VERS_CAT[(t && t.tag) || ''] || ['', '']; return { cat: m[0], sous: m[1] }; }
/* Le « type » d'un événement, que le reste de l'app utilise (rappel de récolte, facture de livraison, vacances, agenda en ligne) */
function typeDepuisCat(cat, sous) {
  if (sous === 'recolte') return 'recolte';
  if (sous === 'livraison') return 'livraison';
  if (sous === 'marche') return 'vente';
  if (cat === 'conge') return 'vacances';
  if (cat === 'champ') return 'travail';
  return cat === 'ventes' ? 'vente' : 'autre';
}
const couleurCat = (cat) => (cat ? catInfo(cat).couleur : '#6B7480');
function catPill(cat, sous, court) {
  if (!cat) return '';
  const c = catInfo(cat), s = sous && sousInfo(cat, sous);
  return `<span class="catpill" style="--c:${esc(c.couleur)}">${esc(c.icone || '')} ${esc(court && s ? s.nom : c.nom + (s ? ' · ' + s.nom : ''))}</span>`;
}
/* Choix de la catégorie (puces) et de la sous-catégorie (liste) dans un formulaire */
function catChoixHtml(id, cat, sous, o = {}) {
  const cs = o.ev ? categories() : catsTaches(), c = cat ? catInfo(cat) : null;
  return `<div class="field catchoix" id="${id}" data-ev="${o.ev ? '1' : ''}"><span class="flabel">Catégorie</span><input type="hidden" name="cat" value="${esc(cat || '')}">
    <div class="chips">${cs.map((x) => `<button type="button" class="chip catchip${x.k === cat ? ' on' : ''}" style="--c:${esc(x.couleur)}" data-catk="${esc(x.k)}">${esc(x.icone || '')} ${esc(x.nom)}</button>`).join('')}</div>
    ${c && (c.sous || []).length ? `<select name="sous" aria-label="Précision" class="catsous"><option value="">${esc(c.nom)} : préciser (facultatif)…</option>${c.sous.map((s) => `<option value="${esc(s.k)}"${s.k === sous ? ' selected' : ''}>${esc(s.nom)}</option>`).join('')}</select>` : '<input type="hidden" name="sous" value="">'}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-catk]'); if (!b) return; const box = b.closest('.catchoix'); if (!box) return;
  e.preventDefault(); const cur = box.querySelector('input[name="cat"]').value, k = cur === b.dataset.catk && !box.dataset.ev ? '' : b.dataset.catk;
  box.outerHTML = catChoixHtml(box.id, k, '', { ev: !!box.dataset.ev });
  document.dispatchEvent(new CustomEvent('gdt-cat', { detail: { id: box.id, cat: k } }));
});
