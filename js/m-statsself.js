/* Gamins de Talus — statistiques du self-service (Ventes → Self-service → 📊 Statistiques).
   But : savoir ce qui part le mieux, ce qu'il faut remplir le plus souvent, quels jours on vend, et préparer les cultures de l'an prochain.
   Sources :
   - ventes par article : le stand, d'un comptage à l'autre (stp:). Vendu = ce qui y était (dernier comptage + remplissages) − ce qui reste.
     Ce qu'on ne retrouve pas au comptage (manque, vol) compte donc comme parti. Sans aucun comptage : estimé avec ce qui a été mis en vente.
   - jours et heures : les paiements TWINT du self (mails TWINT et relevé), la seule source datée paiement par paiement.
   - argent : encaissements de la vente directe (TWINT, espèces) + payés par message. */
'use strict';

const SST = { an: '' };
ACTIONS.sstAn = (el) => { SST.an = el.dataset.y; render(); };
const JOURS_COURTS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
const jourSem = (iso) => (new Date(iso + 'T12:00:00').getDay() + 6) % 7;
const minLower = (s) => String(s || '').trim().toLowerCase();

/* Un article du stand, le même qu'il vienne d'un remplissage ou d'un comptage */
function cleArticleStand(l) {
  if (l.art) return l.art;
  const p = DB.get(l.prod) || {};
  const cal = l.calibre != null && l.calibre !== '' ? minLower(l.calibre) : l.nom && p.nom && String(l.nom).startsWith(p.nom) ? minLower(String(l.nom).slice(p.nom.length)) : l.nom && !p.nom ? minLower(l.nom) : '';
  return 'p:' + l.prod + '|' + cal;
}
const nomArticleStand = (l) => { const p = DB.get(l.prod) || {}; return l.nom || ((p.nom || '?') + (l.calibre ? ' ' + minLower(l.calibre) : '')); };
const uniteCourteS = (u) => (u === 'pièce' ? 'pc' : u || '');

/* Le film du stand, article par article */
function filmStand() {
  const ev = [];
  for (const s of misesEnVente()) (s.lignes || []).forEach((l, i) => { const q = Math.max(0, num(l.qte) - num((s.retours || {})[i])); ev.push({ d: String(s.date), c: String(s.cree || ''), o: 0, mis: { id: cleArticleStand(l), q, ret: num((s.retours || {})[i]), l } }); });
  for (const p of pointsStand()) ev.push({ d: String(p.date), c: String(p.cree || ''), o: 1, pt: p });
  ev.sort((a, b) => a.d.localeCompare(b.d) || a.c.localeCompare(b.c) || a.o - b.o);
  const etat = {}, par = {}; /* par[année][id] */
  const A = (y, id, l) => { const o = ((par[y] = par[y] || {})[id] = par[y][id] || { id, nom: nomArticleStand(l), prod: l.prod, unite: l.unite || '', poids: num(l.poids), prix: num(l.prix), mis: 0, misV: 0, vendu: 0, venduV: 0, repris: 0, remplis: 0, comptes: 0, epuise: 0, de: '', a: '', joursRemplis: [] }); return o; };
  for (const e of ev) {
    if (e.mis) {
      const { id, q, ret, l } = e.mis, st = etat[id] = etat[id] || { q: 0, l }; st.q += q; st.l = l;
      const o = A(e.d.slice(0, 4), id, l); o.mis += q; o.misV += q * num(l.prix); o.repris += ret; o.remplis++; o.prix = num(l.prix) || o.prix; o.joursRemplis.push(e.d);
      if (!o.de || e.d < o.de) o.de = e.d; if (e.d > o.a) o.a = e.d;
    } else {
      const y = e.d.slice(0, 4), lignes = {}; for (const l of e.pt.lignes || []) lignes[cleArticleStand(l)] = l;
      for (const id of new Set(Object.keys(etat).filter((k) => etat[k].q > 0).concat(Object.keys(lignes)))) {
        const st = etat[id] = etat[id] || { q: 0, l: lignes[id] }, l = lignes[id], reste = l ? num(l.reste) : 0, repris = l ? Math.min(reste, num(l.repris)) : 0;
        const avant = st.q, vendu = Math.max(0, avant - reste), o = A(y, id, st.l || l);
        o.vendu += vendu; o.venduV += vendu * num((l && l.prix) || (st.l && st.l.prix) || o.prix); o.repris += repris;
        if (avant > 0) { o.comptes++; if (reste === 0) o.epuise++; }
        if (e.d > o.a) o.a = e.d;
        st.q = Math.max(0, reste - repris);
      }
    }
  }
  return { par, etat, comptages: pointsStand().length };
}

