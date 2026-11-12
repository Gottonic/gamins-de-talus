/* Gamins de Talus — boîte à idées : bugs, idées, nouvelles fonctions (bouton 💡 en haut).
   idee:<id> = { titre, type: 'bug' | 'idee', details, par, cree, fait?, faitPar?, faitLe?, captures?: [{ chemin, w, h }] }
   — cochée = faite, elle disparaît de la liste.
   Captures d'écran : collées (Ctrl+V) ou choisies, réduites comme les photos des messages, envoyées tout de suite
   dans le stockage privé (seau « fichiers », dossier idees/) : les membres les voient ; il faut du réseau. */
'use strict';
const IDEE_TYPES = [['bug', '🐞', 'Bug'], ['idee', '💡', 'Idée']];
const idees = () => DB.all('idee:').sort((a, b) => String(b.cree || '').localeCompare(String(a.cree || '')));
const IDEE = { type: 'idee', faites: false, caps: [], cle: '' };
const IDEE_MAXCAP = 6;
const ideeCapsHtml = () => IDEE.caps.map((c) => `<span class="idee-cap"><a data-fichier="${esc(c.chemin)}" target="_blank" rel="noopener" aria-label="Voir la capture"><img data-fichier="${esc(c.chemin)}" alt=""></a><button type="button" class="idee-cap-x" data-act="ideeCapRetirer" data-ch="${esc(c.chemin)}" aria-label="Retirer la capture">✕</button></span>`).join('');
const ideeJoindreHtml = () => `<div class="idee-joindre"><div class="idee-caps" id="idee-caps">${ideeCapsHtml()}</div>
  <label class="btn link small idee-joindre-l"${IDEE.caps.length >= IDEE_MAXCAP ? ' hidden' : ''}>📎 Joindre une capture<input type="file" id="idee-cap" accept="image/*" multiple hidden></label>
  <span class="hint" id="idee-cap-etat">${matchMedia('(pointer:fine)').matches ? 'ou colle-la ici (Ctrl+V)' : ''}</span></div>`;
