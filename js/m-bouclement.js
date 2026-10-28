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
  const amortItems = inv.map((i) => ({ i, a: amortissementAnnee(i, Number(y), des), v0: valeurFinAnnee(i, Number(y) - 1, des), v1: valeurFinAnnee(i, Number(y), des) })).filter((x) => x.a > 0.004 || x.v1 > 0.004 || yearOf(x.i.dateAchat) === y);
  const tot = (l) => l.reduce((a, x) => a + num(x.montant), 0);
  const o = { y, deps, recs, charges, invest, amortItems, rec: tot(recs), ch: tot(charges), inv: tot(invest), amort: amortItems.reduce((a, x) => a + x.a, 0) };
  o.resultat = o.rec - o.ch - o.amort;
  o.cat = {}; for (const d of charges) { const k = d.categorie || 'Sans catégorie'; o.cat[k] = (o.cat[k] || 0) + num(d.montant); }
  const part = {}; ps.forEach((p) => { part[p.k] = 0; });
  for (const r of recs) { const P = parts(c, r.date); ps.forEach((p) => { part[p.k] += num(r.montant) * P[p.k]; }); }
  for (const d of charges) { const P = parts(c, d.date); ps.forEach((p) => { part[p.k] -= num(d.montant) * P[p.k]; }); }
  const P31 = parts(c, y + '-12-31'); ps.forEach((p) => { part[p.k] -= o.amort * P31[p.k]; });
  o.part = part; o.P31 = P31;
  o.heures = totalHeures(heuresToutes(), (h) => yearOf(h.date) === y);
  o.facturesY = factures().filter((f) => yearOf(f.date) === y).sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  o.ouvertes = factures().filter((f) => f.date <= y + '-12-31' && f.statut !== 'payee' && f.statut !== 'annulee');
  o.valeurInv = inv.reduce((a, i) => a + valeurFinAnnee(i, Number(y), des), 0);
  const lies = new Set(inv.map((i) => i.depenseId).filter(Boolean));
  o.investHorsInv = invest.filter((d) => !lies.has(d.key));
  o.sansJ = deps.filter(sansJustificatif);
  o.nFichiers = deps.reduce((a, d) => a + (d.fichiers || []).filter((f) => !f.expire).length, 0);
  return o;
}

