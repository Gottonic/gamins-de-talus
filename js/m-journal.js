/* Gamins de Talus — journal général (Calendrier → Journal) : les notes libres, avec photos ou captures,
   et, au même endroit, les remarques laissées un peu partout : journal des cultures, remarques du calendrier,
   notes des heures, remarques des tâches, échanges avec les contacts.
   note:<id> = { date, texte, par, captures: [{ chemin, w, h }], cree, modifie? } */
'use strict';

const JNL = { filtre: '', q: '', caps: [], cle: '', n: 60 };
const SOURCES_JNL = [['note', '📝', 'Notes'], ['culture', '🌱', 'Cultures'], ['calendrier', '📅', 'Calendrier'], ['tache', '☑', 'Tâches'], ['contact', '📞', 'Contacts']];
function entreesJournal() {
  const out = [], j = (o) => out.push(o);
  for (const n of DB.all('note:')) j({ src: 'note', date: n.date || String(n.cree || '').slice(0, 10), par: n.par, texte: n.texte || '', captures: n.captures || [], key: n.key, cree: n.cree });
  for (const x of DB.all('jnl:')) j({ src: 'culture', date: x.date, par: x.par, texte: x.texte || '', photo: x.photo, sous: [(x.fiches || []).map((f) => (DB.get(f) || {}).nom).filter(Boolean).join(', '), (x.emplacements || []).join(', ')].filter(Boolean).join(' · '), lien: '#/cultures/journal', cree: x.cree });
  for (const x of DB.all('jour:')) if (x.remarque) j({ src: 'calendrier', date: x.date, texte: x.remarque, sous: 'remarque du jour', lien: '#/calendrier/mois' });
  for (const h of DB.all('h:')) if (h.note) { const [, d, p] = String(h.key).split(':'); j({ src: 'calendrier', date: d, par: p, texte: h.note, sous: 'note des heures', lien: '#/calendrier/heures' }); }
  for (const t of DB.all('t:')) if (String(t.remarques || '').trim()) j({ src: 'tache', date: t.termineLe || t.jour || String(t.journee || '').split('|')[1] || t.echeance || String(t.cree || '').slice(0, 10), par: t.creePar, texte: t.remarques, sous: '☑ ' + (t.titre || ''), tache: t.key });
  for (const c of (typeof tousContacts === 'function' ? tousContacts() : [])) for (const e of c.journal || []) if (String(e.note || '').trim()) j({ src: 'contact', date: e.date, par: e.par, texte: e.note, sous: displayName(c) + (e.statut ? ' · ' + e.statut : ''), lien: c.prospect ? '#/factures/prospect/' + encodeURIComponent(c.key) : '#/contacts/voir/' + encodeURIComponent(c.key) });
  return out.filter((x) => x.date).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || '')));
}
function renderJournalGeneral() {
  const tout = entreesJournal(), q = sansAccentsS(JNL.q);
  const l = tout.filter((x) => (!JNL.filtre || x.src === JNL.filtre) && (!q || sansAccentsS(x.texte + ' ' + (x.sous || '') + ' ' + nomDe(x.par)).includes(q)));
  const n = (s) => tout.filter((x) => x.src === s).length;
  let html = '', jour = '';
  for (const x of l.slice(0, JNL.n)) {
    if (x.date !== jour) { jour = x.date; html += `<h3 class="jnl-jour">${esc(dateLongue ? dateLongue(x.date) : fmtDate(x.date))}</h3>`; }
    const s = SOURCES_JNL.find((y) => y[0] === x.src) || SOURCES_JNL[0];
    const corps = `<span class="jnl-src" title="${esc(s[2])}">${s[1]}</span><div class="jnl-c"><div class="jnl-t">${lienTexteSimple(x.texte)}</div>
      ${(x.captures || []).length ? `<div class="jnl-caps">${x.captures.map((c) => `<button type="button" class="jnl-cap" data-act="voirFichier" data-fichier="${esc(c.chemin)}" data-titre="Note du ${esc(fmtDate(x.date))}"><img data-fichier="${esc(c.chemin)}" alt=""></button>`).join('')}</div>` : ''}
      ${x.photo && x.photo.chemin ? `<div class="jnl-caps"><button type="button" class="jnl-cap" data-act="voirFichier" data-fichier="${esc(x.photo.chemin)}"><img data-fichier="${esc(x.photo.chemin)}" alt=""></button></div>` : ''}
      <span class="hint">${[x.par ? nomDe(x.par) : '', x.sous || ''].filter(Boolean).map(esc).join(' · ')}</span></div>`;
    html += x.src === 'note' ? `<div class="jnl-e"><button type="button" class="jnl-btn" data-act="noteEdit" data-key="${esc(x.key)}">${corps}</button></div>`
      : x.tache ? `<div class="jnl-e"><button type="button" class="jnl-btn" data-act="taVoir" data-key="${esc(x.tache)}">${corps}</button></div>`
      : `<div class="jnl-e"><a class="jnl-btn" href="${esc(x.lien || '#/calendrier/journal')}">${corps}</a></div>`;
  }
  return `<div class="panel jnl">
    <div class="between"><h2>Journal</h2><button class="btn primary small" type="button" data-act="noteEdit">+ Note</button></div>
    <div class="row jnl-filtres"><input id="jnl-q" type="search" placeholder="🔍 Chercher" value="${esc(JNL.q)}" aria-label="Chercher dans le journal">
      <div class="chips"><button type="button" class="chip small${JNL.filtre ? '' : ' on'}" data-act="jnlFiltre" data-k="">Tout</button>${SOURCES_JNL.map(([k, e, lib]) => n(k) ? `<button type="button" class="chip small${JNL.filtre === k ? ' on' : ''}" data-act="jnlFiltre" data-k="${k}">${e} ${lib}<span class="n">${n(k)}</span></button>` : '').join('')}</div></div>
    ${html || '<p class="empty">Rien pour l\'instant. « + Note » : une idée, une observation, une photo du champ…</p>'}
    ${l.length > JNL.n ? `<div class="row-end"><button class="btn small" type="button" data-act="jnlPlus">Voir plus (${l.length - JNL.n})</button></div>` : ''}</div>`;
}
const lienTexteSimple = (t) => (typeof lienTexte === 'function' ? lienTexte(t) : esc(t)).replace(/\n/g, '<br>');
ACTIONS.jnlFiltre = (el) => { JNL.filtre = el.dataset.k; JNL.n = 60; render(); };
ACTIONS.jnlPlus = () => { JNL.n += 100; render(); };
function brancherJournal() {
  const q = $('jnl-q'); if (q) q.addEventListener('input', () => { JNL.q = q.value; const p = q.selectionStart; render(); const n = $('jnl-q'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* */ } } });
}

