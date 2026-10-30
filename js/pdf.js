/* Gamins de Talus — facture A4 avec section paiement QR (norme suisse, adresses structurées). */
'use strict';

const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
const fmtIban = (s) => cleanIban(s).replace(/(.{4})/g, '$1 ').trim();
function ibanCheck(raw) {
  const s = cleanIban(raw);
  if (!s) return { ok: false, msg: 'IBAN manquant.' };
  if (!/^(CH|LI)\d{7}[A-Z0-9]{12}$/.test(s)) return { ok: false, msg: 'Un IBAN suisse commence par CH et compte 21 caractères.' };
  const re = s.slice(4) + s.slice(0, 4); let rem = 0;
  for (const ch of re) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
  if (rem !== 1) return { ok: false, msg: 'Le chiffre de contrôle ne correspond pas : vérifie une faute de frappe.' };
  const iid = Number(s.slice(4, 9));
  if (iid >= 30000 && iid <= 31999) return { ok: false, msg: "C'est un QR-IBAN. Ici, il faut l'IBAN normal du compte." };
  return { ok: true, msg: 'IBAN valide.' };
}

const slipMoney = (n) => group(Number(n) || 0, ' ');
const fmtQty = (q) => { const n = Number(q) || 0; return Number.isInteger(n) ? String(n) : String(r2(n)).replace(/\.?0+$/, ''); };
const qrText = (s, n) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/[“”«»]/g, '"').trim().slice(0, n);

function qrPayload(inv) {
  const E = inv.emetteur, C = inv.client;
  const creditorName = [E.titulaire, E.nom].filter(Boolean).join(', ');
  return [
    'SPC', '0200', '1', cleanIban(E.iban),
    'S', qrText(creditorName, 70), qrText(E.rue, 70), qrText(E.numero, 16), qrText(E.npa, 16), qrText(E.localite, 35), 'CH',
    '', '', '', '', '', '', '',
    r2(inv.total).toFixed(2), 'CHF',
    'S', qrText(C.nom, 70), qrText(C.rue, 70), qrText(C.numero, 16), qrText(C.npa, 16), qrText(C.localite, 35), 'CH',
    'NON', '',
    qrText('Facture ' + inv.numero, 140), 'EPD',
  ].join('\r\n');
}

