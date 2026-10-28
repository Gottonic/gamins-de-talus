/* Gamins de Talus — irrigation : combien arroser chaque culture, semaine par semaine.
   Méthode FAO-56 : ETc = Kc × ET0. ET0 et pluie mesurées à Fribourg / Posieux (MeteoSwiss, fichier meteo/posieux.json
   mis à jour chaque jour par une action GitHub). Kc selon le stade de la culture (initial, croissance, plein développement,
   fin), avec la durée de chaque stade en % du cycle plantation → fin de récolte.
   Bilan hebdomadaire : besoin net = ETc − pluie efficace − réserve laissée par la semaine passée ;
   besoin brut = net ÷ efficience du système ; durée = volume ÷ débit de la planche.
   cfg:irrigation          matériel et réglages
   fiche:<culture>.irr     { kc: [ini, mid, fin], stades: [% ini, % croissance, % plein, % fin], systeme }
   irr:<lundi>             semaine : { pluiePrevue, et0Prevu, faits: { cul:… : heures } } */
'use strict';

const IRR = { lundi: '' };
const METEO = { jours: {}, maj: '', charge: false, erreur: '', clim: {} };
const IRR_DEFAUT = {
  systemes: [
    { k: 'goutte', nom: 'Goutte-à-goutte', type: 'goutte', debitGoutteur: 1, espacement: 20, lignes: 2, efficience: 0.9, arrosages: 3 },
    { k: 'aspersion', nom: 'Aspersion', type: 'aspersion', pluviometrie: 8, efficience: 0.75, arrosages: 2 },
  ],
  pluieSeuil: 3, pluieCoef: 0.8, reserve: 15,
};
const cfgIrr = () => Object.assign({}, IRR_DEFAUT, DB.get('cfg:irrigation') || {});
const STADES = { ini: 'Initial', dev: 'Croissance', mid: 'Plein développement', fin: 'Fin de cycle' };
/* Coefficients FAO-56 (tableaux 11 et 12, climat européen / méditerranéen). Durées des stades en % du cycle. */
const KC_FAO = [
  [/chou|brocol|kale|crucif/, { kc: [0.7, 1.05, 0.95], stades: [25, 37, 25, 13] }],
  [/courge|potiron|potimarron|butternut|citrouille/, { kc: [0.5, 1.0, 0.8], stades: [21, 29, 29, 21] }],
  [/courgette/, { kc: [0.5, 0.95, 0.75], stades: [22, 33, 28, 17] }],
  [/patate douce/, { kc: [0.5, 1.15, 0.65], stades: [13, 20, 40, 27] }],
  [/arachide|cacahu/, { kc: [0.4, 1.15, 0.6], stades: [25, 32, 25, 18] }],
  [/poireau/, { kc: [0.7, 1.0, 0.95], stades: [15, 25, 45, 15], estime: true }],
  [/ail\b|^ail/, { kc: [0.7, 1.0, 0.7], stades: [15, 25, 45, 15], estime: true }],
  [/oignon|echalote/, { kc: [0.7, 1.05, 0.75], stades: [10, 17, 46, 27] }],
  [/carotte/, { kc: [0.7, 1.05, 0.95], stades: [20, 27, 40, 13] }],
  [/salade|laitue|batavia/, { kc: [0.7, 1.0, 0.95], stades: [27, 40, 20, 13] }],
  [/tomate/, { kc: [0.6, 1.15, 0.8], stades: [21, 28, 31, 20] }],
  [/pomme de terre|patate/, { kc: [0.5, 1.15, 0.75], stades: [21, 24, 34, 21] }],
  [/haricot/, { kc: [0.5, 1.05, 0.9], stades: [22, 33, 33, 12] }],
  [/epinard/, { kc: [0.7, 1.0, 0.95], stades: [30, 35, 25, 10] }],
];
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function kcDefaut(nom) { const n = sansAccents(nom); const x = KC_FAO.find(([re]) => re.test(n)); return x ? Object.assign({ fao: !x[1].estime }, x[1]) : { kc: [0.6, 1.0, 0.8], stades: [20, 30, 35, 15], generique: true }; }
function irrDe(fiche) { const d = kcDefaut(fiche && fiche.nom), i = (fiche && fiche.irr) || {}; return { kc: i.kc || d.kc, stades: i.stades || d.stades, systeme: i.systeme || '', perso: !!(i.kc || i.stades), defaut: d }; }
/* Kc le jour t (jours depuis la plantation) pour un cycle de « total » jours */
function kcJour(ir, t, total) {
  const s = ir.stades.map(num), som = s.reduce((a, x) => a + x, 0) || 100;
  const [Li, Ld, Lm, Lf] = s.map((x) => (x / som) * total), [k0, k1, k2] = ir.kc.map(num);
  if (t < Li) return { stade: 'ini', kc: k0 };
  if (t < Li + Ld) return { stade: 'dev', kc: k0 + (k1 - k0) * (t - Li) / (Ld || 1) };
  if (t < Li + Ld + Lm) return { stade: 'mid', kc: k1 };
  return { stade: 'fin', kc: k1 + (k2 - k1) * Math.min(1, (t - Li - Ld - Lm) / (Lf || 1)) };
}

