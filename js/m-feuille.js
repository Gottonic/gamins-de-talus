/* Gamins de Talus — feuille de la semaine à imprimer : pour aller au champ sans réseau ni téléphone.
   Agenda jour par jour, tâches avec cases à cocher, cultures à planter / récolter, arrosage conseillé, stock, place pour noter. */
'use strict';

const FEUILLE = { lundi: '', qui: '' };
function renderFeuille() {
  if (!FEUILLE.lundi) { const t = todayISO(), wd = (new Date(t + 'T12:00').getDay() + 6) % 7; FEUILLE.lundi = wd >= 5 ? addDays(lundiDe(t), 7) : lundiDe(t); }
  const l = FEUILLE.lundi, fin = addDays(l, 6), w = semaineISO(l), qui = FEUILLE.qui;
  const pour = (q) => !qui || !q || q === 'ensemble' || q === qui;
  const items = itemsPeriode(l, fin);
  const jours = Array.from({ length: 7 }, (_, i) => addDays(l, i)).map((d, i) => {
    const xs = (items[d] || []).filter((x) => (x.kind === 'ev' || x.kind === 'facture') && pour(x.qui));
    return `<tr><td class="fj"><b>${JOURS[i]}</b> ${fmtDateCourt(d)}</td><td>${xs.map((x) => `${x.heure ? '<b>' + esc(x.heure) + '</b> ' : ''}${esc(x.titre)}${x.qui && x.qui !== 'ensemble' && !String(x.titre).includes(nomDe(x.qui)) ? ' (' + esc(nomDe(x.qui)) + ')' : ''}`).join(' · ') || ''}</td></tr>`;
  }).join('');
  const ts = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu' && pour(t.responsable))
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || String(a.echeance || '9').localeCompare(String(b.echeance || '9')));
  const tachesHtml = ts.map((t) => `<li><span class="case"></span><span><b>${esc(t.titre)}</b>${t.urgent ? ' · URGENT' : ''}${t.echeance ? ' · pour le ' + fmtDateCourt(t.echeance) : ''}${t.responsable ? ' · ' + esc(nomDe(t.responsable)) : ''}${t.remarques ? `<br><small>${esc(trunc(t.remarques.replace(/\s+/g, ' '), 120))}</small>` : ''}</span></li>`).join('');
  /* Cultures : à planter, à récolter, en place (avec où) */
  const y = l.slice(0, 4), cs = (typeof cultures === 'function' ? cultures(y) : []), sem = w.semaine;
  const dans = (s) => { const r = parseSemaines(s); return r && (r[0] <= r[1] ? sem >= r[0] && sem <= r[1] : sem >= r[0] || sem <= r[1]); };
  const ou = (c) => (typeof resumeEmplacements === 'function' && (c.emplacements || []).length ? ' — ' + resumeEmplacements(c.emplacements) : '');
  const aPlanter = cs.filter((c) => dans(c.semPlantation)), aRecolter = cs.filter((c) => dans(c.semRecolte));
  /* Arrosage conseillé */
  let arro = '';
  if (typeof culturesIrriguees === 'function') {
    const xs = culturesIrriguees(l).map((x) => ({ x, r: calculIrrigation(x, l).cible })).filter((o) => o.r && o.r.net > 0.5);
    arro = xs.map(({ x, r }) => `<li><span class="case"></span><span><b>${esc(x.c.nom)}</b> : ${Math.max(1, r.arrosages || 1)} × ${fmtDuree(r.heuresPl / Math.max(1, r.arrosages || 1))} par planche (${f0(r.litresPl)} L/planche)${ou(x.c)}</span></li>`).join('');
  }
  const stk = typeof stockDe === 'function' ? produits().map((p) => ({ p, q: stockDe(p.key) })).filter((o) => (o.q != null && o.q > 0) || o.p.dispo || o.p.auChamp) : [];
  const chips = [['', 'Tout le monde']].concat(personnes().map((p) => [p.k, p.nom])).map(([k, n]) => `<button class="chip${qui === k ? ' on' : ''}" type="button" data-act="feuilleQui" data-k="${k}">${esc(n)}</button>`).join('');
  return `<div class="no-print"><div class="between"><div class="row"><button class="btn small" type="button" data-act="feuilleSem" data-n="-7">←</button><h2 style="margin:0">Semaine ${w.semaine}</h2><button class="btn small" type="button" data-act="feuilleSem" data-n="7">→</button></div>
      <button class="btn primary" type="button" data-act="imprimer">Imprimer</button></div><div class="chips">${chips}</div>
      <p class="hint">Une page A4 (parfois deux) avec tout ce qu'il faut pour la semaine au champ. Sur téléphone : Imprimer → Enregistrer en PDF.</p></div>
    <article class="feuille">
      <header><h1>Gamins de Talus · semaine ${w.semaine}</h1><span>${fmtDate(l)} – ${fmtDate(fin)}${qui ? ' · ' + esc(nomDe(qui)) : ''} · imprimé le ${fmtDate(todayISO())}</span></header>
      <h2>Agenda</h2><table class="fagenda"><tbody>${jours}</tbody></table>
      <div class="fcols">
        <section><h2>Tâches</h2>${tachesHtml ? `<ul class="fliste">${tachesHtml}</ul>` : '<p>Aucune tâche ouverte.</p>'}</section>
        <section><h2>Cultures</h2>
          ${aPlanter.length ? `<h3>À planter</h3><ul class="fliste">${aPlanter.map((c) => `<li><span class="case"></span><span><b>${esc(c.nom)}</b> : ${f0(c.planches)} planches${c.lignes ? ', ' + f0(c.lignes) + ' lignes' : ''}${c.interplant ? ', tous les ' + fmtNum(c.interplant, 0) + ' cm' : ''}${c.variete ? ' · ' + esc(c.variete) : ''}${ou(c)}</span></li>`).join('')}</ul>` : ''}
          ${aRecolter.length ? `<h3>À récolter</h3><ul class="fliste">${aRecolter.map((c) => `<li><span class="case"></span><span><b>${esc(c.nom)}</b>${ou(c)} · kg : ________</span></li>`).join('')}</ul>` : ''}
          ${arro ? `<h3>Arrosage conseillé</h3><ul class="fliste">${arro}</ul>` : ''}
          ${!aPlanter.length && !aRecolter.length && !arro ? '<p>Rien de prévu au plan cette semaine.</p>' : ''}
          ${stk.length ? `<h3>En stock / au champ</h3><p>${stk.map((o) => `${esc(o.p.nom)}${o.q != null && o.q > 0 ? ' ' + fmtQ(o.q, o.p.unite) : ''}${o.p.auChamp ? ' (au champ)' : ''}`).join(' · ')}</p>` : ''}
        </section>
      </div>
      <h2>Heures et notes</h2>
      <table class="fheures"><thead><tr><th></th>${JOURS.map((j) => `<th>${j.slice(0, 3)}</th>`).join('')}</tr></thead><tbody>${(qui ? personnes().filter((p) => p.k === qui) : personnes()).map((p) => `<tr><td>${esc(p.nom)}</td>${JOURS.map(() => '<td></td>').join('')}</tr>`).join('')}</tbody></table>
      <div class="fnotes"></div>
    </article>`;
}
ACTIONS.feuilleSem = (el) => { FEUILLE.lundi = addDays(FEUILLE.lundi, Number(el.dataset.n)); render(); };
ACTIONS.feuilleQui = (el) => { FEUILLE.qui = el.dataset.k; render(); };
ACTIONS.imprimer = () => window.print();
