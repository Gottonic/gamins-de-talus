/* Gamins de Talus — LE journal (Calendrier → Journal), un seul pour tout :
   - les notes : jnl:<id> = { date, par, texte, type, fiches: [], emplacements: [], captures: [{ chemin, w, h }], photo? (ancien), cree }
     (une note liée à des cultures apparaît aussi dans leur fiche et dans le plan de cultures) ;
     les anciennes notes note:<id> (quelques jours en novembre 2026) restent lisibles ;
   - au même endroit, les remarques laissées ailleurs : calendrier, heures, tâches (pas celles créées depuis un mail), échanges avec les contacts.
   But : retrouver facilement ce qu'on a noté, et en fin d'année un rapport complet à donner à Claude pour en tirer les points importants. */
'use strict';

const JNL = { filtre: '', fiche: '', q: '', an: '', caps: [], n: 60 };
const SOURCES_JNL = [['note', '📝', 'Notes'], ['culture', '🌱', 'Cultures'], ['calendrier', '📅', 'Calendrier'], ['tache', '☑', 'Tâches'], ['contact', '📞', 'Contacts']];
const capturesJnl = (j) => (j.captures || []).concat(j.photo && j.photo.chemin ? [j.photo] : []);
/* Les tâches nées d'un mail : leur remarque est le mail lui-même, pas une note */
const tachesDeMails = () => new Set(DB.all('mail:').map((m) => m.tache).filter(Boolean));
function entreesJournal() {
  const out = [], j = (o) => out.push(o), deMail = tachesDeMails();
  for (const x of DB.all('jnl:')) { const fs = jnlFiches(x), es = jnlPlanches(x); j({ src: fs.length || es.length ? 'culture' : 'note', date: x.date, par: x.par, texte: x.texte || '', type: x.type, fiches: fs, planches: es, captures: capturesJnl(x), key: x.key, cree: x.cree }); }
  for (const n of DB.all('note:')) j({ src: 'note', date: n.date || String(n.cree || '').slice(0, 10), par: n.par, texte: n.texte || '', captures: n.captures || [], key: n.key, ancienne: true, cree: n.cree });
  for (const x of DB.all('jour:')) if (x.remarque) j({ src: 'calendrier', date: x.date, texte: x.remarque, sous: 'remarque du jour', lien: '#/calendrier/mois' });
  for (const h of DB.all('h:')) if (h.note) { const [, d, p] = String(h.key).split(':'); j({ src: 'calendrier', date: d, par: p, texte: h.note, sous: 'note des heures', lien: '#/calendrier/heures' }); }
  for (const t of DB.all('t:')) if (String(t.remarques || '').trim() && !t.deMail && !deMail.has(t.key)) j({ src: 'tache', date: t.termineLe || t.jour || String(t.journee || '').split('|')[1] || t.echeance || String(t.cree || '').slice(0, 10), par: t.creePar, texte: t.remarques, sous: '☑ ' + (t.titre || ''), tache: t.key, fiches: t.cultures || [] });
  for (const c of (typeof tousContacts === 'function' ? tousContacts() : [])) for (const e of c.journal || []) if (String(e.note || '').trim()) j({ src: 'contact', date: e.date, par: e.par, texte: e.note, sous: displayName(c) + (e.statut ? ' · ' + e.statut : ''), lien: c.prospect ? '#/factures/prospect/' + encodeURIComponent(c.key) : '#/contacts/voir/' + encodeURIComponent(c.key) });
  return out.filter((x) => x.date).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.cree || '').localeCompare(String(a.cree || '')));
}
const etiquettesJnl = (x) => [x.type ? typeJnl(x.type) : '', ...(x.fiches || []).map((k) => (DB.get(k) || {}).nom).filter(Boolean), ...(x.planches || []).map((p) => (typeof nomPlanche === 'function' ? nomPlanche(p) : p))].filter(Boolean);
function renderJournalGeneral() {
  const tout = entreesJournal(), ans = [...new Set(tout.map((x) => String(x.date).slice(0, 4)).concat([todayISO().slice(0, 4)]))].sort().reverse();
  const q = sansAccentsS(JNL.q), an = JNL.an && ans.includes(JNL.an) ? JNL.an : '';
  const l = tout.filter((x) => (!an || String(x.date).startsWith(an)) && (!JNL.filtre || x.src === JNL.filtre) && (!JNL.fiche || (x.fiches || []).includes(JNL.fiche))
    && (!q || sansAccentsS(x.texte + ' ' + (x.sous || '') + ' ' + etiquettesJnl(x).join(' ') + ' ' + nomDe(x.par)).includes(q)));
  const n = (s) => tout.filter((x) => x.src === s && (!an || String(x.date).startsWith(an))).length;
  const fsUt = [...new Set(tout.flatMap((x) => x.fiches || []))].map((k) => DB.get(k) && Object.assign({ key: k }, DB.get(k))).filter(Boolean).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
  let html = '', jour = '';
  for (const x of l.slice(0, JNL.n)) {
    if (x.date !== jour) { jour = x.date; html += `<h3 class="jnl-jour">${esc(dateLongue(x.date))}</h3>`; }
    const s = SOURCES_JNL.find((y) => y[0] === x.src) || SOURCES_JNL[0], et = etiquettesJnl(x);
    const corps = `<span class="jnl-src" title="${esc(s[2])}">${s[1]}</span><div class="jnl-c"><div class="jnl-t">${lienTexteSimple(x.texte)}</div>
      ${(x.captures || []).length ? `<div class="jnl-caps">${x.captures.map((c) => `<span class="jnl-cap"><img data-fichier="${esc(c.chemin)}" alt=""></span>`).join('')}</div>` : ''}
      <span class="hint">${[x.par ? nomDe(x.par) : '', ...et, x.sous || ''].filter(Boolean).map(esc).join(' · ')}</span></div>`;
    const act = x.ancienne ? `data-act="noteEdit" data-key="${esc(x.key)}"` : x.key ? `data-act="jnlEdit" data-key="${esc(x.key)}"` : x.tache ? `data-act="taVoir" data-key="${esc(x.tache)}"` : '';
    html += `<div class="jnl-e">${act ? `<button type="button" class="jnl-btn" ${act}>${corps}</button>` : `<a class="jnl-btn" href="${esc(x.lien || '#/calendrier/journal')}">${corps}</a>`}</div>`;
  }
  return `<div class="panel jnl">
    <div class="between"><h2>Journal</h2><div class="row"><button class="btn small" type="button" data-act="jnlRapport" data-y="${esc(an || todayISO().slice(0, 4))}" title="Tout le journal de l'année et le bilan des cultures, en texte : à garder ou à donner à Claude en fin d'année">📄 Rapport ${esc(an || todayISO().slice(0, 4))}</button><button class="btn primary small" type="button" data-act="jnlNouveau">+ Note</button></div></div>
    <p class="hint jnl-but" data-aide-garder>Ce dont vous voulez vous souvenir : observations, idées, problèmes, à changer l'an prochain. Liée à une culture, la note réapparaît dans sa fiche et dans le plan.</p>
    <div class="jnl-filtres"><input id="jnl-q" type="search" placeholder="🔍 Chercher" value="${esc(JNL.q)}" aria-label="Chercher dans le journal">
      <div class="chips">${['', ...ans].map((y) => `<button type="button" class="chip small${an === y ? ' on' : ''}" data-act="jnlAnG" data-y="${esc(y)}">${y || 'Toutes les années'}</button>`).join('')}</div>
      <div class="chips"><button type="button" class="chip small${JNL.filtre ? '' : ' on'}" data-act="jnlFiltre" data-k="">Tout</button>${SOURCES_JNL.map(([k, e, lib]) => n(k) ? `<button type="button" class="chip small${JNL.filtre === k ? ' on' : ''}" data-act="jnlFiltre" data-k="${k}">${e} ${lib}<span class="n">${n(k)}</span></button>` : '').join('')}</div>
      ${fsUt.length ? `<select class="fin-sel" id="jnl-fiche" aria-label="Culture"><option value="">🌱 Toutes les cultures</option>${fsUt.map((f) => `<option value="${esc(f.key)}"${JNL.fiche === f.key ? ' selected' : ''}>${esc(f.nom)}</option>`).join('')}</select>` : ''}</div>
    ${html || '<p class="empty">Rien pour ce filtre. « + Note » : une observation, une idée, une photo du champ…</p>'}
    ${l.length > JNL.n ? `<div class="row-end"><button class="btn small" type="button" data-act="jnlPlus">Voir plus (${l.length - JNL.n})</button></div>` : ''}</div>`;
}
const lienTexteSimple = (t) => (typeof lienTexte === 'function' ? lienTexte(t) : esc(t)).replace(/\n/g, '<br>');
ACTIONS.jnlFiltre = (el) => { JNL.filtre = el.dataset.k; JNL.n = 60; render(); };
ACTIONS.jnlAnG = (el) => { JNL.an = el.dataset.y; JNL.n = 60; render(); };
ACTIONS.jnlPlus = () => { JNL.n += 100; render(); };
function brancherJournal() {
  const q = $('jnl-q'); if (q) q.addEventListener('input', () => { JNL.q = q.value; const p = q.selectionStart; render(); const n = $('jnl-q'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) { /* */ } } });
  const f = $('jnl-fiche'); if (f) f.addEventListener('change', () => { JNL.fiche = f.value; render(); });
}

