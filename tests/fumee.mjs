/* Test de fumée : ouvre chaque écran de l'app en mode essai (?local=1), avec des données fictives,
   et échoue si une page plante. Vérifie aussi quelques calculs qui touchent l'argent et le stock.
   Lancé par GitHub à chaque modification (.github/workflows/tests.yml). En local : node tests/fumee.mjs */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const RACINE = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const serveur = createServer(async (req, res) => {
  const chemin = normalize(join(RACINE, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!chemin.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  try { const f = await readFile(chemin.endsWith('/') ? join(chemin, 'index.html') : chemin); res.writeHead(200, { 'Content-Type': TYPES[extname(chemin)] || 'application/octet-stream' }); res.end(f); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const U = `http://127.0.0.1:${serveur.address().port}/index.html?local=1`;

const erreurs = [], ok = (cond, msg) => { if (!cond) erreurs.push('Calcul : ' + msg); };
const b = await chromium.launch();
for (const largeur of [1200, 390]) {
  const p = await b.newPage({ viewport: { width: largeur, height: 900 } });
  p.on('pageerror', (e) => erreurs.push(`[${largeur}px] ${p.url().split('#')[1] || ''} : ${e.message}`));
  await p.route('https://**', (r) => r.abort()); // pas de réseau extérieur pendant le test
  await p.goto(U + '#/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(300);
  /* Données fictives */
  await p.evaluate(() => {
    const t = todayISO(), y = t.slice(0, 4);
    DB.put('cfg:entreprise', Object.assign({}, DB.get('cfg:entreprise') || {}, { nom: 'Ferme test', titulaire: 'Test', rue: 'Route', numero: '1', npa: '1700', localite: 'Fribourg', iban: 'CH9300762011623852957' }));
    DB.put('ct:a', { nom: 'Resto test', type: 'pro', npa: '1700', localite: 'Fribourg', rue: 'Rue' });
    DB.put('ct:p', { nom: 'Prospect test', prospect: true, prospection: { statut: 'À contacter', priorite: 1 } });
    DB.put('prod:c', { nom: 'Courge', unite: 'kg', prixMin: 3, prixMax: 6, calibres: [{ nom: 'Moyen', poids: 1.5 }] });
    DB.put('mvt:i', { date: t, prod: 'prod:c', qte: 100, type: 'inventaire' });
    DB.put('cul:a', { nom: 'Courge', saison: y, planches: 4, semPlantation: '20', semRecolte: '36-40', rendement: 3, interplant: 80, lignes: 1, fournisseur: 'Pépinière', emplacements: ['A:1'] });
    DB.put('cfg:parcelle', { secteurs: [{ k: 'A', nom: 'Champ', planches: 6 }] });
    DB.put('t:a', { titre: 'Tâche test', statut: 'afaire', echeance: t, rep: 'hebdo' });
    DB.put('ev:a', { titre: '', type: 'recolte', date: t, cultureId: 'cul:a' });
    DB.put('dep:a', { date: t, montant: 12, objet: 'Semences', type: 'charge', par: 'nicolas' });
    DB.put('fac:a', { date: t, client: { id: 'ct:a', nom: 'Resto test' }, lignes: [{ designation: 'Courge', quantite: 2, unite: 'kg', prix: 4, produitId: 'prod:c' }], total: 8, statut: 'ouverte', blNumero: 'BL-' + y + '-001' });
    DB.put('msg:a', { de: 'noe', texte: 'Salut', cree: new Date().toISOString() });
    DB.put('self:a', { date: t, lieu: 'Stand', lignes: [{ prod: 'prod:c', qte: 4, prix: 9, unite: 'pièce', calibre: 'Moyen', poids: 1.5 }], retours: {}, statut: 'ouverte' });
  });
  const routes = ['accueil', 'messages', 'mails', 'contacts', 'contacts/prospection', 'taches', 'taches/semaine', 'calendrier', 'calendrier/mois', 'calendrier/heures',
    'factures', 'factures/nouvelle', 'factures/selfservice', 'factures/stock', 'factures/voir/fac:a', 'finances', 'finances/recettes', 'finances/associes', 'finances/annee', 'finances/bilan', 'finances/inventaire', 'finances/achats',
    'cultures', 'cultures/planches', 'cultures/journal', 'cultures/fiches', 'irrigation', 'irrigation/saison', 'irrigation/meteo', 'irrigation/reglages', 'drive', 'reglages', 'reglages/associes', 'reglages/donnees'];
  for (const r of routes) {
    await p.goto(U + '#/' + r); await p.waitForTimeout(150);
    const plante = await p.evaluate(() => /n'a pas pu s'afficher/.test(document.body.innerText));
    if (plante) erreurs.push(`[${largeur}px] #/${r} : la page ne s'affiche pas`);
    if (largeur < 500 && await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) erreurs.push(`[${largeur}px] #/${r} : la page déborde en largeur`);
  }
  if (largeur === 1200) {
    const r = await p.evaluate(() => ({
      prix: [prixAuto({ prixMin: 3, prixMax: 6 }, 'gros'), prixAuto({ prixMin: 3, prixMax: 6 }, 'resto'), prixAuto({ prixMin: 3, prixMax: 6 }, 'part')],
      piece: prixPiece({ prixMin: 3, prixMax: 6 }, { poids: 1.5 }, 'part'),
      stockSelf: stockDe('prod:c'),
      groupee: factureStatut({ groupe: 'fac:x', statut: 'ouverte' }, todayISO()),
      mois: ajouterMois('2026-01-31', 1),
      rotation: !!conflitRotation({ key: 'cul:n', nom: 'Courgette', saison: '2099', emplacements: ['A:1'] }, 'A:1') === false,
    }));
    ok(r.prix.join() === '3,4,6', 'prix par niveau ' + r.prix);
    ok(r.piece === 9, 'prix à la pièce ' + r.piece);
    ok(r.groupee === 'groupee', 'statut facture du mois');
    ok(r.mois === '2026-02-28', 'fin de mois ' + r.mois);
  }
  await p.close();
}
await b.close(); serveur.close();
if (erreurs.length) { console.error('Problèmes :\n- ' + erreurs.join('\n- ')); process.exit(1); }
console.log('Tout est ok.');
