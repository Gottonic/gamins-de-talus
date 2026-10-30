/* Gamins de Talus — calculs purs (aucun accès à l'écran ni au réseau).
   Testables seuls : node -e "const C=require('./js/calc.js')". */
'use strict';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(',', '.').replace(/[’'\s]/g, '')); return isFinite(n) ? n : 0; };
const yearOf = (iso) => (iso ? String(iso).slice(0, 4) : '');

/* ---------- Personnes et parts ---------- */
const DEFAULT_PERSONNES = [{ k: 'nicolas', nom: 'Nicolas' }, { k: 'noe', nom: 'Noé' }];
/* Parts de chacun à une date donnée. Une personne avec « associeDes » (AAAA-MM-JJ) ne partage
   les dépenses et les recettes qu'à partir de cette date ; avant, sa part est 0.
   Sans date : toutes les personnes. Si toutes les parts sont à 0, partage égal. */
function estAssocie(p, date) { return !p.associeDes || !date || String(date) >= p.associeDes; }
function parts(cfg, date) {
  const ps = (cfg && cfg.personnes && cfg.personnes.length ? cfg.personnes : DEFAULT_PERSONNES);
  const elig = ps.filter((p) => estAssocie(p, date));
  const raw = elig.map((p) => Math.max(0, num(p.part == null ? 1 : p.part)));
  const tot = raw.reduce((a, b) => a + b, 0);
  const o = {}; ps.forEach((p) => { o[p.k] = 0; });
  elig.forEach((p, i) => { o[p.k] = tot > 0 ? raw[i] / tot : 1 / elig.length; });
  return o;
}

/* ---------- Factures ---------- */
function factureStatut(inv, today) {
  if (inv.statut === 'annulee') return 'annulee';
  if (inv.statut === 'payee') return 'payee';
  if (inv.echeance && inv.echeance < today) return 'retard';
  return 'ouverte';
}
function factureTotal(inv) { return r2((inv.lignes || []).reduce((a, l) => a + r2(num(l.quantite) * num(l.prix)), 0)); }

/* Toutes les recettes, qu'elles viennent d'une facture payée ou d'une saisie directe. */
function recettesUnifiees(recettes, factures, cfg) {
  const out = [];
  for (const r of recettes) out.push({ src: 'recette', key: r.key, date: r.date, montant: r2(r.montant), par: r.par, libelle: r.client || r.libelle || '', moyen: r.moyen || '', ref: r.justificatif || '' });
  for (const f of factures) {
    if (f.statut !== 'payee') continue;
    out.push({ src: 'facture', key: f.key, date: f.payeeLe || f.date, montant: r2(f.total), par: f.encaissePar || (cfg && cfg.compteDe) || 'nicolas', libelle: (f.client && f.client.nom) || '', moyen: f.payeePar === 'especes' ? 'Espèces' : f.payeePar === 'twint' ? 'TWINT' : 'Virement', ref: f.numero || f.blNumero || 'vente' });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* Décompte entre associés, depuis le début.
   solde > 0 : la personne doit recevoir de l'argent ; solde < 0 : elle en doit. */
function decompte(depenses, recettesU, reglements, cfg, today) {
  const ps = (cfg && cfg.personnes && cfg.personnes.length ? cfg.personnes : DEFAULT_PERSONNES);
  const ks = ps.map((p) => p.k), memo = {};
  const P = (date) => memo[date] || (memo[date] = parts(cfg, date || ''));
  const z = () => Object.fromEntries(ks.map((k) => [k, 0]));
  const o = { paye: z(), partDep: z(), encaisse: z(), partRec: z(), verse: z(), recu: z(), reprise: z(), solde: z(), totalDep: 0, totalRec: 0 };
  for (const d of depenses) {
    const m = num(d.montant), pp = P(d.date); o.totalDep += m;
    if (d.par in o.paye) o.paye[d.par] += m;
    ks.forEach((k) => { o.partDep[k] += m * pp[k]; });
  }
  for (const r of recettesU) {
    const m = num(r.montant), pp = P(r.date); o.totalRec += m;
    if (r.par in o.encaisse) o.encaisse[r.par] += m;
    ks.forEach((k) => { o.partRec[k] += m * pp[k]; });
  }
  for (const g of reglements) {
    const m = num(g.montant);
    if (g.de in o.verse) o.verse[g.de] += m;
    if (g.a in o.recu) o.recu[g.a] += m;
  }
  /* Reprise de parts : un nouvel associé rachète une part de ce qui a été investi avant lui.
     Il le doit aux associés d'avant, selon leurs parts la veille de son entrée. Compté dès la date d'entrée. */
  for (const p of ps) {
    const m = num(p.reprise);
    if (!(m > 0) || !p.associeDes || (today && today < p.associeDes)) continue;
    const veille = new Date(p.associeDes + 'T12:00:00Z'); veille.setUTCDate(veille.getUTCDate() - 1);
    const av = parts(cfg, veille.toISOString().slice(0, 10)); av[p.k] = 0;
    const tot = ks.reduce((a, k) => a + av[k], 0); if (!(tot > 0)) continue;
    o.reprise[p.k] += m;
    ks.forEach((k) => { o.reprise[k] -= m * av[k] / tot; });
  }
  ks.forEach((k) => {
    o.solde[k] = (o.paye[k] - o.partDep[k]) - (o.encaisse[k] - o.partRec[k]) + o.verse[k] - o.recu[k] - o.reprise[k];
  });
  for (const f of ['paye', 'partDep', 'encaisse', 'partRec', 'verse', 'recu', 'reprise', 'solde']) ks.forEach((k) => { o[f][k] = Math.round(o[f][k] * 1000) / 1000; });
  o.totalDep = r2(o.totalDep); o.totalRec = r2(o.totalRec);
  // Qui doit combien à qui (cas de 2 associés, ou plus : du plus endetté au plus créancier)
  const deb = ks.filter((k) => o.solde[k] < -0.004).map((k) => ({ k, v: -o.solde[k] })).sort((a, b) => b.v - a.v);
  const cre = ks.filter((k) => o.solde[k] > 0.004).map((k) => ({ k, v: o.solde[k] })).sort((a, b) => b.v - a.v);
  o.transferts = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cre.length) {
    const m = Math.min(deb[i].v, cre[j].v);
    o.transferts.push({ de: deb[i].k, a: cre[j].k, montant: r2(m) });
    deb[i].v -= m; cre[j].v -= m;
    if (deb[i].v < 0.005) i++;
    if (cre[j].v < 0.005) j++;
  }
  return o;
}

/* ---------- Inventaire & amortissements (dégressif, comme l'Excel) ----------
   Par défaut (comme le tableur) : la valeur l'année d'achat = valeur d'achat,
   puis × (1 − taux) chaque année suivante. Option « dès l'année d'achat » : déjà amorti fin de l'année d'achat. */
function valeurFinAnnee(item, year, desAchat) {
  const v0 = num(item.valeur), t = Math.min(1, Math.max(0, num(item.taux)));
  const ya = Number(yearOf(item.dateAchat) || year);
  if (year < ya) return 0;
  if (item.sortieLe && Number(yearOf(item.sortieLe)) < year) return 0;
  const n = year - ya + (desAchat ? 1 : 0);
  return v0 * Math.pow(1 - t, n);
}
function amortissementAnnee(item, year, desAchat) {
  const ya = Number(yearOf(item.dateAchat) || year);
  if (year < ya) return 0;
  const avant = year === ya ? num(item.valeur) : valeurFinAnnee(item, year - 1, desAchat);
  return Math.max(0, avant - valeurFinAnnee(item, year, desAchat));
}

/* ---------- Plan de cultures ---------- */
const NUTR = ['N', 'P', 'K', 'Mg'];
const DEFAULT_PARAMS_CULTURES = {
  longueur: 19, facteurSurface: 1.1, partRevendeur: 0.6, dispoCompost: 1 / 3,
  teneurCompost: { N: 3, P: 1.5, K: 2.5, Mg: 3 },
  correction: { N: 1, P: 1, K: 1, Mg: 1 },
  engrais: [
    { k: 'corne', nom: 'Raclure de corne', nutriment: 'N', teneur: 0.14 },
    { k: 'patentkali', nom: 'Patentkali', nutriment: 'K', teneur: 0.3 },
  ],
};
/* Teneurs d'un engrais : { N, P, K, Mg } (0,14 = 14 %). Ancien format : un seul nutriment + teneur. */
function teneursEngrais(e) { const t = Object.assign({}, e.teneurs || {}); if (e.nutriment && t[e.nutriment] == null) t[e.nutriment] = num(e.teneur); return t; }
function culture(c, params) {
  const p = Object.assign({}, DEFAULT_PARAMS_CULTURES, params || {});
  const longueur = num(c.longueur) || num(p.longueur);
  const planches = num(c.planches);
  const surface = planches * longueur * num(p.facteurSurface);
  const recolte = num(c.rendement) * surface;
  const prixRev = c.prixRevendeur === '' || c.prixRevendeur == null ? num(c.prixDirect) * num(p.partRevendeur) : num(c.prixRevendeur);
  const o = {
    surface, recolte, prixRevendeur: prixRev,
    ventesDirect: num(c.prixDirect) * recolte, ventesRevendeur: prixRev * recolte,
    chfM2Direct: num(c.prixDirect) * num(c.rendement), chfM2Revendeur: prixRev * num(c.rendement),
    plantons: num(c.interplant) > 0 ? longueur / (num(c.interplant) / 100) * planches * (num(c.lignes) || 1) : 0,
    compostM3: num(c.compost) * surface / 1000,
    net: {}, apresCompost: {}, total: {}, excedent: {},
  };
  for (const n of NUTR) {
    const brut = num((c.besoins || {})[n]);
    const pc = p.correction || {}; /* correction d'analyse de sol : liée au champ, dans les hypothèses de la saison */
    const corr = pc[n] == null || pc[n] === '' ? 1 : num(pc[n]);
    o.net[n] = brut * corr;
    o.apresCompost[n] = o.net[n] - num(c.compost) * num((p.teneurCompost || {})[n]) * num(p.dispoCompost);
    o.total[n] = Math.max(0, o.apresCompost[n]) * surface;            // g pour toute la culture
    o.excedent[n] = o.apresCompost[n] < 0;
  }
  /* Engrais, dans l'ordre de la liste : chacun couvre le reste de son nutriment principal ;
     ce qu'il apporte en plus (ex. Mg du Patentkali) est déduit des autres besoins. */
  o.engrais = {}; o.nonCouvert = {};
  const reste = {}; NUTR.forEach((n) => { reste[n] = o.total[n]; });
  for (const e of p.engrais || []) {
    const t = teneursEngrais(e), tp = num(t[e.nutriment]);
    const kg = tp > 0 ? reste[e.nutriment] / tp / 1000 : 0;
    NUTR.forEach((n) => { reste[n] = Math.max(0, reste[n] - kg * 1000 * num(t[n])); });
    o.engrais[e.k] = { kg, kgParPlanche: planches > 0 ? kg / planches : 0, gM2: surface > 0 ? kg * 1000 / surface : 0 };
  }
  NUTR.forEach((n) => { o.nonCouvert[n] = reste[n]; });
  o.surfaceParPlanche = longueur * num(p.facteurSurface);
  o.compostLParPlanche = num(c.compost) * o.surfaceParPlanche;
  return o;
}
function totauxCultures(list, params) {
  const t = { surface: 0, recolte: 0, ventesDirect: 0, ventesRevendeur: 0, plantons: 0, compostM3: 0, total: { N: 0, P: 0, K: 0, Mg: 0 }, nonCouvert: { N: 0, P: 0, K: 0, Mg: 0 }, engrais: {}, recolteReelle: 0 };
  const p = Object.assign({}, DEFAULT_PARAMS_CULTURES, params || {});
  for (const c of list) {
    const o = culture(c, p);
    t.surface += o.surface; t.recolte += o.recolte; t.ventesDirect += o.ventesDirect; t.ventesRevendeur += o.ventesRevendeur;
    t.plantons += o.plantons; t.compostM3 += o.compostM3; t.recolteReelle += num(c.recolteReelle);
    NUTR.forEach((n) => { t.total[n] += o.total[n]; t.nonCouvert[n] += o.nonCouvert[n]; });
    for (const k in o.engrais) t.engrais[k] = (t.engrais[k] || 0) + o.engrais[k].kg;
  }
  return t;
}

/* ---------- Heures ---------- */
function isoDate(d) { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); }
function lundiDe(iso) { const d = new Date(iso + 'T12:00:00'); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDate(d); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
function semaineISO(iso) {
  const d = new Date(iso + 'T12:00:00'); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day + 3);
  const y = d.getFullYear(); const j4 = new Date(y, 0, 4, 12); const w = 1 + Math.round(((d - j4) / 864e5 - 3 + ((j4.getDay() + 6) % 7)) / 7);
  return { annee: y, semaine: w };
}
/* Lundi de la semaine ISO n d'une année. */
function lundiSemaine(annee, semaine) {
  const j4 = new Date(Number(annee), 0, 4, 12); const wd = (j4.getDay() + 6) % 7;
  const d = new Date(j4); d.setDate(j4.getDate() - wd + (Number(semaine) - 1) * 7); return isoDate(d);
}
/* « 44-48 » → [44, 48] ; « 25 » → [25, 25] ; vide → null */
function parseSemaines(s) {
  const m = String(s || '').match(/(\d{1,2})(?:\s*[-–à]\s*(\d{1,2}))?/); if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a; if (a < 1 || a > 53 || b < 1 || b > 53) return null; return [a, b];
}
/* Période d'une culture : en place dès la semaine de plantation, récoltée pendant les semaines de récolte. */
function periodeCulture(c) {
  const y = Number(c.saison) || new Date().getFullYear();
  const p = parseSemaines(c.semPlantation), r = parseSemaines(c.semRecolte);
  if (!p && !r) return null;
  const debut = p ? lundiSemaine(y, p[0]) : lundiSemaine(y, r[0]);
  let yr = y; if (p && r && r[0] < p[0]) yr = y + 1;        // récolte l'année suivante (hivernage)
  const recolteDebut = r ? lundiSemaine(yr, r[0]) : null;
  const yr2 = r && r[1] < r[0] ? yr + 1 : yr;
  const fin = r ? addDays(lundiSemaine(yr2, r[1]), 6) : addDays(debut, 7 * 12);
  return { debut, recolteDebut, fin };
}
/* Occurrences d'un événement (récurrent ou non) qui touchent la période [de, a]. */
function occurrences(ev, de, a) {
  const out = [], dur = ev.fin && ev.fin > ev.date ? Math.round((new Date(ev.fin + 'T12:00') - new Date(ev.date + 'T12:00')) / 864e5) : 0;
  const ex = new Set(ev.exceptions || []), rec = (ev.rec && ev.rec.freq) || '', fin = (ev.rec && ev.rec.jusquau) || '9999-12-31';
  const push = (d) => { const f = addDays(d, dur); if (f >= de && d <= a && !ex.has(d)) out.push({ date: d, fin: f }); };
  if (!rec) { push(ev.date); return out; }
  let d = ev.date, i = 0;
  const step = (n) => { if (rec === 'mensuel') { const [Y, M, D] = ev.date.split('-').map(Number); const t = new Date(Y, M - 1 + n, 1, 12); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(D, last)); return isoDate(t); } return addDays(ev.date, n * (rec === 'bihebdo' ? 14 : 7)); };
  while (d <= a && d <= fin && i < 1000) { push(d); i++; d = step(i); }
  return out;
}
function totalHeures(heures, filtre) {
  const o = {};
  for (const h of heures) { if (filtre && !filtre(h)) continue; o[h.personne] = (o[h.personne] || 0) + num(h.heures); }
  return o;
}

if (typeof module !== 'undefined') module.exports = { r2, num, yearOf, parts, estAssocie, teneursEngrais, DEFAULT_PERSONNES, factureStatut, factureTotal, recettesUnifiees, decompte, valeurFinAnnee, amortissementAnnee, NUTR, DEFAULT_PARAMS_CULTURES, culture, totauxCultures, isoDate, lundiDe, addDays, semaineISO, totalHeures, lundiSemaine, parseSemaines, periodeCulture, occurrences };
