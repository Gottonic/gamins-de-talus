/* Gamins de Talus — messagerie entre associés, avec notifications Discord (facultatives, par personne).
   msg:<id>          un message { de, texte, cree, photo? { chemin, w, h }, repond? (clé du message cité), modifieLe?, epingle? { par, le } }
                     Mis à la corbeille au bout de 3 mois (sauf s'il est épinglé) ; 3 messages épinglés au plus.
   mail:<id>         un mail reçu sur l'adresse commune (relevé par la fonction Supabase « mails ») : voir plus bas
   lu:<personne>     jusqu'où la personne a lu { jusqua } : une ligne par personne, donc jamais de conflit
   cfg:discord:<p>   le webhook Discord de la personne { webhook, texte } (dans la base, pas dans le code public) */
'use strict';

const MSG = { draft: '', timer: null, photo: null, envoi: false, repondA: '', edition: '' };
const MAX_EPINGLES = 3;
/* Réserve la place de la photo avant qu'elle se charge (sinon les messages « redescendent ») */
const taillePhoto = (ph) => { const w = Number(ph.w) || 4, h = Number(ph.h) || 3, r = Math.min(280 / w, 340 / h); return ` width="${w}" height="${h}" style="width:${Math.round(w * r)}px;aspect-ratio:${w}/${h}"`; };
const apercuMsg = (m) => (m.sondage ? (m.sondage.type === 'dates' ? '📅 ' : '📊 ') + (m.sondage.question || 'Sondage') : '') || (m.texte ? m.texte.replace(/\s+/g, ' ') : '') || (m.photo ? '📷 Photo' : '') || (m.fichier ? '📎 ' + m.fichier.nom : '');
const messages = () => DB.all('msg:').sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
const luJusqua = (p) => ((DB.get('lu:' + p) || {}).jusqua || '');
function nonLus(p) { p = p || Sync.me; const l = luJusqua(p); return messages().filter((m) => m.de !== p && String(m.cree) > l); }
const discordDe = (p) => DB.get('cfg:discord:' + p) || {};
/* Discord pour les messages : oui par défaut dès qu'un webhook est enregistré (choix dans Réglages → Notifications) */
const discordMessages = (p) => !!discordDe(p).webhook && (DB.get('cfg:notif:' + p) || {}).d_messages !== false;
const APP_URL = 'https://gottonic.github.io/gamins-de-talus/';
/* Petit lien 🔗 au début de chaque message Discord : ouvre la messagerie pour répondre (les < > évitent l'aperçu du site) */
const LIEN_MSG = `[🔗](<${APP_URL}#/messages>)`;

MODULES.messages = {
  titre: 'Messagerie',
  tuile() {
    const n = nonLus().length, ms = messages(), der = ms[ms.length - 1];
    if (!der) return { line: 'Discuter entre associés' };
    return { qui: der.de === Sync.me ? 'Toi :' : nomDe(der.de) + ' :', line: (der.photo && der.texte ? '📷 ' : '') + trunc(apercuMsg(der), 90), clamp: true, badge: n };
  },
  render(sub) {
    /* Les mails ont maintenant leur propre module : l'ancienne adresse y mène */
    if (sub === 'mails') { setTimeout(() => location.replace('#/mails'), 0); return ''; }
    return renderMessages();
  },
  after() {
    marquerLu();
    /* Toujours ouvrir sur le dernier message, même quand les photos se chargent après coup */
    const box = $('msg-list');
    if (box) {
      /* « collé en bas » tant que la personne ne fait pas défiler elle-même (molette, doigt, clavier) */
      let colle = true; MSG.geste = 0; const enBas = () => { box.scrollTop = box.scrollHeight; };
      enBas(); requestAnimationFrame(enBas);
      ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach((ev) => box.addEventListener(ev, () => { MSG.geste = Date.now(); }, { passive: true }));
      box.addEventListener('scroll', () => { if (Date.now() - MSG.geste < 1500) colle = box.scrollHeight - box.scrollTop - box.clientHeight < 80; }, { passive: true });
      box.addEventListener('load', () => { if (colle) enBas(); }, true);
      if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (colle) enBas(); }); [...box.children].forEach((c) => ro.observe(c)); }
    }
    const t = $('msg-txt');
    if (t) {
      const grow = () => { t.style.height = 'auto'; t.style.height = Math.min(220, t.scrollHeight + 2) + 'px'; };
      t.addEventListener('input', () => { MSG.draft = t.value; grow(); }); grow();
      const f = $('msg-file'); if (f) f.addEventListener('change', () => { closeSheet(); choisirPhoto(f.files[0]); });
      const cam = $('msg-cam'); if (cam) cam.addEventListener('change', () => { closeSheet(); choisirPhoto(cam.files[0]); });
      const doc = $('msg-doc'); if (doc) doc.addEventListener('change', () => { closeSheet(); choisirFichierMsg(doc.files[0]); doc.value = ''; });
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); envoyerMessage(); }
      });
    }
    /* Sur cette page, on regarde souvent s'il y a du nouveau */
    clearInterval(MSG.timer);
    MSG.timer = setInterval(() => {
      if (ROUTE.mod !== 'messages') { clearInterval(MSG.timer); return; }
      if (document.visibilityState === 'visible') Sync.pull();
    }, 8000);
  },
};

function marquerLu() {
  if (!Sync.me) return;
  const ms = messages(); if (!ms.length) return;
  const der = ms[ms.length - 1].cree;
  if (String(der) > luJusqua(Sync.me)) DB.put('lu:' + Sync.me, { jusqua: der });
}

function heureMsg(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }); }
function jourMsg(iso) {
  const d = isoDate(new Date(iso)), t = todayISO();
  if (d === t) return "Aujourd'hui";
  if (d === addDays(t, -1)) return 'Hier';
  return JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7] + ' ' + fmtDate(d);
}
/* Liens cliquables dans le texte */
function texteMsg(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, '<br>'); }

