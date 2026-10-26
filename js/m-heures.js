/* Gamins de Talus — heures de travail, jours off et remarques du calendrier. */
'use strict';

const heuresToutes = () => DB.all('h:');
const HEU = { lundi: '', annee: '' };
const hKey = (date, p) => `h:${date}:${p}`;

MODULES.heures = {
  titre: 'Heures',
  tuile() {
    const l = lundiDe(todayISO()), fin = addDays(l, 6);
    const t = totalHeures(heuresToutes(), (h) => h.date >= l && h.date <= fin);
    const parts = personnes().map((p) => `${p.nom} ${fmtH(t[p.k] || 0)} h`);
    return { line: 'Cette semaine : ' + parts.join(' · ') };
  },
  render(sub) {
    const t = tabs('heures', [['', 'Semaine'], ['bilan', 'Bilan']], sub);
    return t + (sub === 'bilan' ? renderBilanHeures() : renderSemaine());
  },
  after(sub) {
    if (sub === 'bilan') { const s = $('h-annee'); if (s) s.addEventListener('change', () => { HEU.annee = s.value; render(); }); return; }
    const v = $('view');
    v.querySelectorAll('input[data-h]').forEach((el) => el.addEventListener('change', () => {
      const [date, p] = el.dataset.h.split('|'); const k = hKey(date, p), old = DB.get(k) || { date, personne: p };
      const val = el.value.trim() === '' ? 0 : num(el.value);
      if (val < 0 || val > 24) { toast('Entre 0 et 24 heures.'); el.value = old.heures || ''; return; }
      const o = Object.assign({}, old, { heures: r2(val) });
      if (!o.heures && !o.off && !o.note) DB.del(k); else DB.put(k, o);
    }));
    v.querySelectorAll('input[data-jour]').forEach((el) => el.addEventListener('change', () => {
      const k = 'jour:' + el.dataset.jour, val = el.value.trim();
      if (!val) DB.del(k); else DB.put(k, { date: el.dataset.jour, remarque: val });
    }));
  },
};

function renderSemaine() {
  if (!HEU.lundi) HEU.lundi = lundiDe(todayISO());
  const l = HEU.lundi, ps = personnes(), today = todayISO(), w = semaineISO(l);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(l, i));
  const tot = {}; ps.forEach((p) => { tot[p.k] = 0; });
  const rows = jours.map((d, i) => {
    const cells = ps.map((p) => {
      const h = DB.get(hKey(d, p.k)) || {}; tot[p.k] += num(h.heures);
      return `<td><div class="hcell"><input type="text" inputmode="decimal" autocomplete="off" data-h="${d}|${p.k}" value="${h.heures ? esc(fmtH(h.heures)) : ''}" aria-label="Heures de ${esc(p.nom)} le ${fmtDate(d)}" placeholder="–">
        <button type="button" class="off${h.off ? ' on' : ''}" data-act="hOff" data-d="${d}" data-p="${p.k}" aria-pressed="${!!h.off}" title="Jour off">off</button></div></td>`;
    }).join('');
    const j = DB.get('jour:' + d) || {};
    const note = `<input class="note" data-jour="${d}" value="${esc(j.remarque || '')}" placeholder="Remarque…" aria-label="Remarque du ${fmtDate(d)}">`;
    return `<tr class="${d === today ? 'today' : ''} ${i >= 5 ? 'we' : ''}"><td class="day"><b>${JOURS[i]}</b><span>${fmtDateCourt(d)}</span></td>${cells}<td class="ncol">${note}</td></tr>
      <tr class="noteRow ${i >= 5 ? 'we' : ''}"><td colspan="${ps.length + 1}">${note}</td></tr>`;
  }).join('');
  const fin = addDays(l, 6);
  const mois = l.slice(0, 7), annee = l.slice(0, 4);
  const tm = totalHeures(heuresToutes(), (h) => h.date.slice(0, 7) === mois);
  const ty = totalHeures(heuresToutes(), (h) => h.date.slice(0, 4) === annee);
  return `<div class="panel">
    <div class="between"><div class="row"><button class="btn small" type="button" data-act="hWeek" data-n="-7" aria-label="Semaine précédente">←</button>
      <h2>Semaine ${w.semaine}</h2><button class="btn small" type="button" data-act="hWeek" data-n="7" aria-label="Semaine suivante">→</button></div>
      <div class="row"><span class="hint">${fmtDate(l)} – ${fmtDate(fin)}</span>${l !== lundiDe(today) ? '<button class="btn small" type="button" data-act="hWeek" data-n="0">Aujourd\'hui</button>' : ''}</div></div>
    <div class="table-wrap"><table class="week"><thead><tr><th>Jour</th>${ps.map((p) => `<th>${esc(p.nom)}</th>`).join('')}<th class="ncol">Remarque du jour</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td>${ps.map((p) => `<td>${fmtH(tot[p.k])} h</td>`).join('')}<td class="ncol"></td></tr></tfoot></table></div>
    <p class="hint">Saisis les heures en décimal : 7,5 = 7 h 30, 0,25 = un quart d'heure. Chaque saisie est enregistrée dès que tu quittes la case.</p></div>
    <div class="stats">${ps.map((p) => `<div class="stat good"><span class="k">${esc(p.nom)} · ${MOIS[Number(mois.slice(5)) - 1]}</span><span class="v">${fmtH(tm[p.k] || 0)} h</span><span class="s">${annee} : ${fmtH(ty[p.k] || 0)} h</span></div>`).join('')}</div>`;
}
ACTIONS.hWeek = (el) => { const n = Number(el.dataset.n); HEU.lundi = n === 0 ? lundiDe(todayISO()) : addDays(HEU.lundi || lundiDe(todayISO()), n); render(); };
ACTIONS.hOff = (el) => {
  const k = hKey(el.dataset.d, el.dataset.p), old = DB.get(k) || { date: el.dataset.d, personne: el.dataset.p };
  const o = Object.assign({}, old, { off: !old.off });
  if (!o.heures && !o.off && !o.note) DB.del(k); else DB.put(k, o);
};

