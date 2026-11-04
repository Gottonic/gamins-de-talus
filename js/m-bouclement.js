/* Gamins de Talus — fin d'année : vérifications, résumé des comptes et archive à garder 10 ans
   (PDF des comptes, tableaux CSV, factures émises en PDF, justificatifs joints aux dépenses).
   cfg:archive:AAAA:personne = { le, fichiers, manquants } : qui a téléchargé l'archive, et quand (une ligne par personne). Les justificatifs
   ne sont retirés de l'app (après 2 ans) que si l'archive de leur année a été téléchargée. */
'use strict';

const BCL = { annee: '', enCours: false, etape: '' };
const anneeBouclement = () => { const t = todayISO(), y = Number(t.slice(0, 4)); return String(Number(t.slice(5, 7)) <= 6 ? y - 1 : y); };
/* Qui a téléchargé l'archive de l'année y : { personne: { le, … } } */
function archivesDe(y) {
  const o = {}; for (const a of DB.all('cfg:archive:' + y + ':')) o[a.key.split(':').pop()] = a;
  const vieux = DB.get('cfg:archive:' + y); if (vieux && vieux.par && !o[vieux.par]) o[vieux.par] = vieux;
  return o;
}
const archiveDe = (y) => Object.keys(archivesDe(y)).length > 0;
/* Les associés de l'année (part > 0 au 31.12) qui n'ont pas encore téléchargé l'archive */
function archiveManquePour(y) { const P = parts(cfg(), y + '-12-31'), a = archivesDe(y); return personnes().filter((p) => P[p.k] > 0 && !a[p.k]); }

/* Résultat de l'année et part de chacun (chaque montant partagé selon les associés à sa date ; amortissements au 31.12) */
function comptesAnnee(y) {
  const c = cfg(), des = !!c.amortirDesAchat, ps = personnes();
  const deps = depenses().filter((d) => yearOf(d.date) === y).sort((a, b) => String(a.date).localeCompare(b.date) || (a.n || 0) - (b.n || 0));
  const recs = recettesToutes().filter((r) => yearOf(r.date) === y).sort((a, b) => String(a.date).localeCompare(b.date));
  const charges = deps.filter((d) => d.type !== 'investissement'), invest = deps.filter((d) => d.type === 'investissement');
  const inv = inventaire();
  /* Par objet : valeur au 01.01, achats de l'année (ajouts), amortissement, valeur au 31.12 (comme le tableau des amortissements des impôts) */
  const amortItems = inv.map((i) => ({ i, a: amortissementAnnee(i, Number(y), des), v0: valeurFinAnnee(i, Number(y) - 1, des), v1: valeurFinAnnee(i, Number(y), des), ajouts: partsInv(i).filter((p) => yearOf(p.date || i.dateAchat) === y).reduce((s2, p) => s2 + num(p.valeur), 0) })).filter((x) => x.a > 0.004 || x.v1 > 0.004 || x.ajouts > 0);
  const tot = (l) => l.reduce((a, x) => a + num(x.montant), 0);
  const o = { y, deps, recs, charges, invest, amortItems, rec: tot(recs), ch: tot(charges), inv: tot(invest), amort: amortItems.reduce((a, x) => a + x.a, 0) };
  o.resultat = o.rec - o.ch - o.amort;
  o.cat = {}; for (const d of charges) { const k = libCompte(compteDe(d)); o.cat[k] = (o.cat[k] || 0) + num(d.montant); }
  o.recCat = {}; for (const r of recs) { const k = libCompte(compteRecette(r)); o.recCat[k] = (o.recCat[k] || 0) + num(r.montant); }
  o.direct = Object.entries(o.cat).filter(([k]) => k.startsWith('4')).reduce((a, [, v]) => a + v, 0);
  const part = {}; ps.forEach((p) => { part[p.k] = 0; });
  for (const r of recs) { const P = parts(c, r.date); ps.forEach((p) => { part[p.k] += num(r.montant) * P[p.k]; }); }
  for (const d of charges) { const P = parts(c, d.date); ps.forEach((p) => { part[p.k] -= num(d.montant) * P[p.k]; }); }
  const P31 = parts(c, y + '-12-31'); ps.forEach((p) => { part[p.k] -= o.amort * P31[p.k]; });
  o.part = part; o.P31 = P31;
  o.heures = totalHeures(heuresToutes(), (h) => yearOf(h.date) === y);
  o.facturesY = factures().filter((f) => yearOf(f.date) === y && f.numero).sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  o.ouvertes = factures().filter((f) => f.date <= y + '-12-31' && ['ouverte', 'retard'].includes(facStatut(f)));
  o.valeurInv = inv.reduce((a, i) => a + valeurFinAnnee(i, Number(y), des), 0);
  const lies = new Set(inv.flatMap((i) => [i.depenseId].concat((i.parts || []).map((p) => p.depenseId))).filter(Boolean));
  o.investHorsInv = invest.filter((d) => !lies.has(d.key));
  o.sansJ = deps.filter(sansJustificatif);
  o.blY = factures().filter((f) => yearOf(f.date) === y && f.blNumero).sort((a, b) => String(a.blNumero).localeCompare(String(b.blNumero)));
  o.nFichiers = deps.reduce((a, d) => a + (d.fichiers || []).filter((f) => !f.expire).length, 0) + o.blY.reduce((a, f) => a + (f.blSigne || []).filter((x) => !x.expire).length, 0);
  return o;
}

