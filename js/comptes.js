/* Gamins de Talus — plan de comptes (petite structure, numéros du plan comptable suisse PME).
   Chaque dépense va dans un compte : 1xxx = investissement (un actif, amorti via l'inventaire), le reste = charge de l'année.
   La liste se règle dans Réglages → Catégories (cfg:comptes = { liste: [{ n, nom, pour, taux, aide, cache }] }).
   « pour » pré-coche à quoi sert la dépense (cultures, ventes, admin) pour les marges par culture. */
'use strict';

const COMPTES_DEFAUT = [
  { n: '1500', nom: 'Machines et appareils', taux: 30, aide: 'Motoculteur, broyeur, semoir de précision…' },
  { n: '1510', nom: 'Installations (irrigation, serres, tunnels)', taux: 25, aide: 'Plusieurs petits achats peuvent former un seul objet, ex. « Système d\'irrigation ».' },
  { n: '1520', nom: 'Informatique et bureau', taux: 40, aide: 'Ordinateur, téléphone pro, imprimante.' },
  { n: '1530', nom: 'Véhicules', taux: 40, aide: 'Utilitaire, remorque.' },
  { n: '1540', nom: 'Outillage durable', taux: 45, aide: 'Outils de qualité qui durent des années (grelinette, houe maraîchère…).' },
  { n: '4000', nom: 'Semences et plants', pour: 'cultures' },
  { n: '4010', nom: 'Engrais, compost et amendements', pour: 'cultures' },
  { n: '4020', nom: 'Protection des cultures (voiles, filets, traitements)', pour: 'cultures' },
  { n: '4030', nom: 'Emballages et étiquettes', pour: 'ventes', aide: 'Caisses, sachets, cagettes, étiquettes.' },
  { n: '4400', nom: 'Petit matériel et fournitures', aide: 'Bon marché ou vite usé : gants, arrosoirs, piquets, ficelle, petits outils.' },
  { n: '6000', nom: 'Loyer et fermage' },
  { n: '6100', nom: 'Entretien et réparations', aide: 'Réparer une machine, pièces de rechange, aiguisage.' },
  { n: '6200', nom: 'Véhicule et transport', aide: 'Carburant, recharge, train, livraisons.' },
  { n: '6300', nom: 'Assurances, taxes et cotisations', pour: 'admin' },
  { n: '6400', nom: 'Énergie et eau' },
  { n: '6500', nom: 'Administration (bureau, téléphone, logiciels)', pour: 'admin' },
  { n: '6600', nom: 'Publicité et marchés', pour: 'ventes', aide: 'Flyers, site, place de marché.' },
  { n: '6700', nom: 'Autres charges' },
  { n: '6900', nom: 'Frais bancaires', pour: 'admin' },
];
const comptesTous = () => { const l = (DB.get('cfg:comptes') || {}).liste; return (Array.isArray(l) && l.length ? l : COMPTES_DEFAUT).slice().sort((a, b) => String(a.n).localeCompare(String(b.n))); };
const comptes = () => comptesTous().filter((c) => !c.cache);
const compteInfo = (n) => comptesTous().find((c) => String(c.n) === String(n)) || { n: String(n || ''), nom: n ? 'Compte ' + n : 'Sans compte' };
const estInvest = (n) => String(n || '').startsWith('1');
const libCompte = (n) => { const c = compteInfo(n); return c.n ? `${c.n} ${c.nom}` : c.nom; };
/* Les dépenses d'avant le plan de comptes : leur ancienne catégorie donne le compte */
function compteDe(d) {
  if (d.compte) return String(d.compte);
  if (d.type === 'investissement') return d.categorie === 'Outil' ? '1540' : '1500';
  return ({ 'Charges spécifiques': '4000', Outil: '4400', Machine: '6100', Carburant: '6200', Frais: '6500', Autres: '6700' })[d.categorie] || '6700';
}
/* À quoi sert la dépense par défaut (« Pour quoi ? ») selon le compte */
const pourDuCompte = (n) => { const p = compteInfo(n).pour; return p === 'cultures' ? { cultures: 'toutes' } : p === 'admin' ? { admin: true } : p === 'ventes' ? { ventes: true } : null; };
function optionsComptes(cur) {
  const l = comptes(); if (cur && !l.some((c) => c.n === cur)) l.push(compteInfo(cur));
  const grp = (titre, xs) => xs.length ? `<optgroup label="${esc(titre)}">${xs.map((c) => `<option value="${esc(c.n)}"${c.n === cur ? ' selected' : ''}>${esc(c.n + ' ' + c.nom)}</option>`).join('')}</optgroup>` : '';
  return grp('Charges de l\'année', l.filter((c) => !estInvest(c.n))) + grp('Investissements (inventaire, amortis)', l.filter((c) => estInvest(c.n)));
}
/* La petite aide pour choisir */
const AIDE_COMPTES = `<details class="aide-comptes"><summary>Comment choisir le compte ?</summary>
  <ul>
    <li><b>Ça sert plusieurs années et ça coûte cher</b> (en pratique dès env. CHF 1'000, à voir avec la fiduciaire) → un compte <b>15xx</b> : c'est un investissement. Il va dans l'inventaire et sa valeur baisse chaque année (amortissement). Plusieurs petits achats peuvent former un seul objet (ex. « Système d'irrigation »).</li>
    <li><b>Bon marché, vite usé ou consommé dans l'année</b> (gants, piquets, ficelle, petit outil) → <b>4400 Petit matériel</b> : une charge, comptée en entier cette année.</li>
    <li><b>Ce qui part dans les cultures</b> : semences et plants (4000), engrais et compost (4010), voiles et traitements (4020).</li>
    <li><b>Réparer</b> ce qu'on a déjà → 6100. <b>Rouler</b> → 6200. <b>Papiers, téléphone, logiciels</b> → 6500.</li>
    <li>Pas sûr ? <b>6700 Autres charges</b>, et une remarque : la fiduciaire corrigera.</li>
  </ul></details>`;