/* ---------- Une note : texte, date, photos ou captures (collées, glissées ou choisies) ---------- */
const capsNoteHtml = () => JNL.caps.map((c, i) => `<span class="idee-cap"><img data-fichier="${esc(c.chemin)}" alt=""><button type="button" class="idee-cap-x" data-act="noteCapOff" data-i="${i}" aria-label="Retirer">×</button></span>`).join('');
ACTIONS.noteEdit = (el) => {
  const k = (el && el.dataset && el.dataset.key) || '', n = k ? DB.get(k) : null;
  if (JNL.cle !== k) { JNL.caps = n ? (n.captures || []).slice() : []; JNL.cle = k; }
  openSheet(`${sheetHead(k ? 'Note' : 'Nouvelle note', n ? `${nomDe(n.par)} · ${fmtDate(n.date)}` : '')}<form class="sbody form" data-form="note" id="note-form"><input type="hidden" name="key" value="${esc(k)}">
    ${txt('note-t', 'Note', n ? n.texte : '', { name: 'texte', rows: 5 })}
    ${inp('note-d', 'Date', n ? n.date : todayISO(), { name: 'date', type: 'date' })}
    <div class="field"><span class="flabel">Photos, captures</span><div class="idee-caps" id="note-caps">${capsNoteHtml()}</div>
      <label class="btn small">📎 Ajouter<input type="file" id="note-file" accept="image/*" multiple hidden></label><span class="sub" id="note-etat">${matchMedia('(pointer:fine)').matches ? 'ou colle (Ctrl+V), ou glisse ici' : ''}</span></div>
    <div class="row-end">${k ? `<button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette note">Supprimer</button>` : ''}<button class="btn primary" type="submit">Enregistrer</button></div></form>`);
  const f = $('note-file'); if (f) f.addEventListener('change', () => { noteJoindre([...f.files]); f.value = ''; });
  const t = $('note-t'); if (t && !k) t.focus();
};
async function noteJoindre(files) {
  const imgs = [...(files || [])].filter((f) => /^image\//.test(f.type)); if (!imgs.length) return false;
  const et = $('note-etat'); if (et) et.textContent = 'Envoi…';
  for (const f of imgs.slice(0, 8)) {
    try { const r = await preparerFichier(f, 'photo'); const ch = await Fichiers.envoyer(r.blob, cheminFichier('journal', r.ext)); if (!LOCAL_MODE) Fichiers.liens[ch] = { url: URL.createObjectURL(r.blob), exp: Date.now() + 50 * 60000 }; else Fichiers.local[ch] = URL.createObjectURL(r.blob); JNL.caps.push({ chemin: ch, w: r.w, h: r.h }); }
    catch (e) { if (et) et.textContent = 'Impossible : ' + e.message; return true; }
  }
  const z = $('note-caps'); if (z) { z.innerHTML = capsNoteHtml(); if (typeof hydraterFichiers === 'function') hydraterFichiers(z); }
  if (et) et.textContent = ''; majBoutonFermer();
  return true;
}
ACTIONS.noteCapOff = (el) => { JNL.caps.splice(Number(el.dataset.i), 1); const z = $('note-caps'); if (z) { z.innerHTML = capsNoteHtml(); if (typeof hydraterFichiers === 'function') hydraterFichiers(z); } };
document.addEventListener('paste', (e) => { if (!$('note-form')) return; const fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); noteJoindre(fs); } });
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#note-form') && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (!(e.target.closest && e.target.closest('#note-form')) || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); noteJoindre(e.dataTransfer.files); });
FORMS.note = (v) => {
  const texte = String(v.texte || '').trim(); if (!texte && !JNL.caps.length) { toast('Écris quelque chose, ou ajoute une photo.'); return; }
  const k = v.key || 'note:' + uid('n'), old = DB.get(k) || { par: Sync.me || '', cree: new Date().toISOString() };
  DB.put(k, Object.assign({}, old, { texte, date: v.date || todayISO(), captures: JNL.caps.slice() }, v.key ? { modifie: new Date().toISOString() } : {}));
  JNL.caps = []; JNL.cle = ''; closeSheet(); toast(v.key ? 'Note mise à jour.' : 'Note ajoutée au journal.');
};