function renderMessages() {
  const ms = messages(), me = Sync.me, prevenus = personnes().filter((p) => discordMessages(p.k)).map((p) => p.nom);
  let jour = '', html = '';
  ms.forEach((m, i) => {
    const j = isoDate(new Date(m.cree));
    if (j !== jour) { jour = j; html += `<div class="msg-day">${esc(jourMsg(m.cree))}</div>`; }
    const mien = m.de === me, suite = i > 0 && ms[i - 1].de === m.de && isoDate(new Date(ms[i - 1].cree)) === j;
    const cite = m.repond ? DB.get(m.repond) || DB.trash[m.repond] : null;
    html += `<div class="msg${mien ? ' mine' : ''}${suite && !m.repond ? ' suite' : ''}${m.epingle ? ' pinned' : ''}" id="m-${esc(m.key.slice(4))}">
      ${!mien && (!suite || m.repond) ? `<span class="msg-who">${esc(nomDe(m.de))}</span>` : ''}
      ${m.repond ? `<button type="button" class="msg-cite" data-act="msgVoir" data-key="${esc(m.repond)}">↪ ${cite ? `<b>${esc(nomDe(cite.de))}</b> ${esc(trunc(apercuMsg(cite), 70))}` : 'message supprimé'}</button>` : ''}
      <div class="bubble${m.photo && !m.photo.expire ? ' has-photo' : ''}">${m.photo && m.photo.expire ? '<span class="photo-expiree">📷 Photo retirée après 6 mois</span>' : ''}${m.photo && !m.photo.expire ? `<button type="button" class="msg-photo" data-act="voirFichier" data-fichier="${esc(m.photo.chemin)}" data-titre="${esc(nomDe(m.de) + ' · ' + jourMsg(m.cree) + ' ' + heureMsg(m.cree))}"><img data-fichier="${esc(m.photo.chemin)}" alt="Photo de ${esc(nomDe(m.de))}"${taillePhoto(m.photo)}></button>` : ''}${m.sondage ? sondageHtml(m) : ''}${m.fichier ? fichierMsgHtml(m.fichier) : ''}${m.sondage ? '' : texteMsg(m.texte || '')}<span class="msg-t">${m.epingle ? '📌 ' : ''}${heureMsg(m.cree)}${m.modifieLe ? ' · modifié' : ''} <button type="button" class="msg-menu" data-act="msgMenu" data-key="${esc(m.key)}" title="Options" aria-label="Options du message">⋯</button></span></div></div>`;
  });
  /* « Vu par » sous le dernier message */
  const der = ms[ms.length - 1];
  if (der) {
    const vus = personnes().filter((p) => p.k !== der.de && p.k !== me && luJusqua(p.k) >= String(der.cree)).map((p) => p.nom);
    if (der.de === me || vus.length) html += `<div class="msg-vu${der.de === me ? ' mine' : ''}">${vus.length ? 'Vu par ' + esc(vus.join(', ')) : 'Pas encore vu'}</div>`;
  }
  const pins = ms.filter((m) => m.epingle).sort((a, b) => String(a.epingle.le).localeCompare(String(b.epingle.le)));
  const pinsHtml = pins.length ? `<div class="pins">${pins.map((m) => `<button type="button" class="pin" data-act="msgVoir" data-key="${esc(m.key)}">📌 <b>${esc(nomDe(m.de))}</b> ${esc(trunc(apercuMsg(m), 80))}</button>`).join('')}</div>` : '';
  const cible = MSG.repondA ? DB.get(MSG.repondA) : null, edit = MSG.edition ? DB.get(MSG.edition) : null;
  const bandeau = edit ? `<div class="msg-prev"><span>✏️ Modifier ton message</span><button type="button" class="btn small" data-act="msgAnnuler">Annuler</button></div>`
    : cible ? `<div class="msg-prev"><span>↪ Réponse à <b>${esc(nomDe(cible.de))}</b> : ${esc(trunc(apercuMsg(cible), 80))}</span><button type="button" class="btn small" data-act="msgAnnuler">Annuler</button></div>` : '';
  return `<div class="panel chat">
    <div class="between chat-head"><a class="btn small chat-fermer" href="#/" data-act="chatFermer" aria-label="Fermer la discussion">←</a><h2>Entre nous</h2>
      <a class="btn small" href="#/reglages/notifications">🔔 Notifications</a></div>
    <p class="hint chat-who">${esc(personnes().map((p) => p.nom).join(', '))}${prevenus.length ? ' · prévenus sur Discord : ' + esc(prevenus.join(', ')) : ''}</p>
    ${pinsHtml}${(() => { const h = hautSondages(); return h ? `<div class="pins">${h}</div>` : ''; })()}
    <div class="msg-list" id="msg-list" aria-live="polite">${html || '<p class="empty">Aucun message pour l\'instant. Écris le premier !</p>'}</div>
    ${bandeau}
    ${MSG.photo ? `<div class="msg-prev"><img src="${MSG.photo.apercu}" alt="Photo à envoyer"><span>Photo prête à envoyer${MSG.envoi ? ' : envoi…' : ' · ajoute une légende si tu veux'}</span><button type="button" class="btn small" data-act="msgPhotoOff"${MSG.envoi ? ' disabled' : ''}>Retirer</button></div>` : ''}
    ${MSG.fichier ? `<div class="msg-prev"><span>📎 <b>${esc(trunc(MSG.fichier.name, 40))}</b> · ${tailleTxt(MSG.fichier.size)}${MSG.envoi ? ' : envoi…' : ' · prêt à envoyer'}</span><button type="button" class="btn small" data-act="msgFichierOff"${MSG.envoi ? ' disabled' : ''}>Retirer</button></div>` : ''}
    <form class="composer" data-form="msg">
      <button type="button" class="btn photo-btn" data-act="msgPlus" title="Fichier, sondage…" aria-label="Ajouter un fichier ou un sondage">＋</button>
      <button type="button" class="btn photo-btn" data-act="msgPhoto" title="Photo" aria-label="Ajouter une photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg></button>
      <input id="msg-file" type="file" accept="image/*" hidden><input id="msg-cam" type="file" accept="image/*" capture="environment" hidden><input id="msg-doc" type="file" hidden>
      <textarea id="msg-txt" name="texte" rows="1" placeholder="Écrire un message…" aria-label="Message">${esc(MSG.draft)}</textarea>
      <button class="btn primary" type="submit"${MSG.envoi ? ' disabled' : ''}>${MSG.envoi ? 'Envoi…' : 'Envoyer'}</button>
    </form>
    <p class="hint chat-aide">${matchMedia('(pointer: fine)').matches ? 'Entrée pour envoyer, Maj + Entrée pour aller à la ligne. ' : ''}⋯ sur un message : répondre, épingler (${MAX_EPINGLES} au plus), modifier, supprimer, en faire une tâche. Les messages partent à la corbeille au bout de 3 mois, sauf ceux épinglés.</p></div>`;
}

const ICON_DISCORD = '<svg class="ic-d" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8.5c4-2 8-2 12 0l1.5 7c-1.5 1.3-3 2-4.5 2.3l-1-1.6m-4 0-1 1.6C7.5 17.5 6 16.8 4.5 15.5z"/><circle cx="9.5" cy="12.5" r="1.1"/><circle cx="14.5" cy="12.5" r="1.1"/></svg>';