/* ---------- Météo ---------- */
async function chargerMeteo(force) {
  if (METEO.charge && !force) return;
  try {
    const r = await fetch('meteo/posieux.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); METEO.jours = {}; METEO.maj = d.maj || '';
    const parMois = {};
    for (const [j, et0, pluie, tmin, tmax] of d.jours || []) {
      METEO.jours[j] = { et0, pluie, tmin, tmax };
      if (et0 != null) (parMois[j.slice(5, 7)] = parMois[j.slice(5, 7)] || []).push(et0);
    }
    METEO.clim = {}; for (const m in parMois) METEO.clim[m] = parMois[m].reduce((a, x) => a + x, 0) / parMois[m].length;
    METEO.erreur = '';
  } catch (e) { METEO.erreur = 'Données météo pas disponibles (' + e.message + ').'; }
  METEO.charge = true;
  if (ROUTE.mod === 'irrigation' || !ROUTE.mod) render();
}
const CLIM_DEFAUT = { '01': 0.4, '02': 0.7, '03': 1.4, '04': 2.6, '05': 3.3, '06': 4.5, '07': 4.7, '08': 4.0, '09': 2.4, '10': 1.1, '11': 0.5, '12': 0.3 };
/* ET0 d'un jour : mesurée, sinon estimée (moitié moyenne des 7 derniers jours mesurés, moitié moyenne du mois à Posieux) */
function et0Jour(d) {
  const m = METEO.jours[d]; if (m && m.et0 != null) return { v: m.et0, mesure: true };
  const clim = METEO.clim[d.slice(5, 7)] ?? CLIM_DEFAUT[d.slice(5, 7)];
  const ds = Object.keys(METEO.jours).filter((x) => x < d && METEO.jours[x].et0 != null).sort().slice(-7);
  const rec = ds.length >= 4 ? ds.reduce((a, x) => a + METEO.jours[x].et0, 0) / ds.length : clim;
  return { v: 0.5 * rec + 0.5 * clim, mesure: false };
}
const pluieEff = (mm, c) => (num(mm) >= num(c.pluieSeuil) ? num(mm) * num(c.pluieCoef) : 0);

/* ---------- Cultures en place et calcul semaine par semaine ---------- */
function systemeDe(c, ir, ci) { return ci.systemes.find((s) => s.k === ir.systeme) || ci.systemes[0] || IRR_DEFAUT.systemes[0]; }
function debitPlanche(sys, longueur) { return sys.type === 'aspersion' ? 0 : (longueur * 100 / Math.max(1, num(sys.espacement))) * num(sys.debitGoutteur) * Math.max(1, num(sys.lignes)); }
function culturesIrriguees(lundi) {
  const y = Number(lundi.slice(0, 4)), fin = addDays(lundi, 6);
  return DB.all('cul:').filter((c) => [String(y), String(y - 1)].includes(String(c.saison))).map((c) => {
    const p = periodeCulture(c); if (!p) return null;
    const plant = parseSemaines(c.semPlantation) ? p.debut : null; if (!plant) return null;
    if (p.fin < lundi || plant > fin) return null;
    return { c, debut: plant, fin: p.fin };
  }).filter(Boolean);
}
/* Bilan d'une culture semaine après semaine, de la plantation jusqu'à la semaine demandée.
   stock (mm) : réserve laissée dans le sol (+) ou manque à rattraper (−), borné à ± la réserve utile. */
function calculIrrigation(x, lundiCible) {
  const ci = cfgIrr(), P = paramsCultures(x.c.saison), f = DB.get(ficheDe(x.c)) || { nom: x.c.nom }, ir = irrDe(f), sys = systemeDe(x.c, ir, ci);
  const longueur = num(x.c.longueur) || num(P.longueur), surfPl = longueur * num(P.facteurSurface);
  const total = Math.max(14, (new Date(x.fin) - new Date(x.debut)) / 864e5 + 1);
  const dp = debitPlanche(sys, longueur), res = num(ci.reserve);
  let stock = 0; const semaines = [];
  for (let l = lundiDe(x.debut); l <= lundiCible; l = addDays(l, 7)) {
    const sem = DB.get('irr:' + l) || {};
    let etc = 0, pe = 0, joursMes = 0, et0s = 0, kcMoy = 0, n = 0, stade = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(l, i); if (d < x.debut || d > x.fin) continue;
      const t = (new Date(d) - new Date(x.debut)) / 864e5, k = kcJour(ir, t, total), e = et0Jour(d);
      etc += k.kc * e.v; et0s += e.v; kcMoy += k.kc; n++; stade = k.stade;
      const m = METEO.jours[d];
      if (m && m.pluie != null && e.mesure) { pe += pluieEff(m.pluie, ci); joursMes++; }
    }
    if (!n) continue;
    /* Pluie des jours pas encore mesurés : la pluie prévue saisie pour la semaine, au prorata */
    const jf = n - joursMes; if (jf > 0 && num(sem.pluiePrevue) > 0) pe += pluieEff(num(sem.pluiePrevue), ci) * jf / 7;
    const report = stock;
    const net = Math.max(0, etc - pe - report), brut = net / Math.max(0.3, num(sys.efficience) || 0.85);
    const litresPl = brut * surfPl, heuresPl = sys.type === 'aspersion' ? brut / Math.max(0.5, num(sys.pluviometrie)) : (dp ? litresPl / dp : 0);
    /* Ce qui a été fait : heures notées, sinon on suppose le conseil suivi (pour les semaines passées) */
    const fait = (sem.faits || {})[x.c.key];
    const apportNet = fait != null && fait !== '' ? (sys.type === 'aspersion' ? num(fait) * num(sys.pluviometrie) : num(fait) * dp / surfPl) * (num(sys.efficience) || 0.85) : net;
    stock = Math.max(-res, Math.min(res, report + pe + apportNet - etc));
    semaines.push({ lundi: l, n, joursMes, stade, kc: kcMoy / n, et0: et0s, etc, pe, report, net, brut, litresPl, heuresPl, fait, apportNet, stock });
  }
  return { ir, sys, f, surfPl, dp, total, semaines, cible: semaines.find((s) => s.lundi === lundiCible) };
}
const fmtDuree = (h) => { if (!(h > 0)) return '—'; const m = Math.round(h * 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''); };