function ideeMajCaps(msg) {
  const z = $('idee-caps'); if (z) z.innerHTML = ideeCapsHtml();
  const l = document.querySelector('#sheet .idee-joindre-l'); if (l) l.hidden = IDEE.caps.length >= IDEE_MAXCAP;
  if (msg != null) { const e = $('idee-cap-etat'); if (e) e.textContent = msg; }
}
/* une ou plusieurs images : réduites puis envoyées tout de suite ; elles rejoignent l'idée à l'enregistrement */
async function ideeJoindre(files) {
  const imgs = [...(files || [])].filter((f) => /^image\//.test(f.type)); if (!imgs.length) return false;
  const place = IDEE_MAXCAP - IDEE.caps.length; if (place <= 0) { ideeMajCaps(IDEE_MAXCAP + ' captures au plus.'); return true; }
  ideeMajCaps('Envoi de la capture…');
  let n = 0;
  for (const f of imgs.slice(0, place)) {
    try { const r = await preparerFichier(f, 'photo'); const ch = await Fichiers.envoyer(r.blob, cheminFichier('idees', r.ext)); IDEE.caps.push({ chemin: ch, w: r.w, h: r.h }); n++; }
    catch (e) { ideeMajCaps('Capture impossible : ' + e.message); return true; }
  }
  ideeMajCaps(n > 1 ? n + ' captures jointes.' : 'Capture jointe.');
  return true;
}
const ideeSheetOuverte = () => !!document.querySelector('#sheet #idee-caps');
function ideesHtml() {
  const l = idees(), ouv = l.filter((x) => !x.fait), faites = l.filter((x) => x.fait);
  const ligne = (x) => { const t = IDEE_TYPES.find((y) => y[0] === x.type) || IDEE_TYPES[1];
    return `<div class="idee${x.fait ? ' fait' : ''}"><input type="checkbox" data-idee="${esc(x.key)}"${x.fait ? ' checked' : ''} aria-label="Fait : ${esc(x.titre)}">
      <button type="button" class="idee-t" data-act="ideeVoir" data-key="${esc(x.key)}"><span>${t[1]} ${esc(x.titre)}</span><span class="hint">${esc(nomDe(x.par))}${x.details ? ' · 📝' : ''}${(x.captures || []).length ? ' · 📷 ' + x.captures.length : ''}</span></button></div>`; };
  return `${sheetHead('Bugs et idées', 'Ce qui ne marche pas, ce qui manque')}<div class="sbody" data-vue-racine>
    <form class="form idee-ajout" data-form="ideeAjout">
      <div class="chips">${IDEE_TYPES.map(([k, e, n]) => `<button type="button" class="chip${IDEE.type === k ? ' on' : ''}" data-act="ideeType" data-k="${k}">${e} ${n}</button>`).join('')}</div>
      <div class="ab-ligne"><input name="titre" id="idee-titre" placeholder="${IDEE.type === 'bug' ? 'Ce qui ne marche pas…' : 'Ton idée, une nouvelle fonction…'}" autocomplete="off" enterkeyhint="done" aria-label="Titre"><button class="btn primary ab-plus" type="submit" aria-label="Ajouter">+</button></div>
      ${ideeJoindreHtml()}
      <details><summary class="hint">+ Détails</summary>${txt('idee-det', 'Détails (facultatif)', '', { name: 'details', rows: 3 })}</details></form>
    <div class="idees">${ouv.length ? ouv.map(ligne).join('') : '<p class="empty">Rien en attente. 🌿</p>'}</div>
    <div class="row idees-pied">${ouv.length ? `<span class="row" style="gap:12px"><button type="button" class="btn link small" data-act="ideesCopier">Copier pour Claude</button>${ouv.length > 1 ? '<button type="button" class="btn link small" data-act="ideesToutFait">☑ Tout cocher</button>' : ''}${(() => { const n = ouv.reduce((a, x) => a + (x.captures || []).length, 0); return n ? (partageFichiersPossible() ? `<button type="button" class="btn link small" data-act="ideesPartager">Partager avec les captures (${n})</button>` : `<button type="button" class="btn link small" data-act="ideesCaptures">Télécharger les captures (${n})</button>`) : ''; })()}</span>` : '<span></span>'}${faites.length ? `<button type="button" class="btn link small" data-act="ideeFaites">${IDEE.faites ? 'Cacher' : 'Voir'} les faites (${faites.length})</button>` : ''}</div>
    ${faites.length && IDEE.faites ? `<div class="idees">${faites.slice(0, 50).map(ligne).join('')}</div>` : ''}</div>`;
}
/* Tout ce qui est en attente, en texte, à coller dans la conversation avec Claude.
   Les captures : « Partager » (téléphone : texte + images vers l'app Claude) ou « Télécharger » (ordinateur : à glisser dans la conversation). */
const partageFichiersPossible = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; } };
const IDEE_FICHIERS = {}; /* chemin → File, préparés à l'avance (le partage doit suivre le toucher sans attendre le réseau) */
async function preparerCaptures(ouv) {
  const caps = []; ouv.forEach((x) => (x.captures || []).forEach((c, i) => caps.push({ c, nom: `${x.type === 'bug' ? 'bug' : 'idee'}-${sansAccentsS(x.titre).replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${i + 1}` })));
  await Fichiers.liensPour(caps.map((x) => x.c.chemin));
  for (const { c, nom } of caps) {
    if (IDEE_FICHIERS[c.chemin]) continue; const u = Fichiers.enCache(c.chemin); if (!u) continue;
    try { const b = await (await fetch(u)).blob(), ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'); IDEE_FICHIERS[c.chemin] = new File([b], `${nom}.${ext}`, { type: b.type || 'image/jpeg' }); } catch (e) { /* hors ligne */ }
  }
  return caps.map((x) => IDEE_FICHIERS[x.c.chemin]).filter(Boolean);
}
const texteIdees = (ouv, jointes) => `Gamins de Talus — bugs et idées (${ouv.length})\n` + ouv.map((x) => `- ${(IDEE_TYPES.find((y) => y[0] === x.type) || IDEE_TYPES[1])[1]} ${x.titre}${x.details ? ' : ' + x.details.replace(/\s*\n\s*/g, ' / ') : ''}${(x.captures || []).length ? ` (📷 ${x.captures.length} capture${x.captures.length > 1 ? 's' : ''}${jointes ? ' jointe' + (x.captures.length > 1 ? 's' : '') : " dans l'app"})` : ''}${x.par ? ' — ' + nomDe(x.par) : ''}`).join('\n');
ACTIONS.ideesPartager = async () => {
  const ouv = idees().filter((x) => !x.fait), txt = texteIdees(ouv, true), files = ouv.flatMap((x) => (x.captures || []).map((c) => IDEE_FICHIERS[c.chemin])).filter(Boolean);
  try { if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {}); } catch (e) { /* */ }
  if (!files.length) { toast('Captures pas encore prêtes (réseau ?) : réessaie dans un instant.'); preparerCaptures(ouv); return; }
  try { await navigator.share({ text: txt, files, title: 'Bugs et idées' }); }
  catch (e) { if (e && e.name !== 'AbortError') toast('Partage impossible : ' + e.message); }
};
ACTIONS.ideesCaptures = async () => {
  const ouv = idees().filter((x) => !x.fait); toast('Préparation des captures…');
  const files = await preparerCaptures(ouv); if (!files.length) { toast('Captures introuvables (réseau ?).'); return; }
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  try { await navigator.clipboard.writeText(texteIdees(ouv, true)); } catch (e) { /* */ }
  toast(`${files.length} capture${files.length > 1 ? 's' : ''} téléchargée${files.length > 1 ? 's' : ''} et texte copié : colle le texte dans la conversation, puis glisse les captures.`, 7000);
};
ACTIONS.ideesCopier = () => {
  const ouv = idees().filter((x) => !x.fait);
  const txt = texteIdees(ouv);
  const fini = () => toast('Copié : colle-le dans la conversation avec Claude.');
  const secours = () => { const t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); fini(); } catch (e) { toast('Copie impossible.'); } t.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(fini, secours); else secours();
};
ACTIONS.idees = () => { if (partageFichiersPossible()) setTimeout(() => preparerCaptures(idees().filter((x) => !x.fait)), 0); if (IDEE.cle) { IDEE.caps = []; IDEE.cle = ''; } openSheet(ideesHtml()); };
const ideesRafraichir = () => {
  if (!(document.querySelector('#sheet .idees') || document.querySelector('#sheet .idee-ajout'))) return;
  const t = $('idee-titre'), v = t ? t.value : ''; openSheet(ideesHtml()); const n = $('idee-titre'); if (n && v) n.value = v;
};
ACTIONS.ideeType = (el) => { IDEE.type = el.dataset.k; const t = $('idee-titre'), v = t ? t.value : ''; openSheet(ideesHtml()); const n = $('idee-titre'); if (n) { n.value = v; n.focus(); } };
/* Tout cocher d'un coup (après les avoir données à Claude, par ex.) ; ↶ Annuler les remet toutes */
ACTIONS.ideesToutFait = () => {
  const ouv = idees().filter((x) => !x.fait); if (!ouv.length) return;
  const le = todayISO(); for (const x of ouv) { const o = Object.assign({}, x); delete o.key; DB.put(x.key, Object.assign(o, { fait: true, faitPar: Sync.me || '', faitLe: le })); }
  openSheet(ideesHtml()); toast(`${ouv.length} cochées. ↶ en haut pour annuler.`, 5000);
};
ACTIONS.ideeFaites = () => { IDEE.faites = !IDEE.faites; openSheet(ideesHtml()); };
FORMS.ideeAjout = (v) => {
  if (!String(v.titre || '').trim()) { toast('Écris le titre.'); return; }
  DB.put('idee:' + uid('i'), Object.assign({ titre: v.titre.trim(), type: IDEE.type, details: String(v.details || '').trim(), par: Sync.me || '', cree: new Date().toISOString() }, IDEE.caps.length ? { captures: IDEE.caps.slice() } : {}));
  IDEE.caps = [];
  toast(IDEE.type === 'bug' ? 'Bug noté. Merci !' : 'Idée notée. Merci !'); openSheet(ideesHtml()); const n = $('idee-titre'); if (n) n.focus();
};
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.idee; if (!k) return; const x = DB.get(k); if (!x) return;
  DB.put(k, Object.assign({}, x, e.target.checked ? { fait: true, faitPar: Sync.me || '', faitLe: todayISO() } : { fait: false, faitPar: '', faitLe: '' }));
  setTimeout(ideesRafraichir, 250);
});
ACTIONS.ideeVoir = (el) => {
  const k = el.dataset.key, x = DB.get(k); if (!x) return;
  IDEE.cle = k; IDEE.caps = (x.captures || []).slice();
  openSheet(`${sheetHead(x.titre, `${(IDEE_TYPES.find((y) => y[0] === x.type) || IDEE_TYPES[1])[2]} · ${nomDe(x.par)} · ${fmtDate(String(x.cree || '').slice(0, 10))}${x.fait ? ` · fait${x.faitPar ? ' par ' + nomDe(x.faitPar) : ''}` : ''}`)}<form class="sbody form" data-form="ideeEdit"><input type="hidden" name="key" value="${esc(k)}">
    ${inp('ie-t', 'Titre', x.titre, { name: 'titre', req: true })}
    <div class="field"><span class="flabel">Type</span><div class="seg">${IDEE_TYPES.map(([t, e, n]) => `<label><input type="radio" name="type" value="${t}"${(x.type || 'idee') === t ? ' checked' : ''}> ${e} ${n}</label>`).join('')}</div></div>
    ${txt('ie-d', 'Détails', x.details, { name: 'details', rows: 6 })}
    ${x.details && /https?:\/\//.test(x.details) ? `<p class="hint">${linkify(x.details)}</p>` : ''}
    <div class="field"><span class="flabel">Captures</span>${ideeJoindreHtml()}</div>
    <div class="row-end"><button class="btn danger" type="button" data-act="delItem" data-key="${esc(k)}" data-what="cet élément">Supprimer</button><button class="btn" type="button" data-act="ideesListe">‹ Liste</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.ideeEdit = (v) => {
  const x = DB.get(v.key); if (!x || !String(v.titre || '').trim()) return;
  const o = Object.assign({}, x, { titre: v.titre.trim(), type: v.type || x.type, details: String(v.details || '').trim() });
  if (IDEE.cle === v.key) { if (IDEE.caps.length) o.captures = IDEE.caps.slice(); else delete o.captures; }
  DB.put(v.key, o); toast('Enregistré.'); ACTIONS.idees();
};
/* « ‹ Liste » sans enregistrer : les captures ajoutées entre-temps restent dans le stockage, mais pas sur l'idée */
ACTIONS.ideesListe = () => ACTIONS.idees();
/* retirer une capture : elle quitte l'idée (le fichier, lui, n'est jamais effacé du stockage) */
ACTIONS.ideeCapRetirer = (el) => { IDEE.caps = IDEE.caps.filter((c) => c.chemin !== el.dataset.ch); ideeMajCaps(IDEE.cle ? 'Retirée : Enregistrer pour confirmer.' : ''); };
document.addEventListener('change', (e) => { if (e.target && e.target.id === 'idee-cap') { const fs = [...e.target.files]; e.target.value = ''; ideeJoindre(fs); } });
/* coller une capture (Ctrl+V) quand la boîte à idées est ouverte */
document.addEventListener('paste', (e) => {
  if (!ideeSheetOuverte() || !e.clipboardData) return;
  const fs = [...(e.clipboardData.items || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
  if (fs.length) { e.preventDefault(); ideeJoindre(fs); }
});