const PT = 0.3528;
function svgCanvas() {
  const parts = [];
  return {
    text(s, x, y, o = {}) { const a = o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start'; parts.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${((o.size || 10) * PT).toFixed(3)}" font-weight="${o.bold ? 700 : 400}" text-anchor="${a}">${esc(s)}</text>`); },
    line(x1, y1, x2, y2, o = {}) { parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${o.w || 0.2}"${o.dash ? ' stroke-dasharray="1 1"' : ''}/>`); },
    rect(x, y, w, h, o = {}) { parts.push(`<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${w.toFixed(3)}" height="${h.toFixed(3)}" fill="${o.fill || '#000'}"/>`); },
    svg() { return `<svg viewBox="0 0 210 297" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aperçu de la facture"><rect width="210" height="297" fill="#fff"/><g font-family="Helvetica, Arial, sans-serif" fill="#000">${parts.join('')}</g></svg>`; },
  };
}
function pdfCanvas() {
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
  doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0);
  return {
    doc,
    text(s, x, y, o = {}) { doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 10); doc.text(String(s), x, y, { align: o.align || 'left' }); },
    line(x1, y1, x2, y2, o = {}) { doc.setLineWidth(o.w || 0.2); doc.setLineDashPattern(o.dash ? [1, 1] : [], 0); doc.line(x1, y1, x2, y2); doc.setLineDashPattern([], 0); },
    rect(x, y, w, h, o = {}) { doc.setFillColor(o.fill === '#fff' ? '#FFFFFF' : '#000000'); doc.rect(x, y, w, h, 'F'); },
  };
}
function drawQR(cv, text, x, y, size) {
  const qr = window.qrcode(0, 'M');
  qr.addData(unescape(encodeURIComponent(text)), 'Byte'); qr.make();
  const n = qr.getModuleCount(), m = size / n;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) { let c2 = c; while (c2 < n && qr.isDark(r, c2)) c2++; cv.rect(x + c * m, y + r * m, (c2 - c) * m + 0.02, m + 0.02, { fill: '#000' }); c = c2; } else c++;
    }
  }
  const cx = x + size / 2, cy = y + size / 2;
  cv.rect(cx - 3.5, cy - 3.5, 7, 7, { fill: '#fff' }); cv.rect(cx - 3.1, cy - 3.1, 6.2, 6.2, { fill: '#000' });
  cv.rect(cx - 0.6, cy - 1.95, 1.2, 3.9, { fill: '#fff' }); cv.rect(cx - 1.95, cy - 0.6, 3.9, 1.2, { fill: '#fff' });
}
function drawInvoice(cv, inv) {
  const E = inv.emetteur, C = inv.client, cash = inv.paiement === 'especes';
  cv.text(E.nom || '', 20, 24, { size: 18, bold: true });
  let y = 30.5;
  for (const l of [E.titulaire, street(E), place(E), E.telephone, E.email].filter(Boolean)) { cv.text(l, 20, y, { size: 9 }); y += 4.2; }
  let ry = 52;
  cv.text(trunc(C.nom, 44), 118, ry, { size: 10.5, bold: true }); ry += 5;
  for (const l of [C.attn ? "À l'att. de " + C.attn : '', street(C), place(C)].filter(Boolean)) { cv.text(trunc(l, 46), 118, ry, { size: 10 }); ry += 4.6; }
  cv.text('Facture ' + inv.numero, 20, 92, { size: 15, bold: true });
  const meta = [['Date', fmtDate(inv.date)]];
  if (inv.livraison) meta.push(['Livraison du', fmtDate(inv.livraison)]);
  if (inv.bulletin) meta.push(['Bulletin de livraison', trunc(inv.bulletin, 30)]);
  meta.push(cash ? ['Payée comptant le', fmtDate(inv.payeeLe || inv.date)] : ['Échéance', fmtDate(inv.echeance)]);
  let my = 100;
  for (const [k, v] of meta) { cv.text(k, 20, my, { size: 9 }); cv.text(v, 58, my, { size: 9, bold: k === 'Échéance' || k === 'Payée comptant le' }); my += 4.6; }
  const ty = 124;
  cv.text('Désignation', 20, ty, { size: 8.5, bold: true });
  cv.text('Quantité', 128, ty, { size: 8.5, bold: true, align: 'right' });
  cv.text('Prix unitaire', 158, ty, { size: 8.5, bold: true, align: 'right' });
  cv.text('Montant CHF', 190, ty, { size: 8.5, bold: true, align: 'right' });
  cv.line(20, ty + 2, 190, ty + 2, { w: 0.3 });
  let rowY = ty + 7.5;
  for (const l of inv.lignes) {
    cv.text(trunc(l.designation, 46), 20, rowY, { size: 9.5 });
    cv.text(fmtQty(l.quantite) + ' ' + (l.unite || ''), 128, rowY, { size: 9.5, align: 'right' });
    cv.text(money(l.prix), 158, rowY, { size: 9.5, align: 'right' });
    cv.text(money(r2(num(l.quantite) * num(l.prix))), 190, rowY, { size: 9.5, align: 'right' });
    rowY += 6.2;
  }
  cv.line(120, rowY - 2.6, 190, rowY - 2.6, { w: 0.3 });
  cv.text('Total CHF', 158, rowY + 3, { size: 10.5, bold: true, align: 'right' });
  cv.text(money(inv.total), 190, rowY + 3, { size: 10.5, bold: true, align: 'right' });
  let ny = rowY + 13;
  if (cash) cv.text(`Montant de CHF ${money(inv.total)} reçu ${inv.payeePar === 'twint' ? 'par TWINT' : inv.payeePar === 'virement' ? 'par virement' : 'comptant, en espèces,'} le ${fmtDate(inv.payeeLe || inv.date)}. Merci !`, 20, ny, { size: 8.5 });
  else cv.text(`Payable dans les ${inv.delai} jours, au plus tard le ${fmtDate(inv.echeance)}, avec la section paiement ci-dessous.`, 20, ny, { size: 8.5 });
  ny += 4.3;
  if (E.mention) { cv.text(trunc(E.mention, 100), 20, ny, { size: 8.5 }); ny += 4.3; }
  if (inv.remarque) { cv.text(trunc(inv.remarque, 110), 20, ny, { size: 8.5 }); ny += 4.3; }
  if (cash) {
    const sx = 20, sy = ny + 8, sw = 62, sh = 16;
    cv.line(sx, sy, sx + sw, sy, { w: 0.6 }); cv.line(sx, sy + sh, sx + sw, sy + sh, { w: 0.6 }); cv.line(sx, sy, sx, sy + sh, { w: 0.6 }); cv.line(sx + sw, sy, sx + sw, sy + sh, { w: 0.6 });
    cv.text('ACQUITTÉE', sx + sw / 2, sy + 7.5, { size: 15, bold: true, align: 'center' });
    const especes = !inv.payeePar || inv.payeePar === 'especes';
    cv.text((inv.payeePar === 'twint' ? 'payée par TWINT le ' : inv.payeePar === 'virement' ? 'payée par virement le ' : 'payée comptant le ') + fmtDate(inv.payeeLe || inv.date), sx + sw / 2, sy + 12.5, { size: 8.5, align: 'center' });
    /* « Reçu par » + signature : seulement pour l'argent liquide (TWINT et virement laissent déjà une trace à la banque) */
    if (especes) { cv.text('Reçu par :', 118, sy + 4, { size: 8.5 }); cv.line(118, sy + sh, 190, sy + sh, { w: 0.3 }); cv.text('Signature', 118, sy + sh + 4, { size: 7 }); }
    return;
  }
  const y0 = 192;
  cv.text('Séparer avant de payer', 105, y0 - 1.5, { size: 6, align: 'center' });
  cv.line(0, y0, 210, y0, { dash: true }); cv.line(62, y0, 62, 297, { dash: true });
  const creditor = [fmtIban(E.iban), [E.titulaire, E.nom].filter(Boolean).join(', '), street(E), place(E)].filter(Boolean);
  const debtor = [C.nom, street(C), place(C)].filter(Boolean);
  cv.text('Récépissé', 5, y0 + 9, { size: 11, bold: true });
  let a = y0 + 15;
  cv.text('Compte / Payable à', 5, a, { size: 6, bold: true }); a += 3.4;
  for (const l of creditor) { cv.text(trunc(l, 34), 5, a, { size: 8 }); a += 3.4; }
  a += 1.8; cv.text('Payable par', 5, a, { size: 6, bold: true }); a += 3.4;
  for (const l of debtor) { cv.text(trunc(l, 34), 5, a, { size: 8 }); a += 3.4; }
  cv.text('Monnaie', 5, y0 + 68, { size: 6, bold: true }); cv.text('Montant', 20, y0 + 68, { size: 6, bold: true });
  cv.text('CHF', 5, y0 + 72, { size: 8 }); cv.text(slipMoney(inv.total), 20, y0 + 72, { size: 8 });
  cv.text('Point de dépôt', 57, y0 + 82, { size: 6, bold: true, align: 'right' });
  cv.text('Section paiement', 67, y0 + 9, { size: 11, bold: true });
  drawQR(cv, qrPayload(inv), 67, y0 + 17, 46);
  cv.text('Monnaie', 67, y0 + 71, { size: 8, bold: true }); cv.text('Montant', 87, y0 + 71, { size: 8, bold: true });
  cv.text('CHF', 67, y0 + 76, { size: 10 }); cv.text(slipMoney(inv.total), 87, y0 + 76, { size: 10 });
  let b = y0 + 9;
  cv.text('Compte / Payable à', 118, b, { size: 8, bold: true }); b += 4.2;
  for (const l of creditor) { cv.text(trunc(l, 40), 118, b, { size: 10 }); b += 4.2; }
  b += 2.2; cv.text('Informations supplémentaires', 118, b, { size: 8, bold: true }); b += 4.2;
  cv.text('Facture ' + inv.numero, 118, b, { size: 10 }); b += 6.4;
  cv.text('Payable par', 118, b, { size: 8, bold: true }); b += 4.2;
  for (const l of debtor) { cv.text(trunc(l, 40), 118, b, { size: 10 }); b += 4.2; }
}
function invoiceSvg(inv) { const cv = svgCanvas(); try { drawInvoice(cv, inv); } catch (e) { return `<p class="empty">Aperçu indisponible : ${esc(e.message)}</p>`; } return cv.svg(); }
function invoicePdfBlob(inv) { const cv = pdfCanvas(); drawInvoice(cv, inv); return cv.doc.output('blob'); }
function invoiceFileName(inv) { return `Facture ${inv.numero} ${inv.client.nom}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf'; }

/* ---------- Bulletin de livraison (A4, sans section paiement) ---------- */
function drawBulletin(cv, v, avecPrix) {
  const E = v.emetteur || cfg(), C = v.client || {};
  cv.text(E.nom || '', 20, 24, { size: 18, bold: true });
  let y = 30.5;
  for (const l of [E.titulaire, street(E), place(E), E.telephone, E.email].filter(Boolean)) { cv.text(l, 20, y, { size: 9 }); y += 4.2; }
  let ry = 52;
  cv.text(trunc(C.nom || '', 44), 118, ry, { size: 10.5, bold: true }); ry += 5;
  for (const l of [C.attn ? "À l'att. de " + C.attn : '', street(C), place(C)].filter(Boolean)) { cv.text(trunc(l, 46), 118, ry, { size: 10 }); ry += 4.6; }
  cv.text('Bulletin de livraison ' + (v.blNumero || ''), 20, 92, { size: 15, bold: true });
  const meta = [['Livré le', fmtDate(v.livraison || v.date)]];
  if (v.numero) meta.push(['Facture', v.numero]);
  let my = 100;
  for (const [k, x] of meta) { cv.text(k, 20, my, { size: 9 }); cv.text(x, 58, my, { size: 9, bold: true }); my += 4.6; }
  const ty = 118;
  cv.text('Désignation', 20, ty, { size: 8.5, bold: true });
  cv.text('Quantité', 128, ty, { size: 8.5, bold: true, align: 'right' });
  if (avecPrix) { cv.text('Prix unitaire', 158, ty, { size: 8.5, bold: true, align: 'right' }); cv.text('Montant CHF', 190, ty, { size: 8.5, bold: true, align: 'right' }); }
  cv.line(20, ty + 2, 190, ty + 2, { w: 0.3 });
  let rowY = ty + 7.5;
  for (const l of v.lignes || []) {
    cv.text(trunc(l.designation, 46), 20, rowY, { size: 9.5 });
    cv.text(fmtQty(l.quantite) + ' ' + (l.unite || ''), 128, rowY, { size: 9.5, align: 'right' });
    if (avecPrix) { cv.text(money(l.prix), 158, rowY, { size: 9.5, align: 'right' }); cv.text(money(r2(num(l.quantite) * num(l.prix))), 190, rowY, { size: 9.5, align: 'right' }); }
    rowY += 6.2;
  }
  if (avecPrix) { cv.line(120, rowY - 2.6, 190, rowY - 2.6, { w: 0.3 }); cv.text('Total CHF', 158, rowY + 3, { size: 10.5, bold: true, align: 'right' }); cv.text(money(v.total), 190, rowY + 3, { size: 10.5, bold: true, align: 'right' }); rowY += 8; }
  if (v.remarque) { cv.text(trunc(v.remarque, 110), 20, rowY + 6, { size: 8.5 }); rowY += 5; }
  const sy = Math.max(rowY + 22, 200);
  cv.text('Marchandise reçue en bon état :', 20, sy, { size: 9 });
  cv.line(20, sy + 18, 90, sy + 18, { w: 0.3 }); cv.text('Date, nom et signature', 20, sy + 22, { size: 7 });
  cv.line(118, sy + 18, 190, sy + 18, { w: 0.3 }); cv.text('Livré par', 118, sy + 22, { size: 7 });
}
function bulletinPdfBlob(v, avecPrix) { const cv = pdfCanvas(); drawBulletin(cv, v, avecPrix); return cv.doc.output('blob'); }
function bulletinSvg(v, avecPrix) { const cv = svgCanvas(); try { drawBulletin(cv, v, avecPrix); } catch (e) { return `<p class="empty">Aperçu indisponible : ${esc(e.message)}</p>`; } return cv.svg(); }
function bulletinFileName(v) { return `Bulletin ${v.blNumero} ${(v.client && v.client.nom) || ''}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf'; }