FORMS.msg = () => envoyerMessage();
async function choisirPhoto(file) {
  if (!file) return;
  try {
    const f = await preparerFichier(file, 'photo');
    if (MSG.photo) URL.revokeObjectURL(MSG.photo.apercu);
    MSG.photo = Object.assign(f, { apercu: URL.createObjectURL(f.blob) });
    const t = $('msg-txt'); if (t) MSG.draft = t.value;
    render();
  } catch (e) { toast('Photo impossible : ' + e.message); }
}
ACTIONS.msgPhotoOff = () => { if (MSG.photo) URL.revokeObjectURL(MSG.photo.apercu); MSG.photo = null; render(); };
async function envoyerMessage() {
  if (MSG.envoi) return;
  const t = $('msg-txt'); const texte = String((t && t.value) || '').trim();
  if (!texte && !MSG.photo && !MSG.fichier) return;
  if (!Sync.me) { toast('Connecte-toi pour envoyer un message.'); return; }
  if (MSG.edition) {
    const k = MSG.edition, o = DB.get(k); MSG.edition = ''; MSG.draft = ''; if (t) t.value = '';
    if (o && texte) DB.put(k, Object.assign({}, o, { texte, modifieLe: new Date().toISOString() }));
    render(); return;
  }
  let photo = null; const ph = MSG.photo;
  if (ph) {
    MSG.envoi = true; MSG.draft = texte; render();
    try {
      const chemin = await Fichiers.envoyer(ph.blob, cheminFichier('messages', ph.ext));
      photo = { chemin, w: ph.w, h: ph.h };
    } catch (e) { MSG.envoi = false; render(); toast("La photo n'est pas partie : " + e.message, 6000); return; }
    MSG.envoi = false;
  }
  let fichier = null; const fi = MSG.fichier;
  if (fi) {
    MSG.envoi = true; MSG.draft = texte; render();
    try {
      const ext = (fi.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
      const chemin = await Fichiers.envoyer(fi, cheminFichier('messages', ext));
      fichier = { chemin, nom: fi.name, type: fi.type || '', taille: fi.size };
    } catch (e) { MSG.envoi = false; render(); toast("Le fichier n'est pas parti : " + e.message, 6000); return; }
    MSG.envoi = false;
  }
  const cree = new Date().toISOString();
  MSG.draft = ''; MSG.photo = null; MSG.fichier = null; const tt = $('msg-txt'); if (tt) tt.value = '';
  const msg = { de: Sync.me, texte, cree }; if (photo) msg.photo = photo; if (fichier) msg.fichier = fichier;
  const cite = MSG.repondA && DB.get(MSG.repondA); if (cite) msg.repond = MSG.repondA; MSG.repondA = '';
  DB.put('msg:' + uid('m'), msg);
  DB.put('lu:' + Sync.me, { jusqua: cree });
  Sync.schedule(0);
  notifierDiscord(Sync.me, (cite ? `↪ (réponse à ${nomDe(cite.de)} : « ${trunc(apercuMsg(cite), 50)} ») ` : '') + (texte || (fichier ? '📎 ' + fichier.nom : '')), ph && ph.blob);
  if (ph) Fichiers.local[photo.chemin] = Fichiers.local[photo.chemin] || ph.apercu;
  if (ph && !LOCAL_MODE) Fichiers.liens[photo.chemin] = { url: ph.apercu, exp: Date.now() + 50 * 60000 };
  render(); const n = $('msg-txt'); if (n && matchMedia('(pointer: fine)').matches) n.focus();
}
/* ---------- Photo, fichier, sondage : les boutons du bas ---------- */
ACTIONS.msgPhoto = () => {
  /* Sur ordinateur : directement le choix du fichier ; sur téléphone : prendre une photo ou en choisir une */
  if (matchMedia('(pointer: fine)').matches) { $('msg-file').click(); return; }
  openSheet(`${sheetHead('Photo')}<div class="sbody"><div class="menu-list">
    <label class="menu-it" for="msg-cam">📸 Prendre une photo</label><label class="menu-it" for="msg-file">🖼️ Choisir une photo</label></div></div>`);
};
ACTIONS.msgPlus = () => openSheet(`${sheetHead('Ajouter')}<div class="sbody"><div class="menu-list">
  <label class="menu-it" for="msg-doc">📎 Un fichier <span class="hint">(5 Mo au plus)</span></label>
  <button type="button" class="menu-it" data-act="sondageNouveau" data-type="simple">📊 Un sondage</button>
  <button type="button" class="menu-it" data-act="sondageNouveau" data-type="dates">📅 Un sondage de dates</button></div></div>`);
const FICHIER_MSG_MAX = 5 * 1024 * 1024;
function choisirFichierMsg(f) {
  if (!f) return; if (f.size > FICHIER_MSG_MAX) { toast(`Trop lourd : ${tailleTxt(f.size)} (5 Mo au plus). Mets-le plutôt dans le Drive.`, 6000); return; }
  const t = $('msg-txt'); if (t) MSG.draft = t.value; MSG.fichier = f; render();
}
ACTIONS.msgFichierOff = () => { MSG.fichier = null; render(); };
function fichierMsgHtml(f) {
  if (f.expire) return '<span class="photo-expiree">📎 Fichier retiré après 6 mois</span>';
  const vue = /^image\/|pdf/.test(f.type || '') || /\.pdf$/i.test(f.nom);
  return vue ? `<button type="button" class="msg-fichier" data-act="voirFichier" data-fichier="${esc(f.chemin)}" data-titre="${esc(f.nom)}">📎 <b>${esc(trunc(f.nom, 40))}</b> <small>${tailleTxt(f.taille)}</small></button>`
    : `<a class="msg-fichier" data-fichier="${esc(f.chemin)}" download="${esc(f.nom)}" target="_blank" rel="noopener">📎 <b>${esc(trunc(f.nom, 40))}</b> <small>${tailleTxt(f.taille)}</small></a>`;
}

/* ---------- Sondages ----------
   msg.sondage = { type: 'simple' | 'dates', question, options: [{ k, t }] (pour les dates, t = AAAA-MM-JJ), plusieurs }
   Les réponses sont des lignes à part : vote:<id du message>:<personne> = { choix: [k…], le } (pas de conflit si deux répondent en même temps).
   Rempli quand tout le monde a répondu. Sondage de dates rempli : la date commune la plus proche → « Créer l'événement ». */
const votesDe = (k) => { const id = k.slice(4), o = {}; for (const p of personnes()) { const v = DB.get(`vote:${id}:${p.k}`); if (v) o[p.k] = v.choix || []; } return o; };
const sondageRempli = (k) => { const v = votesDe(k); return personnes().every((p) => v[p.k]); };
function datesCommunes(k, m) {
  const v = votesDe(k), today = todayISO();
  return (m.sondage.options || []).filter((o) => personnes().every((p) => (v[p.k] || []).includes(o.k))).map((o) => o.t).filter((d) => d >= today).sort();
}
const jourCourt = (d) => `${JOURS[(new Date(d + 'T12:00').getDay() + 6) % 7].slice(0, 3)} ${fmtDateCourt(d)}`;
function sondageHtml(m) {
  const s = m.sondage, k = m.key, v = votesDe(k), rempli = personnes().every((p) => v[p.k]), moi = v[Sync.me] || null;
  const communs = s.type === 'dates' ? datesCommunes(k, m) : [];
  const attend = personnes().filter((p) => !v[p.k]).map((p) => p.nom);
  return `<div class="sondage"><div class="sd-tete">${rempli ? '<span class="sd-ok">✓ Sondage rempli</span>' : `<span class="hint">${attend.length} réponse${attend.length > 1 ? 's' : ''} attendue${attend.length > 1 ? 's' : ''} : ${esc(attend.join(', '))}</span>`}</div>
    <b class="sd-q">${s.type === 'dates' ? '📅' : '📊'} ${esc(s.question || 'Sondage')}</b>
    <div class="sd-opts">${(s.options || []).map((o) => { const qui = personnes().filter((p) => (v[p.k] || []).includes(o.k)), on = moi && moi.includes(o.k), commun = s.type === 'dates' && communs.includes(o.t);
      return `<button type="button" class="sd-opt${on ? ' on' : ''}${commun ? ' commun' : ''}" data-act="sondageVote" data-key="${esc(k)}" data-o="${esc(o.k)}"><span class="sd-case">${on ? '✓' : ''}</span><span class="sd-t">${esc(s.type === 'dates' ? jourCourt(o.t) : o.t)}</span><span class="sd-qui">${qui.length ? esc(qui.map((p) => p.nom).join(', ')) : ''}</span></button>`; }).join('')}</div>
    ${s.type === 'dates' && !(moi && moi.length) ? `<button type="button" class="btn link small sd-aucune" data-act="sondageAucune" data-key="${esc(k)}">${moi ? '✓ Aucune date ne me va' : 'Aucune date ne me va'}</button>` : ''}
    ${s.type === 'dates' && rempli ? `<p class="sd-res">${communs.length ? `Date${communs.length > 1 ? 's' : ''} commune${communs.length > 1 ? 's' : ''} : ${esc(communs.map(jourCourt).join(', '))}` : 'Aucune date commune.'}${m.evenement && DB.get(m.evenement) ? ' · événement créé ✓' : ''}</p>` : ''}
    <span class="hint sd-aide">${s.plusieurs || s.type === 'dates' ? 'Plusieurs choix possibles.' : 'Un seul choix.'}</span></div>`;
}
/* En haut de la discussion : les sondages qui attendent ma réponse, et les dates trouvées */
function hautSondages() {
  const out = [];
  for (const m of messages().filter((x) => x.sondage)) {
    const v = votesDe(m.key);
    if (Sync.me && !v[Sync.me]) out.push(`<button type="button" class="pin sd-pin" data-act="msgVoir" data-key="${esc(m.key)}">${m.sondage.type === 'dates' ? '📅' : '📊'} <b>Sondage</b> ${esc(trunc(m.sondage.question || '', 60))} · <u>répondre</u></button>`);
    else if (m.sondage.type === 'dates' && personnes().every((p) => v[p.k]) && !(m.evenement && DB.get(m.evenement))) {
      const c = datesCommunes(m.key, m);
      if (c.length) out.push(`<div class="pin sd-trouve"><span>📅 <b>Date trouvée</b> : ${esc(trunc(m.sondage.question || '', 40))} · ${esc(jourCourt(c[0]))}${c.length > 1 ? ` <span class="hint">(+${c.length - 1} autre${c.length > 2 ? 's' : ''})</span>` : ''}</span><button type="button" class="btn small primary" data-act="sondageEvenement" data-key="${esc(m.key)}">Créer l'événement</button></div>`);
    }
  }
  return out.join('');
}
ACTIONS.sondageVote = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m || !m.sondage || !Sync.me) return;
  const vk = `vote:${k.slice(4)}:${Sync.me}`, cur = (DB.get(vk) || {}).choix || [], o = el.dataset.o;
  const multi = m.sondage.type === 'dates' || m.sondage.plusieurs;
  const choix = cur.includes(o) ? cur.filter((x) => x !== o) : multi ? cur.concat([o]) : [o];
  if (!choix.length && m.sondage.type !== 'dates') DB.del(vk); else DB.put(vk, { choix, le: new Date().toISOString() });
};
ACTIONS.sondageAucune = (el) => { if (!Sync.me) return; DB.put(`vote:${el.dataset.key.slice(4)}:${Sync.me}`, { choix: [], le: new Date().toISOString() }); };
ACTIONS.sondageNouveau = (el) => {
  const dates = el.dataset.type === 'dates';
  SONDAGE.options = dates ? [addDays(todayISO(), 1), addDays(todayISO(), 2)] : ['', ''];
  openSheet(`${sheetHead(dates ? 'Sondage de dates' : 'Sondage')}<form class="sbody form" data-form="sondage"><input type="hidden" name="type" value="${dates ? 'dates' : 'simple'}">
    ${inp('sd-q', dates ? 'Pour quoi ? (devient le titre de l\'événement)' : 'Question', '', { name: 'question', req: true, attrs: { placeholder: dates ? 'Ex. Journée plantation de l\'ail' : 'Ex. On commande les plantons où ?', autofocus: '' } })}
    <div class="field"><span class="flabel">${dates ? 'Dates proposées' : 'Choix'}</span><div id="sd-opts">${optionsSondageHtml(dates)}</div>
      <button type="button" class="btn small" data-act="sondageOpt" data-dates="${dates ? '1' : ''}">+ ${dates ? 'une date' : 'un choix'}</button></div>
    ${dates ? '' : '<label class="row" style="font-size:14px"><input type="checkbox" name="plusieurs"> Plusieurs réponses possibles</label>'}
    <div class="row-end"><button class="btn primary" type="submit">Envoyer le sondage</button></div></form>`);
};
const SONDAGE = { options: [] };
function optionsSondageHtml(dates) { return SONDAGE.options.map((v, i) => `<div class="row" style="margin-bottom:6px"><input name="o_${i}" ${dates ? `type="date" min="${todayISO()}"` : 'placeholder="Choix ' + (i + 1) + '"'} value="${esc(v)}" style="flex:1" data-sdo="${i}">${SONDAGE.options.length > 2 ? `<button type="button" class="btn link small" data-act="sondageOptOff" data-i="${i}" data-dates="${dates ? '1' : ''}">×</button>` : ''}</div>`).join(''); }
const lireOptionsSondage = () => document.querySelectorAll('[data-sdo]').forEach((x) => { SONDAGE.options[Number(x.dataset.sdo)] = x.value; });
ACTIONS.sondageOpt = (el) => { lireOptionsSondage(); const d = !!el.dataset.dates, last = SONDAGE.options[SONDAGE.options.length - 1]; SONDAGE.options.push(d ? addDays(last || todayISO(), 1) : ''); $('sd-opts').innerHTML = optionsSondageHtml(d); };
ACTIONS.sondageOptOff = (el) => { lireOptionsSondage(); SONDAGE.options.splice(Number(el.dataset.i), 1); $('sd-opts').innerHTML = optionsSondageHtml(!!el.dataset.dates); };
FORMS.sondage = (v) => {
  const dates = v.type === 'dates', opts = Object.keys(v).filter((x) => /^o_\d+$/.test(x)).sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))).map((x) => String(v[x] || '').trim()).filter(Boolean);
  const uniques = [...new Set(opts)]; if (dates) uniques.sort();
  if (!v.question || uniques.length < 2) { toast(dates ? 'Une question et au moins 2 dates.' : 'Une question et au moins 2 choix.'); return; }
  if (!Sync.me) { toast('Connecte-toi d\'abord.'); return; }
  const cree = new Date().toISOString();
  DB.put('msg:' + uid('m'), { de: Sync.me, texte: '', cree, sondage: { type: dates ? 'dates' : 'simple', question: v.question.trim(), options: uniques.map((t, i) => ({ k: 'o' + i, t })), plusieurs: !dates && !!v.plusieurs } });
  DB.put('lu:' + Sync.me, { jusqua: cree }); Sync.schedule(0);
  notifierDiscord(Sync.me, `${dates ? '📅 Sondage de dates' : '📊 Sondage'} : ${v.question.trim()} (${uniques.map((t) => dates ? jourCourt(t) : t).join(' / ')})`);
  closeSheet(); toast('Sondage envoyé.');
};
/* Date trouvée → événement de travail (titre = la question, jour = la date commune la plus proche, modifiable) */
ACTIONS.sondageEvenement = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m) return; const c = datesCommunes(k, Object.assign({ key: k }, m)); if (!c.length) return;
  EVF.sondage = k; ACTIONS.evEdit({ dataset: { date: c[0], titre: m.sondage.question || '' } });
  if (c.length > 1) { const d = $('ev-date'); if (d) d.insertAdjacentHTML('afterend', `<div class="chips" style="margin-top:6px">${c.map((x) => `<button type="button" class="chip" data-act="evDateSondage" data-d="${x}">${esc(jourCourt(x))}</button>`).join('')}</div>`); }
};
ACTIONS.evDateSondage = (el) => { const d = $('ev-date'); if (d) d.value = el.dataset.d; };
ACTIONS.msgDel = (el) => confirmSheet('Supprimer ce message ?', 'Il disparaît pour tout le monde (il reste récupérable dans la corbeille).', 'delItemOk', 'Supprimer', { key: el.dataset.key });
/* Menu d'un message */
ACTIONS.msgMenu = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m) return; const mien = m.de === Sync.me;
  const nPins = messages().filter((x) => x.epingle).length;
  const b = (act, txt, extra = '') => `<button type="button" class="menu-it${extra}" data-act="${act}" data-key="${esc(k)}">${txt}</button>`;
  openSheet(`${sheetHead(nomDe(m.de) + ' · ' + jourMsg(m.cree) + ' ' + heureMsg(m.cree))}<div class="sbody">
    <p class="hint" style="margin-top:0">${esc(trunc(apercuMsg(m), 160))}</p>
    <div class="menu-list">
      ${b('msgRepondre', '↪ Répondre à ce message')}
      ${m.epingle ? b('msgEpingle', '📌 Désépingler') : b('msgEpingle', `📌 Épingler${nPins >= MAX_EPINGLES ? ` (déjà ${MAX_EPINGLES} : il faudra en retirer un)` : ''}`)}
      ${m.texte ? b('msgCopier', '📋 Copier le texte') : ''}
      ${b('msgTache', '✅ En faire une tâche')}
      ${mien && m.texte ? b('msgModifier', '✏️ Modifier') : ''}
      ${mien ? b('msgDel', '🗑️ Supprimer', ' danger') : ''}
    </div></div>`);
};
ACTIONS.msgRepondre = (el) => { MSG.repondA = el.dataset.key; MSG.edition = ''; closeSheet(); render(); const t = $('msg-txt'); if (t) t.focus(); };
ACTIONS.msgModifier = (el) => { const m = DB.get(el.dataset.key); if (!m) return; MSG.edition = el.dataset.key; MSG.repondA = ''; MSG.draft = m.texte || ''; closeSheet(); render(); const t = $('msg-txt'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
ACTIONS.msgAnnuler = () => { if (MSG.edition) MSG.draft = ''; MSG.edition = ''; MSG.repondA = ''; render(); };
ACTIONS.msgEpingle = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m) return;
  if (!m.epingle && messages().filter((x) => x.epingle).length >= MAX_EPINGLES) { closeSheet(); toast(`${MAX_EPINGLES} messages sont déjà épinglés : désépingle-en un d'abord.`, 4500); return; }
  const o = Object.assign({}, m); if (m.epingle) delete o.epingle; else o.epingle = { par: Sync.me || '', le: new Date().toISOString() };
  DB.put(k, o); closeSheet(); toast(m.epingle ? 'Désépinglé.' : 'Épinglé en haut de la discussion.');
};
ACTIONS.msgCopier = async (el) => { const m = DB.get(el.dataset.key); try { await navigator.clipboard.writeText((m && m.texte) || ''); toast('Texte copié.'); } catch (e) { toast('Copie impossible.'); } closeSheet(); };
ACTIONS.msgTache = (el) => {
  const m = DB.get(el.dataset.key); if (!m) return;
  const k = 't:' + uid('t');
  DB.put(k, { titre: trunc((m.texte || 'Photo de ' + nomDe(m.de)).replace(/\s+/g, ' '), 80), statut: 'afaire', responsable: Sync.me || '', remarques: `Depuis un message de ${nomDe(m.de)} (${jourMsg(m.cree)}) :\n${m.texte || ''}`, cree: new Date().toISOString(), creePar: Sync.me || '' });
  closeSheet(); toast('Tâche créée : complète-la si besoin.'); ACTIONS.taEdit({ dataset: { key: k } });
};
ACTIONS.msgVoir = (el) => {
  const n = $('m-' + el.dataset.key.slice(4)); if (!n) { toast('Ce message n\'est plus là.'); return; }
  MSG.geste = Date.now(); n.scrollIntoView({ block: 'center', behavior: 'smooth' }); n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 1600);
};
/* Ménage quotidien : messages de plus de 3 mois à la corbeille (sauf épinglés) */
function rangerVieuxMessages() {
  if (!Sync.me || ls.get('gdt-menage-msg') === todayISO()) return; ls.set('gdt-menage-msg', todayISO());
  const d = new Date(); d.setMonth(d.getMonth() - 3); const lim = d.toISOString();
  for (const m of messages()) if (!m.epingle && String(m.cree) < lim) DB.del(m.key);
}
setTimeout(() => sansAnnuler(rangerVieuxMessages), 10000);