function renderBouclement() {
  const ys = anneesFin(); if (!BCL.annee) BCL.annee = ys.includes(anneeBouclement()) ? anneeBouclement() : ys[0];
  const y = BCL.annee, o = comptesAnnee(y), ar = archivesDe(y), manque = archiveManquePour(y), ps = personnes();
  const fini = y < todayISO().slice(0, 4);
  const chk = (ok, txt, lien, act) => `<li class="${ok ? 'ok' : 'todo'}"><span class="ck">${ok ? '✓' : '!'}</span><span>${txt}</span>${!ok && lien ? `<a class="btn small" href="${lien}"${act ? ` data-act="${act}"` : ''}>Voir</a>` : ''}</li>`;
  return `<div class="row">${ys.map((x) => `<button class="chip${x === y ? ' on' : ''}" type="button" data-act="bclAnnee" data-y="${x}">${x}</button>`).join('')}</div>
    <div class="split">
      <div class="panel"><h2>Avant de boucler ${y}</h2>
        <ul class="checklist">
          ${chk(fini, fini ? `L'année ${y} est terminée.` : `L'année ${y} n'est pas encore finie : l'archive sera provisoire.`)}
          ${chk(!o.sansJ.length, o.sansJ.length ? `<b>${o.sansJ.length} dépense${o.sansJ.length > 1 ? 's' : ''} sans justificatif</b> (${chf(o.sansJ.reduce((a, d) => a + num(d.montant), 0))})` : 'Toutes les dépenses ont leur justificatif.', '#/finances/depenses', 'goSansJ')}
          ${chk(!o.investHorsInv.length, o.investHorsInv.length ? `${o.investHorsInv.length} investissement${o.investHorsInv.length > 1 ? 's' : ''} relié${o.investHorsInv.length > 1 ? 's' : ''} à aucun objet de l'inventaire : vérifie qu'ils y sont (sinon ils ne sont pas amortis)` : "Les investissements sont tous dans l'inventaire.", '#/finances/inventaire')}
          ${chk(!o.ouvertes.length, o.ouvertes.length ? `${o.ouvertes.length} facture${o.ouvertes.length > 1 ? 's' : ''} pas encore payée${o.ouvertes.length > 1 ? 's' : ''} au 31.12 (${chf(o.ouvertes.reduce((a, f) => a + f.total, 0))}) : à noter comme « à recevoir »` : 'Toutes les factures émises sont payées.', '#/factures')}
          ${chk(true, `Heures ${y} : ${ps.map((p) => `${esc(p.nom)} ${fmtH(o.heures[p.k] || 0)} h`).join(', ')}.`)}
        </ul>
        <h3>L'archive de l'année</h3>
        <p class="hint">Un fichier .zip avec les comptes en PDF, les tableaux (dépenses, recettes, inventaire, heures), toutes les factures émises en PDF et tous les justificatifs joints (${o.nFichiers} fichier${o.nFichiers > 1 ? 's' : ''}).
          C'est ce qu'il faut pour la déclaration d'impôts et pour ce que la caisse AVS vous demande de déclarer. Chaque associé la télécharge une fois pour ses propres déclarations. <b>À garder 10 ans</b>, par exemple dans votre Proton Drive.</p>
        <div class="row"><button class="btn primary" type="button" data-act="bclZip"${BCL.enCours ? ' disabled' : ''}>${BCL.enCours ? esc(BCL.etape || 'Préparation…') : `Télécharger l'archive ${y}`}</button>
          <button class="btn" type="button" data-act="bclPdf"${BCL.enCours ? ' disabled' : ''}>Seulement le PDF des comptes</button></div>
        <p class="hint">${Object.keys(ar).length ? 'Téléchargée par ' + Object.entries(ar).map(([k, a]) => `${esc(nomDe(k))} le ${fmtDate(String(a.le).slice(0, 10))}${a.manquants ? ` (${a.manquants} fichier(s) manquant(s))` : ''}`).join(', ') + '.' : "L'archive de cette année n'a encore été téléchargée par personne."}
          ${manque.length ? `<b>Pas encore téléchargée par ${esc(manque.map((p) => p.nom).join(', '))}.</b>` : ''}
          Conservation dans l'app : photos des messages 6 mois ; justificatifs 2 ans, et seulement une fois l'archive de leur année téléchargée.</p>
      </div>
      <div class="panel"><h2>Comptes ${y}</h2>
        <table class="list"><tbody>
          <tr><td>Recettes</td><td class="r num">${money(o.rec)}</td></tr>
          <tr><td>Charges</td><td class="r num">− ${money(o.ch)}</td></tr>
          <tr><td>Amortissements</td><td class="r num">− ${money(o.amort)}</td></tr>
        </tbody><tfoot><tr><td>Résultat</td><td class="r num">${money(o.resultat)}</td></tr></tfoot></table>
        <h3>Part du résultat de chacun</h3>
        <table class="list"><tbody>${ps.filter((p) => Math.abs(o.part[p.k]) > 0.004 || o.P31[p.k] > 0).map((p) => `<tr><td>${esc(p.nom)}</td><td class="r num">${money(o.part[p.k])}</td></tr>`).join('')}</tbody></table>
        <p class="hint">Investissements ${y} : ${chf(o.inv)} (amortis via l'inventaire) · valeur de l'inventaire au 31.12 : ${chf(o.valeurInv)}.
          Chaque associé déclare sa part comme revenu d'activité indépendante (impôts et caisse AVS). Ces chiffres sont une base de travail : faites-les valider par votre fiduciaire ou votre comptable.</p>
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
  ligne('Recettes (ventes encaissées)', pdfM(o.rec));
  ligne('Charges', '- ' + pdfM(o.ch));
  Object.entries(o.cat).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => ligne(k, pdfM(v), { ind: 6 }));
  ligne("Amortissements (voir l'inventaire)", '- ' + pdfM(o.amort));
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
  tableau([{ titre: 'N°', l: 10 }, { titre: 'Date', l: 20 }, { titre: 'Objet', l: 60 }, { titre: 'Catégorie', l: 30 }, { titre: 'Payé par', l: 20 }, { titre: 'Justif.', l: 18 }, { titre: 'Montant', l: 16, r: true }],
    o.deps.map((d) => [d.n || '', fmtDate(d.date), d.objet + (d.type === 'investissement' ? ' (invest.)' : ''), d.categorie || '', nomDe(d.par), (d.fichiers || []).length ? 'joint' : d.justificatif ? 'réf.' : 'MANQUE', pdfM(d.montant)]),
    [null, null, null, null, null, 'Total', pdfM(o.ch + o.inv)]);

  titre('Inventaire et amortissements');
  tableau([{ titre: 'Objet', l: 62 }, { titre: 'Achat', l: 22 }, { titre: 'Taux', l: 14, r: true }, { titre: 'Valeur 01.01', l: 28, r: true }, { titre: 'Amort.', l: 24, r: true }, { titre: 'Valeur 31.12', l: 24, r: true }],
    o.amortItems.map((x) => [x.i.nom, x.i.dateAchat ? fmtDate(x.i.dateAchat) : '', Math.round(num(x.i.taux) * 100) + ' %', yearOf(x.i.dateAchat) === o.y ? pdfM(x.i.valeur) + ' *' : pdfM(x.v0), pdfM(x.a), pdfM(x.v1)]),
    [null, null, null, 'Total', pdfM(o.amort), pdfM(o.valeurInv)]);
  saut(8); t("* acheté dans l'année : valeur d'achat. Amortissement dégressif.", L, { size: 8 }); y += 6;

  if (o.ouvertes.length) {
    titre('Factures à recevoir au 31.12');
    tableau([{ titre: 'N°', l: 30 }, { titre: 'Date', l: 22 }, { titre: 'Client', l: 90 }, { titre: 'Échéance', l: 20 }, { titre: 'Montant', l: 12, r: true }],
      o.ouvertes.map((f) => [f.numero, fmtDate(f.date), f.client.nom, fmtDate(f.echeance), pdfM(f.total)]));
  }
  pied();
  return doc.output('blob');
}

