/* Gamins de Talus — plan de cultures : surfaces, récoltes, ventes prévues, plantons et fumure. */
'use strict';

const CU = { saison: '' };
const cultures = (s) => DB.all('cul:').filter((c) => String(c.saison) === String(s)).sort((a, b) => (a.ordre || 0) - (b.ordre || 0) || String(a.nom).localeCompare(b.nom, 'fr'));
const saisons = () => { const s = new Set(DB.all('cul:').map((c) => String(c.saison))); if (!s.size) s.add(todayISO().slice(0, 4)); return [...s].sort().reverse(); };
function saisonCourante() { const ss = saisons(); return CU.saison && ss.includes(CU.saison) ? CU.saison : (ss.includes(todayISO().slice(0, 4)) ? todayISO().slice(0, 4) : ss[0]); }
function paramsCultures(s) { return Object.assign({}, DEFAULT_PARAMS_CULTURES, DB.get('cfg:cultures:' + s) || {}); }
const f1 = (n) => fmtNum(n, 1), f0 = (n) => fmtNum(n, 0);

MODULES.cultures = {
  titre: 'Cultures',
  tuile() { const s = saisonCourante(), l = cultures(s); if (!l.length) return { line: 'Aucun plan' }; const t = totauxCultures(l, paramsCultures(s)); return { line: `${s} · ${l.length} cultures · ${f0(t.surface)} m²` }; },
  render() {
    const s = saisonCourante(), ss = saisons(), list = cultures(s), P = paramsCultures(s);
    const chips = ss.map((x) => `<button class="chip${x === s ? ' on' : ''}" type="button" data-act="cuSaison" data-s="${x}">${x}</button>`).join('');
    const head = `<div class="between"><div class="row">${chips}</div><div class="row"><button class="btn small" type="button" data-act="cuParams">Hypothèses</button><button class="btn small" type="button" data-act="cuDupliquer">Préparer ${Number(s) + 1}</button><button class="btn primary small" type="button" data-act="cuEdit">+ Culture</button></div></div>`;
    if (!list.length) return head + '<div class="panel"><p class="empty">Aucune culture dans ce plan. Ajoute la première avec « + Culture ».</p></div>';
    const os = list.map((c) => culture(c, P)), T = totauxCultures(list, P);
    const cols = list.length;
    const grp = (t) => `<tr class="grp"><td>${t}</td>${'<td></td>'.repeat(cols + 1)}</tr>`;
    const row = (label, f, tot, cls) => `<tr><td>${label}</td>${list.map((c, i) => { const v = f(c, os[i]); return `<td class="num ${cls ? cls(c, os[i]) : ''}">${v}</td>`; }).join('')}<td class="num tot">${tot ?? ''}</td></tr>`;
    const engr = (P.engrais || []);
    const table = `<div class="table-wrap"><table class="matrix"><thead><tr><th></th>${list.map((c) => `<th><button type="button" data-act="cuEdit" data-key="${esc(c.key)}">${esc(c.nom)}</button></th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${grp('Surface')}
      ${row('Planches', (c) => f0(c.planches), f0(list.reduce((a, c) => a + num(c.planches), 0)))}
      ${row('Surface m²', (c, o) => f1(o.surface), f1(T.surface))}
      ${row('Part de la surface', (c, o) => T.surface ? Math.round(o.surface / T.surface * 100) + ' %' : '—', '100 %')}
      ${grp('Récolte et ventes')}
      ${row('Rendement kg/m²', (c) => fmtNum(c.rendement, 2))}
      ${row('Récolte prévue kg', (c, o) => f0(o.recolte), f0(T.recolte))}
      ${row('Récolte réelle kg', (c) => c.recolteReelle ? f0(c.recolteReelle) : '—', T.recolteReelle ? f0(T.recolteReelle) : '—')}
      ${row('Prix direct CHF/kg', (c) => money(c.prixDirect))}
      ${row('Ventes directes CHF', (c, o) => f0(o.ventesDirect), f0(T.ventesDirect))}
      ${row('CHF/m² direct', (c, o) => money(o.chfM2Direct))}
      ${row('Prix revendeur CHF/kg', (c, o) => money(o.prixRevendeur) + (c.prixRevendeur == null || c.prixRevendeur === '' ? '*' : ''))}
      ${row('Ventes revendeur CHF', (c, o) => f0(o.ventesRevendeur), f0(T.ventesRevendeur))}
      ${row('CHF/m² revendeur', (c, o) => money(o.chfM2Revendeur))}
      ${grp('Plantation')}
      ${row('Semaine de plantation', (c) => esc(c.semPlantation || '—'))}
      ${row('Semaines de récolte', (c) => esc(c.semRecolte || '—'))}
      ${row('Lignes par planche', (c) => f0(c.lignes))}
      ${row('Interplant cm', (c) => f1(c.interplant))}
      ${row('Plantons', (c, o) => f0(o.plantons), f0(T.plantons))}
      ${row('Variété', (c) => esc(c.variete || '—'))}
      ${row('Fournisseur', (c) => esc(c.fournisseur || '—'))}
      ${grp('Fumure')}
      ${NUTR.map((n) => row(`Besoin net ${n} g/m²`, (c, o) => f1(o.net[n]))).join('')}
      ${row('Compost L/m²', (c) => f1(c.compost))}
      ${row('Compost m³', (c, o) => fmtNum(o.compostM3, 2), fmtNum(T.compostM3, 2))}
      ${NUTR.map((n) => row(`Reste ${n} après compost g/m²`, (c, o) => f1(o.apresCompost[n]), '', (c, o) => o.excedent[n] ? 'neg' : '')).join('')}
      ${NUTR.map((n) => row(`À apporter ${n} kg`, (c, o) => fmtNum(o.total[n] / 1000, 2), fmtNum(T.total[n] / 1000, 2))).join('')}
      ${engr.map((e) => row(`${esc(e.nom)} kg`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kg : 0, 1), fmtNum(T.engrais[e.k] || 0, 1))).join('')}
      ${engr.map((e) => row(`${esc(e.nom)} kg/planche`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kgParPlanche : 0, 2))).join('')}
    </tbody></table></div>`;
    return `${head}
      <div class="stats">
        <div class="stat good"><span class="k">Surface cultivée</span><span class="v">${f0(T.surface)} m²</span><span class="s">${list.reduce((a, c) => a + num(c.planches), 0)} planches de ${fmtNum(P.longueur, 1)} m</span></div>
        <div class="stat"><span class="k">Récolte prévue</span><span class="v">${f0(T.recolte)} kg</span><span class="s">${T.recolteReelle ? 'Réelle : ' + f0(T.recolteReelle) + ' kg' : 'Récolte réelle à saisir'}</span></div>
        <div class="stat good"><span class="k">Ventes directes prévues</span><span class="v">${chf(T.ventesDirect)}</span></div>
        <div class="stat blue"><span class="k">Ventes revendeur prévues</span><span class="v">${chf(T.ventesRevendeur)}</span></div>
        <div class="stat"><span class="k">Plantons</span><span class="v">${f0(T.plantons)}</span></div>
        <div class="stat"><span class="k">Compost</span><span class="v">${fmtNum(T.compostM3, 1)} m³</span></div>
      </div>
      <div class="panel"><h2>Plan ${s}</h2>${table}
        <p class="hint">Surface = planches × ${fmtNum(P.longueur, 1)} m × ${fmtNum(P.facteurSurface, 2)} (passe-pieds). Plantons = longueur ÷ interplant × lignes × planches.
        * Prix revendeur calculé à ${Math.round(num(P.partRevendeur) * 100)} % du prix direct. Le compost couvre ${Math.round(num(P.dispoCompost) * 100)} % de sa teneur la première année ; un excédent (en gris) compte pour 0 dans les totaux. Touche le nom d'une culture pour la modifier.</p></div>`;
  },
};
ACTIONS.cuSaison = (el) => { CU.saison = el.dataset.s; render(); };