/* ---------- Discord ----------
   Chaque personne colle l'adresse d'un webhook de son propre salon Discord. Quand quelqu'un écrit,
   l'app poste dans le salon des autres. Envoi en « multipart » : Discord l'accepte sans autorisation spéciale du navigateur. */
const DQ_KEY = 'gdt-discord-file';
function posterDiscord(webhook, contenu, image) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ username: 'Gamins de Talus', content: contenu.slice(0, 1900), allowed_mentions: { parse: [] } }));
  if (image) fd.append('files[0]', image, 'photo.jpg');
  return fetch(webhook, { method: 'POST', mode: 'no-cors', body: fd });
}
function notifierDiscord(de, texte, image) {
  if (LOCAL_MODE) return;
  /* Avec une photo : envoi direct (une photo ne se garde pas dans la file d'attente) */
  if (image) {
    for (const p of personnes()) {
      const d = discordDe(p.k); if (p.k === de || !discordMessages(p.k)) continue;
      const c = d.texte === false ? `${LIEN_MSG} 📷 Nouvelle photo de **${nomDe(de)}**` : `${LIEN_MSG} 📷 **${nomDe(de)}**${texte ? ' : ' + trunc(texte, 1500) : ''}`;
      posterDiscord(d.webhook, c, d.texte === false ? null : image).catch(() => {});
    }
    return;
  }
  const envois = personnes().filter((p) => p.k !== de && discordMessages(p.k)).map((p) => {
    const d = discordDe(p.k);
    return { webhook: d.webhook, contenu: d.texte === false ? `${LIEN_MSG} Nouveau message de **${nomDe(de)}**` : `${LIEN_MSG} **${nomDe(de)}** : ${trunc(texte, 1500)}` };
  });
  if (!envois.length) return;
  let file = []; try { file = JSON.parse(ls.get(DQ_KEY) || '[]'); } catch (e) { file = []; }
  ls.set(DQ_KEY, JSON.stringify(file.concat(envois))); viderFileDiscord();
}
async function viderFileDiscord() {
  if (!navigator.onLine || viderFileDiscord.busy) return;
  let file = []; try { file = JSON.parse(ls.get(DQ_KEY) || '[]'); } catch (e) { file = []; }
  if (!file.length) return;
  viderFileDiscord.busy = true; const reste = [];
  for (const x of file) { try { await posterDiscord(x.webhook, x.contenu); } catch (e) { reste.push(x); } }
  ls.set(DQ_KEY, JSON.stringify(reste)); viderFileDiscord.busy = false;
}
addEventListener('online', () => viderFileDiscord());
setTimeout(viderFileDiscord, 3000);