/* ---------- Archive zip ---------- */
const nomZip = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
function csvAnnee(o) {
  const ps = personnes();
  const dep = csv(['N°', 'Date', 'Montant', 'Objet', 'Type', 'Catégorie', 'Payé par', 'Justificatif', 'Fichiers joints', 'Remarque'],
    o.deps.map((d) => [d.n || '', fmtDate(d.date), r2(d.montant).toFixed(2), d.objet, d.type === 'investissement' ? 'Investissement' : 'Charge', d.categorie, nomDe(d.par), d.justificatif, (d.fichiers || []).length, d.remarque]));
  const rec = csv(['Date', 'Montant', 'Client / libellé', 'Moyen', 'Encaissé par', 'Origine'],
    o.recs.map((r) => [fmtDate(r.date), r2(r.montant).toFixed(2), r.libelle, r.moyen, nomDe(r.par), r.src === 'facture' ? 'Facture ' + r.ref : 'Saisie directe']));
  const inv = csv(['Objet', 'Catégorie', "Date d'achat", "Valeur d'achat", 'Taux', 'Valeur 01.01', 'Amortissement', 'Valeur 31.12'],
    o.amortItems.map((x) => [x.i.nom, x.i.categorie, fmtDate(x.i.dateAchat), r2(x.i.valeur).toFixed(2), Math.round(num(x.i.taux) * 100) + ' %', r2(x.v0).toFixed(2), r2(x.a).toFixed(2), r2(x.v1).toFixed(2)]));
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
ACTIONS.bclZip = async () => {
  if (BCL.enCours) return;
  if (!window.JSZip) { toast("L'outil d'archive n'est pas chargé. Recharge la page."); return; }
  const o = comptesAnnee(BCL.annee), c = cfg(), base = nomZip(`${c.nom} - Comptes ${o.y}`);
  if (o.nFichiers && !navigator.onLine && !LOCAL_MODE) { toast('Il faut du réseau pour récupérer les justificatifs.'); return; }
  BCL.enCours = true; BCL.etape = 'Comptes…'; render();
  const etape = (s) => { BCL.etape = s; const b = document.querySelector('[data-act="bclZip"]'); if (b) b.textContent = s; };
  try {
    const z = new window.JSZip(), dir = z.folder(base);
    dir.file(`Comptes ${o.y}.pdf`, pdfComptes(o));
    const t = csvAnnee(o);
    dir.file(`Tableaux/Dépenses ${o.y}.csv`, t.dep); dir.file(`Tableaux/Recettes ${o.y}.csv`, t.rec);
    dir.file(`Tableaux/Inventaire et amortissements ${o.y}.csv`, t.inv); dir.file(`Tableaux/Heures ${o.y}.csv`, t.heu);
    etape('Factures…');
    for (const f of o.facturesY) { try { dir.file(`Factures émises/${nomZip(invoiceFileName(f).replace(/\.pdf$/, '') + (f.statut === 'annulee' ? ' (annulée)' : ''))}.pdf`, invoicePdfBlob(f)); } catch (e) { console.error(e); } }
    const manquants = [], vus = {};
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
      'Tableaux/ : les mêmes données en CSV (s\'ouvrent dans un tableur).', 'Factures émises/ : chaque facture envoyée aux clients, en PDF.',
      'Justificatifs/ : tickets et factures des dépenses, nommés « date, n° de dépense, objet, montant ».', '',
      'À conserver 10 ans (obligation légale de conservation des pièces comptables en Suisse).',
      manquants.length ? '\nFichiers qui n\'ont pas pu être ajoutés :\n- ' + manquants.join('\n- ') : '',
      o.sansJ.length ? `\nDépenses sans justificatif au moment de l'archive : ${o.sansJ.length}.` : '',
    ].join('\r\n'));
    etape('Compression…');
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    downloadFile(base + '.zip', blob, 'application/zip');
    DB.put('cfg:archive:' + o.y + ':' + (Sync.me || 'inconnu'), { le: new Date().toISOString(), fichiers: fich.length - manquants.length, manquants: manquants.length });
    toast(manquants.length ? `Archive téléchargée, mais ${manquants.length} fichier(s) manquent (voir LISEZ-MOI).` : 'Archive téléchargée. Range-la dans votre drive.', 6000);
  } catch (e) { console.error(e); toast("L'archive n'a pas pu être créée : " + (e.message || e), 6000); }
  BCL.enCours = false; BCL.etape = ''; render();
};