ACTIONS.cuEdit = (el) => {
  const k = el.dataset.key || '', s = saisonCourante();
  const c = k ? DB.get(k) : { saison: s, lignes: 1, besoins: {}, correction: {}, ordre: cultures(s).length + 1 };
  const b = c.besoins || {}, co = c.correction || {};
  const n = (id, label, val, step, name) => inp(id, label, val ?? '', { name: name || id.slice(3), type: 'number', attrs: { step: step || 'any', inputmode: 'decimal' } });
  openSheet(`${sheetHead(k ? c.nom : 'Nouvelle culture', 'Saison ' + (c.saison || s))}<form class="sbody form" data-form="cu"><input type="hidden" name="key" value="${esc(k)}"><input type="hidden" name="saison" value="${esc(c.saison || s)}">
    <div class="grid2">${inp('cu-nom', 'Culture', c.nom, { name: 'nom', req: true })}${n('cu-ordre', 'Ordre d\'affichage', c.ordre, '1')}</div>
    <h3>Surface et rendement</h3>
    <div class="grid2">${n('cu-planches', 'Planches', c.planches, '1')}${n('cu-longueur', 'Longueur de planche m', c.longueur, 'any')}${n('cu-rendement', 'Rendement kg/m²', c.rendement)}${n('cu-recolteReelle', 'Récolte réelle kg', c.recolteReelle)}</div>
    <p class="hint">Longueur vide : celle des hypothèses (${fmtNum(paramsCultures(c.saison || s).longueur, 1)} m).</p>
    <h3>Prix</h3>
    <div class="grid2">${n('cu-prixDirect', 'Prix direct CHF/kg', c.prixDirect)}${n('cu-prixRevendeur', 'Prix revendeur CHF/kg', c.prixRevendeur)}</div>
    <p class="hint">Prix revendeur vide : calculé automatiquement depuis le prix direct.</p>
    <h3>Plantation</h3>
    <div class="grid2">${inp('cu-semP', 'Semaine de plantation', c.semPlantation, { name: 'semPlantation' })}${inp('cu-semR', 'Semaines de récolte', c.semRecolte, { name: 'semRecolte' })}
      ${n('cu-lignes', 'Lignes par planche', c.lignes, '1')}${n('cu-interplant', 'Interplant cm', c.interplant)}
      ${inp('cu-var', 'Variété', c.variete, { name: 'variete' })}${inp('cu-four', 'Fournisseur', c.fournisseur, { name: 'fournisseur' })}</div>
    <h3>Fumure (g/m²)</h3>
    <div class="grid2">${NUTR.map((x) => n('cu-b' + x, 'Besoin brut ' + x, b[x], 'any', 'b_' + x)).join('')}</div>
    <div class="grid2">${NUTR.map((x) => n('cu-c' + x, 'Correction ' + x + ' (analyse)', co[x] ?? 1, 'any', 'c_' + x)).join('')}</div>
    <div class="grid2">${n('cu-compost', 'Compost L/m²', c.compost)}</div>
    ${txt('cu-rem', 'Remarque', c.remarque, { name: 'remarque' })}
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette culture">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.cu = (v) => {
  if (!v.nom) { toast('Le nom est obligatoire.'); return; }
  const k = v.key || 'cul:' + uid('c'), old = DB.get(k) || {};
  const o = Object.assign({}, old, { saison: v.saison, nom: v.nom, variete: v.variete, fournisseur: v.fournisseur, semPlantation: v.semPlantation, semRecolte: v.semRecolte, remarque: v.remarque });
  for (const f of ['ordre', 'planches', 'longueur', 'rendement', 'recolteReelle', 'prixDirect', 'prixRevendeur', 'lignes', 'interplant', 'compost']) o[f] = v[f] === '' ? (f === 'prixRevendeur' || f === 'longueur' || f === 'recolteReelle' ? null : 0) : num(v[f]);
  o.besoins = {}; o.correction = {}; for (const x of NUTR) { o.besoins[x] = num(v['b_' + x]); o.correction[x] = v['c_' + x] === '' ? 1 : num(v['c_' + x]); }
  DB.put(k, o); closeSheet(); toast('Culture enregistrée.');
};
ACTIONS.cuParams = () => {
  const s = saisonCourante(), P = paramsCultures(s);
  const n = (id, label, val, name, sub) => inp(id, label, val ?? '', { name, type: 'number', attrs: { step: 'any', inputmode: 'decimal' }, sub });
  openSheet(`${sheetHead('Hypothèses ' + s)}<form class="sbody form" data-form="cuParams"><input type="hidden" name="saison" value="${esc(s)}">
    <div class="grid2">${n('cp-l', 'Longueur de planche m', P.longueur, 'longueur')}${n('cp-f', 'Facteur de surface', P.facteurSurface, 'facteurSurface', '1,1 = +10 % pour les passe-pieds')}
      ${n('cp-r', 'Prix revendeur (part du direct)', P.partRevendeur, 'partRevendeur', '0,6 = 60 %')}${n('cp-d', 'Compost disponible 1re année', r2(P.dispoCompost * 1000) / 1000, 'dispoCompost', '0,333 = un tiers')}</div>
    <h3>Teneur du compost (g/L)</h3>
    <div class="grid2">${NUTR.map((x) => n('cp-t' + x, x, P.teneurCompost[x], 't_' + x)).join('')}</div>
    <h3>Engrais</h3>
    ${(P.engrais || []).map((e, i) => `<div class="grid2">${inp('cp-en' + i, 'Engrais', e.nom, { name: 'en_' + i })}${sel('cp-nu' + i, 'Apporte', e.nutriment, NUTR.map((x) => [x, x]), { name: 'nu_' + i })}${n('cp-te' + i, 'Teneur (0,14 = 14 %)', e.teneur, 'te_' + i)}</div>`).join('')}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.cuParams = (v) => {
  const P = paramsCultures(v.saison);
  const o = { longueur: num(v.longueur) || 19, facteurSurface: num(v.facteurSurface) || 1, partRevendeur: num(v.partRevendeur), dispoCompost: num(v.dispoCompost), teneurCompost: {}, engrais: [] };
  for (const x of NUTR) o.teneurCompost[x] = num(v['t_' + x]);
  (P.engrais || []).forEach((e, i) => o.engrais.push({ k: e.k, nom: v['en_' + i] || e.nom, nutriment: v['nu_' + i] || e.nutriment, teneur: num(v['te_' + i]) }));
  DB.put('cfg:cultures:' + v.saison, o); closeSheet(); toast('Hypothèses enregistrées.');
};
ACTIONS.cuDupliquer = () => {
  const s = saisonCourante(), ns = String(Number(s) + 1);
  if (cultures(ns).length) { CU.saison = ns; render(); toast(`Le plan ${ns} existe déjà.`); return; }
  confirmSheet(`Préparer le plan ${ns} ?`, `Les ${cultures(s).length} cultures de ${s} sont copiées dans un nouveau plan ${ns} (sans les récoltes réelles), que tu peux ensuite modifier. Le plan ${s} reste intact.`, 'cuDupOk', 'Créer le plan ' + ns, { s, ns });
};
ACTIONS.cuDupOk = (el) => {
  const { s, ns } = el.dataset;
  for (const c of cultures(s)) { const o = Object.assign({}, c); delete o.key; o.saison = ns; o.recolteReelle = null; DB.put('cul:' + uid('c'), o); }
  const P = DB.get('cfg:cultures:' + s); if (P) DB.put('cfg:cultures:' + ns, P);
  CU.saison = ns; closeSheet(); toast(`Plan ${ns} créé.`); render();
};