/* ---------- Module ---------- */
MODULES.irrigation = {
  titre: 'Irrigation',
  tuile() {
    chargerMeteo();
    const l = lundiDe(todayISO()), xs = culturesIrriguees(l);
    if (!xs.length) return { line: 'Aucune culture en place cette semaine' };
    let m3 = 0, nb = 0; for (const x of xs) { const r = calculIrrigation(x, l).cible; if (r && r.net > 0.5) { nb++; m3 += r.litresPl * num(x.c.planches) / 1000; } }
    return { line: nb ? `Semaine ${semaineISO(l).semaine} : ${nb} culture${nb > 1 ? 's' : ''} à arroser · ${fmtNum(m3, 1)} m³` : `Semaine ${semaineISO(l).semaine} : pas besoin d'arroser` };
  },
  render(sub) {
    chargerMeteo();
    const t = tabs('irrigation', [['', 'Cette semaine'], ['saison', 'Saison'], ['meteo', 'Météo Posieux'], ['reglages', 'Matériel et cultures']], sub);
    if (sub === 'saison') return t + renderIrrSaison();
    if (sub === 'meteo') return t + renderMeteo();
    if (sub === 'reglages') return t + renderIrrReglages();
    return t + renderIrrSemaine();
  },
  after(sub) {
    if (!sub) {
      const pp = $('irr-pp'); if (pp) pp.addEventListener('change', () => { const k = 'irr:' + IRR.lundi; DB.put(k, Object.assign({}, DB.get(k) || {}, { pluiePrevue: pp.value.trim() === '' ? null : num(pp.value) })); renderGardeFocus(); });
      $('view').querySelectorAll('input[data-fait]').forEach((el) => el.addEventListener('change', () => {
        const k = 'irr:' + IRR.lundi, o = Object.assign({}, DB.get(k) || {}); o.faits = Object.assign({}, o.faits || {});
        if (el.value.trim() === '') delete o.faits[el.dataset.fait]; else o.faits[el.dataset.fait] = num(el.value);
        DB.put(k, o); renderGardeFocus();
      }));
    }
  },
};