function renderBouclement() {
  const ys = anneesFin(); if (!BCL.annee) BCL.annee = ys.includes(anneeBouclement()) ? anneeBouclement() : ys[0];
  const y = BCL.annee, o = comptesAnnee(y), ar = archivesDe(y), manque = archiveManquePour(y), ps = personnes();
  const fini = y < todayISO().slice(0, 4);
  const chk = (ok, txt, lien, act) => `<li class="${ok ? 'ok' : 'todo'}"><span class="ck">${ok ? '✓' : '!'}</span><span>${txt}</span>${!ok && lien ? `<a class="btn small" href="${lien}"${act ? ` data-act="${act}"` : ''}>Voir</a>` : ''}</li>`;
  return `    <div class="bcl-l">
      <div class="panel"><h2>Bouclement ${y}</h2>
        <ul class="checklist">
          ${chk(fini, fini ? `L'année ${y} est terminée.` : `L'année ${y} n'est pas encore finie : l'archive sera provisoire.`)}
          ${chk(!o.sansJ.length, o.sansJ.length ? `<b>${o.sansJ.length} dépense${o.sansJ.length > 1 ? 's' : ''} sans justificatif</b> (${chf(o.sansJ.reduce((a, d) => a + num(d.montant), 0))})` : 'Toutes les dépenses ont leur justificatif.', '#/finances/depenses', 'goSansJ')}
          ${chk(!o.investHorsInv.length, o.investHorsInv.length ? `${o.investHorsInv.length} investissement${o.investHorsInv.length > 1 ? 's' : ''} relié${o.investHorsInv.length > 1 ? 's' : ''} à aucun objet de l'inventaire : vérifie qu'ils y sont (sinon ils ne sont pas amortis)` : "Les investissements sont tous dans l'inventaire.", '#/finances/inventaire')}
          ${chk(!o.ouvertes.length, o.ouvertes.length ? `${o.ouvertes.length} facture${o.ouvertes.length > 1 ? 's' : ''} pas encore payée${o.ouvertes.length > 1 ? 's' : ''} au 31.12 (${chf(o.ouvertes.reduce((a, f) => a + f.total, 0))}) : à noter comme « à recevoir »` : 'Toutes les factures émises sont payées.', '#/factures')}
          ${chk(true, `Heures ${y} : ${ps.map((p) => `${esc(p.nom)} ${fmtH(o.heures[p.k] || 0)} h`).join(', ')}.`)}
        </ul>
        <h3>Relevés de l'année</h3>
        ${(() => { const e = relEtat(y), R = relDe(y); const st = (k, n) => R[k] ? `✓ ${n} ajouté` : e[k] ? `${n} vérifié le ${fmtDate(String(e.le).slice(0, 10))}` : `${n} : pas encore`; return `<p class="hint">${st('twint', 'TWINT')} · ${st('banque', 'banque')}. Le relevé TWINT et le relevé bancaire de l'année vont dans l'archive et servent à vérifier les recettes, les factures et les dépenses.</p>${rapportRelevesHtml(y)}`; })()}
        <div class="row"><button class="btn" type="button" data-act="relOuvrir">Ajouter les relevés et vérifier</button></div>
        <h3>L'archive de l'année</h3>
        <p class="hint">Un fichier .zip avec les comptes en PDF, les tableaux (dépenses, recettes, inventaire, heures), toutes les factures émises et les bulletins de livraison en PDF (avec la photo signée quand il y en a une), et tous les justificatifs joints (${o.nFichiers} fichier${o.nFichiers > 1 ? 's' : ''}).
          C'est ce qu'il faut pour la déclaration d'impôts et pour ce que la caisse AVS vous demande de déclarer. Chaque associé la télécharge une fois pour ses propres déclarations. <b>À garder 10 ans</b>, par exemple dans votre Proton Drive.</p>
        <div class="row"><button class="btn primary" type="button" data-act="bclZip"${BCL.enCours ? ' disabled' : ''}>${BCL.enCours ? esc(BCL.etape || 'Préparation…') : `Télécharger l'archive ${y}`}</button>
          <button class="btn" type="button" data-act="bclPdf"${BCL.enCours ? ' disabled' : ''}>Seulement le PDF des comptes</button>
        <button class="btn" type="button" data-act="expAutre"${BCL.enCours ? ' disabled' : ''}>Exportation autre…</button></div>
        <p class="hint">${Object.keys(ar).length ? 'Téléchargée par ' + Object.entries(ar).map(([k, a]) => `${esc(nomDe(k))} le ${fmtDate(String(a.le).slice(0, 10))}${a.manquants ? ` (${a.manquants} fichier(s) manquant(s))` : ''}`).join(', ') + '.' : "L'archive de cette année n'a encore été téléchargée par personne."}
          ${manque.length ? `<b>Pas encore téléchargée par ${esc(manque.map((p) => p.nom).join(', '))}.</b>` : ''}
          Conservation dans l'app : photos des messages 6 mois ; justificatifs et bulletins signés 2 ans, et seulement une fois l'archive de leur année téléchargée.</p>
      </div>
    </div>`;
}
ACTIONS.bclAnnee = (el) => { BCL.annee = el.dataset.y; render(); };

/* ---------- PDF des comptes ---------- */
const pdfM = (n) => group(Number(n) || 0, "'").replace('−', '-');
const pdfTxt = (s) => String(s ?? '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/−/g, '-').replace(/[^\x20-\x7E -ÿ–—…•€]/g, '');
function pdfComptes(o) {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' }), c = cfg(), ps = personnes();
  const L = 18, R = 192; let y = 20, page = 1;
  const pied = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120); doc.text(pdfTxt(`${c.nom} · Comptes ${o.y} · page ${page}`), L, 289); doc.text(pdfTxt(`Établi le ${fmtDate(todayISO())}`), R, 289, { align: 'right' }); doc.setTextColor(0); };
  const saut = (h) => { if (y + h > 280) { pied(); doc.addPage(); page++; y = 20; } };
  const t = (s, x, o2 = {}) => { doc.setFont('helvetica', o2.bold ? 'bold' : 'normal'); doc.setFontSize(o2.size || 10); doc.text(pdfTxt(s), x, y, { align: o2.align || 'left', maxWidth: o2.max }); };
  const titre = (s) => { saut(28); y += 4; t(s, L, { bold: true, size: 13 }); y += 2; doc.setLineWidth(0.3); doc.line(L, y, R, y); y += 6; };
  const ligne = (a, b, o2 = {}) => { saut(7); t(a, L + (o2.ind || 0), { bold: o2.bold }); t(b, R, { align: 'right', bold: o2.bold }); y += 6; };
  /* Tableau : cols = [{ titre, l (largeur), r (à droite) }] */
  const tableau = (cols, rows, total) => {
    const entete = () => { saut(10); let x = L; doc.setFillColor(238, 238, 232); doc.rect(L, y - 4.2, R - L, 6, 'F'); cols.forEach((cl) => { t(cl.titre, cl.r ? x + cl.l - 1 : x + 1, { bold: true, size: 8.5, align: cl.r ? 'right' : 'left' }); x += cl.l; }); y += 6; };
    entete();
    for (const r of rows) {
      if (y + 6 > 280) { pied(); doc.addPage(); page++; y = 20; entete(); }
      let x = L; cols.forEach((cl, i) => { const v = pdfTxt(r[i]); const s = doc.splitTextToSize(v, cl.l - 2)[0] || ''; t(s, cl.r ? x + cl.l - 1 : x + 1, { size: 8.5, align: cl.r ? 'right' : 'left' }); x += cl.l; });
      y += 5;
    }
    if (total) { doc.setLineWidth(0.2); doc.line(L, y - 3.5, R, y - 3.5); let x = L; cols.forEach((cl, i) => { if (total[i] != null) t(total[i], cl.r ? x + cl.l - 1 : x + 1, { size: 8.5, bold: true, align: cl.r ? 'right' : 'left' }); x += cl.l; }); y += 6; }
  };

  t(c.nom, L, { bold: true, size: 20 }); y += 8;
  t(`Comptes de l'année ${o.y} (1er janvier – 31 décembre)`, L, { size: 12 }); y += 6;
  const adr = [[c.rue, c.numero].filter(Boolean).join(' '), [c.npa, c.localite].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  t([adr, 'Associés : ' + ps.filter((p) => o.P31[p.k] > 0 || Math.abs(o.part[p.k]) > 0.004).map((p) => p.nom).join(', '), c.mention].filter(Boolean).join(' · '), L, { size: 9, max: R - L }); y += 8;

  titre('Compte de résultat');
  ligne('Produits (recettes encaissées)', pdfM(o.rec), { bold: true });
  Object.entries(o.recCat).sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => ligne(k, pdfM(v), { ind: 6 }));
  ligne('Charges directes (matériel et fournitures)', '- ' + pdfM(o.direct), { bold: true });
  Object.entries(o.cat).filter(([k]) => k.startsWith('4')).sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => ligne(k, pdfM(v), { ind: 6 }));
  ligne('Marge brute', pdfM(o.rec - o.direct), { bold: true });
  ligne("Autres charges d'exploitation", '- ' + pdfM(o.ch - o.direct), { bold: true });
  Object.entries(o.cat).filter(([k]) => !k.startsWith('4')).sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => ligne(k, pdfM(v), { ind: 6 }));
  ligne("6800 Amortissements (voir l'inventaire)", '- ' + pdfM(o.amort));
  ligne(`Résultat ${o.y}`, 'CHF ' + pdfM(o.resultat), { bold: true });

  titre('Part du résultat de chaque associé');
  ps.filter((p) => o.P31[p.k] > 0 || Math.abs(o.part[p.k]) > 0.004).forEach((p) => ligne(p.nom, 'CHF ' + pdfM(o.part[p.k])));
  saut(10); t('Chaque recette et chaque charge est partagée selon les associés à sa date ; les amortissements selon les parts au 31.12.', L, { size: 8.5, max: R - L }); y += 6;

  titre('Patrimoine au 31 décembre');
  ligne('Valeur de l\'inventaire (après amortissements)', pdfM(o.valeurInv));
  ligne(`Factures émises pas encore payées (à recevoir) : ${o.ouvertes.length}`, pdfM(o.ouvertes.reduce((a, f) => a + f.total, 0)));
  ligne(`Investissements de l'année`, pdfM(o.inv));

  titre('Heures de travail');
  ps.forEach((p) => ligne(p.nom, fmtH(o.heures[p.k] || 0) + ' h'));

  titre(`Recettes ${o.y} (${o.recs.length})`);
  tableau([{ titre: 'Date', l: 22 }, { titre: 'Client / libellé', l: 66 }, { titre: 'Moyen', l: 24 }, { titre: 'Encaissé par', l: 26 }, { titre: 'Pièce', l: 20 }, { titre: 'Montant', l: 16, r: true }],
    o.recs.map((r) => [fmtDate(r.date), r.libelle, r.moyen, nomDe(r.par), r.src === 'facture' ? r.ref : '', pdfM(r.montant)]), [null, null, null, null, 'Total', pdfM(o.rec)]);

  titre(`Dépenses ${o.y} (${o.deps.length})`);
  tableau([{ titre: 'N°', l: 10 }, { titre: 'Date', l: 20 }, { titre: 'Objet', l: 60 }, { titre: 'Compte', l: 30 }, { titre: 'Payé par', l: 20 }, { titre: 'Justif.', l: 18 }, { titre: 'Montant', l: 16, r: true }],
    o.deps.map((d) => [d.n || '', fmtDate(d.date), d.objet + (d.type === 'investissement' ? ' (invest.)' : ''), libCompte(compteDe(d)), nomDe(d.par), (d.fichiers || []).length ? 'joint' : d.justificatif ? 'réf.' : 'MANQUE', pdfM(d.montant)]),
    [null, null, null, null, null, 'Total', pdfM(o.ch + o.inv)]);

  titre('Inventaire et amortissements');
  tableau([{ titre: 'Objet', l: 52 }, { titre: 'Achat', l: 20 }, { titre: 'Amort.', l: 14, r: true }, { titre: 'Valeur 01.01', l: 24, r: true }, { titre: 'Achats', l: 22, r: true }, { titre: 'Amort.', l: 20, r: true }, { titre: 'Valeur 31.12', l: 22, r: true }],
    o.amortItems.map((x) => [x.i.nom, x.i.dateAchat ? fmtDate(x.i.dateAchat) : '', amortTxt(x.i), pdfM(x.v0), x.ajouts ? pdfM(x.ajouts) : '', pdfM(x.a), pdfM(x.v1)]),
    [null, null, null, null, 'Total', pdfM(o.amort), pdfM(o.valeurInv)]);
  saut(8); t("Achats : investissements de l'année rangés dans l'objet. % = amortissement dégressif (sur la valeur restante), ans = linéaire.", L, { size: 8 }); y += 6;

  if (o.ouvertes.length) {
    titre('Factures à recevoir au 31.12');
    tableau([{ titre: 'N°', l: 30 }, { titre: 'Date', l: 22 }, { titre: 'Client', l: 90 }, { titre: 'Échéance', l: 20 }, { titre: 'Montant', l: 12, r: true }],
      o.ouvertes.map((f) => [f.numero || f.blNumero || 'vente', fmtDate(f.date), f.client.nom, fmtDate(f.echeance), pdfM(f.total)]));
  }
  pied();
  return doc.output('blob');
}

