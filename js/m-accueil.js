/* Gamins de Talus — accueil : une tuile par module, et ce qui demande de l'attention. */
'use strict';

const ICONS = {
  drive: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  irrigation: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 4.2 5.5 7.4 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.8 2.3-6 5.5-10.2z"/><path d="M9.3 14.2a2.8 2.8 0 0 0 2.7 2.6"/></svg>',
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
const ORDRE = ['messages', 'contacts', 'taches', 'calendrier', 'factures', 'finances', 'cultures', 'irrigation']; // par paires de couleur ; le Drive s'ouvre par le bouton en haut de l'écran

/* Ce que l'accueil montre : « moi » (ce qui me concerne, par défaut) ou « tous » ; mémorisé sur l'appareil */
const ACC = { vue: ls.get('gdt-accueil-vue') || 'moi' };
const pourMoi = (qui) => ACC.vue !== 'moi' || !Sync.me || !qui || qui === 'ensemble' || qui === Sync.me;
ACTIONS.accVue = (el) => { ACC.vue = el.dataset.v; ls.set('gdt-accueil-vue', ACC.vue); render(); };

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
    <a class="kpi t-finances" href="#/finances/bilan"><span class="k">Résultat ${y}</span><span class="v">${chf(b.resultat)}</span><span class="s">Recettes ${chf(b.rec)} · charges ${chf(b.charges)}</span></a>
    <a class="kpi t-calendrier" href="#/calendrier/heures"><span class="k">${ACC.vue === 'moi' && Sync.me ? 'Mes heures cette semaine' : 'Heures cette semaine'}</span><span class="v">${fmtH(ACC.vue === 'moi' && Sync.me ? hs[Sync.me] || 0 : hTot)} h</span><span class="s">${personnes().map((p) => `${esc(p.nom)} ${fmtH(hs[p.k] || 0)} h`).join(' · ')}</span></a>
  </section>`;

  /* --- Ce qui est à faire --- */
  const groupes = [];
  const nl = typeof nonLus === 'function' ? nonLus() : [];
  if (nl.length) groupes.push({ mod: 'messages', titre: 'Messages non lus', n: nl.length, items: nl.slice(-4).reverse().map((m) => ({ href: '#/messages', txt: `${nomDe(m.de)} : ${trunc(apercuMsg(m), 60)}`, val: fmtDateCourt(isoDate(new Date(m.cree))) })),
    plus: { href: '#/messages', txt: 'Ouvrir la messagerie' } });
  const ml = typeof mailsATraiter === 'function' ? mailsATraiter().filter((m) => ACC.vue !== 'moi' || !m.par || m.par === Sync.me) : [];
  if (ml.length) groupes.push({ mod: 'messages', titre: 'Mails à traiter', n: ml.length, items: ml.slice(0, 4).map((m) => ({ href: '#/messages/mails', txt: `${(m.de && (m.de.nom || m.de.adresse)) || '?'} : ${trunc(m.objet || '(sans objet)', 50)}`, val: m.par ? nomDe(m.par) : fmtDateCourt(String(m.date || '').slice(0, 10)), bad: !m.par })), plus: { href: '#/messages/mails', txt: 'Voir les mails' } });
  if (ouvertes.length) groupes.push({ mod: 'factures', titre: 'Ventes pas encore payées', n: ouvertes.length, items: ouvertes.sort((a, c) => String(a.echeance).localeCompare(String(c.echeance))).slice(0, 6)
    .map((f) => ({ href: '#/factures/voir/' + encodeURIComponent(f.key), txt: `${f.numero || f.blNumero || 'Vente'} · ${f.client.nom}`, val: `${chf(f.total)} · ${facStatut(f) === 'retard' ? 'en retard depuis le ' : 'échéance '}${fmtDateCourt(f.echeance)}`, bad: facStatut(f) === 'retard' })) });
  /* Tâches : d'abord urgentes et en retard, puis les prochaines échéances, puis les autres tâches ouvertes */
  const ouvT = taches().filter((t) => t.statut !== 'termine' && t.statut !== 'suspendu' && pourMoi(t.responsable));
  const demain = addDays(today, 1);
  const rang = (t) => (t.urgent || (t.echeance && t.echeance < today) ? 0 : t.echeance ? 1 : 2);
  const tch = ouvT.sort((a, c) => rang(a) - rang(c) || String(a.echeance || '9').localeCompare(String(c.echeance || '9')) || String(a.cree || '').localeCompare(String(c.cree || '')));
  groupes.push({ mod: 'taches', titre: 'Tâches urgentes et prochaines', n: ouvT.length, vide: 'Aucune tâche ouverte.',
    items: tch.slice(0, 7).map((t) => ({ href: '#/taches', txt: t.titre + (t.responsable ? ' · ' + nomDe(t.responsable) : ''), val: t.urgent ? 'urgent' : t.echeance ? (t.echeance < today ? 'en retard' : t.echeance === today ? "aujourd'hui" : t.echeance === demain ? 'demain' : fmtDateCourt(t.echeance)) : '', bad: rang(t) === 0, fort: !!t.urgent || (!!t.echeance && t.echeance <= demain) })),
    plus: ouvT.length > 7 ? { href: '#/taches', txt: `Voir les ${ouvT.length} tâches` } : null });
  /* Calendrier des 7 prochains jours */
  const prochains = []; const it7 = itemsPeriode(today, addDays(today, 6));
  for (const d of Object.keys(it7).sort()) for (const x of it7[d]) if (x.kind === 'ev' && (x.debut || d === today) && pourMoi(x.qui)) prochains.push({ href: '#/calendrier', txt: x.titre + (x.qui && !x.titre.includes(quiLabel(x.qui)) ? ' · ' + quiLabel(x.qui) : ''), val: (d === today ? "aujourd'hui" : d === addDays(today, 1) ? 'demain' : JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3) + ' ' + fmtDateCourt(d)) + (x.heure ? ' ' + x.heure : ''), fort: d <= addDays(today, 1) });
  groupes.push({ mod: 'calendrier', titre: 'Ces 7 prochains jours', n: prochains.length, vide: 'Rien de prévu au calendrier.', items: prochains.slice(0, 7), plus: { href: '#/calendrier/agenda', txt: "Voir l'agenda" } });
  const sansJ = depenses().filter((x) => sansJustificatif(x) && pourMoi(x.par)).sort((a, c) => String(c.date).localeCompare(String(a.date)));
  if (sansJ.length) groupes.push({ mod: 'finances', titre: 'Justificatifs manquants', n: sansJ.length, items: sansJ.slice(0, 4).map((d) => ({ href: '#/finances/depenses', txt: `${d.objet} · payé par ${nomDe(d.par)}`, val: `${chf(d.montant)} · ${fmtDateCourt(d.date)}`, bad: true })),
    plus: sansJ.length > 4 ? { href: '#/finances/depenses', txt: `Voir les ${sansJ.length} dépenses sans justificatif` } : null, avant: () => { FIN.sansJ = true; } });
  /* Archive de l'année passée : le rappel reste tant que chaque associé ne l'a pas téléchargée une fois */
  const yb = String(Number(y) - 1);
  if (typeof archiveManquePour === 'function' && (depenses().some((x) => yearOf(x.date) === yb) || recettesToutes().some((x) => yearOf(x.date) === yb))) {
    const manque = archiveManquePour(yb), moi = manque.some((p) => p.k === Sync.me);
    if (manque.length) groupes.push({ mod: 'finances', titre: "Fin d'année " + yb, items: [moi
      ? { href: '#/finances/annee', txt: `Télécharger l'archive des comptes ${yb}`, val: 'impôts', bad: Number(today.slice(5, 7)) >= 3 }
      : { href: '#/finances/annee', txt: `Archive ${yb} pas encore téléchargée par ${manque.map((p) => p.nom).join(', ')}`, val: '' }] });
  }
  const d = decompteActuel();
  const trs = d.transferts.filter((t) => ACC.vue !== 'moi' || !Sync.me || t.de === Sync.me || t.a === Sync.me);
  if (trs.length) groupes.push({ mod: 'finances', titre: 'Entre associés', items: trs.map((t) => ({ href: '#/finances/associes', txt: `${nomDe(t.de)} doit à ${nomDe(t.a)}`, val: chf(t.montant) })) });

  const vue = Sync.me ? `<div class="seg-mini" role="group" aria-label="Afficher"><button type="button" class="${ACC.vue === 'moi' ? 'on' : ''}" data-act="accVue" data-v="moi">Pour moi</button><button type="button" class="${ACC.vue !== 'moi' ? 'on' : ''}" data-act="accVue" data-v="tous">Tout le monde</button></div>` : '';
  const todo = `<section class="panel"><div class="between"><h2>À traiter</h2>${vue}</div><div class="todo">${groupes.map((g) => `<div class="grp t-${g.mod}"><h3>${esc(g.titre)}${g.n ? `<span class="n">${g.n}</span>` : ''}</h3>
      ${g.items.length ? g.items.map((it) => `<a class="it${it.fort ? ' fort' : it.bad ? ' bad' : ''}" href="${it.href}"${g.avant ? ' data-act="goSansJ"' : ''}><span>${esc(it.txt)}</span><span class="num">${esc(it.val)}</span></a>`).join('') : `<p class="none">${esc(g.vide || 'Rien.')}</p>`}
      ${g.plus ? `<a class="btn link" href="${g.plus.href}"${g.avant ? ' data-act="goSansJ"' : ''}>${esc(g.plus.txt)}</a>` : ''}</div>`).join('')}</div></section>`;

  const tiles = ORDRE.filter((k) => MODULES[k]).map((k) => {
    const m = MODULES[k]; let t = { line: '' };
    try { t = m.tuile ? m.tuile() : t; } catch (e) { console.error(e); }
    return `<a class="tile t-${k}" href="#/${k}"><span class="ic">${ICONS[k] || ''}</span><b>${esc(m.titre)}</b><span class="tline${t.warn ? ' warn' : ''}${t.clamp ? ' clamp' : ''}">${t.qui ? `<strong>${esc(t.qui)}</strong> ` : ''}${esc(t.line || '')}</span>${t.badge ? `<span class="badge" aria-label="${t.badge} à voir">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}</a>`;
  }).join('');
  return `<section class="hello"><div><span class="eyebrow">Maraîchers · Marly · ${fmtDate(today)}</span><h2>${salut}${Sync.me ? ' ' + esc(nomDe(Sync.me)) : ''}</h2></div>
    <button class="btn primary big" type="button" data-act="mesHeures"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>Enregistrer mes heures</button></section>
    <section class="tiles" aria-label="Modules">${tiles}</section>
    ${todo}
    ${kpis}`;
}
ACTIONS.goSansJ = () => { FIN.sansJ = true; FIN.annee = ''; FIN.type = ''; FIN.par = ''; FIN.q = ''; go('#/finances/depenses'); };