function meteoSemaine(l) {
  let et0 = 0, pluie = 0, mes = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(l, i), e = et0Jour(d); et0 += e.v; if (e.mesure) { mes++; pluie += num((METEO.jours[d] || {}).pluie); } }
  return { et0, pluie, mes };
}
function renderIrrSemaine() {
  if (!IRR.lundi) IRR.lundi = lundiDe(todayISO());
  const l = IRR.lundi, w = semaineISO(l), ci = cfgIrr(), sem = DB.get('irr:' + l) || {}, today = todayISO();
  const ms = meteoSemaine(l), mp = meteoSemaine(addDays(l, -7));
  const xs = culturesIrriguees(l).map((x) => Object.assign(x, { r: calculIrrigation(x, l) })).filter((x) => x.r.cible);
  /* On garde l'estimation de la semaine (pour comparer ensuite avec ce qui a été mesuré) */
  if (l >= lundiDe(today) && sem.et0Prevu == null && METEO.charge && !METEO.erreur && ms.mes < 7) setTimeout(() => DB.put('irr:' + l, Object.assign({}, DB.get('irr:' + l) || {}, { et0Prevu: r2(ms.et0) })), 0);
  const totalM3 = xs.reduce((a, x) => a + x.r.cible.litresPl * num(x.c.planches) / 1000, 0);
  const lignes = xs.map((x) => {
    const r = x.r.cible, s = x.r.sys, arr = Math.max(1, num(s.arrosages) || 1), coul = (DB.get(ficheDe(x.c)) || {}).couleur || couleurCulture(x.c, (x.c.ordre || 1) - 1);
    return `<tr><td style="white-space:nowrap"><span class="sw" style="background:${coul}"></span><b>${esc(x.c.nom)}</b><br><span class="hint">${esc(STADES[r.stade] || '')} · Kc ${fmtNum(r.kc, 2)} · ${esc(s.nom)}</span></td>
      <td class="r num">${fmtNum(r.etc, 1)}</td><td class="r num">${fmtNum(r.pe, 1)}</td><td class="r num">${r.report ? (r.report > 0 ? '−' : '+') + fmtNum(Math.abs(r.report), 1) : '0'}</td>
      <td class="r num"><b>${fmtNum(r.net, 1)}</b></td><td class="r num">${r.net > 0.5 ? f0(r.litresPl) + ' L' : '—'}</td>
      <td class="r"><b>${r.net > 0.5 ? `${arr} × ${fmtDuree(r.heuresPl / arr)}` : 'pas besoin'}</b>${r.net > 0.5 ? `<br><span class="hint">${fmtDuree(r.heuresPl)} par semaine</span>` : ''}</td>
      <td class="r num">${r.net > 0.5 ? fmtNum(r.litresPl * num(x.c.planches) / 1000, 2) : '—'}<br><span class="hint">${f0(x.c.planches)} pl.</span></td>
      <td><input class="cell-in" data-fait="${esc(x.c.key)}" inputmode="decimal" value="${r.fait == null ? '' : esc(String(r.fait).replace('.', ','))}" placeholder="${l < lundiDe(today) ? 'conseil' : 'h'}" aria-label="Heures arrosées ${esc(x.c.nom)}"></td></tr>`;
  }).join('');
  const cartes = xs.map((x) => {
    const r = x.r.cible, s = x.r.sys, arr = Math.max(1, num(s.arrosages) || 1), coul = (DB.get(ficheDe(x.c)) || {}).couleur || couleurCulture(x.c, (x.c.ordre || 1) - 1);
    return `<div class="irr-carte"><div class="between"><b><span class="sw" style="background:${coul}"></span>${esc(x.c.nom)}</b><b>${r.net > 0.5 ? `${arr} × ${fmtDuree(r.heuresPl / arr)}` : 'pas besoin'}</b></div>
      <span class="hint">${esc(STADES[r.stade] || '')} · ETc ${fmtNum(r.etc, 1)} mm − pluie ${fmtNum(r.pe, 1)} mm${r.report ? ` ${r.report > 0 ? '−' : '+'} réserve ${fmtNum(Math.abs(r.report), 1)} mm` : ''} = <b>${fmtNum(r.net, 1)} mm</b>${r.net > 0.5 ? ` · ${f0(r.litresPl)} L par planche · ${fmtNum(r.litresPl * num(x.c.planches) / 1000, 1)} m³ pour ${f0(x.c.planches)} pl.` : ''}</span>
      <label class="row" style="font-size:13.5px;margin-top:6px">Fait (heures par planche) <input class="cell-in" data-fait="${esc(x.c.key)}" inputmode="decimal" style="width:80px" value="${r.fait == null ? '' : esc(String(r.fait).replace('.', ','))}" placeholder="${l < lundiDe(today) ? 'conseil' : 'h'}"></label></div>`;
  }).join('');
  return `<div class="between"><div class="row"><button class="btn small" type="button" data-act="irrSem" data-n="-7" aria-label="Semaine précédente">←</button><h2 style="margin:0">Semaine ${w.semaine}</h2><button class="btn small" type="button" data-act="irrSem" data-n="7" aria-label="Semaine suivante">→</button></div>
      <div class="row"><span class="hint">${fmtDate(l)} – ${fmtDate(addDays(l, 6))}</span>${l !== lundiDe(today) ? '<button class="btn small" type="button" data-act="irrSem" data-n="0">Cette semaine</button>' : ''}</div></div>
    ${METEO.erreur ? `<p class="banner">${esc(METEO.erreur)} Les calculs utilisent des moyennes de saison.</p>` : ''}
    <div class="stats">
      <div class="stat blue"><span class="k">ET0 cette semaine</span><span class="v">${fmtNum(ms.et0, 1)} mm</span><span class="s">${ms.mes === 7 ? 'mesurée' : ms.mes ? `${ms.mes} jour${ms.mes > 1 ? 's' : ''} mesuré${ms.mes > 1 ? 's' : ''}, le reste estimé` : 'estimée'}</span></div>
      <div class="stat good"><span class="k">Pluie mesurée cette semaine</span><span class="v">${fmtNum(ms.pluie, 1)} mm</span><span class="s">Semaine passée : ${fmtNum(mp.pluie, 1)} mm · ET0 ${fmtNum(mp.et0, 1)} mm</span></div>
      <div class="stat"><span class="k">Eau à apporter</span><span class="v">${fmtNum(totalM3, 1)} m³</span><span class="s">${xs.length} culture${xs.length > 1 ? 's' : ''} en place</span></div>
      <div class="stat">${fld('irr-pp', 'Pluie prévue cette semaine (mm)', `<input id="irr-pp" inputmode="decimal" value="${sem.pluiePrevue == null ? '' : esc(String(sem.pluiePrevue).replace('.', ','))}" placeholder="ex. 10">`, 'Selon la météo de la semaine : remplace les jours pas encore mesurés.')}</div>
    </div>
    <div class="panel"><h2>Arrosage conseillé</h2>
      ${xs.length ? `<div class="irr-cartes">${cartes}</div><div class="table-wrap irr-table"><table class="list irr"><thead><tr><th>Culture</th><th class="r">ETc mm</th><th class="r">Pluie eff. mm</th><th class="r">Réserve</th><th class="r">Besoin net mm</th><th class="r">Par planche</th><th class="r">Durée</th><th class="r">m³</th><th>Fait (h)</th></tr></thead><tbody>${lignes}</tbody></table></div>`
        : '<p class="empty">Aucune culture en place cette semaine (d\'après les semaines de plantation et de récolte du plan).</p>'}
      <p class="hint">ETc = Kc × ET0 (besoin en eau de la culture, 1 mm = 1 L/m²). Pluie efficace : pluies d'au moins ${fmtNum(ci.pluieSeuil, 1)} mm, comptées à ${Math.round(num(ci.pluieCoef) * 100)} %. Réserve : ce que la semaine passée a laissé dans le sol (−) ou pas couvert (+), jusqu'à ${fmtNum(ci.reserve, 0)} mm.
        Par planche : besoin net ÷ efficience du système × ${fmtNum(xs[0] ? xs[0].r.surfPl : 0, 1)} m². « Fait (h) » : heures d'arrosage réelles de la semaine pour une planche ; vide = conseil suivi.</p></div>`;
}
ACTIONS.irrSem = (el) => { const n = Number(el.dataset.n); IRR.lundi = n === 0 ? lundiDe(todayISO()) : addDays(IRR.lundi || lundiDe(todayISO()), n); render(); };