/* ---------- Archive zip ---------- */
const nomZip = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
function csvAnnee(o) {
  const ps = personnes();
  const dep = csv(['N°', 'Date', 'Montant', 'Objet', 'Type', 'Compte', 'Payé par', 'Justificatif', 'Fichiers joints', 'Remarque'],
    o.deps.map((d) => [d.n || '', fmtDate(d.date), r2(d.montant).toFixed(2), d.objet, d.type === 'investissement' ? 'Investissement' : 'Charge', libCompte(compteDe(d)), nomDe(d.par), d.justificatif, (d.fichiers || []).length, d.remarque]));
  const rec = csv(['Date', 'Montant', 'Client / libellé', 'Compte', 'Moyen', 'Encaissé par', 'Origine'],
    o.recs.map((r) => [fmtDate(r.date), r2(r.montant).toFixed(2), r.libelle, libCompte(compteRecette(r)), r.moyen, nomDe(r.par), r.src === 'facture' ? 'Facture ' + r.ref : 'Saisie directe']));
  const inv = csv(['Objet', 'Catégorie', "Date d'achat", "Valeur d'achat totale", 'Amortissement (taux ou durée)', 'Valeur 01.01', "Achats de l'année", 'Amortissement', 'Valeur 31.12'],
    o.amortItems.map((x) => [x.i.nom, x.i.categorie, fmtDate(x.i.dateAchat), r2(x.i.valeur).toFixed(2), amortTxt(x.i), r2(x.v0).toFixed(2), r2(x.ajouts).toFixed(2), r2(x.a).toFixed(2), r2(x.v1).toFixed(2)]));
  const hs = heuresToutes().filter((h) => yearOf(h.date) === o.y && (num(h.heures) || h.off)).sort((a, b) => String(a.date).localeCompare(b.date));
  const heu = csv(['Date', 'Personne', 'Heures', 'Off', 'Note'], hs.map((h) => [fmtDate(h.date), nomDe(h.personne), h.heures ? String(h.heures).replace('.', ',') : '', h.off ? 'off' : '', h.note || '']));
  return { dep, rec, inv, heu, ps };
}
async function telechargerFichier(chemin) {
  if (LOCAL_MODE) { const u = Fichiers.local[chemin]; if (!u) throw new Error('absent'); return (await fetch(u)).blob(); }
  const { data, error } = await Sync.sb.storage.from(FICHIERS_SEAU).download(chemin);
  if (error) throw error; return data;
}
ACTIONS.bclPdf = () => { const o = comptesAnnee(BCL.annee); downloadFile(`Comptes ${cfg().nom} ${o.y}.pdf`, pdfComptes(o), 'application/pdf'); };
ACTIONS.bclZip = async (el) => {
  if (BCL.enCours) return;
  /* Avant l'archive : les relevés TWINT et bancaire de l'année (on peut continuer sans) */
  const R0 = relDe(BCL.annee); if (!(el && el.dataset && el.dataset.sansDemander) && !R0.twint && !R0.banque) { relevesFeuille(BCL.annee, 'archive'); return; }
  if (!window.JSZip) { toast("L'outil d'archive n'est pas chargé. Recharge la page."); return; }
  const o = comptesAnnee(BCL.annee), c = cfg(), base = nomZip(`${c.nom} - Comptes ${o.y}`);
  if (o.nFichiers && !navigator.onLine && !LOCAL_MODE) { toast('Il faut du réseau pour récupérer les justificatifs.'); return; }
  BCL.enCours = true; BCL.etape = 'Comptes…'; render();
  const etape = (s) => { BCL.etape = s; const b = document.querySelector('[data-act="bclZip"]'); if (b) b.textContent = s; };
  try {
    const z = new window.JSZip(), dir = z.folder(base);
    dir.file(`Comptes ${o.y}.pdf`, pdfComptes(o));
    const releves = ajouterRelevesZip(dir, o.y);
    const t = csvAnnee(o);
    dir.file(`Tableaux/Dépenses ${o.y}.csv`, t.dep); dir.file(`Tableaux/Recettes ${o.y}.csv`, t.rec);
    dir.file(`Tableaux/Inventaire et amortissements ${o.y}.csv`, t.inv); dir.file(`Tableaux/Heures ${o.y}.csv`, t.heu);
    etape('Factures…');
    for (const f of o.facturesY) { try { dir.file(`Factures émises/${nomZip(invoiceFileName(f).replace(/\.pdf$/, '') + (f.statut === 'annulee' ? ' (annulée)' : ''))}.pdf`, invoicePdfBlob(f)); } catch (e) { console.error(e); } }
    const manquants = [], vus = {};
    etape('Bulletins…');
    for (const f of o.blY) {
      const nb = nomZip(bulletinFileName(f).replace(/\.pdf$/, '') + (f.statut === 'annulee' ? ' (annulée)' : ''));
      try { dir.file(`Bulletins de livraison/${nb}.pdf`, bulletinPdfBlob(f, true)); } catch (e) { console.error(e); }
      const sg = (f.blSigne || []).filter((x) => !x.expire);
      for (let i = 0; i < sg.length; i++) {
        try { dir.file(`Bulletins de livraison/${nb} - signé${sg.length > 1 ? ' (' + (i + 1) + ')' : ''}.${sg[i].chemin.split('.').pop() || 'jpg'}`, await telechargerFichier(sg[i].chemin)); }
        catch (e) { manquants.push(`Bulletin ${f.blNumero} signé (${sg[i].nom || sg[i].chemin})`); }
      }
    }
    const fich = o.deps.flatMap((d) => (d.fichiers || []).filter((x) => !x.expire).map((x, i, arr) => ({ d, x, i, n: arr.length })));
    let k = 0;
    for (const { d, x, i, n } of fich) {
      etape(`Justificatifs ${++k}/${fich.length}…`);
      let nom = nomZip(`${d.date} D${String(d.n || '').padStart(3, '0')} ${trunc(d.objet, 40)} ${r2(d.montant).toFixed(2)}${n > 1 ? ' (' + (i + 1) + ')' : ''}`);
      if (vus[nom]) nom += ' ' + (++vus[nom]); else vus[nom] = 1;
      try { dir.file(`Justificatifs/${nom}.${(x.chemin.split('.').pop() || 'jpg')}`, await telechargerFichier(x.chemin)); }
      catch (e) { manquants.push(`${fmtDate(d.date)} ${d.objet} (${x.nom || x.chemin})`); }
    }
    dir.file('LISEZ-MOI.txt', [
      `${c.nom} — archive des comptes ${o.y}`, `Établie le ${fmtDate(todayISO())} par ${nomDe(Sync.me)} depuis l'app Gamins de Talus.`, '',
      `Comptes ${o.y}.pdf : compte de résultat, part de chaque associé, inventaire et amortissements, heures, liste des recettes et des dépenses.`,
      'Tableaux/ : les mêmes données en CSV (s\'ouvrent dans un tableur).', 'Factures émises/ : chaque facture envoyée aux clients, en PDF.', 'Bulletins de livraison/ : chaque bulletin en PDF, suivi de la photo du bulletin signé par le client quand elle a été prise.',
      'Justificatifs/ : tickets et factures des dépenses, nommés « date, n° de dépense, objet, montant ».',
      releves.length ? 'Relevés/ : ' + releves.join(', ') + '.' : 'Relevés TWINT et bancaire : pas ajoutés à cette archive (à garder à côté).', '',
      'À conserver 10 ans (obligation légale de conservation des pièces comptables en Suisse).',
      manquants.length ? '\nFichiers qui n\'ont pas pu être ajoutés :\n- ' + manquants.join('\n- ') : '',
      o.sansJ.length ? `\nDépenses sans justificatif au moment de l'archive : ${o.sansJ.length}.` : '',
    ].join('\r\n'));
    etape('Compression…');
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    downloadFile(base + '.zip', blob, 'application/zip');
    DB.put('cfg:archive:' + o.y + ':' + (Sync.me || 'inconnu'), { le: new Date().toISOString(), fichiers: o.nFichiers - manquants.length, manquants: manquants.length });
    toast(manquants.length ? `Archive téléchargée, mais ${manquants.length} fichier(s) manquent (voir LISEZ-MOI).` : 'Archive téléchargée. Range-la dans votre drive.', 6000);
  } catch (e) { console.error(e); toast("L'archive n'a pas pu être créée : " + (e.message || e), 6000); }
  BCL.enCours = false; BCL.etape = ''; render();
};