/* Les paiements TWINT du self (pas ceux d'une facture ni d'une « autre vente »), avec leur heure si on la connaît */
function paiementsTwintSelf() {
  return DB.all('tw:').filter((t) => {
    if (!(num(t.montant) > 0) || !t.date) return false;
    if (String(t.utilise || '').startsWith('fac:')) return false;
    const r = t.utilise && String(t.utilise).startsWith('rec:') ? DB.get(t.utilise) : null; if (r && !estVenteDirecte(r)) return false;
    return true;
  }).map((t) => { let h = t.heure || ''; if (!h && t.mail) { const m = DB.get(t.mail), d = m && new Date(m.date); if (d && !isNaN(d)) h = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } return Object.assign({}, t, { heure: h }); });
}

/* Petits graphiques en barres (une seule série) : la plus haute est mise en avant, les valeurs sont écrites dessous */
function barresHtml(items, opts = {}) {
  const max = Math.max(0, ...items.map((x) => x.v)); if (!(max > 0)) return '<p class="empty">Pas encore de données.</p>';
  const top = items.reduce((a, x) => (x.v > a.v ? x : a), items[0]);
  return `<div class="sst-bars${opts.serre ? ' serre' : ''}" role="img" aria-label="${esc(opts.titre || '')}">${items.map((x) => `<div class="sst-col${x === top ? ' top' : ''}" title="${esc(x.titre || '')}">
    <span class="sst-v">${x === top || !opts.seulTop ? esc(x.lib2 || '') : ''}</span><span class="sst-track"><i style="height:${Math.max(2, Math.round(x.v / max * 100))}%"></i></span><span class="sst-l">${esc(x.lib)}</span>${x.sous ? `<span class="sst-s">${x.sous}</span>` : ''}</div>`).join('')}</div>`;
}

function conseilProduit(g) {
  if (g.comptes < 2) return { cls: '', txt: 'Pas assez de comptages pour conclure' };
  const ep = g.epuise / g.comptes, part = g.vendu + g.repris > 0 ? g.vendu / (g.vendu + g.repris) : 1;
  if (ep >= 0.5 && part >= 0.85) return { cls: 'plus', txt: `⬆ Prévoir plus : épuisé à ${g.epuise} comptage${g.epuise > 1 ? 's' : ''} sur ${g.comptes}` };
  if (part < 0.6) return { cls: 'moins', txt: `⬇ Moins à la fois : ${Math.round((1 - part) * 100)} % repris invendu` };
  if (ep >= 0.5) return { cls: 'plus', txt: `🔁 Remplir plus souvent : épuisé à ${g.epuise} comptages sur ${g.comptes}` };
  return { cls: 'ok', txt: '✓ Bon équilibre' };
}