function renderIrrSaison() {
  const y = (IRR.lundi || todayISO()).slice(0, 4), lc = lundiDe(todayISO());
  const xs = DB.all('cul:').filter((c) => String(c.saison) === y).map((c) => { const p = periodeCulture(c); return p && parseSemaines(c.semPlantation) ? { c, debut: p.debut, fin: p.fin } : null; }).filter(Boolean);
  if (!xs.length) return `<div class="panel"><p class="empty">Aucune culture avec semaines de plantation dans le plan ${esc(y)}.</p></div>`;
  const parts = xs.map((x) => {
    const r = calculIrrigation(x, x.fin < lc ? lundiDe(x.fin) : lc);
    const tot = r.semaines.reduce((a, s) => ({ etc: a.etc + s.etc, pe: a.pe + s.pe, net: a.net + s.net, l: a.l + s.litresPl }), { etc: 0, pe: 0, net: 0, l: 0 });
    return `<details class="fold"><summary><b>${esc(x.c.nom)}</b> · ${r.semaines.length} semaines · ETc ${f0(tot.etc)} mm · pluie efficace ${f0(tot.pe)} mm · arrosage ${f0(tot.net)} mm (${fmtNum(tot.l * num(x.c.planches) / 1000, 1)} m³)</summary>
      <div class="table-wrap"><table class="list"><thead><tr><th>Semaine</th><th>Stade</th><th class="r">Kc</th><th class="r">ET0</th><th class="r">ETc</th><th class="r">Pluie eff.</th><th class="r">Besoin net</th><th class="r">Fait (h)</th><th class="r">Réserve fin</th></tr></thead><tbody>
      ${r.semaines.map((s) => { const sem = DB.get('irr:' + s.lundi) || {}; return `<tr><td>${semaineISO(s.lundi).semaine} <span class="hint">${fmtDateCourt(s.lundi)}</span></td><td>${esc(STADES[s.stade] || '')}</td><td class="r num">${fmtNum(s.kc, 2)}</td><td class="r num">${fmtNum(s.et0, 1)}${sem.et0Prevu != null && s.joursMes === 7 ? ` <span class="hint">(prévu ${fmtNum(sem.et0Prevu, 1)})</span>` : s.joursMes < s.n ? ' <span class="hint">est.</span>' : ''}</td><td class="r num">${fmtNum(s.etc, 1)}</td><td class="r num">${fmtNum(s.pe, 1)}</td><td class="r num">${fmtNum(s.net, 1)}</td><td class="r num">${s.fait == null ? '—' : fmtH(s.fait)}</td><td class="r num">${fmtNum(s.stock, 1)}</td></tr>`; }).join('')}
      </tbody></table></div></details>`;
  }).join('');
  return `<div class="panel"><h2>Saison ${esc(y)}</h2><p class="hint">Semaine par semaine, ce que chaque culture a consommé (ETc), ce que la pluie a apporté et le besoin d'arrosage calculé. Pour les semaines passées, l'ET0 et la pluie sont mesurées ; « prévu » montre l'estimation faite pendant la semaine. Un écart se reporte sur la semaine suivante par la réserve.</p>${parts}</div>`;
}

