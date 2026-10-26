/* Gamins de Talus — accueil : une tuile par module, et ce qui demande de l'attention. */
'use strict';

const ICONS = {
  factures: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3"/><path d="M9 10h6M9 14h6M9 18h3"/></svg>',
  finances: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4c0-1.3-1.9-2.4-4.4-2.5"/><path d="M10 15.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>',
  heures: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  taches: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.5l2.7 2.7L16.5 9"/></svg>',
  cultures: '<svg viewBox="0 0 24 24"><path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 14.5c0-3-2.4-5-5.5-5 0 3 2.4 5 5.5 5z"/><path d="M4 21h16"/></svg>',
  inventaire: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  contacts: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.5.2 4.3 1.9 4.9 4.9"/></svg>',
  reglages: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};
const ORDRE = ['factures', 'finances', 'heures', 'taches', 'cultures', 'inventaire', 'contacts', 'reglages'];

function renderAccueil() {
  const h = new Date().getHours();
  const salut = h < 11 ? 'Bonjour' : h < 18 ? 'Salut' : 'Bonsoir';
  const today = todayISO(), y = today.slice(0, 4);

  /* --- Les 3 chiffres importants --- */
  const fs = factures(), ouvertes = fs.filter((f) => ['ouverte', 'retard'].includes(facStatut(f))), retard = ouvertes.filter((f) => facStatut(f) === 'retard');
  const b = bilanAnnee(y);
  const l = lundiDe(today), dim = addDays(l, 6), hs = totalHeures(heuresToutes(), (x) => x.date >= l && x.date <= dim);
  const hTot = Object.values(hs).reduce((a, x) => a + x, 0);
  const kpis = `<section class="dash" aria-label="Tableau de bord">
    <a class="kpi t-factures" href="#/factures"><span class="k">À encaisser</span><span class="v">${chf(ouvertes.reduce((a, f) => a + f.total, 0))}</span>
      <span class="s ${retard.length ? 'bad' : ''}">${ouvertes.length ? `${ouvertes.length} facture${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''}${retard.length ? `, dont ${retard.length} en retard` : ''}` : 'Toutes les factures sont payées'}</span></a>
    <a class="kpi t-finances" href="#/finances"><span class="k">Résultat ${y}</span><span class="v">${chf(b.resultat)}</span><span class="s">Recettes ${chf(b.rec)} · charges ${chf(b.charges)}</span></a>
    <a class="kpi t-heures" href="#/heures"><span class="k">Heures cette semaine</span><span class="v">${fmtH(hTot)} h</span><span class="s">${personnes().map((p) => `${esc(p.nom)} ${fmtH(hs[p.k] || 0)} h`).join(' · ')}</span></a>
  </section>`;

  /* --- Ce qui est à faire --- */
  const groupes = [];
  if (ouvertes.length) groupes.push({ mod: 'factures', titre: 'Factures impayées', n: ouvertes.length, items: ouvertes.sort((a, c) => String(a.echeance).localeCompare(String(c.echeance))).slice(0, 6)
    .map((f) => ({ href: '#/factures/voir/' + encodeURIComponent(f.key), txt: `${f.numero} · ${f.client.nom}`, val: `${chf(f.total)} · ${facStatut(f) === 'retard' ? 'en retard depuis le ' : 'échéance '}${fmtDateCourt(f.echeance)}`, bad: facStatut(f) === 'retard' })) });
  const dans7 = addDays(today, 7);
  const tch = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu' && (t.urgent || (t.echeance && t.echeance <= dans7)))
    .sort((a, c) => (c.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || String(a.echeance || '9').localeCompare(String(c.echeance || '9')));
  const nOuvertes = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu').length;
  groupes.push({ mod: 'taches', titre: 'Tâches urgentes ou proches', n: tch.length, vide: nOuvertes ? `Rien d'urgent. ${nOuvertes} tâche${nOuvertes > 1 ? 's' : ''} ouverte${nOuvertes > 1 ? 's' : ''}.` : 'Aucune tâche ouverte.',
    items: tch.slice(0, 6).map((t) => ({ href: '#/taches', txt: t.titre + (t.responsable ? ' · ' + nomDe(t.responsable) : ''), val: t.urgent ? 'urgent' : (t.echeance < today ? 'en retard' : fmtDateCourt(t.echeance)), bad: t.urgent || (t.echeance && t.echeance < today) })) });
  const sansJ = depenses().filter(sansJustificatif).sort((a, c) => String(c.date).localeCompare(String(a.date)));
  if (sansJ.length) groupes.push({ mod: 'finances', titre: 'Justificatifs manquants', n: sansJ.length, items: sansJ.slice(0, 4).map((d) => ({ href: '#/finances/depenses', txt: `${d.objet} · payé par ${nomDe(d.par)}`, val: `${chf(d.montant)} · ${fmtDateCourt(d.date)}`, bad: true })),
    plus: sansJ.length > 4 ? { href: '#/finances/depenses', txt: `Voir les ${sansJ.length} dépenses sans justificatif` } : null, avant: () => { FIN.sansJ = true; } });
  const d = decompteActuel();
  if (d.transferts.length) groupes.push({ mod: 'finances', titre: 'Entre associés', items: d.transferts.map((t) => ({ href: '#/finances/associes', txt: `${nomDe(t.de)} doit à ${nomDe(t.a)}`, val: chf(t.montant) })) });

  const todo = `<section class="panel"><h2>À traiter</h2><div class="todo">${groupes.map((g) => `<div class="grp t-${g.mod}"><h3>${esc(g.titre)}${g.n ? `<span class="n">${g.n}</span>` : ''}</h3>
      ${g.items.length ? g.items.map((it) => `<a class="it${it.bad ? ' bad' : ''}" href="${it.href}"${g.avant ? ' data-act="goSansJ"' : ''}><span>${esc(it.txt)}</span><span class="num">${esc(it.val)}</span></a>`).join('') : `<p class="none">${esc(g.vide || 'Rien.')}</p>`}
      ${g.plus ? `<a class="btn link" href="${g.plus.href}" data-act="goSansJ">${esc(g.plus.txt)}</a>` : ''}</div>`).join('')}</div></section>`;

  const tiles = ORDRE.filter((k) => MODULES[k]).map((k) => {
    const m = MODULES[k]; let t = { line: '' };
    try { t = m.tuile ? m.tuile() : t; } catch (e) { console.error(e); }
    return `<a class="tile t-${k}" href="#/${k}"><span class="ic">${ICONS[k] || ''}</span><b>${esc(m.titre)}</b><span class="tline${t.warn ? ' warn' : ''}">${esc(t.line || '')}</span></a>`;
  }).join('');
  return `<section class="hello"><span class="eyebrow">Maraîchers · Marly · ${fmtDate(today)}</span><h2>${salut}${Sync.me ? ' ' + esc(nomDe(Sync.me)) : ''}</h2></section>
    ${kpis}
    <section class="tiles" aria-label="Modules">${tiles}</section>
    ${todo}`;
}
ACTIONS.goSansJ = () => { FIN.sansJ = true; FIN.annee = ''; FIN.type = ''; FIN.par = ''; FIN.q = ''; go('#/finances/depenses'); };
