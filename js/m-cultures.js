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
  render(sub, id) {
    creerFichesManquantes();
    const t = tabs('cultures', [['', 'Plan de culture'], ['fiches', `Nos cultures · ${fiches().length}`]], sub);
    if (sub === 'fiches') return t + renderFiches(id);
    return t + renderPlan();
  },
  after(sub) { if (sub !== 'fiches') brancherPlan(); },
};
function renderPlan() {
  {
    const s = saisonCourante(), ss = saisons(), list = cultures(s), P = paramsCultures(s);
    const chips = ss.map((x) => `<button class="chip${x === s ? ' on' : ''}" type="button" data-act="cuSaison" data-s="${x}">${x}</button>`).join('');
    const head = `<div class="between"><div class="row">${chips}</div><div class="row"><button class="btn small" type="button" data-act="cuParams">Hypothèses</button><button class="btn small" type="button" data-act="cuDupliquer">Préparer ${Number(s) + 1}</button><button class="btn primary small" type="button" data-act="cuAjouter">+ Culture</button></div></div>`;
    if (!list.length) return head + '<div class="panel"><p class="empty">Aucune culture dans ce plan. Ajoute la première avec « + Culture » : tu peux la choisir dans « Nos cultures », avec ses données des années passées.</p></div>';
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
    /* Ligne venant de la fiche (Nos cultures) : affichée, se modifie dans la fiche */
    const fic = (label, f, o = {}) => `<tr class="fic"><td>${label}</td>${list.map((c, i) => { const v = get(c, f); const shown = o.fmt ? o.fmt(v, c, os[i]) : v == null || v === '' ? '—' : String(v).replace('.', ','); return `<td><button type="button" class="fic-cell" data-act="ficheEdit" data-key="${esc(ficheDe(c))}" title="Modifier dans la fiche ${esc(c.nom)}">${esc(shown)}</button></td>`; }).join('')}<td class="num tot">${o.tot ?? ''}</td></tr>`;
    const engr = (P.engrais || []);
    const table = `<div class="table-wrap"><table class="matrix"><thead><tr><th></th>${list.map((c, i) => `<th><button type="button" data-act="cuEdit" data-key="${esc(c.key)}"><span class="sw" style="background:${coul[i]}"></span>${esc(c.nom)}</button></th>`).join('')}<th>Total</th></tr></thead>
      ${grp('Surface', 4)}
      ${edit('Planches', 'planches', { tot: f0(list.reduce((a, c) => a + num(c.planches), 0)) })}
      ${edit('Longueur de planche m', 'longueur', { ph: () => String(P.longueur).replace('.', ',') })}
      ${calc('Surface m²', (c, o) => f1(o.surface), f1(T.surface))}
      ${calc('Part de la surface', (c, o) => T.surface ? Math.round(o.surface / T.surface * 100) + ' %' : '—', '100 %')}
      ${grp('Récolte et ventes', 9)}
      ${fic('Rendement kg/m²', 'rendement')}
      ${calc('Récolte prévue kg', (c, o) => f0(o.recolte), f0(T.recolte))}
      ${edit('Récolte réelle kg', 'recolteReelle', { ph: (c) => { const k = recolteNotee(c.key); return k ? f0(k) + ' cal.' : ''; }, tot: T.recolteReelle ? f0(T.recolteReelle) : '—' })}
      ${fic('Prix direct CHF/kg', 'prixDirect', { fmt: (v) => (v ? money(v) : '—') })}
      ${calc('Ventes directes CHF', (c, o) => f0(o.ventesDirect), f0(T.ventesDirect))}
      ${calc('CHF/m² direct', (c, o) => money(o.chfM2Direct))}
      ${fic('Prix revendeur CHF/kg', 'prixRevendeur', { fmt: (v, c, o) => (v == null || v === '' ? money(o.prixRevendeur) + ' auto' : money(v)) })}
      ${calc('Ventes revendeur CHF', (c, o) => f0(o.ventesRevendeur), f0(T.ventesRevendeur))}
      ${calc('CHF/m² revendeur', (c, o) => money(o.chfM2Revendeur))}
      ${grp('Plantation', 7)}
      ${fic('Semaine de plantation', 'semPlantation')}
      ${fic('Semaines de récolte', 'semRecolte')}
      ${fic('Lignes par planche', 'lignes')}
      ${fic('Interplant cm', 'interplant')}
      ${calc('Plantons', (c, o) => f0(o.plantons), f0(T.plantons))}
      ${fic('Variété', 'variete')}
      ${fic('Fournisseur', 'fournisseur')}
      ${grp('Fumure', 18 + 2 * engr.length)}
      ${NUTR.map((n) => fic(`Besoin brut ${n} g/m²`, 'besoins.' + n)).join('')}
      ${NUTR.map((n) => calc(`Besoin net ${n} g/m²`, (c, o) => f1(o.net[n]))).join('')}
      ${fic('Compost L/m²', 'compost')}
      ${calc('Compost L/planche', (c, o) => f0(o.compostLParPlanche))}
      ${calc('Compost m³', (c, o) => fmtNum(o.compostM3, 2), fmtNum(T.compostM3, 2))}
      ${NUTR.map((n) => calc(`Reste ${n} après compost g/m²`, (c, o) => f1(o.apresCompost[n]), '', (c, o) => o.excedent[n] ? 'neg' : '')).join('')}
      ${NUTR.map((n) => calc(`À apporter ${n} kg`, (c, o) => fmtNum(o.total[n] / 1000, 2), fmtNum(T.total[n] / 1000, 2))).join('')}
      ${engr.map((e) => calc(`${esc(e.nom)} kg`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kg : 0, 1), fmtNum(T.engrais[e.k] || 0, 1))).join('')}
      ${engr.map((e) => calc(`${esc(e.nom)} kg/planche`, (c, o) => fmtNum(o.engrais[e.k] ? o.engrais[e.k].kgParPlanche : 0, 2))).join('')}
      ${NUTR.filter((n) => T.nonCouvert[n] > 0.5).map((n) => calc(`${n} non couvert par les engrais kg`, (c, o) => (o.nonCouvert[n] > 0.5 ? fmtNum(o.nonCouvert[n] / 1000, 2) : '—'), fmtNum(T.nonCouvert[n] / 1000, 2), (c, o) => (o.nonCouvert[n] > 0.5 ? 'neg' : ''))).join('')}
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
      <div class="panel"><h2>Planning ${s}</h2>${gantt}<p class="hint">Clair : en place depuis la plantation · foncé : semaines de récolte. Le trait rouge marque cette semaine.</p></div>
      <div class="split">
        <div class="panel"><h2>Planches</h2><div class="blocks">${blocks}</div><div class="legend">${legend}</div></div>
        <div class="panel"><h2>Récolte prévue et réelle (kg)</h2>${bars}<h2 style="margin-top:8px">Ventes directes prévues (CHF)</h2>${ventes}</div>
      </div>
      <div class="panel"><h2>Fumure ${s} : à apporter</h2>
        <div class="table-wrap"><table class="list"><thead><tr><th>Culture</th><th class="r">Planches</th><th class="r">Compost L/planche</th>${engr.map((e) => `<th class="r">${esc(e.nom)} kg/planche</th>`).join('')}${engr.map((e) => `<th class="r">${esc(e.nom)} kg</th>`).join('')}</tr></thead><tbody>
          ${list.map((c, i) => `<tr><td style="white-space:nowrap"><span class="sw" style="background:${coul[i]}"></span>${esc(c.nom)}</td><td class="r num">${f0(c.planches)}</td><td class="r num">${f0(os[i].compostLParPlanche)}</td>${engr.map((e) => `<td class="r num">${fmtNum((os[i].engrais[e.k] || {}).kgParPlanche || 0, 2)}</td>`).join('')}${engr.map((e) => `<td class="r num">${fmtNum((os[i].engrais[e.k] || {}).kg || 0, 1)}</td>`).join('')}</tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="r num">${f0(list.reduce((a, c) => a + num(c.planches), 0))}</td><td class="r num">${fmtNum(T.compostM3, 1)} m³</td>${engr.map(() => '<td></td>').join('')}${engr.map((e) => `<td class="r num">${fmtNum(T.engrais[e.k] || 0, 1)}</td>`).join('')}</tr></tfoot></table></div>
        ${NUTR.filter((n) => T.nonCouvert[n] > 0.5).length ? `<p class="banner">Pas couvert par vos engrais : ${NUTR.filter((n) => T.nonCouvert[n] > 0.5).map((n) => `${n} ${fmtNum(T.nonCouvert[n] / 1000, 1)} kg`).join(', ')}. Ajoute un engrais qui en contient dans les hypothèses, ou augmente le compost.</p>` : ''}
        <p class="hint">Une planche = ${fmtNum(P.longueur, 1)} m × ${fmtNum(P.facteurSurface, 2)} m (avec le passe-pied) = ${fmtNum(num(P.longueur) * num(P.facteurSurface), 1)} m². Besoin brut × correction du sol − compost (${Math.round(num(P.dispoCompost) * 100)} % disponible la 1re année) = reste à couvrir par les engrais, dans l'ordre de la liste des hypothèses.</p></div>
      <div class="panel"><h2>Plan ${s}</h2>
        <p class="hint">Cases blanches : propres à cette saison (planches, longueur, récolte réelle), elles se modifient directement. Lignes vertes : données de la culture, qui viennent de « Nos cultures » ; touche une case pour modifier la fiche. Lignes grisées : calculées. Touche le nom d'une culture pour ses réglages de saison ou pour la retirer du plan. Récolte réelle vide : somme des récoltes notées au calendrier (« cal. »).</p>
        ${table}
        <p class="hint">Surface = planches × longueur × largeur avec passe-pied (${fmtNum(P.facteurSurface, 2)} m). Plantons = longueur ÷ interplant × lignes × planches. Prix revendeur vide : ${Math.round(num(P.partRevendeur) * 100)} % du prix direct. Corrections d'analyse de sol (hypothèses) : ${NUTR.map((n) => n + ' ' + fmtNum((P.correction || {})[n] ?? 1, 2)).join(', ')}. Le compost couvre ${Math.round(num(P.dispoCompost) * 100)} % de sa teneur la première année ; un excédent (en gris) compte pour 0. Chaque engrais couvre le reste de son nutriment principal ; ce qu'il apporte en plus (ex. Mg) est déduit des autres.</p></div>`;
  }
}
function brancherPlan() {
  {
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
  }
}
ACTIONS.cuSaison = (el) => { CU.saison = el.dataset.s; render(); };
function cuSave() { ls.set('gdt-cu-fermes', JSON.stringify(CU.fermes)); render(); }
ACTIONS.cuToggle = (el) => { const g = el.dataset.g; CU.fermes = CU.fermes.includes(g) ? CU.fermes.filter((x) => x !== g) : CU.fermes.concat([g]); cuSave(); };
ACTIONS.cuToutes = (el) => { CU.fermes = el.dataset.v === 'fermer' ? ['surface', 'r-colte-et-ventes', 'plantation', 'fumure'] : []; cuSave(); };
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.grp[data-act]')) { e.preventDefault(); e.target.click(); } });

/* Réglages d'une culture pour la saison : planches, longueur, récolte réelle, ordre, remarque. Le reste est dans sa fiche. */
ACTIONS.cuEdit = (el) => {
  const k = el.dataset.key || ''; if (!k || !DB.get(k)) { ACTIONS.cuAjouter(el); return; }
  const c = DB.get(k), fk = ficheDe(c), n = (id, label, val, step) => inp(id, label, val ?? '', { name: id.slice(3), type: 'number', attrs: { step: step || 'any', inputmode: 'decimal' } });
  openSheet(`${sheetHead(c.nom, 'Saison ' + c.saison)}<form class="sbody form" data-form="cu"><input type="hidden" name="key" value="${esc(k)}">
    <div class="grid2">${n('cu-planches', 'Planches', c.planches, '1')}${n('cu-longueur', 'Longueur de planche m', c.longueur)}${n('cu-recolteReelle', 'Récolte réelle kg', c.recolteReelle)}${n('cu-ordre', "Ordre d'affichage", c.ordre, '1')}</div>
    <p class="hint">Longueur vide : celle des hypothèses (${fmtNum(paramsCultures(c.saison).longueur, 1)} m). Récolte réelle vide : les récoltes notées au calendrier.</p>
    ${txt('cu-rem', 'Remarque pour cette saison', c.remarque, { name: 'remarque' })}
    <p class="hint">Rendement, prix, semaines, espacements, variété, fumure : dans la fiche de la culture. <a href="#/cultures/fiches/${encodeURIComponent(fk)}" data-act="go" data-href="#/cultures/fiches/${encodeURIComponent(fk)}">Ouvrir la fiche ${esc(c.nom)}</a></p>
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette culture du plan ${esc(c.saison)} (sa fiche reste)">Retirer du plan</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.cu = (v) => {
  const k = v.key, old = DB.get(k); if (!old) return;
  const o = Object.assign({}, old, { remarque: v.remarque });
  o.planches = num(v.planches); o.ordre = num(v.ordre) || old.ordre || 1;
  for (const f of ['longueur', 'recolteReelle']) o[f] = v[f] === '' ? null : num(v[f]);
  DB.put(k, o); closeSheet(); toast('Culture mise à jour.');
};
ACTIONS.cuParams = () => {
  const s = saisonCourante(), P = paramsCultures(s);
  const n = (id, label, val, name, sub) => inp(id, label, val ?? '', { name, type: 'number', attrs: { step: 'any', inputmode: 'decimal' }, sub });
  openSheet(`${sheetHead('Hypothèses ' + s)}<form class="sbody form" data-form="cuParams"><input type="hidden" name="saison" value="${esc(s)}">
    <div class="grid2">${n('cp-l', 'Longueur de planche m', P.longueur, 'longueur')}${n('cp-f', 'Largeur planche + passe-pied m', P.facteurSurface, 'facteurSurface', `Une planche = longueur × largeur = ${fmtNum(num(P.longueur) * num(P.facteurSurface), 1)} m²`)}
      ${n('cp-r', 'Prix revendeur (part du direct)', P.partRevendeur, 'partRevendeur', '0,6 = 60 %')}${n('cp-d', 'Compost disponible 1re année', r2(P.dispoCompost * 1000) / 1000, 'dispoCompost', '0,333 = un tiers')}</div>
    <h3>Corrections d'analyse de sol</h3>
    <p class="hint">Liées au champ : multiplient les besoins de toutes les cultures (1 = pas de correction, 0,8 = −20 %).</p>
    <div class="grid2">${NUTR.map((x) => n('cp-c' + x, x, (P.correction || {})[x] ?? 1, 'c_' + x)).join('')}</div>
    <h3>Teneur du compost (g/L)</h3>
    <div class="grid2">${NUTR.map((x) => n('cp-t' + x, x, P.teneurCompost[x], 't_' + x)).join('')}</div>
    <h3>Engrais</h3>
    <p class="hint">Dans l'ordre d'utilisation. Teneurs en fraction : 0,14 = 14 %. Le nutriment principal décide de la dose ; les autres teneurs sont déduites des besoins restants. Utilise les mêmes unités que les besoins (par ex. K₂O ou K). Nom vide = engrais retiré.</p>
    ${(P.engrais || []).concat([{ k: '', nom: '', nutriment: 'P' }]).map((e, i) => { const t = teneursEngrais(e); return `<div class="engr-row${e.k ? '' : ' nouveau'}"><input type="hidden" name="ek_${i}" value="${esc(e.k)}">
      <div class="grid2">${inp('cp-en' + i, e.k ? 'Engrais' : 'Nouvel engrais', e.nom, { name: 'en_' + i, attrs: e.k ? {} : { placeholder: 'ex. Phosphate naturel' } })}${sel('cp-nu' + i, 'Nutriment principal', e.nutriment, NUTR.map((x) => [x, x]), { name: 'nu_' + i })}</div>
      <div class="grid4">${NUTR.map((x) => n('cp-t' + x + i, x, t[x] ?? '', 'tn_' + x + '_' + i)).join('')}</div></div>`; }).join('')}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.cuParams = (v) => {
  const P = paramsCultures(v.saison);
  const o = { longueur: num(v.longueur) || 19, facteurSurface: num(v.facteurSurface) || 1, partRevendeur: num(v.partRevendeur), dispoCompost: Math.abs(num(v.dispoCompost) - r2(P.dispoCompost * 1000) / 1000) < 1e-9 ? P.dispoCompost : num(v.dispoCompost), teneurCompost: {}, engrais: [] };
  for (const x of NUTR) o.teneurCompost[x] = num(v['t_' + x]);
  o.correction = {}; for (const x of NUTR) o.correction[x] = v['c_' + x] === '' ? 1 : num(v['c_' + x]);
  for (let i = 0; ('en_' + i) in v; i++) {
    const nom = String(v['en_' + i] || '').trim(); if (!nom) continue;
    const teneurs = {}; for (const x of NUTR) if (v['tn_' + x + '_' + i] !== '' && v['tn_' + x + '_' + i] != null) teneurs[x] = num(v['tn_' + x + '_' + i]);
    const nu = v['nu_' + i] || 'N';
    let k = v['ek_' + i] || nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'engrais';
    while (o.engrais.some((x) => x.k === k)) k += '2';
    o.engrais.push({ k, nom, nutriment: nu, teneur: num(teneurs[nu]), teneurs });
  }
  DB.put('cfg:cultures:' + v.saison, o); closeSheet(); toast('Hypothèses enregistrées.');
};
ACTIONS.cuDupliquer = () => {
  const s = saisonCourante(), ns = String(Number(s) + 1);
  if (cultures(ns).length) { CU.saison = ns; render(); toast(`Le plan ${ns} existe déjà.`); return; }
  confirmSheet(`Préparer le plan ${ns} ?`, `Les ${cultures(s).length} cultures de ${s} sont placées dans un nouveau plan ${ns}, avec les mêmes planches et les données à jour de leurs fiches (sans les récoltes réelles). Le plan ${s} reste intact.`, 'cuDupOk', 'Créer le plan ' + ns, { s, ns });
};
ACTIONS.cuDupOk = (el) => {
  const { s, ns } = el.dataset;
  for (const c of cultures(s)) { const f = DB.get(ficheDe(c)); const o = Object.assign({}, c, f ? valeursFiche(f) : {}, { fiche: ficheDe(c) }); delete o.key; delete o.correction; o.saison = ns; o.recolteReelle = null; o.remarque = ''; DB.put('cul:' + uid('c'), o); }
  const P = DB.get('cfg:cultures:' + s); if (P) DB.put('cfg:cultures:' + ns, P);
  CU.saison = ns; closeSheet(); toast(`Plan ${ns} créé.`); render();
};


/* ================= Nos cultures : une fiche par culture, réutilisée d'une année à l'autre =================
   fiche:<nom> = { nom, couleur, rendement, prixDirect, prixRevendeur, semPlantation, semRecolte, lignes, interplant,
                   variete, fournisseur, besoins, compost, notes, saison (d'où viennent les données), majLe }
   Les cultures se créent ici ; le plan d'une saison les place (planches, longueur, récolte réelle, ordre, remarque) et garde une copie
   de leurs données. Modifier une fiche met à jour les plans de l'année en cours et des suivantes, jamais les plans passés.
   Les corrections d'analyse de sol sont liées au champ : elles sont dans les hypothèses de la saison. */
const FICHE_CHAMPS = ['couleur', 'rendement', 'prixDirect', 'prixRevendeur', 'semPlantation', 'semRecolte', 'lignes', 'interplant', 'variete', 'fournisseur', 'besoins', 'compost'];
const fiches = () => DB.all('fiche:').sort((a, b) => String(a.nom).localeCompare(b.nom, 'fr'));
const cleFiche = (nom) => 'fiche:' + (String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'culture');
function valeursFiche(f) { const o = { nom: f.nom }; for (const k of FICHE_CHAMPS) if (f[k] !== undefined) o[k] = JSON.parse(JSON.stringify(f[k])); return o; }
function ficheDe(c) { return (c.fiche && DB.get(c.fiche)) ? c.fiche : cleFiche(c.nom); }
function majFiche(c) {
  if (!c || !c.nom) return;
  const k = ficheDe(c), old = DB.get(k);
  if (old && old.saison && String(c.saison) < String(old.saison)) return; /* un vieux plan n'écrase pas des données plus récentes */
  const o = Object.assign({}, old || { nom: c.nom, cree: new Date().toISOString() }, { nom: old ? old.nom : c.nom, saison: String(c.saison || ''), majLe: todayISO() });
  for (const f of FICHE_CHAMPS) if (c[f] !== undefined && c[f] !== null && c[f] !== '') o[f] = JSON.parse(JSON.stringify(c[f]));
  DB.put(k, o);
  if (c.key && c.fiche !== k) { const cc = DB.get(c.key); if (cc && cc.fiche !== k) DB.put(c.key, Object.assign({}, cc, { fiche: k })); }
}
/* Au premier passage : une fiche pour chaque culture déjà dans les plans (en partant des plus anciens, le plus récent gagne) */
function creerFichesManquantes() {
  const dernier = {};
  for (const c of DB.all('cul:')) { const k = ficheDe(c); if (!dernier[k] || String(c.saison) > String(dernier[k].saison)) dernier[k] = c; }
  for (const [k, c] of Object.entries(dernier)) if (!DB.get(k) && !(k in DB.trash)) majFiche(c);
}
/* Historique d'une fiche : ce que la culture a donné chaque saison */
function historiqueFiche(k) {
  const f = DB.get(k) || {};
  return DB.all('cul:').filter((c) => ficheDe(c) === k).sort((a, b) => String(b.saison).localeCompare(String(a.saison))).map((c) => {
    const P = paramsCultures(c.saison), reel = c.recolteReelle == null || c.recolteReelle === '' ? recolteNotee(c.key) : num(c.recolteReelle);
    const o = culture(Object.assign({}, c, { recolteReelle: reel }), P);
    return { saison: c.saison, planches: num(c.planches), surface: o.surface, prevu: o.recolte, reel, rdtReel: reel && o.surface ? reel / o.surface : 0, rdtPrevu: num(c.rendement) };
  });
}
function renderFiches(id) {
  const l = fiches(), s = saisonCourante(), dans = new Set(cultures(s).map((c) => ficheDe(c)));
  const sel = id && DB.get(id) ? Object.assign({ key: id }, DB.get(id)) : null;
  const ligne = (f, i) => `<a class="item${sel && sel.key === f.key ? ' sel' : ''}" href="#/cultures/fiches/${encodeURIComponent(f.key)}"><span class="who"><strong><span class="sw" style="background:${f.couleur || CULT_PALETTE[i % CULT_PALETTE.length]}"></span>${esc(f.nom)}</strong>
    <span class="meta">${[f.rendement ? fmtNum(f.rendement, 1) + ' kg/m²' : '', f.prixDirect ? money(f.prixDirect) + ' CHF/kg' : '', f.semPlantation ? 'plant. sem. ' + esc(f.semPlantation) : '', f.variete ? esc(f.variete) : ''].filter(Boolean).join(' · ') || 'Données à compléter'}</span></span>
    ${dans.has(f.key) ? `<span class="tpill">plan ${esc(s)}</span>` : ''}</a>`;
  let droite = '<div class="panel"><p class="hint">Choisis une culture pour voir sa fiche et ce qu\'elle a donné chaque saison.</p></div>';
  if (sel) {
    const h = historiqueFiche(sel.key), b = sel.besoins || {};
    const v = (x, u) => (x == null || x === '' ? '—' : esc(typeof x === 'number' ? fmtNum(x, 2).replace(/[.,]00$/, '') : x) + (u ? ' ' + u : ''));
    droite = `<div class="panel"><div class="between"><h2><span class="sw" style="background:${sel.couleur || '#999'}"></span>${esc(sel.nom)}</h2>
        <div class="row">${!dans.has(sel.key) ? `<button class="btn primary small" type="button" data-act="cuAjouter" data-fiche="${esc(sel.key)}">Ajouter au plan ${esc(s)}</button>` : ''}<button class="btn small" type="button" data-act="ficheEdit" data-key="${esc(sel.key)}">Modifier</button></div></div>
      <table class="list"><tbody>
        <tr><td>Rendement</td><td class="r">${v(sel.rendement, 'kg/m²')}</td></tr>
        <tr><td>Prix direct / revendeur</td><td class="r">${v(sel.prixDirect, 'CHF/kg')} / ${sel.prixRevendeur == null || sel.prixRevendeur === '' ? 'auto' : v(sel.prixRevendeur, 'CHF/kg')}</td></tr>
        <tr><td>Semaine de plantation · de récolte</td><td class="r">${v(sel.semPlantation)} · ${v(sel.semRecolte)}</td></tr>
        <tr><td>Lignes par planche · interplant</td><td class="r">${v(sel.lignes)} · ${v(sel.interplant, 'cm')}</td></tr>
        <tr><td>Variété · fournisseur</td><td class="r">${v(sel.variete)} · ${v(sel.fournisseur)}</td></tr>
        <tr><td>Besoins N / P / K / Mg (g/m²)</td><td class="r">${NUTR.map((x) => v(b[x])).join(' / ')}</td></tr>
        <tr><td>Compost</td><td class="r">${v(sel.compost, 'L/m²')}</td></tr>
      </tbody></table>
      ${sel.notes ? `<h3>Notes</h3><p style="white-space:pre-wrap">${esc(sel.notes)}</p>` : ''}
      <p class="hint">Données de la saison ${esc(sel.saison || '—')}${sel.majLe ? ', mises à jour le ' + fmtDate(sel.majLe) : ''}.</p>
      <h3>Saison après saison</h3>
      ${h.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Saison</th><th class="r">Planches</th><th class="r">Surface m²</th><th class="r">Prévu kg</th><th class="r">Réel kg</th><th class="r">Rendement réel</th></tr></thead><tbody>
        ${h.map((x) => `<tr><td>${esc(x.saison)}</td><td class="r num">${f0(x.planches)}</td><td class="r num">${f1(x.surface)}</td><td class="r num">${f0(x.prevu)}</td><td class="r num">${x.reel ? f0(x.reel) : '—'}</td><td class="r num">${x.rdtReel ? fmtNum(x.rdtReel, 2) + ' kg/m²' : '—'}${x.rdtReel && x.rdtPrevu ? ` <span class="hint">(prévu ${fmtNum(x.rdtPrevu, 1)})</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="hint">Pas encore cultivée dans un plan.</p>'}
    </div>`;
  }
  return `<div class="split"><div class="panel"><div class="between"><h2>Nos cultures</h2><button class="btn primary small" type="button" data-act="ficheEdit">+ Fiche</button></div>
      <p class="hint">Chaque culture se crée ici, avec ses données. Dans le plan de culture, on la place et on indique ses planches pour la saison.</p>
      ${l.length ? `<div class="items">${l.map(ligne).join('')}</div>` : '<p class="empty">Aucune fiche pour l\'instant.</p>'}</div>
    <div id="ct-right">${droite}</div></div>`;
}
/* « + Culture » : on choisit une culture de « Nos cultures » et on la place dans le plan */
ACTIONS.cuAjouter = (el) => {
  creerFichesManquantes(); const choisie = (el && el.dataset && el.dataset.fiche) || '';
  const s = saisonCourante(), dans = new Set(cultures(s).map((c) => ficheDe(c))), dispo = fiches().filter((f) => !dans.has(f.key));
  if (!dispo.length) {
    openSheet(`${sheetHead('Ajouter une culture', 'Plan ' + s)}<div class="sbody"><p>${fiches().length ? 'Toutes vos cultures sont déjà dans ce plan.' : "Vous n'avez pas encore de culture."} Crée d'abord la culture dans « Nos cultures », puis place-la ici.</p>
      <div class="row-end"><button class="btn primary" type="button" data-act="ficheNouvelle">Créer une culture</button></div></div>`);
    return;
  }
  const n = (id, label, val, step) => inp(id, label, val ?? '', { name: id.slice(3), type: 'number', attrs: { step: step || 'any', inputmode: 'decimal' } });
  openSheet(`${sheetHead('Ajouter une culture', 'Plan ' + s)}<form class="sbody form" data-form="cuPlacer"><input type="hidden" name="saison" value="${esc(s)}">
    ${sel('cu-fiche', 'Culture', choisie, [['', 'Choisir…']].concat(dispo.map((f) => [f.key, f.nom])), { name: 'fiche' })}
    <div class="grid2">${n('cu-planches', 'Planches', '', '1')}${n('cu-longueur', 'Longueur de planche m', '')}</div>
    <p class="hint">Rendement, prix, semaines, espacements et fumure viennent de la fiche. Longueur vide : celle des hypothèses (${fmtNum(paramsCultures(s).longueur, 1)} m).
      Culture absente de la liste ? <a href="#" data-act="ficheNouvelle">Crée-la dans « Nos cultures »</a>.</p>
    <div class="row-end"><button class="btn primary" type="submit">Placer dans le plan</button></div></form>`);
};
FORMS.cuPlacer = (v) => {
  const f = DB.get(v.fiche); if (!f) { toast('Choisis une culture dans la liste.'); return; }
  const s = v.saison;
  const o = Object.assign({ saison: s, fiche: v.fiche, ordre: cultures(s).length + 1, recolteReelle: null }, valeursFiche(f), { planches: num(v.planches), longueur: v.longueur === '' ? null : num(v.longueur) });
  DB.put('cul:' + uid('c'), o); closeSheet(); toast(`${f.nom} placé dans le plan ${s}.`);
};
ACTIONS.ficheNouvelle = () => { closeSheet(); go('#/cultures/fiches'); setTimeout(() => ACTIONS.ficheEdit({ dataset: {} }), 60); };
ACTIONS.ficheEdit = (el) => {
  const k = el.dataset.key || '', f = k ? DB.get(k) : { lignes: 1, besoins: {} }, b = f.besoins || {}, s = saisonCourante();
  const n = (id, label, val, name) => inp(id, label, val ?? '', { name, type: 'number', attrs: { step: 'any', inputmode: 'decimal' } });
  openSheet(`${sheetHead(k ? 'Fiche ' + f.nom : 'Nouvelle fiche de culture')}<form class="sbody form" data-form="fiche"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('fi-nom', 'Culture', f.nom, { name: 'nom', req: true })}
    <div class="field"><span class="flabel">Couleur</span><div class="seg">${CULT_PALETTE.map((x) => `<label style="--c:${x}"><input type="radio" name="couleur" value="${x}"${f.couleur === x ? ' checked' : ''}> <span class="blk" style="background:${x};width:18px;height:18px"></span></label>`).join('')}</div></div>
    <div class="grid2">${n('fi-r', 'Rendement kg/m²', f.rendement, 'rendement')}${n('fi-c', 'Compost L/m²', f.compost, 'compost')}
      ${n('fi-pd', 'Prix direct CHF/kg', f.prixDirect, 'prixDirect')}${n('fi-pr', 'Prix revendeur CHF/kg', f.prixRevendeur, 'prixRevendeur')}
      ${inp('fi-sp', 'Semaine de plantation', f.semPlantation, { name: 'semPlantation', attrs: { placeholder: 'ex. 20' } })}${inp('fi-sr', 'Semaines de récolte', f.semRecolte, { name: 'semRecolte', attrs: { placeholder: 'ex. 40-46' } })}
      ${n('fi-l', 'Lignes par planche', f.lignes, 'lignes')}${n('fi-i', 'Interplant cm', f.interplant, 'interplant')}
      ${inp('fi-v', 'Variété', f.variete, { name: 'variete' })}${inp('fi-f', 'Fournisseur', f.fournisseur, { name: 'fournisseur' })}</div>
    <div class="grid2">${NUTR.map((x) => n('fi-b' + x, 'Besoin brut ' + x + ' g/m²', b[x], 'b_' + x)).join('')}</div>
    ${txt('fi-notes', 'Notes de culture', f.notes, { name: 'notes', rows: 4 })}
    <p class="hint">Les notes restent dans la fiche (conseils, maladies, ce qui a marché…).</p>
    <p class="hint">Les plans de ${todayISO().slice(0, 4)} et des années suivantes prennent ces valeurs ; les plans passés gardent celles de leur saison.</p>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette fiche (les plans ne changent pas)">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.fiche = (v) => {
  if (!v.nom) { toast('Le nom est obligatoire.'); return; }
  const k = v.key || cleFiche(v.nom);
  if (!v.key && DB.get(k)) { toast('Une fiche porte déjà ce nom.'); return; }
  const old = DB.get(k) || { cree: new Date().toISOString() }, s = saisonCourante();
  const o = Object.assign({}, old, { nom: v.nom, couleur: v.couleur || old.couleur || CULT_PALETTE[fiches().length % CULT_PALETTE.length], semPlantation: v.semPlantation, semRecolte: v.semRecolte, variete: v.variete, fournisseur: v.fournisseur, notes: v.notes, majLe: todayISO(), saison: old.saison || s });
  for (const f of ['rendement', 'compost', 'prixDirect', 'lignes', 'interplant']) o[f] = num(v[f]);
  o.prixRevendeur = v.prixRevendeur === '' ? null : num(v.prixRevendeur);
  o.besoins = {}; for (const x of NUTR) o.besoins[x] = num(v['b_' + x]);
  DB.put(k, o);
  const an = todayISO().slice(0, 4);
  for (const c of DB.all('cul:')) if (ficheDe(c) === k && String(c.saison) >= an) DB.put(c.key, Object.assign({}, DB.get(c.key), valeursFiche(o), { fiche: k }));
  closeSheet(); toast('Fiche enregistrée.'); go('#/cultures/fiches/' + encodeURIComponent(k));
};