function renderStatsSelf() {
  const F = filmStand();
  const ans = [...new Set(misesEnVente().map((x) => yearOf(x.date)).concat(Object.keys(F.par), [todayISO().slice(0, 4)]))].filter(Boolean).sort().reverse();
  const y = SST.an && ans.includes(SST.an) ? SST.an : ans[0];
  const misY = misesEnVente().filter((x) => yearOf(x.date) === y).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const sansComptage = !pointsStand().some((p) => yearOf(p.date) === y);
  const arts = Object.values(F.par[y] || {}).map((o) => sansComptage ? Object.assign({}, o, { vendu: o.mis, venduV: o.misV, estime: true }) : o).filter((o) => o.mis > 0 || o.vendu > 0);

  /* L'argent et la saison */
  const encY = encaissementsVD().filter((r) => yearOf(r.date) === y), msgY = paiementsMessage().filter((x) => yearOf(x.date) === y);
  const encaisse = r2(encY.reduce((a, r) => a + num(r.montant), 0) + msgY.reduce((a, x) => a + num(x.montant), 0));
  const d0 = misY.length ? misY[0].date : '', d1 = misY.length ? (y === todayISO().slice(0, 4) ? todayISO() : misY[misY.length - 1].date) : '';
  const semaines = d0 ? Math.max(1, Math.round((new Date(d1 + 'T12:00') - new Date(d0 + 'T12:00')) / (7 * 864e5)) || 1) : 0;
  const ecartRempl = misY.length > 1 ? Math.round((new Date(misY[misY.length - 1].date + 'T12:00') - new Date(d0 + 'T12:00')) / 864e5 / (misY.length - 1)) : 0;
  const tw = paiementsTwintSelf().filter((t) => yearOf(t.date) === y), panier = tw.length ? r2(tw.reduce((a, t) => a + num(t.montant), 0) / tw.length) : 0;
  const ptsY = pointsStand().filter((p) => yearOf(p.date) === y), manque = r2(ptsY.reduce((a, p) => a + Math.max(0, num(p.manque)), 0));
  const venduV = r2(arts.reduce((a, o) => a + o.venduV, 0));

  /* Jours de la semaine (paiements TWINT) et jours de remplissage */
  const parJ = JOURS_COURTS.map(() => ({ n: 0, v: 0 })), rempJ = JOURS_COURTS.map(() => 0);
  for (const t of tw) { const j = jourSem(t.date); parJ[j].n++; parJ[j].v += num(t.montant); }
  for (const s of misY) rempJ[jourSem(s.date)]++;
  const meilleurJ = parJ.reduce((a, x, i) => (x.v > parJ[a].v ? i : a), 0);
  /* Heures (si connues) */
  const avecH = tw.filter((t) => /^\d{2}:/.test(t.heure || '')), tranches = [[6, 9], [9, 12], [12, 14], [14, 17], [17, 20], [20, 23]];
  const parH = tranches.map(([a, b]) => ({ a, b, n: 0, v: 0 }));
  for (const t of avecH) { const h = Number(t.heure.slice(0, 2)), x = parH.find((z) => h >= z.a && h < z.b); if (x) { x.n++; x.v += num(t.montant); } }
  /* Mois */
  const parM = Array.from({ length: 12 }, () => 0);
  for (const r of encY) parM[Number(String(r.date).slice(5, 7)) - 1] += num(r.montant);
  for (const x of msgY) parM[Number(String(x.date).slice(5, 7)) - 1] += num(x.montant);
  const mois = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  const m0 = parM.findIndex((v) => v > 0), m1 = 11 - [...parM].reverse().findIndex((v) => v > 0);

  /* Par produit (tous calibres et articles d'un même produit ensemble), pour l'an prochain */
  const parP = {};
  for (const o of arts) {
    const p = DB.get(o.prod) || {}, g = parP[o.prod] = parP[o.prod] || { prod: o.prod, nom: p.nom || o.nom, kg: 0, pc: 0, lots: 0, u: p.unite || o.unite, venduV: 0, vendu: 0, repris: 0, comptes: 0, epuise: 0, remplis: 0 };
    g.venduV += o.venduV; g.vendu += o.vendu; g.repris += o.repris; g.comptes = Math.max(g.comptes, o.comptes); g.epuise = Math.max(g.epuise, o.epuise); g.remplis += o.remplis;
    if (o.poids > 0 && (o.unite === 'pièce' || o.unite === 'lot')) g.kg += o.vendu * o.poids; else if (/^kg$/i.test(o.unite)) g.kg += o.vendu; else if (o.unite === 'lot') g.lots += o.vendu; else g.pc += o.vendu;
  }
  const prods = Object.values(parP).sort((a, b) => b.venduV - a.venduV);
  const tri = arts.slice().sort((a, b) => b.venduV - a.venduV), totV = tri.reduce((a, o) => a + o.venduV, 0);

  /* En bref */
  const bref = [];
  if (tri[0]) bref.push(`🥇 <b>${esc(tri[0].nom)}</b> part le mieux : ${chf(tri[0].venduV)}${totV ? `, ${Math.round(tri[0].venduV / totV * 100)} % des ventes du stand` : ''}.`);
  if (tw.length >= 7) bref.push(`📅 C'est le <b>${JOURS[meilleurJ]}</b> qu'on vend le plus (${Math.round(parJ[meilleurJ].v / (tw.reduce((a, t) => a + num(t.montant), 0) || 1) * 100)} % des paiements TWINT).`);
  const aRemplir = arts.filter((o) => o.comptes >= 2 && o.epuise / o.comptes >= 0.5).sort((a, b) => b.epuise / b.comptes - a.epuise / a.comptes);
  if (aRemplir.length) bref.push(`🔁 Souvent épuisé : ${aRemplir.slice(0, 3).map((o) => `<b>${esc(o.nom)}</b>`).join(', ')}.`);
  const lents = arts.filter((o) => o.vendu + o.repris > 0 && o.vendu / (o.vendu + o.repris) < 0.6);
  if (lents.length) bref.push(`🐢 Part lentement : ${lents.slice(0, 3).map((o) => `<b>${esc(o.nom)}</b>`).join(', ')}.`);
  const maxRemp = Math.max(...rempJ); if (maxRemp > 0 && tw.length >= 7) { const jr = rempJ.indexOf(maxRemp); if (jr !== meilleurJ) bref.push(`🧺 Vous remplissez surtout le ${JOURS[jr]} : remplir le ${JOURS[(meilleurJ + 6) % 7]} donnerait un stand plein pour le ${JOURS[meilleurJ]}.`); }

  const fq = (q, u) => `${fmtQty(r2(q))} <span class="hint">${esc(uniteCourteS(u))}</span>`;
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) + ' %' : '—');
  return `<div class="row"><a class="btn small" href="#/factures/selfservice">← Self-service</a></div>
  <div class="panel sst">
    <div class="between"><h2>📊 Statistiques du self-service</h2>${ans.length > 1 ? `<div class="chips">${ans.map((a) => `<button type="button" class="chip${a === y ? ' on' : ''}" data-act="sstAn" data-y="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}</div>
    ${!misY.length ? '<p class="empty">Pas encore de remplissage cette année.</p>' : `
    <div class="stats">
      <div class="stat"><span class="k">Encaissé ${esc(y)}</span><span class="v">${chf(encaisse)}</span><span class="s">TWINT, espèces et par message</span></div>
      <div class="stat"><span class="k">Par semaine</span><span class="v">${chf(semaines ? encaisse / semaines : 0)}</span><span class="s">sur ${semaines} semaine${semaines > 1 ? 's' : ''} de stand</span></div>
      <div class="stat"><span class="k">Remplissages</span><span class="v">${misY.length}</span><span class="s">${ecartRempl ? `un tous les ${ecartRempl} jours` : ''}</span></div>
      <div class="stat"><span class="k">Paiement TWINT moyen</span><span class="v">${tw.length ? chf(panier) : '—'}</span><span class="s">${tw.length} paiement${tw.length > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="k">Manque aux comptages</span><span class="v">${chf(manque)}</span><span class="s">${venduV ? pct(manque, venduV) + ' de ce qui est parti' : ''}</span></div>
    </div>
    ${bref.length ? `<ul class="sst-bref">${bref.map((b) => `<li>${b}</li>`).join('')}</ul>` : ''}

    <div class="sst-grille">
      <section><h3>Les jours de vente</h3>
        ${tw.length ? barresHtml(parJ.map((x, i) => ({ v: x.v, lib: JOURS_COURTS[i], lib2: chf(x.v).replace('CHF ', ''), titre: `${JOURS[i]} : ${x.n} paiement${x.n > 1 ? 's' : ''} · ${chf(x.v)}`, sous: `${x.n}${rempJ[i] ? ` · 🧺${rempJ[i]}` : ''}` })), { titre: 'Paiements TWINT par jour de la semaine', seulTop: true })
          + `<p class="hint">Montant des paiements TWINT par jour (dessous : nombre de paiements · 🧺 remplissages). Les espèces sont comptées en une fois, elles ne disent pas le jour.</p>` : '<p class="empty">Il faut des paiements TWINT (mails TWINT ou relevé) pour voir les jours.</p>'}
      </section>
      <section><h3>Les heures</h3>
        ${avecH.length >= 5 ? barresHtml(parH.map((x) => ({ v: x.n, lib: `${x.a}–${x.b}h`, lib2: String(x.n), titre: `${x.a} h – ${x.b} h : ${x.n} paiement${x.n > 1 ? 's' : ''} · ${chf(x.v)}`, sous: '' })), { titre: 'Paiements TWINT par heure', seulTop: false }) + `<p class="hint">Nombre de paiements TWINT par tranche horaire (${avecH.length} paiements dont l'heure est connue).</p>`
          : '<p class="empty">L\'heure vient des mails TWINT : elle apparaîtra au fil des paiements.</p>'}
      </section>
    </div>

    <section><h3>Par mois</h3>
      ${m0 >= 0 ? barresHtml(parM.slice(m0, m1 + 1).map((v, i) => ({ v, lib: mois[m0 + i], lib2: Math.round(v) ? String(Math.round(v)) : '', titre: `${mois[m0 + i]} : ${chf(v)}` })), { titre: 'Encaissé par mois', serre: true }) + '<p class="hint">Encaissé par mois, en CHF.</p>' : '<p class="empty">Rien d\'encaissé cette année.</p>'}
    </section>

    <section><h3>Ce qui part le mieux</h3>
      ${tri.length ? `<div class="table-wrap"><table class="list sst-table"><thead><tr><th>Article</th><th class="r">Vendu</th><th class="r">Par semaine</th><th class="r">Remplissages</th><th class="r" title="Comptages où il n'en restait plus">Épuisé</th><th class="r" title="Part de ce qui a quitté le stand qui a été vendu (le reste a été repris)">Écoulé</th></tr></thead><tbody>
        ${tri.map((o, i) => { const sem = Math.max(1, Math.round((new Date((o.a || o.de) + 'T12:00') - new Date(o.de + 'T12:00')) / (7 * 864e5)) || 1), ec = o.vendu + o.repris > 0 ? o.vendu / (o.vendu + o.repris) : null;
          return `<tr><td>${i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${esc(o.nom)}<div class="sst-part"><i style="width:${totV ? Math.round(o.venduV / totV * 100) : 0}%"></i></div></td><td class="r num">${fq(o.vendu, o.unite)}<br>${money(o.venduV)}</td><td class="r num">${fq(Math.round(o.vendu / sem * 10) / 10, o.unite)}</td><td class="r num">${o.remplis}</td><td class="r num">${o.comptes ? `${o.epuise}/${o.comptes}` : '—'}</td><td class="r num${ec != null && ec < 0.6 ? ' bad' : ''}">${ec == null ? '—' : Math.round(ec * 100) + ' %'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="hint">${sansComptage ? '⚠️ Aucun comptage du stand cette année : « vendu » = ce qui a été mis en vente, moins les retours. Compter le stand de temps en temps rend tout ça exact.' : 'Vendu = ce qui était sur le stand (dernier comptage + remplissages) moins ce qui reste au comptage suivant ; le manque (vol, pertes) y est compris. Ce qui est sur le stand depuis le dernier comptage n\'est pas encore compté.'}</p>` : '<p class="empty">Rien de vendu au self cette année.</p>'}
    </section>

    <section><h3>🌱 Pour les cultures de l'an prochain</h3>
      ${prods.length ? `<div class="items sst-conseils">${prods.map((g) => { const c = conseilProduit(g), cu = typeof cultureDuProduit === 'function' ? cultureDuProduit(DB.get(g.prod) || {}, y) : null;
        return `<div class="item sst-conseil ${c.cls}"><span class="who"><strong>${esc(g.nom)}</strong><span class="meta">${[g.kg ? `${fmtQty(r2(g.kg))} kg` : '', g.pc ? `${fmtQty(r2(g.pc))} pc` : '', g.lots ? `${fmtQty(r2(g.lots))} lot${g.lots > 1 ? 's' : ''}` : '', chf(g.venduV), cu ? 'culture : ' + esc(cu.nom) : ''].filter(Boolean).join(' · ')}</span></span><span class="sst-avis">${esc(c.txt)}</span></div>`; }).join('')}</div>
      <p class="hint">Quantités vendues au self en ${esc(y)}. « Prévoir plus » : souvent épuisé et presque rien de repris. « Moins à la fois » : une bonne part revient invendue.</p>` : '<p class="empty">Pas encore de données.</p>'}
    </section>`}
  </div>`;
}