/* ---------- Exportation autre : choisir les pièces selon pour qui (impôts, caisse AVS, assurance accident, banque) ----------
   Les présélections suivent ce que ces organismes demandent d'habitude en Suisse ; ils peuvent demander autre chose : la liste reste modifiable. */
const EXP_PIECES = [
  ['comptes', 'Comptes de l\'année (PDF : résultat, part de chaque associé, inventaire et amortissements, listes)'],
  ['recettes', 'Liste des recettes (CSV)'],
  ['depenses', 'Liste des dépenses par compte (CSV)'],
  ['inventaire', 'Inventaire et tableau des amortissements (CSV)'],
  ['partage', 'Partage des dépenses et recettes entre associés (explication)'],
  ['factures', 'Factures émises aux clients (PDF)'],
  ['bulletins', 'Bulletins de livraison (PDF et photos signées)'],
  ['clients', 'Liste des clients et ventes par client (CSV)'],
  ['prospection', 'Démarches commerciales : prospects contactés (CSV)'],
  ['jInvest', 'Justificatifs des investissements (factures d\'achat)'],
  ['jMateriel', 'Justificatifs du matériel : petit matériel, entretien et réparations'],
  ['jFourn', 'Justificatifs des fournitures : semences, plants, engrais, protection, emballages'],
  ['jAutres', 'Autres justificatifs de dépenses'],
  ['heures', 'Feuilles d\'heures (CSV et total par personne)'],
  ['releves', 'Relevés TWINT et bancaire de l\'année (demandés au moment du téléchargement)'],
];
const EXP_PRESETS = [
  ['impots', 'Impôts', ['comptes', 'recettes', 'depenses', 'inventaire', 'partage', 'releves'], 'Déclaration d\'indépendant : relevé des recettes et dépenses, actifs (inventaire) et tableau des amortissements, et la part de chaque associé. Les justificatifs se gardent 10 ans ; on ne les envoie que s\'ils sont demandés.'],
  ['avs', 'Activité indépendante (AVS)', ['comptes', 'factures', 'clients', 'prospection', 'jInvest', 'jMateriel', 'inventaire', 'partage'], 'Pour montrer à la caisse de compensation que c\'est une vraie activité indépendante : factures à plusieurs clients en votre nom, achats de matériel et investissements (risque économique), démarches commerciales, et le partage entre associés.'],
  ['accident', 'Assurance accident', ['comptes', 'partage', 'heures'], 'Le revenu de l\'activité (pour le gain assuré ou une indemnité) et la preuve qu\'on y travaille : comptes, part de chacun, heures.'],
  ['banque', 'Banque ou crédit', ['comptes', 'recettes', 'depenses', 'inventaire', 'clients'], 'Ce qu\'une banque regarde d\'habitude : résultat, patrimoine (inventaire), régularité des recettes et clientèle.'],
  ['tout', 'Tout (fiduciaire)', EXP_PIECES.map((x) => x[0]), 'Tout ce que l\'app a, pour la fiduciaire ou pour vos archives.'],
];
const EXP = { choix: new Set(), preset: '' };
ACTIONS.expAutre = () => { if (!EXP.choix.size) EXP.choix = new Set(EXP_PRESETS[0][2]); expFeuille(); };
function expFeuille() {
  const pr = EXP_PRESETS.find((x) => x[0] === EXP.preset);
  openSheet(`${sheetHead('Exportation autre', 'Année ' + BCL.annee)}<div class="sbody" id="exp-sheet">
    <p class="hint" style="margin-top:0">Pour qui ? Un clic coche ce qu'il faut d'habitude. Tu peux ensuite cocher ou décocher.</p>
    <div class="row">${EXP_PRESETS.map(([k, l]) => `<button type="button" class="chip${EXP.preset === k ? ' on' : ''}" data-act="expPreset" data-k="${k}">${esc(l)}</button>`).join('')}</div>
    ${pr ? `<p class="exp-pour">${esc(pr[3])}</p>` : ''}
    <div class="exp-l">${EXP_PIECES.map(([k, l]) => `<label class="exp-it"><input type="checkbox" data-exp="${k}"${EXP.choix.has(k) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
    <p class="hint">Chaque organisme peut demander d'autres pièces (attestations, contrats, pièce d'identité…) : celles-ci ne sont pas dans l'app. En cas de doute, demande-leur la liste ou à votre fiduciaire.</p>
    <div class="row-end"><button class="btn primary" type="button" data-act="expGo">Télécharger (.zip)</button></div></div>`);
  $('exp-sheet').addEventListener('change', (e) => { const k = e.target.dataset.exp; if (!k) return; if (e.target.checked) EXP.choix.add(k); else EXP.choix.delete(k); });
}
ACTIONS.expPreset = (el) => { const p = EXP_PRESETS.find((x) => x[0] === el.dataset.k); EXP.preset = p[0]; EXP.choix = new Set(p[2]); expFeuille(); };
function textePartage(o) {
  const c = cfg(), ps = personnes(), y = o.y;
  const lignes = [`${c.nom} — partage des recettes et des dépenses entre associés, ${y}`, ''];
  lignes.push('Les associés exploitent l\'activité ensemble. Chaque recette et chaque charge est partagée selon les parts des associés à sa date ; les amortissements selon les parts au 31 décembre.', '');
  lignes.push('Associés et parts :');
  for (const p of ps) lignes.push(`- ${p.nom} : part ${num(p.part == null ? 1 : p.part)}${p.associeDes ? `, associé dès le ${fmtDate(p.associeDes)}` : ''}`);
  lignes.push('', `Parts au 31.12.${y} : ` + ps.filter((p) => o.P31[p.k] > 0).map((p) => `${p.nom} ${Math.round(o.P31[p.k] * 100)} %`).join(', '));
  lignes.push('', `Résultat ${y} : CHF ${pdfM(o.resultat)} (recettes ${pdfM(o.rec)} − charges ${pdfM(o.ch)} − amortissements ${pdfM(o.amort)}).`, 'Part du résultat de chacun :');
  for (const p of ps.filter((x) => Math.abs(o.part[x.k]) > 0.004 || o.P31[x.k] > 0)) lignes.push(`- ${p.nom} : CHF ${pdfM(o.part[p.k])}`);
  lignes.push('', 'Qui a payé ou encaissé quoi : chaque dépense indique qui l\'a payée, chaque recette qui l\'a encaissée. Les écarts entre associés sont remboursés entre eux (décompte dans l\'app) ; ils ne changent pas le résultat.');
  lignes.push('', `Établi le ${fmtDate(todayISO())} depuis l'app ${c.nom}.`);
  return lignes.join('\r\n');
}
async function ajouterJustifs(dir, dossier, deps, manquants, etape) {
  const fich = deps.flatMap((d) => (d.fichiers || []).filter((x) => !x.expire).map((x, i, arr) => ({ d, x, i, n: arr.length }))), vus = {};
  let k = 0;
  for (const { d, x, i, n } of fich) {
    etape(`${dossier} ${++k}/${fich.length}…`);
    let nom = nomZip(`${d.date} D${String(d.n || '').padStart(3, '0')} ${compteDe(d)} ${trunc(d.objet, 40)} ${r2(d.montant).toFixed(2)}${n > 1 ? ' (' + (i + 1) + ')' : ''}`);
    if (vus[nom]) nom += ' ' + (++vus[nom]); else vus[nom] = 1;
    try { dir.file(`${dossier}/${nom}.${(x.chemin.split('.').pop() || 'jpg')}`, await telechargerFichier(x.chemin)); } catch (e) { manquants.push(`${fmtDate(d.date)} ${d.objet} (${x.nom || x.chemin})`); }
  }
  return fich.length;
}
ACTIONS.expGo = async (el) => {
  if (BCL.enCours) return; const ch = EXP.choix; if (!ch.size) { toast('Coche au moins une pièce.'); return; }
  const R0 = relDe(BCL.annee); if (ch.has('releves') && !(el && el.dataset && el.dataset.sansDemander) && !R0.twint && !R0.banque) { relevesFeuille(BCL.annee, 'export'); return; }
  if (!window.JSZip) { toast("L'outil d'archive n'est pas chargé. Recharge la page."); return; }
  const o = comptesAnnee(BCL.annee), c = cfg(), pr = EXP_PRESETS.find((x) => x[0] === EXP.preset), base = nomZip(`${c.nom} - ${pr ? pr[1] : 'Export'} ${o.y}`);
  const b = document.querySelector('[data-act="expGo"]'), etape = (t) => { if (b) b.textContent = t; };
  BCL.enCours = true; if (b) b.disabled = true;
  try {
    const z = new window.JSZip(), dir = z.folder(base), t = csvAnnee(o), manquants = [], contenu = [];
    const ajoute = (k, l) => { if (ch.has(k)) contenu.push('- ' + l); return ch.has(k); };
    if (ajoute('comptes', `Comptes ${o.y}.pdf`)) dir.file(`Comptes ${o.y}.pdf`, pdfComptes(o));
    if (ajoute('recettes', `Recettes ${o.y}.csv`)) dir.file(`Recettes ${o.y}.csv`, t.rec);
    if (ajoute('depenses', `Dépenses ${o.y}.csv (avec le compte de chaque dépense)`)) dir.file(`Dépenses ${o.y}.csv`, t.dep);
    if (ajoute('inventaire', `Inventaire et amortissements ${o.y}.csv`)) dir.file(`Inventaire et amortissements ${o.y}.csv`, t.inv);
    if (ajoute('partage', 'Partage entre associés.txt')) dir.file('Partage entre associés.txt', textePartage(o));
    if (ch.has('releves')) { const l = ajouterRelevesZip(dir, o.y); contenu.push('- Relevés/ : ' + (l.length ? l.join(', ') : 'pas ajoutés (à joindre à part)')); }
    if (ajoute('heures', `Heures ${o.y}.csv`)) {
      const hs = heuresToutes().filter((h) => yearOf(h.date) === o.y && (num(h.heures) || h.off)).sort((a, x) => String(a.date).localeCompare(x.date));
      dir.file(`Heures ${o.y}.csv`, csv(['Date', 'Personne', 'Début', 'Fin', 'Pause (min)', 'Heures', 'Off'], hs.map((h) => [fmtDate(h.date), nomDe(h.personne), h.debut || '', h.fin || '', h.pause || '', h.heures ? String(h.heures).replace('.', ',') : '', h.off ? 'off' : '']))
        + '\r\n\r\n' + csv(['Personne', `Total ${o.y} (heures)`], personnes().map((p) => [p.nom, String(r2(o.heures[p.k] || 0)).replace('.', ',')])).replace(/^\uFEFF/, ''));
    }
    if (ajoute('clients', `Clients ${o.y}.csv`)) {
      const parC = {}; for (const r of o.recs) { const k = r.libelle || '—'; parC[k] = parC[k] || { n: 0, m: 0 }; parC[k].n++; parC[k].m += num(r.montant); }
      dir.file(`Clients ${o.y}.csv`, csv(['Client', 'Ventes', 'Montant CHF', 'Part du chiffre d\'affaires'], Object.entries(parC).sort((a, x) => x[1].m - a[1].m).map(([k, v]) => [k, v.n, r2(v.m).toFixed(2), o.rec ? Math.round(v.m / o.rec * 100) + ' %' : ''])));
    }
    if (ajoute('prospection', `Prospection ${o.y}.csv`)) {
      const rows = []; for (const p of (typeof tousContacts === 'function' ? tousContacts() : [])) for (const e of p.journal || []) if (yearOf(e.date) === o.y) rows.push([fmtDate(e.date), displayName(p), (p.prospection || {}).categorie || '', e.statut || '', e.note || '', nomDe(e.par)]);
      dir.file(`Prospection ${o.y}.csv`, csv(['Date', 'Contact', 'Catégorie', 'Statut', 'Échange', 'Par'], rows.sort((a, x) => a[0].split('.').reverse().join('').localeCompare(x[0].split('.').reverse().join('')))));
    }
    if (ajoute('factures', 'Factures émises/')) { etape('Factures…'); for (const f of o.facturesY) { try { dir.file(`Factures émises/${nomZip(invoiceFileName(f).replace(/\.pdf$/, '') + (f.statut === 'annulee' ? ' (annulée)' : ''))}.pdf`, invoicePdfBlob(f)); } catch (e) { console.error(e); } } }
    if (ajoute('bulletins', 'Bulletins de livraison/')) {
      etape('Bulletins…');
      for (const f of o.blY) {
        const nb = nomZip(bulletinFileName(f).replace(/\.pdf$/, '')); try { dir.file(`Bulletins de livraison/${nb}.pdf`, bulletinPdfBlob(f, true)); } catch (e) { console.error(e); }
        for (const [i, x] of (f.blSigne || []).filter((y) => !y.expire).entries()) { try { dir.file(`Bulletins de livraison/${nb} - signé ${i + 1}.${x.chemin.split('.').pop() || 'jpg'}`, await telechargerFichier(x.chemin)); } catch (e) { manquants.push('Bulletin ' + f.blNumero); } }
      }
    }
    const groupe = (d) => { const n = compteDe(d); return estInvest(n) ? 'jInvest' : ['4400', '6100'].includes(n) ? 'jMateriel' : /^40\d\d$/.test(n) ? 'jFourn' : 'jAutres'; };
    const dossiers = { jInvest: 'Justificatifs - investissements', jMateriel: 'Justificatifs - matériel', jFourn: 'Justificatifs - fournitures', jAutres: 'Justificatifs - autres dépenses' };
    for (const g of Object.keys(dossiers)) if (ajoute(g, dossiers[g] + '/')) await ajouterJustifs(dir, dossiers[g], o.deps.filter((d) => groupe(d) === g), manquants, etape);
    dir.file('LISEZ-MOI.txt', [`${c.nom} — ${pr ? pr[1] : 'exportation'} ${o.y}`, `Établi le ${fmtDate(todayISO())} par ${nomDe(Sync.me)} depuis l'app.`, '', pr ? pr[3] : '', '', 'Contenu :', ...contenu, '',
      'Les justificatifs sont nommés « date, n° de dépense, compte, objet, montant ». Les montants sont en CHF.',
      manquants.length ? '\nFichiers qui n\'ont pas pu être ajoutés :\n- ' + manquants.join('\n- ') : ''].join('\r\n'));
    etape('Compression…');
    downloadFile(base + '.zip', await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }), 'application/zip');
    closeSheet(); toast(manquants.length ? `Exportation téléchargée, mais ${manquants.length} fichier(s) manquent (voir LISEZ-MOI).` : 'Exportation téléchargée.', 5000);
  } catch (e) { console.error(e); toast("L'exportation n'a pas pu être créée : " + (e.message || e), 6000); }
  BCL.enCours = false; const b2 = document.querySelector('[data-act="expGo"]'); if (b2) { b2.disabled = false; b2.textContent = 'Télécharger (.zip)'; }
};