function renderMeteo() {
  const ds = Object.keys(METEO.jours).sort().slice(-42).reverse();
  if (!ds.length) return `<div class="panel"><p class="empty">${esc(METEO.erreur || 'Chargement des données météo…')}</p></div>`;
  const maxE = Math.max(1, ...ds.map((d) => num(METEO.jours[d].et0))), maxP = Math.max(1, ...ds.map((d) => num(METEO.jours[d].pluie)));
  const semaines = []; for (let l = lundiDe(ds[0]); l >= lundiDe(ds[ds.length - 1]); l = addDays(l, -7)) { const m = meteoSemaine(l), sem = DB.get('irr:' + l) || {}; semaines.push({ l, m, sem }); }
  return `<div class="split"><div class="panel"><h2>Par semaine</h2><div class="table-wrap"><table class="list"><thead><tr><th>Semaine</th><th class="r">ET0 mm</th><th class="r">Prévu</th><th class="r">Pluie mm</th><th class="r">Prévue</th></tr></thead><tbody>
      ${semaines.map((x) => `<tr><td>${semaineISO(x.l).semaine} <span class="hint">${fmtDateCourt(x.l)}</span></td><td class="r num">${fmtNum(x.m.et0, 1)}${x.m.mes < 7 ? ' <span class="hint">est.</span>' : ''}</td><td class="r num">${x.sem.et0Prevu != null ? fmtNum(x.sem.et0Prevu, 1) : '—'}</td><td class="r num">${fmtNum(x.m.pluie, 1)}</td><td class="r num">${x.sem.pluiePrevue != null ? fmtNum(x.sem.pluiePrevue, 1) : '—'}</td></tr>`).join('')}
      </tbody></table></div><p class="hint">« Prévu » : ce que l'app estimait (ET0) et ce que vous aviez saisi (pluie) pendant la semaine.</p></div>
    <div class="panel"><h2>Jour par jour</h2><div class="table-wrap"><table class="list meteo"><thead><tr><th>Jour</th><th>ET0</th><th>Pluie</th><th class="r">Min / max</th></tr></thead><tbody>
      ${ds.map((d) => { const m = METEO.jours[d]; return `<tr><td>${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)}</td>
        <td><span class="mbar et0" style="width:${(num(m.et0) / maxE * 70).toFixed(0)}px"></span> ${fmtNum(m.et0, 1)}</td><td>${num(m.pluie) ? `<span class="mbar pluie" style="width:${(num(m.pluie) / maxP * 70).toFixed(0)}px"></span> ${fmtNum(m.pluie, 1)}` : '<span class="hint">0</span>'}</td><td class="r num">${m.tmin == null ? '' : fmtNum(m.tmin, 0) + ' / ' + fmtNum(m.tmax, 0) + ' °C'}</td></tr>`; }).join('')}
      </tbody></table></div></div></div>
    <p class="hint">Station MeteoSwiss Fribourg / Posieux (env. 6 km de Marly), données ouvertes, mises à jour chaque jour${METEO.maj ? ' (dernière : ' + fmtDate(METEO.maj.slice(0, 10)) + ')' : ''}. ET0 : évapotranspiration de référence FAO (mm). Pluie : mm de 0 h à 0 h UTC.</p>`;
}

