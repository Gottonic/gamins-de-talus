/* Gamins de Talus — accueil : une tuile par module, et ce qui demande de l'attention. */
'use strict';

const ICONS = {
  messages: '<svg viewBox="0 0 24 24"><path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  factures: '<svg viewBox="0 0 24 24"><path d="M3.5 9.5h17l-1.8 9.2a1.5 1.5 0 0 1-1.5 1.3H6.8a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M8 9.5l3-5.5M16 9.5l-3-5.5"/><path d="M9 13v3.5M12 13v3.5M15 13v3.5"/></svg>',
  finances: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4c0-1.3-1.9-2.4-4.4-2.5"/><path d="M10 15.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>',
  calendrier: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/></svg>',
  taches: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.5l2.7 2.7L16.5 9"/></svg>',
  cultures: '<svg viewBox="0 0 24 24"><path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 14.5c0-3-2.4-5-5.5-5 0 3 2.4 5 5.5 5z"/><path d="M4 21h16"/></svg>',
  inventaire: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  contacts: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.5.2 4.3 1.9 4.9 4.9"/></svg>',
  reglages: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};
const ORDRE = ['messages', 'factures', 'finances', 'calendrier', 'taches', 'cultures', 'contacts'];

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
    <a class="kpi t-calendrier" href="#/calendrier/heures"><span class="k">Heures cette semaine</span><span class="v">${fmtH(hTot)} h</span><span class="s">${personnes().map((p) => `${esc(p.nom)} ${fmtH(hs[p.k] || 0)} h`).join(' · ')}</span></a>
  </section>`;

  /* --- Ce qui est à faire --- */
  const groupes = [];
  const nl = typeof nonLus === 'function' ? nonLus() : [];
  if (nl.length) groupes.push({ mod: 'messages', titre: 'Messages non lus', n: nl.length, items: nl.slice(-4).reverse().map((m) => ({ href: '#/messages', txt: `${nomDe(m.de)} : ${trunc(apercuMsg(m), 60)}`, val: fmtDateCourt(isoDate(new Date(m.cree))) })),
    plus: { href: '#/messages', txt: 'Ouvrir la messagerie' } });
  if (ouvertes.length) groupes.push({ mod: 'factures', titre: 'Factures impayées', n: ouvertes.length, items: ouvertes.sort((a, c) => String(a.echeance).localeCompare(String(c.echeance))).slice(0, 6)
    .map((f) => ({ href: '#/factures/voir/' + encodeURIComponent(f.key), txt: `${f.numero} · ${f.client.nom}`, val: `${chf(f.total)} · ${facStatut(f) === 'retard' ? 'en retard depuis le ' : 'échéance '}${fmtDateCourt(f.echeance)}`, bad: facStatut(f) === 'retard' })) });
  /* Tâches : d'abord urgentes et en retard, puis les prochaines échéances, puis les autres tâches ouvertes */
  const ouvT = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu');
  const rang = (t) => (t.urgent || (t.echeance && t.echeance < today) ? 0 : t.echeance ? 1 : 2);
  const tch = ouvT.sort((a, c) => rang(a) - rang(c) || String(a.echeance || '9').localeCompare(String(c.echeance || '9')) || String(a.cree || '').localeCompare(String(c.cree || '')));
  groupes.push({ mod: 'taches', titre: 'Tâches urgentes et prochaines', n: ouvT.length, vide: 'Aucune tâche ouverte.',
    items: tch.slice(0, 7).map((t) => ({ href: '#/taches', txt: t.titre + (t.responsable ? ' · ' + nomDe(t.responsable) : ''), val: t.urgent ? 'urgent' : t.echeance ? (t.echeance < today ? 'en retard' : fmtDateCourt(t.echeance)) : '', bad: rang(t) === 0 })),
    plus: ouvT.length > 7 ? { href: '#/taches', txt: `Voir les ${ouvT.length} tâches` } : null });
  /* Calendrier des 7 prochains jours */
  const prochains = []; const it7 = itemsPeriode(today, addDays(today, 6));
  for (const d of Object.keys(it7).sort()) for (const x of it7[d]) if (x.kind === 'ev' && (x.debut || d === today)) prochains.push({ href: '#/calendrier', txt: x.titre + (x.qui && !x.titre.includes(quiLabel(x.qui)) ? ' · ' + quiLabel(x.qui) : ''), val: (d === today ? "aujourd'hui" : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3) + ' ' + fmtDateCourt(d)) + (x.heure ? ' ' + x.heure : '') });
  groupes.push({ mod: 'calendrier', titre: 'Ces 7 prochains jours', n: prochains.length, vide: 'Rien de prévu au calendrier.', items: prochains.slice(0, 7), plus: { href: '#/calendrier/agenda', txt: "Voir l'agenda" } });
  const sansJ = depenses().filter(sansJustificatif).sort((a, c) => String(c.date).localeCompare(String(a.date)));
  if (sansJ.length) groupes.push({ mod: 'finances', titre: 'Justificatifs manquants', n: sansJ.length, items: sansJ.slice(0, 4).map((d) => ({ href: '#/finances/depenses', txt: `${d.objet} · payé par ${nomDe(d.par)}`, val: `${chf(d.montant)} · ${fmtDateCourt(d.date)}`, bad: true })),
    plus: sansJ.length > 4 ? { href: '#/finances/depenses', txt: `Voir les ${sansJ.length} dépenses sans justificatif` } : null, avant: () => { FIN.sansJ = true; } });
  /* Prospection : relances prévues jusqu'à aujourd'hui, sinon les prospects prioritaires à contacter */
  const pros = prospects();
  if (pros.length) {
    const dus = pros.filter(aRelancer).sort((a, c) => String(a.prospection.relanceLe).localeCompare(c.prospection.relanceLe));
    const af = pros.filter((c) => groupeStatut(pStat(c)) === 'afaire').sort((a, c) => ((a.prospection || {}).priorite || 9) - ((c.prospection || {}).priorite || 9) || byName(a, c));
    const items = dus.map((c) => ({ href: '#/factures/prospect/' + encodeURIComponent(c.key), txt: 'Relancer ' + displayName(c), val: (c.prospection.horaires || '').slice(0, 26) || fmtDateCourt(c.prospection.relanceLe), bad: c.prospection.relanceLe < today }))
      .concat(af.slice(0, Math.max(0, 5 - dus.length)).map((c) => ({ href: '#/factures/prospect/' + encodeURIComponent(c.key), txt: `Appeler ${displayName(c)}`, val: `P${(c.prospection || {}).priorite || '–'} · ${((c.prospection || {}).lieu || '').slice(0, 18)}` })));
    groupes.push({ mod: 'factures', titre: 'Prospection', n: dus.length || af.length, items, vide: 'Rien à appeler.', plus: { href: '#/factures/prospection', txt: `${af.length} à contacter · voir la prospection` } });
  }
  /* Archive de l'année passée : le rappel reste tant que chaque associé ne l'a pas téléchargée une fois */
  const yb = String(Number(y) - 1);
  if (typeof archiveManquePour === 'function' && (depenses().some((x) => yearOf(x.date) === yb) || recettesToutes().some((x) => yearOf(x.date) === yb))) {
    const manque = archiveManquePour(yb), moi = manque.some((p) => p.k === Sync.me);
    if (manque.length) groupes.push({ mod: 'finances', titre: "Fin d'année " + yb, items: [moi
      ? { href: '#/finances/annee', txt: `Télécharger l'archive des comptes ${yb}`, val: 'impôts', bad: Number(today.slice(5, 7)) >= 3 }
      : { href: '#/finances/annee', txt: `Archive ${yb} pas encore téléchargée par ${manque.map((p) => p.nom).join(', ')}`, val: '' }] });
  }
  const d = decompteActuel();
  if (d.transferts.length) groupes.push({ mod: 'finances', titre: 'Entre associés', items: d.transferts.map((t) => ({ href: '#/finances/associes', txt: `${nomDe(t.de)} doit à ${nomDe(t.a)}`, val: chf(t.montant) })) });

  const todo = `<section class="panel"><h2>À traiter</h2><div class="todo">${groupes.map((g) => `<div class="grp t-${g.mod}"><h3>${esc(g.titre)}${g.n ? `<span class="n">${g.n}</span>` : ''}</h3>
      ${g.items.length ? g.items.map((it) => `<a class="it${it.bad ? ' bad' : ''}" href="${it.href}"${g.avant ? ' data-act="goSansJ"' : ''}><span>${esc(it.txt)}</span><span class="num">${esc(it.val)}</span></a>`).join('') : `<p class="none">${esc(g.vide || 'Rien.')}</p>`}
      ${g.plus ? `<a class="btn link" href="${g.plus.href}"${g.avant ? ' data-act="goSansJ"' : ''}>${esc(g.plus.txt)}</a>` : ''}</div>`).join('')}</div></section>`;

  const tiles = ORDRE.filter((k) => MODULES[k]).map((k) => {
    const m = MODULES[k]; let t = { line: '' };
    try { t = m.tuile ? m.tuile() : t; } catch (e) { console.error(e); }
    return `<a class="tile t-${k}" href="#/${k}"><span class="ic">${ICONS[k] || ''}</span><b>${esc(m.titre)}</b><span class="tline${t.warn ? ' warn' : ''}${t.clamp ? ' clamp' : ''}">${t.qui ? `<strong>${esc(t.qui)}</strong> ` : ''}${esc(t.line || '')}</span>${t.badge ? `<span class="badge" aria-label="${t.badge} non lu${t.badge > 1 ? 's' : ''}">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}</a>`;
  }).join('');
  return `<section class="hello"><div><span class="eyebrow">Maraîchers · Marly · ${fmtDate(today)}</span><h2>${salut}${Sync.me ? ' ' + esc(nomDe(Sync.me)) : ''}</h2></div>
    <button class="btn primary big" type="button" data-act="mesHeures"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>Enregistrer mes heures</button></section>
    <section class="tiles" aria-label="Modules">${tiles}</section>
    ${todo}
    ${kpis}`;
}
ACTIONS.goSansJ = () => { FIN.sansJ = true; FIN.annee = ''; FIN.type = ''; FIN.par = ''; FIN.q = ''; go('#/finances/depenses'); };