/* ---------- Onglet « Bilans et bouclement » : l'année choisie, le compte de résultat par compte, le bilan, puis le bouclement ---------- */
function renderBilansBouclement() {
  const ys = anneesFin(); if (!BCL.annee || !ys.includes(BCL.annee)) BCL.annee = ys.includes(anneeBouclement()) ? anneeBouclement() : ys[0];
  const y = BCL.annee, o = comptesAnnee(y), ps = personnes(), d = decompteActuel();
  const heures = Object.values(o.heures).reduce((a, x) => a + x, 0);
  const lignes = (cat, filtre) => Object.entries(cat).filter(([k]) => filtre(k)).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<tr class="sous"><td>${esc(k)}</td><td class="r num">${money(v)}</td></tr>`).join('');
  const autres = o.ch - o.direct;
  /* Actifs au 31.12 : les objets de l'inventaire par compte, et les factures à recevoir */
  const actifs = {}; for (const x of o.amortItems) { const k = libCompte(compteObjet(x.i)); actifs[k] = (actifs[k] || 0) + x.v1; }
  const aRecevoir = o.ouvertes.reduce((a, f) => a + f.total, 0), totActifs = o.valeurInv + aRecevoir;
  return `<div class="row">${ys.map((x) => `<button class="chip${x === y ? ' on' : ''}" type="button" data-act="bclAnnee" data-y="${x}">${x}</button>`).join('')}</div>
    <div class="stats">
      <div class="stat good"><span class="k">Produits ${y}</span><span class="v">${chf(o.rec)}</span><span class="s">${o.recs.length} encaissement${o.recs.length > 1 ? 's' : ''}</span></div>
      <div class="stat bad"><span class="k">Charges</span><span class="v">${chf(o.ch + o.amort)}</span><span class="s">dont amortissements ${chf(o.amort)}</span></div>
      <div class="stat ${o.resultat >= 0 ? 'good' : 'bad'}"><span class="k">Résultat</span><span class="v">${chf(o.resultat)}</span></div>
      <div class="stat"><span class="k">Par heure travaillée</span><span class="v">${heures ? chf(o.resultat / heures) : '—'}</span><span class="s">${fmtH(heures)} h</span></div>
    </div>
    <div class="split">
      <div class="panel"><h2>Compte de résultat ${y}</h2>
        <table class="list cr"><tbody>
          <tr class="tot"><td>Produits</td><td class="r num">${money(o.rec)}</td></tr>${lignes(o.recCat, () => true)}
          <tr class="tot"><td>Charges directes (matériel, fournitures)</td><td class="r num">− ${money(o.direct)}</td></tr>${lignes(o.cat, (k) => k.startsWith('4'))}
          <tr class="tot marge"><td>Marge brute</td><td class="r num">${money(o.rec - o.direct)}</td></tr>
          <tr class="tot"><td>Autres charges d'exploitation</td><td class="r num">− ${money(autres)}</td></tr>${lignes(o.cat, (k) => !k.startsWith('4'))}
          <tr class="tot"><td>6800 Amortissements</td><td class="r num">− ${money(o.amort)}</td></tr>
        </tbody><tfoot><tr><td>Résultat ${y}</td><td class="r num">${money(o.resultat)}</td></tr></tfoot></table>
        <h3>Part du résultat de chacun</h3>
        <table class="list"><tbody>${ps.filter((p) => Math.abs(o.part[p.k]) > 0.004 || o.P31[p.k] > 0).map((p) => `<tr><td>${esc(p.nom)}</td><td class="r num">${money(o.part[p.k])}</td></tr>`).join('')}</tbody></table>
        <p class="hint">Les recettes vont dans leur compte toutes seules (vente directe et particuliers 3200, professionnels 3000) ; on peut le changer sur une recette saisie. Investissements de l'année : ${chf(o.inv)}, amortis via l'inventaire.</p></div>
      <div class="panel"><h2>Bilan au 31.12.${y}</h2>
        <table class="list cr"><tbody>
          <tr class="tot"><td>Actifs connus de l'app</td><td class="r num">${money(totActifs)}</td></tr>
          <tr class="sous"><td>1100 Factures à recevoir (${o.ouvertes.length})</td><td class="r num">${money(aRecevoir)}</td></tr>
          ${Object.entries(actifs).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `<tr class="sous"><td>${esc(k)}</td><td class="r num">${money(v)}</td></tr>`).join('')}
        </tbody></table>
        <p class="hint">Valeur des objets après amortissements. Les liquidités (comptes, caisse), les dettes et les apports des associés ne sont pas dans l'app : la fiduciaire les ajoute pour le bilan complet.</p>
        <h3>Entre associés</h3><p style="margin:0"><b>${esc(phraseDecompte(d))}</b> <a class="btn link small" href="#/finances/associes">Détail</a></p></div>
    </div>
    ${renderBouclement()}`;
}