function renderBilanHeures() {
  const all = heuresToutes(), ps = personnes();
  const ys = [...new Set(all.map((h) => yearOf(h.date)).concat([todayISO().slice(0, 4)]))].sort().reverse();
  const y = HEU.annee && ys.includes(HEU.annee) ? HEU.annee : ys[0];
  const inY = all.filter((h) => yearOf(h.date) === y);
  const ty = totalHeures(inY), total = Object.values(ty).reduce((a, b) => a + b, 0);
  const offs = {}; inY.forEach((h) => { if (h.off) offs[h.personne] = (offs[h.personne] || 0) + 1; });
  const parMois = MOIS.map((m, i) => { const mm = y + '-' + String(i + 1).padStart(2, '0'); return [m, totalHeures(inY, (h) => h.date.slice(0, 7) === mm)]; });
  const maxM = Math.max(1, ...parMois.map(([, t]) => Math.max(0, ...Object.values(t))));
  const b = bilanAnnee(y), obj = num(cfg().objectifAnnuel);
  const joursTrav = {}; inY.forEach((h) => { if (num(h.heures) > 0) joursTrav[h.personne] = (joursTrav[h.personne] || 0) + 1; });
  return `<div class="row">${sel('h-annee', 'Année', y, ys.map((x) => [x, x]))}</div>
    <div class="stats">
      ${ps.map((p, i) => `<div class="stat ${i ? 'blue' : 'good'}"><span class="k">${esc(p.nom)}</span><span class="v">${fmtH(ty[p.k] || 0)} h</span><span class="s">${joursTrav[p.k] || 0} jours travaillés · ${offs[p.k] || 0} jours off</span></div>`).join('')}
      <div class="stat"><span class="k">Total ${y}</span><span class="v">${fmtH(total)} h</span></div>
      <div class="stat"><span class="k">Résultat par heure</span><span class="v">${total ? chf(b.resultat / total) : '—'}</span><span class="s">Résultat ${y} : ${chf(b.resultat)}</span></div>
      <div class="stat"><span class="k">Objectif par heure</span><span class="v">${total && obj ? chf(obj / total) : '—'}</span><span class="s">Si vous gagnez ${chf(obj)} (Réglages)</span></div>
    </div>
    <div class="panel"><h2>Par mois</h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Mois</th>${ps.map((p) => `<th>${esc(p.nom)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${parMois.map(([m, t]) => { const s = Object.values(t).reduce((a, x) => a + x, 0); return `<tr><td>${m}</td>${ps.map((p, i) => `<td><div class="bar-row" style="grid-template-columns:minmax(0,1fr) 56px"><span class="bar-track"><span class="bar-fill ${i ? 'b2' : ''}" style="width:${((t[p.k] || 0) / maxM * 100).toFixed(1)}%"></span></span><span class="num">${fmtH(t[p.k] || 0)}</span></div></td>`).join('')}<td class="r num">${fmtH(s)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td>${ps.map((p) => `<td class="num">${fmtH(ty[p.k] || 0)} h</td>`).join('')}<td class="r num">${fmtH(total)} h</td></tr></tfoot></table></div>
      <div class="row"><button class="btn small" type="button" data-act="hCsv" data-y="${y}">Exporter ${y} (CSV)</button></div></div>`;
}
ACTIONS.hCsv = (el) => {
  const y = el.dataset.y, ps = personnes(), days = {};
  for (const h of heuresToutes()) if (yearOf(h.date) === y) { (days[h.date] = days[h.date] || {})[h.personne] = h; }
  for (const j of DB.all('jour:')) if (yearOf(j.date) === y) days[j.date] = days[j.date] || {};
  const rows = Object.keys(days).sort().map((d) => [fmtDate(d), JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7]].concat(ps.map((p) => (days[d][p.k] && days[d][p.k].heures) ? String(days[d][p.k].heures).replace('.', ',') : ''), ps.map((p) => (days[d][p.k] && days[d][p.k].off) ? 'off' : ''), [(DB.get('jour:' + d) || {}).remarque || '']));
  downloadFile(`Heures Gamins de Talus ${y}.csv`, csv(['Date', 'Jour'].concat(ps.map((p) => 'Heures ' + p.nom), ps.map((p) => 'Off ' + p.nom), ['Remarque']), rows), 'text/csv;charset=utf-8');
};
