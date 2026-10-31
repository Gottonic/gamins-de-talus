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
  { k: 'autre', nom: 'Autre', icone: '•', couleur: '#6B7480', heures: '', fixe: true, sous: [] },
];
/* La liste réglée, en gardant toujours les catégories et sous-catégories fixes */
function categories() {
  const c = (DB.get('cfg:categories') || {}).liste;
  if (!Array.isArray(c) || !c.length) return CATS_DEFAUT.map((x) => Object.assign({}, x, { sous: x.sous.slice() }));
  const out = c.filter((x) => x.k !== 'conge').map((x) => Object.assign({ sous: [] }, x));
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

/* Les événements : du travail (journée, récolte, livraison, marché), un congé, ou autre chose. Les catégories, elles, sont
   pour les tâches ; un événement en prend une seulement pour pré-cocher les heures (récolte → cultures, livraison → ventes). */
const EV_GENRES = {
  travail: { nom: 'Journée de travail', court: 'Journée', icone: '🧰', genre: 'travail', cat: '' },
  recolte: { nom: 'Récolte', court: 'Récolte', icone: '🧺', genre: 'travail', cat: 'champ', sous: 'recolte' },
  livraison: { nom: 'Livraison', court: 'Livraison', icone: '🚚', genre: 'travail', cat: 'ventes', sous: 'livraison' },
  vente: { nom: 'Marché / vente', court: 'Marché', icone: '🛒', genre: 'travail', cat: 'ventes', sous: 'marche' },
  vacances: { nom: 'Congé', court: 'Congé', icone: '🏖️', genre: 'conge', couleur: '#8E5BB5' },
  autre: { nom: 'Autre', court: 'Autre', icone: '📌', genre: 'autre', couleur: '#6B7480' },
};
const evGenre = (e) => EV_GENRES[(e && e.type) || 'autre'] || EV_GENRES.autre;
function catEv(e) { const g = evGenre(e); return { cat: g.genre === 'conge' ? 'conge' : g.cat || (g.genre === 'travail' ? '' : 'autre'), sous: g.sous || '' }; }
/* Un événement a la couleur de la Planification ; une journée avec des tâches prend la couleur de sa première tâche (catégorie) */
const COULEUR_PLANIF = 'var(--c-calendrier)';
function couleurEv(e, occ, k) {
  k = k || (e && e.key);
  if (k && occ && typeof taches === 'function') {
    const t = taches().filter((x) => x.journee === k + '|' + occ && x.statut !== 'termine').sort(triOrdre)[0];
    if (t && catTache(t).cat) return catInfo(catTache(t).cat).couleur;
  }
  return COULEUR_PLANIF;
}
const iconeEv = (e) => evGenre(e).icone;
const TAG_VERS_CAT = { agri: ['champ', ''], materiel: ['champ', 'entretien'], admin: ['admin', ''], vente: ['ventes', ''], autre: ['autre', ''] };
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

/* ---------- Classement automatique d'une tâche selon ses mots ----------
   Chaque catégorie / précision a des débuts de mots ; on garde celle qui a le plus de mots trouvés (à égalité, celle dont
   le mot vient en premier). Les cultures du plan dont le nom apparaît sont liées (et classent en Champ si rien d'autre).
   Les noms des catégories et précisions ajoutées dans les réglages comptent aussi. */
const MOTS_CATS = {
  champ: ['plant', 'sem', 'repiqu', 'desherb', 'bin', 'sarcl', 'paill', 'arros', 'irrig', 'goutte', 'tuyau', 'asperseur', 'recolt', 'cueill', 'arrach', 'taill', 'tuteur', 'butt', 'compost', 'fumier', 'engrais', 'trait', 'purin', 'bache', 'filet', 'voile', 'serre', 'tunnel', 'planche', 'labour', 'grelinette', 'motocult', 'tond', 'fauch', 'girobroy', 'broy', 'cloture', 'piquet', 'outil', 'repar', 'aiguis', 'champ', 'parcelle', 'butte', 'mulch', 'eclairc', 'pinc', 'effeuill', 'limace', 'ravageur', 'puceron', 'doryphore', 'chenille', 'soufre', 'cuivre', 'graine', 'pepiniere', 'lit de semence', 'herse'],
  ventes: ['livr', 'client', 'vend', 'vente', 'marche', 'stand', 'self', 'panier', 'etiquet', 'caisse', 'prospect', 'demarch', 'resto', 'restaurant', 'epicerie', 'cantine', 'grossiste', 'commande client', 'degust', 'prix', 'tarif', 'flyer', 'affiche'],
  admin: ['factur', 'compta', 'pay', 'paiement', 'banque', 'virement', 'impot', 'avs', 'assurance', 'fiduciaire', 'mail', 'courrier', 'declar', 'contrat', 'papier', 'admin', 'devis', 'achat', 'achet', 'command', 'inscri', 'formulaire', 'site', 'instagram', 'facebook', 'reunion', 'rdv', 'rendez', 'telephon', 'appel', 'subvention', 'tva', 'bail', 'statut', 'budget', 'releve', 'tableau', 'archive', 'sauvegard'],
};
const MOTS_SOUS = {
  recolte: ['recolt', 'cueill', 'arrach'], plantation: ['plant', 'sem', 'repiqu', 'graine', 'pepiniere'], desherbage: ['desherb', 'bin', 'sarcl', 'paill', 'mulch'],
  irrigation: ['arros', 'irrig', 'goutte', 'tuyau', 'asperseur'], soins: ['trait', 'purin', 'filet', 'voile', 'tuteur', 'taill', 'pinc', 'effeuill', 'limace', 'ravageur', 'puceron', 'doryphore', 'soufre', 'cuivre'],
  entretien: ['repar', 'entretien', 'outil', 'motocult', 'girobroy', 'broy', 'cloture', 'piquet', 'nettoy', 'rang', 'aiguis', 'tond', 'fauch', 'bache', 'serre', 'tunnel'],
  livraison: ['livr'], marche: ['marche', 'stand', 'self', 'caisse', 'degust'], prospection: ['prospect', 'demarch', 'appeler resto', 'flyer'],
};
const normMot = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function devinerCategorie(titre, saison) {
  const t = normMot(titre), mots = t.split(/[^a-z0-9]+/).filter(Boolean);
  const trouve = (racines) => { let n = 0, pos = 1e9; for (const r of racines) { const i = r.includes(' ') ? t.indexOf(r) : mots.findIndex((w) => w.startsWith(r)); if (i >= 0) { n++; pos = Math.min(pos, r.includes(' ') ? i : t.indexOf(mots[i])); } } return { n, pos }; };
  const cats = categories().filter((c) => !c.evSeul);
  let best = null;
  for (const c of cats) {
    const racines = (MOTS_CATS[c.k] || []).concat(normMot(c.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5)), (c.sous || []).flatMap((s) => normMot(s.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5))));
    const r = trouve(racines); if (r.n && (!best || r.n > best.n || (r.n === best.n && r.pos < best.pos))) best = { cat: c.k, n: r.n, pos: r.pos };
  }
  /* Les cultures du plan de la saison (« courge » trouve « Courge butternut », « courges » aussi) */
  const cus = typeof cultures === 'function' ? cultures(saison || (typeof saisonCourante === 'function' ? saisonCourante() : todayISO().slice(0, 4))) : [];
  const liees = cus.filter((c) => { const n = normMot(c.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 2); const premier = n[0] || ''; return premier.length > 2 && mots.some((w) => w === premier || w === premier + 's' || w === premier + 'x' || (premier.length > 4 && w.startsWith(premier.slice(0, premier.length - 1)))); }).map((c) => c.key);
  if (!best && liees.length) best = { cat: 'champ' };
  if (!best) return { cat: '', sous: '', cultures: liees };
  let sous = '', sn = 0, spos = 1e9;
  for (const s of catInfo(best.cat).sous || []) { const r = trouve((MOTS_SOUS[s.k] || []).concat(normMot(s.nom).split(/[^a-z0-9]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5)))); if (r.n && (r.n > sn || (r.n === sn && r.pos < spos))) { sous = s.k; sn = r.n; spos = r.pos; } }
  return { cat: best.cat, sous, cultures: liees };
}