/* ---------- Matériel et coefficients ---------- */
function renderIrrReglages() {
  const ci = cfgIrr(), fs = fiches();
  return `<div class="split"><div class="panel"><div class="between"><h2>Matériel</h2><button class="btn small" type="button" data-act="irrSys">+ Système</button></div>
      <div class="items">${ci.systemes.map((s) => `<a class="item" href="#" data-act="irrSys" data-k="${esc(s.k)}"><span class="who"><strong>${esc(s.nom)}</strong><span class="meta">${s.type === 'aspersion' ? `aspersion · ${fmtNum(s.pluviometrie, 1)} mm/h` : `goutte-à-goutte · ${fmtNum(s.debitGoutteur, 2)} L/h tous les ${f0(s.espacement)} cm · ${f0(s.lignes)} ligne${num(s.lignes) > 1 ? 's' : ''} par planche · ${f0(debitPlanche(s, num(paramsCultures(todayISO().slice(0, 4)).longueur)))} L/h par planche`} · efficience ${Math.round(num(s.efficience) * 100)} % · ${f0(s.arrosages)} arrosage${num(s.arrosages) > 1 ? 's' : ''}/sem.</span></span></a>`).join('')}</div>
      <h3>Réglages du calcul</h3>
      <form class="form" data-form="irrCfg"><div class="grid2">
        ${inp('ir-ps', 'Pluie ignorée en dessous de (mm/jour)', ci.pluieSeuil, { name: 'pluieSeuil', type: 'number' })}${inp('ir-pc', 'Part de la pluie utile (0,8 = 80 %)', ci.pluieCoef, { name: 'pluieCoef', type: 'number' })}
        ${inp('ir-res', 'Réserve utile du sol reportable (mm)', ci.reserve, { name: 'reserve', type: 'number', sub: 'Excédent ou manque d\'une semaine reporté sur la suivante, au plus cette valeur.' })}
      </div><div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form></div>
    <div class="panel"><h2>Coefficients des cultures (Kc)</h2>
      <p class="hint">Kc : consommation de la culture par rapport à l'ET0, au début (initial), au plus fort (plein développement) et en fin de cycle. Les stades sont en % du cycle, de la plantation à la fin de la récolte. Valeurs de départ : FAO-56 (tableaux 11 et 12) ; « estimé » quand la FAO ne donne pas la culture.</p>
      ${fs.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Culture</th><th class="r">Kc début / plein / fin</th><th class="r">Stades %</th><th>Système</th></tr></thead><tbody>
        ${fs.map((f) => { const ir = irrDe(f); return `<tr class="click" data-act="irrKc" data-key="${esc(f.key)}"><td><span class="sw" style="background:${f.couleur || '#999'}"></span>${esc(f.nom)} ${ir.perso ? '' : ir.defaut.generique ? ' <span class="tpill">générique</span>' : ir.defaut.estime ? ' <span class="tpill">estimé</span>' : ' <span class="tpill">FAO</span>'}</td><td class="r num" style="white-space:nowrap">${ir.kc.map((x) => fmtNum(x, 2)).join(' / ')}</td><td class="r num" style="white-space:nowrap">${ir.stades.map((x) => f0(x)).join(' · ')}</td><td>${esc((ci.systemes.find((s) => s.k === ir.systeme) || ci.systemes[0] || {}).nom || '')}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="empty">Créez d\'abord vos cultures dans Cultures → Nos cultures.</p>'}</div></div>`;
}
FORMS.irrCfg = (v) => { DB.put('cfg:irrigation', Object.assign({}, DB.get('cfg:irrigation') || {}, { pluieSeuil: num(v.pluieSeuil), pluieCoef: Math.min(1, num(v.pluieCoef)), reserve: num(v.reserve) })); toast('Réglages enregistrés.'); };
ACTIONS.irrSys = (el) => {
  const ci = cfgIrr(), k = el.dataset.k || '', s = ci.systemes.find((x) => x.k === k) || { type: 'goutte', debitGoutteur: 1, espacement: 20, lignes: 2, efficience: 0.9, arrosages: 3, pluviometrie: 8 };
  const n = (id, label, val, name, sub) => inp(id, label, val ?? '', { name, type: 'number', sub });
  openSheet(`${sheetHead(k ? s.nom : 'Nouveau système d\'irrigation')}<form class="sbody form" data-form="irrSys"><input type="hidden" name="k" value="${esc(k)}">
    <div class="grid2">${inp('is-nom', 'Nom', s.nom, { name: 'nom', req: true, attrs: { placeholder: 'ex. Gaine T-Tape 20 cm' } })}${sel('is-type', 'Type', s.type, [['goutte', 'Goutte-à-goutte'], ['aspersion', 'Aspersion']], { name: 'type' })}</div>
    <h3>Goutte-à-goutte</h3><div class="grid2">${n('is-dg', 'Débit d\'un goutteur (L/h)', s.debitGoutteur, 'debitGoutteur')}${n('is-esp', 'Espacement des goutteurs (cm)', s.espacement, 'espacement')}${n('is-lig', 'Lignes de gaine par planche', s.lignes, 'lignes')}</div>
    <h3>Aspersion</h3><div class="grid2">${n('is-pl', 'Pluviométrie (mm/h)', s.pluviometrie, 'pluviometrie', 'Mesurable avec des gobelets posés sur la planche pendant 30 min.')}</div>
    <h3>Pour les deux</h3><div class="grid2">${n('is-eff', 'Efficience (0,9 = 90 %)', s.efficience, 'efficience', 'Goutte-à-goutte ~0,9 ; aspersion ~0,7–0,8.')}${n('is-arr', 'Arrosages par semaine', s.arrosages, 'arrosages')}</div>
    <div class="row-end">${k && ci.systemes.length > 1 ? '<button class="btn danger" type="button" data-act="irrSysDel" data-k="' + esc(k) + '">Supprimer</button>' : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.irrSys = (v) => {
  const ci = cfgIrr(), l = ci.systemes.map((x) => Object.assign({}, x));
  const o = { k: v.k || sansAccents(v.nom).replace(/[^a-z0-9]+/g, '') + Date.now().toString(36).slice(-3), nom: v.nom, type: v.type, debitGoutteur: num(v.debitGoutteur), espacement: num(v.espacement), lignes: num(v.lignes), pluviometrie: num(v.pluviometrie), efficience: Math.min(1, num(v.efficience)) || 0.85, arrosages: Math.max(1, Math.round(num(v.arrosages)) || 1) };
  const i = l.findIndex((x) => x.k === o.k); if (i >= 0) l[i] = o; else l.push(o);
  DB.put('cfg:irrigation', Object.assign({}, DB.get('cfg:irrigation') || {}, { systemes: l })); closeSheet(); toast('Système enregistré.');
};
ACTIONS.irrSysDel = (el) => { const ci = cfgIrr(); DB.put('cfg:irrigation', Object.assign({}, DB.get('cfg:irrigation') || {}, { systemes: ci.systemes.filter((x) => x.k !== el.dataset.k) })); closeSheet(); toast('Système supprimé.'); };
ACTIONS.irrKc = (el) => {
  const f = DB.get(el.dataset.key); if (!f) return; const ir = irrDe(f), ci = cfgIrr();
  const n = (id, label, val, name) => inp(id, label, val ?? '', { name, type: 'number' });
  openSheet(`${sheetHead('Irrigation · ' + f.nom)}<form class="sbody form" data-form="irrKc"><input type="hidden" name="key" value="${esc(el.dataset.key)}">
    <h3>Kc</h3><div class="grid4">${n('ik-0', 'Initial', ir.kc[0], 'kc0')}${n('ik-1', 'Plein développement', ir.kc[1], 'kc1')}${n('ik-2', 'Fin de cycle', ir.kc[2], 'kc2')}</div>
    <h3>Durée des stades (% du cycle)</h3><div class="grid4">${n('is-0', 'Initial', ir.stades[0], 's0')}${n('is-1', 'Croissance', ir.stades[1], 's1')}${n('is-2', 'Plein dév.', ir.stades[2], 's2')}${n('is-3', 'Fin', ir.stades[3], 's3')}</div>
    <p class="hint">Valeurs de départ : ${ir.defaut.generique ? 'génériques' : 'FAO-56'} — Kc ${ir.defaut.kc.join(' / ')}, stades ${ir.defaut.stades.join(' · ')} %.</p>
    ${sel('ik-sys', 'Système d\'irrigation', ir.systeme || (ci.systemes[0] || {}).k, ci.systemes.map((s) => [s.k, s.nom]), { name: 'systeme' })}
    <div class="row-end"><button class="btn" type="button" data-act="irrKcDefaut" data-key="${esc(el.dataset.key)}">Revenir aux valeurs de départ</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.irrKc = (v) => {
  const f = DB.get(v.key); if (!f) return;
  DB.put(v.key, Object.assign({}, f, { irr: { kc: [num(v.kc0), num(v.kc1), num(v.kc2)], stades: [num(v.s0), num(v.s1), num(v.s2), num(v.s3)], systeme: v.systeme } }));
  closeSheet(); toast('Enregistré.');
};
ACTIONS.irrKcDefaut = (el) => { const f = DB.get(el.dataset.key); if (!f) return; const o = Object.assign({}, f, { irr: { systeme: (f.irr || {}).systeme || '' } }); DB.put(el.dataset.key, o); closeSheet(); toast('Valeurs de départ remises.'); };
