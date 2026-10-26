/* Gamins de Talus — plan de cultures : surfaces, récoltes, ventes prévues, plantons et fumure. */
'use strict';

const CU = { saison: '', fermes: (() => { try { return JSON.parse(ls.get('gdt-cu-fermes') || '[]'); } catch (e) { return []; } })() };
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
    const eff = list.map((c) => Object.assign({}, c, { recolteReelle: c.recolteReelle == null || c.recolteReelle === '' ? recolteNotee(c.key) : c.recolteReelle }));
    const os = eff.map((c) => culture(c, P)), T = totauxCultures(eff, P), cols = list.length;
    const coul = list.map((c, i) => couleurCulture(c, i));
    let gi = 0;
    const grp = (t, n) => { const id = t.toLowerCase().replace(/[^a-z]+/g, '-'); const closed = CU.fermes.includes(id); return `${gi++ ? '</tbody>' : ''}<tbody class="${closed ? 'closed' : ''}"><tr class="grp" data-act="cuToggle" data-g="${id}" tabindex="0" aria-expanded="${!closed}"><td>${t}<span class="cnt">${closed ? n + ' lignes' : ''}</span></td>${'<td></td>'.repeat(cols + 1)}</tr>`; };
    /* Ligne calculée (lecture seule) */
    const calc = (label, f, tot, cls) => `<tr class="calc"><td>${label}</td>${list.map((c, i) => `<td class="num ${cls ? cls(c, os[i]) : ''}">${f(eff[i], os[i])}</td>`).join('')}<td class="num tot">${tot ?? ''}</td></tr>`;
    /* Ligne modifiable : un champ par culture */
    const get = (c, f) => f.includes('.') ? ((c[f.split('.')[0]] || {})[f.split('.')[1]]) : c[f];
    const edit = (label, f, o = {}) => `<tr><td>${label}</td>${list.map((c, i) => { const v = get(c, f); const shown = v == null || v === '' ? '' : (o.txt ? v : String(v).replace('.', ',')); return `<td><input class="cell-in${o.txt ? ' txt' : ''}" id="ci-${i}-${f.replace('.', '_')}" data-cu="${esc(c.key)}" data-f="${f}" ${o.txt ? '' : 'inputmode="decimal"'} autocomplete="off" value="${esc(shown)}" placeholder="${esc(o.ph ? o.ph(c, os[i], eff[i]) : '')}" aria-label="${esc(label)} · ${esc(c.nom)}"></td>`; }).join('')}<td class="num tot">${o.tot ?? ''}</td></tr>`;
    const engr = (P.engrais || []);
    const table = `<div class="table-wrap"><table class="matrix"><thead><tr><th></th>${list.map((c, i) => `<th><button type="button" data-act="cuEdit" data-key="${esc(c.key)}"><span class="sw" style="background:${coul[i]}"></span>${esc(c.nom)}</button></th>`).join('')}<th>Total</th></tr></thead>
      ${grp('Surface', 4)}
      ${edit('Planches', 'planches', { tot: f0(list.reduce((a, c) => a + num(c.planches), 0)) })}
      ${edit('Longueur de planche m', 'longueur', { ph: () => String(P.longueur).replace('.', ',') })}
      ${calc('Surface m²', (c, o) => f1(o.surface), f1(T.surface))}
      ${calc('Part de la surface', (c, o) => T.surface ? Math.round(o.surface / T.surface * 100) + ' %' : '—', '100 %')}
      ${grp('Récolte et ventes', 9)}
      ${edit('Rendement kg/m²', 'rendement')}
      ${calc('Récolte prévue kg', (c, o) => f0(o.recolte), f0(T.recolte))}
      ${edit('Récolte réelle kg', 'recolteReelle', { ph: (c) => { const k = recolteNotee(c.key); return k ? f0(k) + ' cal.' : ''; }, tot: T.recolteReelle ? f0(T.recolteReelle) : '—' })}
      ${edit('Prix direct CHF/kg', 'prixDirect')}
      ${calc('Ventes directes CHF', (c, o) => f0(o.ventesDirect), f0(T.ventesDirect))}
      ${calc('CHF/m² direct', (c, o) => money(o.chfM2Direct))}
      ${edit('Prix revendeur CHF/kg', 'prixRevendeur', { ph: (c, o) => money(o.prixRevendeur) + ' auto' })}
      ${calc('Ventes revendeur CHF', (c, o) => f0(o.ventesRevendeur), f0(T.ventesRevendeur))}
      ${calc('CHF/m² revendeur', (c, o) => money(o.chfM2Revendeur))}
      ${grp('Plantation', 7)}
      ${edit('Semaine de plantation', 'semPlantation', { txt: true, ph: () => 'ex. 20' })}
      ${edit('Semaines de récolte', 'semRecolte', { txt: true, ph: () => 'ex. 40-46' })}
      ${edit('Lignes par planche', 'lignes')}
      ${edit('Interplant cm', 'interplant')}
      ${calc('Plantons', (c, o) => f0(o.plantons), f0(T.plantons))}
      ${edit('Variété', 'variete', { txt: true })}
      ${edit('Fournisseur', 'fournisseur', { txt: true })}
      ${grp('Fumure', 22 + 2 * engr.length)}
      ${NUTR.map((n) => edit(`Besoin brut ${n} g/m²`, 'besoins.' + n)).join('')}
      ${NUTR.map((n) => edit(`Correction ${n} (analyse de sol)`, 'correction.' + n, { ph: () => '1' })).join('')}
      ${NUTR.map((n) => calc(`Besoin net ${n} g/m²`, (c, o) => f1(o.net[n]))).join('')}
      ${edit('Compost L/m²', 'compost')}
      ${calc('Compost m³', (c, o) => fmtNum(o.compostM3, 2), fmtNum(T.compostM3, 2))}
      ${NUTR.map((n) => calc(`Reste ${n} après compost g/m²`, (c, o) => f1(o.apresCompost[n]), '', (c, o) => o.excedent[n] ? 'neg' : '')).join('')}
      ${NUTR.map((n) => calc(`À apporter ${n} kg`, (c, o) => fmtNum(o.total[n] / 1000, 2), fmtNum(T.total[n] / 1000, 2))).join('')}
      ${engr.map((e) => calc(`${esc(e.nom)} kg`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kg : 0, 1), fmtNum(T.engrais[e.k] || 0, 1))).join('')}
      ${engr.map((e) => calc(`${esc(e.nom)} kg/planche`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kgParPlanche : 0, 2))).join('')}
    </tbody></table></div>
    <div class="row"><button class="btn small" type="button" data-act="cuToutes" data-v="ouvrir">Tout ouvrir</button><button class="btn small" type="button" data-act="cuToutes" data-v="fermer">Tout fermer</button></div>`;

    /* ---- Planning de la saison (semaines) ---- */
    const y = Number(s), wk = (d) => { const w = semaineISO(d); return w.annee < y ? 1 : w.annee > y ? 53 : w.semaine; };
    const moisCols = MOIS_COURT.map((m, i) => [m, wk(`${y}-${String(i + 1).padStart(2, '0')}-01`)]);
    const todayW = String(new Date().getFullYear()) === s ? semaineISO(todayISO()).semaine : 0;
    const gantt = `<div class="gantt"><div class="g-head"><span></span><span class="g-weeks">${moisCols.map(([m, w], i) => `<span style="grid-column:${w} / ${i < 11 ? moisCols[i + 1][1] : 54}">${m}</span>`).join('')}</span></div>
      ${list.map((c, i) => { const p = periodeCulture(c); if (!p) return `<div class="g-row"><span class="g-name"><span class="sw" style="background:${coul[i]}"></span><span>${esc(c.nom)}</span></span><span class="hint">Semaines à remplir</span></div>`;
        const a = wk(p.debut), b = wk(p.fin), r = p.recolteDebut ? wk(p.recolteDebut) : null;
        return `<div class="g-row"><span class="g-name"><span class="sw" style="background:${coul[i]}"></span><span>${esc(c.nom)}</span></span><span class="g-weeks g-track">
          ${!r || r > a ? `<span class="g-bar" style="grid-column:${a} / ${r ? r : b + 1};background:${coul[i]}22;border-color:${coul[i]};color:${coul[i]}">${r && r - a > 3 ? 'en place' : ''}</span>` : ''}
          ${r ? `<span class="g-bar harvest" style="grid-column:${r} / ${b + 1};background:${coul[i]}">${b - r >= 2 ? 'récolte' : ''}</span>` : ''}
          ${todayW ? `<span class="g-today" style="grid-column:${todayW}"></span>` : ''}</span></div>`; }).join('')}</div>`;
    /* ---- Planches ---- */
    const blocks = list.map((c, i) => Array.from({ length: Math.min(200, Math.round(num(c.planches))) }, () => `<span class="blk" style="background:${coul[i]}" title="${esc(c.nom)}"></span>`).join('')).join('');
    const legend = list.map((c, i) => `<span><i style="background:${coul[i]}"></i>${esc(c.nom)} · ${f0(c.planches)} pl. · ${Math.round(T.surface ? os[i].surface / T.surface * 100 : 0)} %</span>`).join('');
    /* ---- Récolte et ventes ---- */
    const maxK = Math.max(1, ...os.map((o, i) => Math.max(o.recolte, num(eff[i].recolteReelle))));
    const maxV = Math.max(1, ...os.map((o) => o.ventesDirect));
    const bars = `<div class="bars">${list.map((c, i) => `<div class="bar-row"><span>${esc(c.nom)}</span><span class="bar-track" style="position:relative"><span class="bar-fill" style="width:${(os[i].recolte / maxK * 100).toFixed(1)}%;background:${coul[i]}44"></span>${num(eff[i].recolteReelle) ? `<span class="bar-fill" style="position:absolute;top:0;left:0;height:100%;width:${(num(eff[i].recolteReelle) / maxK * 100).toFixed(1)}%;background:${coul[i]}"></span>` : ''}</span><span class="num">${num(eff[i].recolteReelle) ? f0(eff[i].recolteReelle) + ' / ' : ''}${f0(os[i].recolte)} kg</span></div>`).join('')}</div>`;
    const ventes = `<div class="bars">${list.map((c, i) => `<div class="bar-row"><span>${esc(c.nom)}</span><span class="bar-track"><span class="bar-fill" style="width:${(os[i].ventesDirect / maxV * 100).toFixed(1)}%;background:${coul[i]}"></span></span><span class="num">${f0(os[i].ventesDirect)}</span></div>`).join('')}</div>`;

    return `${head}
      <div class="stats">
        <div class="stat good"><span class="k">Surface cultivée</span><span class="v">${f0(T.surface)} m²</span><span class="s">${list.reduce((a, c) => a + num(c.planches), 0)} planches de ${fmtNum(P.longueur, 1)} m</span></div>
        <div class="stat"><span class="k">Récolte prévue</span><span class="v">${f0(T.recolte)} kg</span><span class="s">${T.recolteReelle ? 'Réelle : ' + f0(T.recolteReelle) + ' kg' : 'Récolte réelle à saisir'}</span></div>
        <div class="stat good"><span class="k">Ventes directes prévues</span><span class="v">${chf(T.ventesDirect)}</span></div>
        <div class="stat blue"><span class="k">Ventes revendeur prévues</span><span class="v">${chf(T.ventesRevendeur)}</span></div>
        <div class="stat"><span class="k">Plantons</span><span class="v">${f0(T.plantons)}</span></div>
        <div class="stat"><span class="k">Compost</span><span class="v">${fmtNum(T.compostM3, 1)} m³</span></div>
      </div>
      <div class="panel"><h2>Planning ${s}</h2>${gantt}<p class="hint">Clair : en place depuis la plantation · foncé : semaines de récolte. Le trait rouge marque cette semaine. Ces périodes apparaissent aussi dans le calendrier.</p></div>
      <div class="split">
        <div class="panel"><h2>Planches</h2><div class="blocks">${blocks}</div><div class="legend">${legend}</div></div>
        <div class="panel"><h2>Récolte prévue et réelle (kg)</h2>${bars}<h2 style="margin-top:8px">Ventes directes prévues (CHF)</h2>${ventes}</div>
      </div>
      <div class="panel"><h2>Plan ${s}</h2>
        <p class="hint">Les cases blanches se modifient directement : tape la valeur, elle est enregistrée dès que tu quittes la case. Les lignes grisées sont calculées. Touche le nom d'une culture pour sa couleur, sa remarque ou pour la supprimer. Récolte réelle vide : somme des récoltes notées au calendrier (« cal. »).</p>
        ${table}
        <p class="hint">Surface = planches × longueur × ${fmtNum(P.facteurSurface, 2)} (passe-pieds). Plantons = longueur ÷ interplant × lignes × planches. Prix revendeur vide : ${Math.round(num(P.partRevendeur) * 100)} % du prix direct. Le compost couvre ${Math.round(num(P.dispoCompost) * 100)} % de sa teneur la première année ; un excédent (en gris) compte pour 0. Engrais par planche : à vérifier avec vos calculs.</p></div>`;
  },
  after() {
    $('view').querySelectorAll('input.cell-in').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.cu, f = el.dataset.f, c = DB.get(k); if (!c) return;
      const TXT = ['semPlantation', 'semRecolte', 'variete', 'fournisseur'], NULLABLE = ['longueur', 'prixRevendeur', 'recolteReelle'];
      const raw = el.value.trim();
      let v;
      if (TXT.includes(f)) v = raw;
      else if (raw === '') v = NULLABLE.includes(f) || f.startsWith('correction.') ? null : 0;
      else { v = num(raw); if (!isFinite(v) || v < 0) { toast('Valeur invalide.'); el.value = ''; return; } }
      if ((f === 'semPlantation' || f === 'semRecolte') && raw && !parseSemaines(raw)) toast('Semaine non reconnue : écris par ex. 20 ou 40-46.');
      const o = JSON.parse(JSON.stringify(c));
      if (f.includes('.')) { const [a, b] = f.split('.'); o[a] = Object.assign({}, o[a] || {}); o[a][b] = v == null ? (a === 'correction' ? 1 : 0) : v; } else o[f] = v;
      DB.put(k, o);
      renderGardeFocus();
    }));
  },
};
ACTIONS.cuSaison = (el) => { CU.saison = el.dataset.s; render(); };
function cuSave() { ls.set('gdt-cu-fermes', JSON.stringify(CU.fermes)); render(); }
ACTIONS.cuToggle = (el) => { const g = el.dataset.g; CU.fermes = CU.fermes.includes(g) ? CU.fermes.filter((x) => x !== g) : CU.fermes.concat([g]); cuSave(); };
ACTIONS.cuToutes = (el) => { CU.fermes = el.dataset.v === 'fermer' ? ['surface', 'r-colte-et-ventes', 'plantation', 'fumure'] : []; cuSave(); };
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.grp[data-act]')) { e.preventDefault(); e.target.click(); } });