/* ---------- Photos et captures d'une note (collées, glissées ou choisies) ---------- */
const capsJnlHtml = () => JNL.caps.map((c, i) => `<span class="idee-cap"><img data-fichier="${esc(c.chemin)}" alt=""><button type="button" class="idee-cap-x" data-act="jnlCapOff" data-i="${i}" aria-label="Retirer">×</button></span>`).join('');
function majCapsJnl(msg) { const z = $('jnl-caps'); if (z) { z.innerHTML = capsJnlHtml(); if (typeof hydraterFichiers === 'function') hydraterFichiers(z); } const et = $('jnl-cap-etat'); if (et && msg != null) et.textContent = msg; }
async function jnlJoindre(files) {
  const imgs = [...(files || [])].filter((f) => /^image\//.test(f.type)); if (!imgs.length) return false;
  majCapsJnl('Envoi…');
  for (const f of imgs.slice(0, 8)) {
    try { const r = await preparerFichier(f, 'photo'); const ch = await Fichiers.envoyer(r.blob, cheminFichier('journal', r.ext)); if (!LOCAL_MODE) Fichiers.liens[ch] = { url: URL.createObjectURL(r.blob), exp: Date.now() + 50 * 60000 }; JNL.caps.push({ chemin: ch, w: r.w, h: r.h }); }
    catch (e) { majCapsJnl('Impossible : ' + e.message); return true; }
  }
  majCapsJnl(''); return true;
}
ACTIONS.jnlCapOff = (el) => { JNL.caps.splice(Number(el.dataset.i), 1); majCapsJnl(); };
document.addEventListener('paste', (e) => { if (!document.querySelector('#sheet form[data-form="jnl"]')) return; const fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { e.preventDefault(); jnlJoindre(fs); } });
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#sheet form[data-form="jnl"]') && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (!(e.target.closest && e.target.closest('#sheet form[data-form="jnl"]')) || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); jnlJoindre(e.dataTransfer.files); });

/* ---------- Anciennes notes note:<id> : on peut encore les modifier ou les supprimer ---------- */
ACTIONS.noteEdit = (el) => {
  const k = el.dataset.key, n = DB.get(k); if (!n) return;
  openSheet(`${sheetHead('Note', `${nomDe(n.par)} · ${fmtDate(n.date)}`)}<form class="sbody form" data-form="note"><input type="hidden" name="key" value="${esc(k)}">
    ${txt('note-t', 'Note', n.texte, { name: 'texte', rows: 5 })}${inp('note-d', 'Date', n.date, { name: 'date', type: 'date' })}
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cette note">Supprimer</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.note = (v) => { const o = DB.get(v.key); if (!o) return; DB.put(v.key, Object.assign({}, o, { texte: String(v.texte || '').trim(), date: v.date || o.date, modifie: new Date().toISOString() })); closeSheet(); toast('Note mise à jour.'); };

/* Les notes d'une culture (toutes saisons), pour le plan de cultures */
const notesDeFiche = (fk) => (fk ? journal().filter((j) => jnlFiches(j).includes(fk)) : []);
ACTIONS.jnlCuVoir = (el) => {
  const fk = el.dataset.fiche, f = DB.get(fk) || {}, l = notesDeFiche(fk);
  openSheet(`${sheetHead('Journal · ' + (f.nom || 'culture'), `${l.length} note${l.length > 1 ? 's' : ''}, toutes saisons`)}<div class="sbody">
    ${l.map((j) => `<button type="button" class="jnl-btn" data-act="jnlEdit" data-key="${esc(j.key)}"><span class="jnl-src">🌱</span><div class="jnl-c"><div class="jnl-t">${lienTexteSimple(j.texte || '')}</div><span class="hint">${esc([fmtDate(j.date), typeJnl(j.type), nomDe(j.par)].filter(Boolean).join(' · '))}</span></div></button>`).join('') || '<p class="empty">Pas encore de note.</p>'}
    <div class="row-end"><button class="btn primary" type="button" data-act="jnlNouveau" data-fiche="${esc(fk)}">+ Note</button></div></div>`);
};