const webhookOk = (u) => /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(String(u || '').trim());
ACTIONS.discordSheet = () => {
  const d = discordDe(Sync.me);
  openSheet(`${sheetHead('Notifications Discord', nomDe(Sync.me))}<form class="sbody form" data-form="discord">
    <p class="hint">L'app poste dans <b>ton</b> salon Discord (nouveaux messages, mails, ta journée : tu choisis dans Réglages → Notifications) : ton ordinateur ou ton téléphone sonne comme pour n'importe quel message Discord. À faire une seule fois :</p>
    <ol class="steps">
      <li>Dans Discord : <b>+</b> (à gauche) → <b>Créer le mien</b> → <b>Pour moi et mes amis</b>. Nomme-le par exemple « Gamins de Talus ». (Ou utilise un salon d'un serveur qui existe déjà.)</li>
      <li>Sur le salon <b>#général</b> : roue dentée <b>Modifier le salon</b> → <b>Intégrations</b> → <b>Webhooks</b> → <b>Nouveau webhook</b> → <b>Copier l'URL du webhook</b>.</li>
      <li>Colle l'adresse ci-dessous, enregistre, puis <b>Envoyer un test</b>.</li>
      <li>Pour être sûr d'être prévenu : clic droit sur le serveur → <b>Paramètres de notification</b> → <b>Tous les messages</b>.</li>
    </ol>
    ${inp('dc-url', 'Adresse du webhook', d.webhook || '', { name: 'webhook', attrs: { placeholder: 'https://discord.com/api/webhooks/…', autocomplete: 'off', spellcheck: 'false' }, sub: 'Elle reste dans votre base, pas dans le code public. Garde-la pour toi : qui la connaît peut écrire dans ce salon.' })}
    <label class="row" style="font-size:14px"><input type="checkbox" name="texte"${d.texte === false ? '' : ' checked'}> Mettre le contenu dans la notification (sinon : juste « Nouveau message de … », « Nouveau mail »)</label>
    <div class="row-end">${d.webhook ? '<button class="btn danger" type="button" data-act="discordOff">Désactiver</button>' : ''}
      <button class="btn" type="button" data-act="discordTest">Envoyer un test</button><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);
};
FORMS.discord = (v) => {
  const u = String(v.webhook || '').trim();
  if (!u) { ACTIONS.discordOff(); return; }
  if (!webhookOk(u)) { toast("Cette adresse ne ressemble pas à un webhook Discord (https://discord.com/api/webhooks/…)."); return; }
  DB.put('cfg:discord:' + Sync.me, { webhook: u, texte: !!v.texte });
  closeSheet(); toast('Notifications Discord activées.');
};
ACTIONS.discordTest = async () => {
  const el = $('dc-url'), u = String((el && el.value) || discordDe(Sync.me).webhook || '').trim();
  if (!webhookOk(u)) { toast("Colle d'abord l'adresse du webhook."); return; }
  try { await posterDiscord(u, `${LIEN_MSG} ✅ Test : les notifications de l'app Gamins de Talus arriveront ici, ${nomDe(Sync.me)}. Le 🔗 au début ouvre l'app.`); toast('Test envoyé : regarde dans Discord.'); }
  catch (e) { toast("Envoi impossible : vérifie la connexion et l'adresse."); }
};
ACTIONS.discordOff = () => { if (DB.get('cfg:discord:' + Sync.me)) DB.del('cfg:discord:' + Sync.me); closeSheet(); toast('Notifications Discord désactivées.'); };

/* ---------- Mails de l'adresse commune ----------
   La fonction Supabase « mails » relève la boîte Infomaniak (IMAP) et ajoute chaque nouveau mail :
   mail:<id> = { de: { nom, adresse }, objet, date, extrait, uid, messageId,
                 statut: '' | 'encours' | 'traite' | 'ignore', par (à qui il est confié), confiePar, traitePar (qui l'a fermé), vus: { personne: date }, tache }
   cfg:mails = { adresse, webmail } (réglages) ; cfg:mails:etat = { derniere, erreur, nouveaux } (écrit par la fonction). */
const MAIL = { filtre: 'atraiter', ouvert: '', complet: {}, charge: '' };
const mails = () => DB.all('mail:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
const mailFini = (m) => ['traite', 'ignore'].includes(m.statut || '');
const mailsATraiter = () => mails().filter((m) => !mailFini(m));
const mailsPourMoi = () => mailsATraiter().filter((m) => m.par && m.par === Sync.me);
/* Le bouton d'état d'un mail : ce qu'il dit, et sa couleur */
function etatMail(m) {
  const qui = m.traitePar || m.par, rep = (m.reponses || []).length;
  if (m.statut === 'ignore') return { txt: '🙈 Ignoré', cls: 'fini' };
  if (m.statut === 'traite') return { txt: `${rep ? '↩ Répondu' : '✓ Traité'}${qui ? ' · ' + (qui === Sync.me ? 'toi' : nomDe(qui)) : ''}`, cls: 'fini' };
  if (m.par) return { txt: m.par === Sync.me ? 'Pour toi…' : `Pour ${nomDe(m.par)}…`, cls: m.par === Sync.me ? 'moi' : 'autre' };
  return { txt: 'À traiter…', cls: 'afaire' };
}
const cfgMails = () => Object.assign({ webmail: 'https://mail.infomaniak.com' }, DB.get('cfg:mails') || {});
function contactDuMail(adr) { adr = String(adr || '').toLowerCase(); if (!adr) return null; return (typeof tousContacts === 'function' ? tousContacts() : []).find((c) => String(c.email || '').toLowerCase() === adr) || null; }
function depuis(iso) { const m = Math.round((Date.now() - new Date(iso)) / 60000); return !iso || isNaN(m) ? '—' : m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : 'le ' + fmtDate(String(iso).slice(0, 10)); }
/* Demande une relève à la fonction Supabase (au plus toutes les 3 minutes par appareil) */
async function releverMails(force) {
  if (LOCAL_MODE || !Sync.sb || !navigator.onLine) return;
  const last = Number(ls.get('gdt-releve-mails') || 0); if (!force && Date.now() - last < 180000) return;
  ls.set('gdt-releve-mails', String(Date.now()));
  try {
    const { error } = await Sync.sb.functions.invoke('mails', { body: {} });
    if (error) { /* Lire le vrai message renvoyé par la fonction plutôt que « non-2xx status code » */
      let msg = error.message, code = '';
      try { const r = error.context; code = r && r.status ? ` (${r.status})` : ''; const b = await r.clone().json(); if (b && b.erreur) msg = b.erreur; } catch (_) { try { const t = await error.context.text(); if (t) msg = t.slice(0, 200); } catch (__) {} }
      throw new Error(msg + code);
    }
    await Sync.pull(); if (force) toast('Boîte relevée.');
  }
  catch (e) { await Sync.pull().catch(() => {}); if (force) toast('Relève impossible : ' + ((e && e.message) || e), 9000); }
}
function renderMails() {
  const c = cfgMails(), etat = DB.get('cfg:mails:etat') || {}, all = mails();
  const f = MAIL.filtre, list = all.filter((m) => f === 'tous' ? true : f === 'moi' ? !mailFini(m) && m.par === Sync.me : f === 'traites' ? mailFini(m) : !mailFini(m));
  const nMoi = mailsPourMoi().length;
  const chips = [['atraiter', `À traiter · ${mailsATraiter().length}`], ['moi', `Pour moi${nMoi ? ' · ' + nMoi : ''}`], ['traites', 'Traités'], ['tous', 'Tous']].map(([k, l]) => `<button class="chip${f === k ? ' on' : ''}${k === 'moi' && nMoi && f !== k ? ' fort' : ''}" type="button" data-act="mailFiltre" data-k="${k}">${esc(l)}</button>`).join('');
  if (!all.length && !etat.derniere) return `<div class="panel"><h2>Mails</h2><p>Les mails reçus sur votre adresse commune (${esc(c.adresse || 'Infomaniak')}) apparaîtront ici : qui s'en occupe, ce qui est traité, en lien avec vos contacts.</p>
    <p class="hint">Il reste à installer la fonction « mails » dans Supabase (voir le README, partie « Mails »). Ensuite, la boîte est relevée chaque fois que quelqu'un ouvre cette page, et toutes les 10 minutes par Supabase.</p>
    <div class="row"><button class="btn primary" type="button" data-act="mailEcrire">✉️ Nouveau mail</button><button class="btn" type="button" data-act="mailRelever">Essayer de relever maintenant</button><button class="btn" type="button" data-act="mailCfg">Réglages</button></div></div>`;
  const carte = (m) => {
    const ct = contactDuMail(m.de && m.de.adresse), vus = Object.keys(m.vus || {}).filter((p) => p !== m.par);
    const et = etatMail(m), confie = !mailFini(m) && m.par && m.confiePar && m.confiePar !== m.par ? `confié par ${m.confiePar === Sync.me ? 'toi' : nomDe(m.confiePar)}` : '';
    return `<div class="mail${!mailFini(m) && m.par ? ' encours' : ''}${mailFini(m) ? ' fini' : ''}">
      <div class="between"><b>${esc((m.de && (m.de.nom || m.de.adresse)) || '?')}</b><span class="hint">${esc(depuis(m.date))}</span></div>
      <div class="mail-objet">${esc(m.objet || '(sans objet)')}</div>
      ${ct ? `<a class="hint" href="#/${ct.prospect ? 'contacts/prospect' : 'contacts/voir'}/${encodeURIComponent(ct.key)}">👤 ${esc(displayName(ct))}${ct.prospect ? ' (prospect)' : ''}</a>` : `<span class="hint">${esc((m.de && m.de.adresse) || '')}</span>`}
      ${MAIL.complet[m.key] ? mailCompletHtml(m) : `<p class="mail-extrait${MAIL.ouvert === m.key ? ' open' : ''}" data-act="mailOuvrir" data-key="${esc(m.key)}">${esc(m.extrait || '')}</p>
      <button class="btn link small" type="button" data-act="mailLire" data-key="${esc(m.key)}">${MAIL.charge === m.key ? 'Chargement…' : 'Lire en entier et voir les pièces jointes'}</button>`}
      <div class="mail-etat">${confie ? `<span class="hint">${esc(confie)}</span>` : ''}${(m.reponses || []).length ? `<span class="hint">↩ répondu par ${esc(m.reponses.map((r) => nomDe(r.par) + ' le ' + fmtDateCourt(String(r.le).slice(0, 10))).join(', '))}</span>` : ''}${vus.length ? `<span class="hint">vu par ${esc(vus.map(nomDe).join(', '))}</span>` : ''}</div>
      <div class="row mail-actions">
        <button class="btn primary small" type="button" data-act="mailRepondre" data-key="${esc(m.key)}">↩ Répondre</button>
        <button class="btn small etat-mail ${et.cls}" type="button" data-act="mailPlus" data-key="${esc(m.key)}" title="Qui s'en occupe, traité, archiver…">${esc(et.txt)}</button></div></div>`;
  };
  return `<div class="panel"><div class="between"><h2>Mails${c.adresse ? ' · ' + esc(c.adresse) : ''}</h2><div class="row"><button class="btn primary small" type="button" data-act="mailEcrire">✉️ Nouveau mail</button><button class="btn small" type="button" data-act="mailRelever">Relever</button><button class="btn small" type="button" data-act="mailCfg">Réglages</button></div></div>
    <p class="hint">Les mails partent de ${esc(c.adresse || 'votre adresse')} ; une copie va dans « Envoyés ». <a href="${esc(c.webmail)}" target="_blank" rel="noopener">Ouvrir la boîte Infomaniak</a>. Dernière relève ${esc(depuis(etat.derniere))}${etat.erreur ? ` · <span class="bad">problème : ${esc(etat.erreur)}</span>` : ''}. Le bouton à côté de « Répondre » dit où en est chaque mail ; on clique dessus pour le confier à quelqu'un, le marquer traité, l'archiver…</p>
    <div class="chips">${chips}</div>
    ${list.length ? list.slice(0, 80).map(carte).join('') : '<p class="empty">Rien ici.</p>'}</div>`;
}
const ouvrirWebmail = () => { try { window.open(cfgMails().webmail, '_blank', 'noopener'); } catch (e) { /* */ } };
const majMail = (k, o) => { const m = DB.get(k); if (m) DB.put(k, Object.assign({}, m, o, { vus: Object.assign({}, m.vus || {}, Sync.me ? { [Sync.me]: new Date().toISOString() } : {}) })); };
ACTIONS.mailFiltre = (el) => { MAIL.filtre = el.dataset.k; render(); };
ACTIONS.mailOuvrir = (el) => { MAIL.ouvert = MAIL.ouvert === el.dataset.key ? '' : el.dataset.key; render(); };
/* Traité / ignoré : on garde à qui il était confié (par) et on note qui l'a fermé (traitePar). Remis à traiter : il revient à la personne à qui il était confié. */
ACTIONS.mailStatut = (el) => {
  const s = el.dataset.s, m = DB.get(el.dataset.key) || {};
  majMail(el.dataset.key, s ? { statut: s, traitePar: Sync.me || m.par || '' } : { statut: m.par ? 'encours' : '', traitePar: '' });
  closeSheet(); if (s) boite(el.dataset.key, 'lu').catch(() => {});
};
/* Confier un mail : à soi, à un associé, ou à personne */
ACTIONS.mailAssigner = (el) => {
  const p = el.dataset.p || '';
  majMail(el.dataset.key, { par: p, statut: p ? 'encours' : '', traitePar: '', confiePar: p && p !== Sync.me ? (Sync.me || '') : '' });
  closeSheet(); toast(p ? (p === Sync.me ? 'Pour toi.' : `Confié à ${nomDe(p)}.`) : 'Confié à personne.');
};
ACTIONS.mailWebmail = () => { closeSheet(); ouvrirWebmail(); };
ACTIONS.mailRelever = () => releverMails(true);
ACTIONS.mailPlus = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m) return; const ct = contactDuMail(m.de && m.de.adresse);
  const b = (act, txt, extra = '') => `<button type="button" class="menu-it" data-act="${act}" data-key="${esc(k)}"${extra}>${txt}</button>`;
  const fini = mailFini(m), et = etatMail(m), moi = Sync.me;
  const gens = personnes().slice().sort((x, y) => (y.k === moi) - (x.k === moi));
  const qui = gens.map((p) => `<button type="button" class="chip${!fini && m.par === p.k ? ' on' : ''}" data-act="mailAssigner" data-key="${esc(k)}" data-p="${esc(p.k)}">${esc(p.k === moi ? 'Moi' : p.nom)}</button>`).join('')
    + `<button type="button" class="chip${!fini && !m.par ? ' on' : ''}" data-act="mailAssigner" data-key="${esc(k)}" data-p="">Personne</button>`;
  openSheet(`${sheetHead(m.objet || '(sans objet)', (m.de && m.de.adresse) || '')}<div class="sbody"><p class="hint" style="margin-top:0">État : <b>${esc(et.txt.replace(/…$/, ''))}</b>${m.confiePar && m.par && m.confiePar !== m.par && !fini ? ` (confié par ${esc(m.confiePar === moi ? 'toi' : nomDe(m.confiePar))})` : ''}</p>
    <div class="flabel">Qui s'en occupe ?</div><div class="chips" style="margin-bottom:10px">${qui}</div><div class="menu-list">
    ${fini ? b('mailStatut', '↩︎ Remettre à traiter', ' data-s=""') : b('mailStatut', '✓ Marquer traité', ' data-s="traite"')}
    ${b('mailRepondre', '↩ Répondre')}
    ${b('mailTache', '✅ En faire une tâche')}
    ${m.uid ? b('mailArchiver', '🗄️ Archiver (dossier « Archives » chez Infomaniak)') : ''}
    ${m.uid ? b('mailNonLu', '✉️ Marquer comme non lu chez Infomaniak') : ''}
    ${m.uid ? b('mailSuppr', '🗑️ Supprimer (corbeille Infomaniak)') : ''}
    ${fini ? '' : b('mailStatut', '🙈 Pas important : ignorer', ' data-s="ignore"')}
    ${!ct && m.de && m.de.adresse ? b('mailContact', '👤 Ajouter l\'expéditeur aux contacts') : ''}
    ${b('mailWebmail', '🌐 Ouvrir la boîte Infomaniak')}
  </div></div>`);
};
ACTIONS.mailTache = (el) => {
  const m = DB.get(el.dataset.key); if (!m) return; const k = 't:' + uid('t');
  DB.put(k, { titre: trunc('Mail : ' + (m.objet || (m.de && m.de.nom) || ''), 80), statut: 'afaire', responsable: Sync.me || '', cat: 'admin', remarques: `De ${(m.de && (m.de.nom + ' <' + m.de.adresse + '>')) || ''} le ${fmtDate(String(m.date || '').slice(0, 10))}\n\n${m.extrait || ''}`, cree: new Date().toISOString(), creePar: Sync.me || '' });
  majMail(el.dataset.key, mailFini(m) ? { tache: k } : { statut: 'encours', par: m.par || Sync.me, tache: k }); closeSheet(); ACTIONS.taEdit({ dataset: { key: k } });
};
ACTIONS.mailContact = (el) => {
  const m = DB.get(el.dataset.key); if (!m || !m.de) return; const k = 'ct:' + uid('c');
  const pn = devinerPrenomNom(m.de.nom); DB.put(k, { prenom: pn.prenom, nomFamille: pn.nom, nom: nomComplet(pn.prenom, pn.nom), email: m.de.adresse, type: 'autre', cree: new Date().toISOString() });
  closeSheet(); go('#/contacts/modifier/' + encodeURIComponent(k));
};
ACTIONS.mailCfg = () => {
  const c = cfgMails();
  openSheet(`${sheetHead('Mails : réglages')}<form class="sbody form" data-form="mailCfg">
    ${inp('ml-adr', 'Adresse relevée', c.adresse, { name: 'adresse', attrs: { placeholder: 'info@gaminsdetalus.ch' }, sub: 'Pour l\'affichage. Le mot de passe, lui, est rangé dans les secrets de Supabase, jamais ici.' })}
    ${inp('ml-web', 'Adresse du webmail', c.webmail, { name: 'webmail', sub: 'Ouverte depuis le menu d\'un mail (« Ouvrir la boîte Infomaniak »).' })}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.mailCfg = (v) => { DB.put('cfg:mails', Object.assign({}, DB.get('cfg:mails') || {}, { adresse: v.adresse, webmail: v.webmail || 'https://mail.infomaniak.com' })); closeSheet(); toast('Enregistré.'); };
setTimeout(() => releverMails(), 15000);

/* Sur téléphone, la discussion s'ouvre en plein écran (comme une app de messagerie) ; « ← » la ferme et mène aux mails */
function majChatPlein() { document.body.classList.toggle('chat-plein', /^#\/messages\/?$/.test(location.hash)); }
window.addEventListener('hashchange', majChatPlein); window.addEventListener('resize', majChatPlein); majChatPlein();

/* Fermer la discussion plein écran : retour à la page d'avant (sinon l'accueil) */
let NAV_N = 0; window.addEventListener('hashchange', () => { NAV_N++; });
ACTIONS.chatFermer = () => { if (NAV_N > 0) { const avant = location.hash; history.back(); setTimeout(() => { if (location.hash === avant) go('#/'); }, 250); } else go('#/'); };

/* ---------- Module Mails (la boîte Infomaniak), à côté de la Messagerie ---------- */
MODULES.mails = {
  titre: 'Mails',
  tuile() {
    const nm = typeof mailsATraiter === 'function' ? mailsATraiter().length : 0, tous = typeof mails === 'function' ? mails() : [];
    if (!tous.length) return { line: 'La boîte ' + (cfgMails().adresse || 'info@') };
    return { line: nm ? `${nm} mail${nm > 1 ? 's' : ''} à traiter` : 'Rien à traiter', badge: nm };
  },
  render() { return renderMails(); },
  after() { if (typeof releverMails === 'function') releverMails(); },
};

/* ---------- Écrire et répondre depuis l'app (envoi par la fonction « mails », SMTP Infomaniak) ---------- */
const signatureMail = () => { const s = cfg(); return `\n\n${Sync.me ? nomDe(Sync.me) + '\n' : ''}${s.nom}${s.telephone ? '\n' + s.telephone : ''}`; };
const ECR = { pieces: [] };
function ouvrirComposeur(o) {
  ECR.pieces = []; const emails = [...new Set(tousContacts().map((c) => String(c.email || '').trim()).filter(Boolean))];
  const mr = o.repond ? DB.get(o.repond) : null, autre = mr && !mailFini(mr) && mr.par && mr.par !== Sync.me ? mr.par : '';
  openSheet(`${sheetHead(o.repond ? 'Répondre' : 'Nouveau mail', 'De ' + (cfgMails().adresse || 'votre adresse Infomaniak'))}<form class="sbody form" data-form="mailEnvoyer">
    ${autre ? `<p class="warn-line">⚠️ Ce mail est confié à ${esc(nomDe(autre))}. Vérifie avec ${esc(nomDe(autre))} pour ne pas répondre à deux.</p>` : ''}
    <input type="hidden" name="repond" value="${esc(o.repond || '')}">
    ${inp('me-a', 'À', o.a || '', { name: 'a', req: true, attrs: { list: 'me-contacts', autocomplete: 'off', placeholder: 'adresse@exemple.ch' } })}
    <datalist id="me-contacts">${tousContacts().filter((c) => c.email).map((c) => `<option value="${esc(c.email)}">${esc(displayName(c))}</option>`).join('')}</datalist>
    ${inp('me-cc', 'Copie (facultatif)', '', { name: 'cc', attrs: { list: 'me-contacts', autocomplete: 'off', placeholder: 'une ou plusieurs adresses, séparées par une virgule' } })}
    ${inp('me-o', 'Objet', o.objet || '', { name: 'objet', req: true })}
    ${txt('me-t', 'Message', o.texte || signatureMail(), { name: 'texte', rows: 11 })}
    <div class="field"><span class="flabel">Pièces jointes</span><div id="me-pj"></div>
      <label class="btn small"><input type="file" id="me-file" multiple hidden>+ Joindre un fichier</label><span class="sub">8 Mo au total.</span></div>
    ${o.repond ? '<label class="row" style="font-size:14px"><input type="checkbox" name="traite" checked> Marquer le mail comme répondu (traité)</label>' : ''}
    <div class="row-end"><button class="btn primary" type="submit" id="me-envoyer">Envoyer</button></div></form>`);
  const t = $('me-t'); if (t && o.repond) { t.focus(); t.setSelectionRange(0, 0); } else { const a = $('me-a'); if (a && !o.a) a.focus(); }
  $('me-file').addEventListener('change', (e) => {
    for (const f of e.target.files) ECR.pieces.push(f); e.target.value = '';
    const tot = ECR.pieces.reduce((a, f) => a + f.size, 0); if (tot > 8 * 1024 * 1024) { ECR.pieces.pop(); toast('Trop lourd : 8 Mo au total.'); }
    majPieces();
  });
  if (emails.length === 0) { /* pas de contact avec adresse : rien à proposer */ }
}
function majPieces() { const b = $('me-pj'); if (b) b.innerHTML = ECR.pieces.map((f, i) => `<span class="tpill">${esc(trunc(f.name, 30))} · ${tailleTxt(f.size)} <button type="button" class="btn link" data-act="mePjOff" data-i="${i}">×</button></span>`).join(' '); }
ACTIONS.mePjOff = (el) => { ECR.pieces.splice(Number(el.dataset.i), 1); majPieces(); };
ACTIONS.mailEcrire = () => ouvrirComposeur({});
ACTIONS.mailRepondre = (el) => {
  const m = DB.get(el.dataset.key); if (!m) return; closeSheet();
  const de = (m.de && (m.de.nom || m.de.adresse)) || '', cite = String(m.extrait || '').split('\n').map((l) => '> ' + l).join('\n');
  ouvrirComposeur({ repond: el.dataset.key, a: (m.de && m.de.adresse) || '', objet: /^re ?:/i.test(m.objet || '') ? m.objet : 'Re: ' + (m.objet || ''), texte: `Bonjour,\n\n${signatureMail().trim()}\n\nLe ${fmtDate(String(m.date || '').slice(0, 10))}, ${de} a écrit :\n${cite}` });
  const t = $('me-t'); if (t) t.setSelectionRange(10, 10);
};
FORMS.mailEnvoyer = async (v) => {
  const a = String(v.a || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a)) { toast('Adresse invalide.'); return; }
  if (LOCAL_MODE || !Sync.sb) { toast("En mode essai, rien n'est envoyé."); return; }
  if (!navigator.onLine) { toast('Il faut du réseau pour envoyer.'); return; }
  const b = $('me-envoyer'); if (b) { b.disabled = true; b.textContent = 'Envoi…'; }
  try {
    const lire = (f) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
    const pieces = await Promise.all(ECR.pieces.map(async (f) => ({ nom: f.name, type: f.type || 'application/octet-stream', base64: await lire(f) })));
    const m = v.repond ? DB.get(v.repond) : null;
    const { data, error } = await Sync.sb.functions.invoke('mails', { body: { envoyer: { a, cc: String(v.cc || '').trim() || undefined, objet: v.objet, texte: v.texte, pieces, inReplyTo: (m && m.messageId) || undefined, nomExp: cfg().nom } } });
    if (error) { let msg = error.message; try { const x = await error.context.clone().json(); if (x && x.erreur) msg = x.erreur; } catch (_) { /* */ } throw new Error(msg); }
    if (m) majMail(v.repond, Object.assign({ reponses: (m.reponses || []).concat([{ le: new Date().toISOString(), par: Sync.me || '', a }]) }, v.traite ? { statut: 'traite', traitePar: Sync.me || '' } : {}));
    ECR.pieces = []; closeSheet(); toast(`Envoyé à ${a}${data && data.copie ? ' (copie dans « Envoyés »)' : ''}.`, 5000);
  } catch (e) { if (b) { b.disabled = false; b.textContent = 'Envoyer'; } toast('Envoi impossible : ' + e.message, 8000); }
};

/* ---------- La boîte chez Infomaniak : lire en entier, pièces jointes, archiver, supprimer, lu / non lu ----------
   Tout passe par la fonction « mails » au moment où on le demande : les pièces jointes restent chez Infomaniak. */
async function boite(k, action, extra) {
  const m = DB.get(k); if (!m || !m.uid) throw new Error('mail introuvable');
  if (LOCAL_MODE || !Sync.sb) throw new Error('pas en mode essai');
  const uv = String(k).replace(/^mail:/, '').split('-')[0];
  const { data, error } = await Sync.sb.functions.invoke('mails', { body: { boite: Object.assign({ action, uid: m.uid, uv }, extra || {}) } });
  if (error) { let msg = error.message; try { const x = await error.context.clone().json(); if (x && x.erreur) msg = x.erreur; } catch (_) { /* */ } throw new Error(msg); }
  return data;
}
const lienTexte = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
function mailCompletHtml(m) {
  const c = MAIL.complet[m.key];
  return `<div class="mail-complet">${lienTexte(c.texte || '(pas de texte)')}</div>
    ${(c.pieces || []).length ? `<div class="mail-pj">${c.pieces.map((p) => `<span class="pj">📎 ${esc(trunc(p.nom, 40))} <span class="hint">${tailleTxt(p.taille)}</span>
      <button class="btn small" type="button" data-act="mailPiece" data-key="${esc(m.key)}" data-i="${p.index}">Télécharger</button>
      <button class="btn small" type="button" data-act="mailPieceDep" data-key="${esc(m.key)}" data-i="${p.index}" title="Créer une dépense avec cette pièce comme justificatif">→ Dépense</button></span>`).join('')}</div>` : ''}
    <button class="btn link small" type="button" data-act="mailReplier" data-key="${esc(m.key)}">Replier</button>`;
}
ACTIONS.mailLire = async (el) => {
  const k = el.dataset.key; MAIL.charge = k; render();
  try { MAIL.complet[k] = await boite(k, 'lire'); majMail(k, {}); } catch (e) { toast('Lecture impossible : ' + e.message, 7000); }
  MAIL.charge = ''; render();
};
ACTIONS.mailReplier = (el) => { delete MAIL.complet[el.dataset.key]; render(); };
async function pieceDeMail(k, i) {
  const x = await boite(k, 'piece', { index: Number(i) });
  const o = Uint8Array.from(atob(x.base64), (ch) => ch.charCodeAt(0));
  return new File([o], x.nom, { type: x.type || 'application/octet-stream' });
}
ACTIONS.mailPiece = async (el) => {
  toast('Téléchargement…');
  try { const f = await pieceDeMail(el.dataset.key, el.dataset.i); downloadFile(f.name, f, f.type); } catch (e) { toast('Téléchargement impossible : ' + e.message, 7000); }
};
/* Une facture fournisseur reçue par mail → une dépense avec ce justificatif (rangé dans l'app, comme une photo de ticket) */
ACTIONS.mailPieceDep = async (el) => {
  const m = DB.get(el.dataset.key); toast('Préparation du justificatif…');
  try {
    const f = await pieceDeMail(el.dataset.key, el.dataset.i);
    ACTIONS.depEdit({ dataset: {} });
    const o = $('dp-objet'); if (o && !o.value) o.value = trunc(`${(m.de && (m.de.nom || m.de.adresse)) || ''} · ${m.objet || ''}`, 80);
    const d = $('dp-date'); if (d && m.date) d.value = String(m.date).slice(0, 10);
    await joindreDep(f);
  } catch (e) { toast('Impossible : ' + e.message, 7000); }
};
ACTIONS.mailNonLu = async (el) => { closeSheet(); try { await boite(el.dataset.key, 'nonlu'); toast('Marqué comme non lu chez Infomaniak.'); } catch (e) { toast('Impossible : ' + e.message, 7000); } };
ACTIONS.mailArchiver = async (el) => {
  const k = el.dataset.key; closeSheet();
  try { await boite(k, 'archiver'); majMail(k, { statut: 'traite', traitePar: Sync.me || '', archive: true }); toast('Archivé chez Infomaniak.'); } catch (e) { toast('Archivage impossible : ' + e.message, 7000); }
};
ACTIONS.mailSuppr = (el) => confirmSheet('Supprimer ce mail ?', 'Il part dans la corbeille de la boîte Infomaniak (où il se récupère encore), et disparaît de l\'app.', 'mailSupprOk', 'Supprimer', { key: el.dataset.key });
ACTIONS.mailSupprOk = async (el) => {
  const k = el.dataset.key; closeSheet();
  try { await boite(k, 'supprimer'); delete MAIL.complet[k]; DB.del(k); toast('Mail mis à la corbeille d\'Infomaniak.'); } catch (e) { toast('Suppression impossible : ' + e.message, 7000); }
};