ACTIONS.cuEdit = (el) => {
  const k = el.dataset.key || '', s = saisonCourante();
  const c = k ? DB.get(k) : { saison: s, lignes: 1, besoins: {}, correction: {}, ordre: cultures(s).length + 1 };
  const b = c.besoins || {}, co = c.correction || {};
  const n = (id, label, val, step, name) => inp(id, label, val ?? '', { name: name || id.slice(3), type: 'number', attrs: { step: step || 'any', inputmode: 'decimal' } });
  openSheet(`${sheetHead(k ? c.nom : 'Nouvelle culture', 'Saison ' + (c.saison || s))}<form class="sbody form" data-form="cu"><input type="hidden" name="key" value="${esc(k)}"><input type="hidden" name="saison" value="${esc(c.saison || s)}">
    <div class="grid2">${inp('cu-nom', 'Culture', c.nom, { name: 'nom', req: true })}${n('cu-ordre', 'Ordre d\'affichage', c.ordre, '1')}</div>
    <div class="field"><span class="flabel">Couleur</span><div class="seg">${CULT_PALETTE.map((x) => `<label style="--c:${x}"><input type="radio" name="couleur" value="${x}"${(c.couleur || couleurCulture(c, (c.ordre || 1) - 1)) === x ? ' checked' : ''}> <span class="blk" style="background:${x};width:18px;height:18px"></span></label>`).join('')}</div></div>
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
  const o = Object.assign({}, old, { saison: v.saison, nom: v.nom, couleur: v.couleur || old.couleur || '', variete: v.variete, fournisseur: v.fournisseur, semPlantation: v.semPlantation, semRecolte: v.semRecolte, remarque: v.remarque });
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
