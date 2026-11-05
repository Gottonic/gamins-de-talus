/* Gamins de Talus — accueil : une tuile par module, et ce qui demande de l'attention. */
'use strict';

const ICONS = {
  drive: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  irrigation: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 4.2 5.5 7.4 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.8 2.3-6 5.5-10.2z"/><path d="M9.3 14.2a2.8 2.8 0 0 0 2.7 2.6"/></svg>',
  mails: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/></svg>',
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
const ORDRE = ['messages', 'mails', 'contacts', 'calendrier', 'factures', 'finances', 'cultures', 'irrigation']; // par paires de couleur ; le Drive s'ouvre par le bouton en haut de l'écran

/* Pastilles et chiffres de l'accueil : ce qui me concerne */
const ACC = { vue: 'moi' };
const pourMoi = (qui) => !Sync.me || quiInclut(qui, Sync.me);

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
    <a class="kpi t-finances" href="#/finances/bilans"><span class="k">Résultat ${y}</span><span class="v">${chf(b.resultat)}</span><span class="s">Recettes ${chf(b.rec)} · charges ${chf(b.charges)}</span></a>
    <a class="kpi t-calendrier" href="#/calendrier/heures"><span class="k">${Sync.me ? 'Mes heures cette semaine' : 'Heures cette semaine'}</span><span class="v">${fmtH(Sync.me ? hs[Sync.me] || 0 : hTot)} h</span><span class="s">${personnes().map((p) => `${esc(p.nom)} ${fmtH(hs[p.k] || 0)} h`).join(' · ')}</span></a>
  </section>`;

  /* --- « À traiter » a laissé la place aux pastilles des tuiles. Restent deux rappels rares, en bandeau --- */
  const rappels = [];
  const sv = DB.get('cfg:sauvegarde') || {};
  if (Object.keys(DB.data).length > 30 && (!sv.le || sv.le.slice(0, 10) < addDays(today, -31))) rappels.push(`<a class="banner rappel" href="#/reglages/donnees">💾 <span><b>Sauvegarde du mois</b> · télécharger une copie des données${sv.le ? ` (dernière le ${fmtDateCourt(sv.le.slice(0, 10))})` : ''}</span></a>`);
  const yb = String(Number(y) - 1);
  if (typeof archiveManquePour === 'function' && (depenses().some((x) => yearOf(x.date) === yb) || recettesToutes().some((x) => yearOf(x.date) === yb))) {
    const manque = archiveManquePour(yb);
    if (manque.some((p) => p.k === Sync.me)) rappels.push(`<a class="banner rappel" href="#/finances/bilans">📦 <span><b>Fin d'année ${yb}</b> · télécharger l'archive des comptes (impôts)</span></a>`);
  }

  const tiles = ORDRE.filter((k) => MODULES[k]).map((k) => {
    const m = MODULES[k]; let t = { line: '' };
    try { t = m.tuile ? m.tuile() : t; } catch (e) { console.error(e); }
    return `<a class="tile t-${k}" href="#/${k}"><span class="ic">${ICONS[k] || ''}</span><b>${esc(m.titre)}</b><span class="tline${t.warn ? ' warn' : ''}${t.clamp ? ' clamp' : ''}">${t.qui ? `<strong>${esc(t.qui)}</strong> ` : ''}${esc(t.line || '')}</span>${t.badge ? `<span class="badge" aria-label="${t.badge} à voir">${t.badge > 99 ? '99+' : t.badge}</span>` : ''}</a>`;
  }).join('');
  /* Soit la journée en cours (avec « Terminer l'événement et enregistrer mes heures »), soit ce bouton */
  const enCours = typeof journeesEnCours === 'function' ? journeesEnCours().length : 0;
  return `<section class="hello"><div><span class="eyebrow">Maraîchers · Marly · ${fmtDate(today)}</span><h2>${salut}${Sync.me ? ' ' + esc(nomDe(Sync.me)) : ''}</h2></div>
    ${enCours ? '' : `<div class="row hello-btns"><button class="btn primary big" type="button" data-act="heuresJour" data-d="${today}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>Noter mes heures</button></div>`}
    </section>
    ${retourHtml()}
    ${typeof journeeEnCoursHtml === 'function' ? journeeEnCoursHtml() : ''}
    <section class="tiles" aria-label="Modules">${tiles}</section>
    ${rappels.join('')}
    ${kpis}`;
}
/* ---------- De retour (fin de sourdine ou de vacances, dans les 14 derniers jours) : ce qui te concerne directement ---------- */
function absenceRecente() {
  if (!Sync.me) return null; const t = todayISO(), pr = DB.get('cfg:notif:' + Sync.me) || {}, cands = [];
  if (pr.sourdineJusqua && pr.sourdineDe && pr.sourdineJusqua < t && pr.sourdineJusqua >= addDays(t, -14)) cands.push({ de: pr.sourdineDe, a: pr.sourdineJusqua });
  if (pr.sourdineVacances !== false) for (const e of DB.all('ev:')) {
    if (e.type !== 'vacances' || !quiInclut(e.qui, Sync.me) || (e.rec && e.rec.freq)) continue; const a = e.fin && e.fin > e.date ? e.fin : e.date;
    if (a < t && a >= addDays(t, -14)) cands.push({ de: e.date, a });
  }
  const r = cands.sort((x, y) => y.a.localeCompare(x.a))[0]; if (!r || pr.retourVu === r.de + '|' + r.a) return null;
  if (typeof enSourdine === 'function' && enSourdine(Sync.me)) return null; return r;
}
function retourHtml() {
  const r = absenceRecente(); if (!r) return '';
  const me = Sync.me, dans = (x) => { const d = String(x || '').slice(0, 10); return d >= r.de && d <= addDays(r.a, 1); };
  const lignes = [];
  const ments = DB.all('msg:').filter((m) => (m.mentions || []).includes(me) && dans(m.cree));
  if (ments.length) lignes.push(`<a href="#/messages">💬 <b>${ments.length}</b> message${ments.length > 1 ? 's' : ''} où l'on te mentionne</a>`);
  const ms = typeof mails === 'function' ? mails().filter((m) => m.par === me && !mailFini(m) && dans(m.date)) : [];
  if (ms.length) lignes.push(`<a href="#/mails">📧 <b>${ms.length}</b> mail${ms.length > 1 ? 's' : ''} pour toi : ${esc(ms.slice(0, 3).map((m) => (m.de && (m.de.nom || m.de.adresse)) || '?').join(', '))}${ms.length > 3 ? '…' : ''}</a>`);
  const evs = DB.all('ev:').filter((e) => e.creePar !== me && e.type !== 'vacances' && quiInclut(e.qui, me) && dans(e.cree) && (e.fin || e.date || '') >= todayISO());
  if (evs.length) lignes.push(`<a href="#/calendrier">📅 <b>${evs.length}</b> événement${evs.length > 1 ? 's' : ''} prévu${evs.length > 1 ? 's' : ''} pour toi : ${esc(evs.slice(0, 3).map((e) => titreEv(e) + ' ' + fmtDateCourt(e.date)).join(', '))}</a>`);
  const ts = taches().filter((t) => tacheOuverte(t) && t.creePar && t.creePar !== me && String(t.responsable || '').split('+').includes(me) && dans(t.cree));
  if (ts.length) lignes.push(`<a href="#/calendrier">☑ <b>${ts.length}</b> tâche${ts.length > 1 ? 's' : ''} pour toi : ${esc(ts.slice(0, 3).map((t) => t.titre).join(', '))}${ts.length > 3 ? '…' : ''}</a>`);
  return `<section class="panel retour"><div class="between"><h2>👋 Bon retour</h2><button class="btn small" type="button" data-act="retourVu" data-v="${esc(r.de + '|' + r.a)}">OK, vu</button></div>
    <p class="hint">Ce qui te concerne directement, du ${fmtDate(r.de)} au ${fmtDate(r.a)} :</p>
    ${lignes.length ? `<div class="retour-l">${lignes.join('')}</div>` : '<p>Rien de spécial pour toi. 🌿</p>'}</section>`;
}
ACTIONS.retourVu = (el) => { DB.put('cfg:notif:' + Sync.me, Object.assign({}, DB.get('cfg:notif:' + Sync.me) || {}, { retourVu: el.dataset.v })); };
ACTIONS.goSansJ = () => { FIN.sansJ = true; FIN.annee = ''; FIN.type = ''; FIN.par = ''; FIN.q = ''; go('#/finances/depenses'); };
