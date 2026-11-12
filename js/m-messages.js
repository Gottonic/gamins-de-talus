/* Gamins de Talus — messagerie entre associés, avec notifications Discord (facultatives, par personne).
   msg:<id>          un message { de, texte, cree, photo? { chemin, w, h }, repond? (clé du message cité), modifieLe?, epingle? { par, le } }
                     Mis à la corbeille au bout de 3 mois (sauf s'il est épinglé) ; 3 messages épinglés au plus.
   mail:<id>         un mail reçu sur l'adresse commune (relevé par la fonction Supabase « mails ») : voir plus bas
   lu:<personne>     jusqu'où la personne a lu { jusqua } : une ligne par personne, donc jamais de conflit
   cfg:discord:<p>   le webhook Discord de la personne { webhook, texte } (dans la base, pas dans le code public) */
'use strict';

const MSG = { draft: '', timer: null, photo: null, envoi: false, repondA: '', edition: '' };
/* Le message en cours d'écriture est aussi gardé sur l'appareil : il survit à un rechargement de l'app (nouvelle version, notification, appli fermée) */
const brouillonMsg = {
  cle: () => 'gdt-msg-brouillon-' + (Sync.me || ''),
  lire() { try { return localStorage.getItem(this.cle()) || ''; } catch (e) { return ''; } },
  ecrire(t) { try { if (t) localStorage.setItem(this.cle(), t); else localStorage.removeItem(this.cle()); } catch (e) { /* */ } },
};
Object.defineProperty(MSG, 'draft', { get() { if (this._d == null || this._dMe !== Sync.me) { this._d = brouillonMsg.lire(); this._dMe = Sync.me; } return this._d; }, set(v) { this._d = v || ''; if (!this.edition) brouillonMsg.ecrire(this._d); }, enumerable: true });
const MAX_EPINGLES = 3;
/* Réserve la place de la photo avant qu'elle se charge (sinon les messages « redescendent ») */
const taillePhoto = (ph) => { const w = Number(ph.w) || 4, h = Number(ph.h) || 3, r = Math.min(280 / w, 340 / h); return ` width="${w}" height="${h}" style="width:${Math.round(w * r)}px;aspect-ratio:${w}/${h}"`; };
const apercuMsg = (m) => (m.sondage ? (m.sondage.type === 'dates' ? '📅 ' : '📊 ') + (m.sondage.question || 'Sondage') : '') || (m.texte ? m.texte.replace(/\s+/g, ' ') : '') || (m.photo ? '📷 Photo' : '') || (m.fichier ? '📎 ' + m.fichier.nom : '');
const messages = () => DB.all('msg:').sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
const luJusqua = (p) => ((DB.get('lu:' + p) || {}).jusqua || '');
function nonLus(p) { p = p || Sync.me; const l = luJusqua(p); return messages().filter((m) => m.de !== p && String(m.cree) > l); }
const discordDe = (p) => DB.get('cfg:discord:' + p) || {};
/* Discord pour les messages : oui par défaut dès qu'un webhook est enregistré (choix dans Réglages → Notifications) */
const discordMessages = (p) => !!discordDe(p).webhook && (DB.get('cfg:notif:' + p) || {}).d_messages !== false && (typeof dansPlageNotif !== 'function' || dansPlageNotif(p));
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
      t.addEventListener('input', () => { MSG.draft = t.value; grow(); majSuggestionsMention(t); }); grow();
      t.addEventListener('click', () => majSuggestionsMention(t));
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
    html += `<div class="msg${mien ? ' mine' : ''}${suite && !m.repond ? ' suite' : ''}${m.epingle ? ' pinned' : ''}${me && (m.mentions || []).includes(me) ? ' pour-moi' : ''}" data-msg="${esc(m.key)}" id="m-${esc(m.key.slice(4))}">
      ${!mien && (!suite || m.repond) ? `<span class="msg-who">${esc(nomDe(m.de))}</span>` : ''}
      ${m.repond ? `<button type="button" class="msg-cite" data-act="msgVoir" data-key="${esc(m.repond)}">↪ ${cite ? `<b>${esc(nomDe(cite.de))}</b> ${esc(trunc(apercuMsg(cite), 70))}` : 'message supprimé'}</button>` : ''}
      <div class="bubble${(m.photo && !m.photo.expire) || (m.fichier && !m.fichier.expire && /^image\//.test(m.fichier.type || '') && !/svg/.test(m.fichier.type)) ? ' has-photo' : ''}">${m.photo && m.photo.expire ? '<span class="photo-expiree">📷 Photo retirée après 6 mois</span>' : ''}${m.photo && !m.photo.expire ? `<button type="button" class="msg-photo" data-act="voirFichier" data-fichier="${esc(m.photo.chemin)}" data-titre="${esc(nomDe(m.de) + ' · ' + jourMsg(m.cree) + ' ' + heureMsg(m.cree))}"><img data-fichier="${esc(m.photo.chemin)}" alt="Photo de ${esc(nomDe(m.de))}"${taillePhoto(m.photo)}></button>` : ''}${m.sondage ? sondageHtml(m) : ''}${m.fichier ? fichierMsgHtml(m.fichier) : ''}${m.sondage ? '' : surlignerMentions(texteMsg(m.texte || ''), m.mentions)}<span class="msg-t">${m.epingle ? '📌 ' : ''}${heureMsg(m.cree)}${m.modifieLe ? ' · modifié' : ''} <button type="button" class="msg-menu" data-act="msgMenu" data-key="${esc(m.key)}" title="Options" aria-label="Options du message">⋯</button></span></div>${reactionsHtml(m)}</div>`;
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
    <div class="mention-sugg" id="msg-mention" hidden></div>
    <div class="emoji-pick" id="msg-emojis" hidden role="group" aria-label="Émojis">${EMOJIS.map((e) => `<button type="button" data-act="msgEmoji" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
    <form class="composer" data-form="msg">
      <button type="button" class="btn photo-btn" data-act="msgPlus" title="Fichier, sondage…" aria-label="Ajouter un fichier ou un sondage">＋</button>
      <button type="button" class="btn photo-btn" data-act="msgPhoto" title="Photo" aria-label="Ajouter une photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg></button>
      <button type="button" class="btn photo-btn emoji-btn" data-act="msgEmojis" title="Émoji" aria-label="Ajouter un émoji" aria-controls="msg-emojis">🙂</button>
      <input id="msg-file" type="file" accept="image/*" hidden><input id="msg-cam" type="file" accept="image/*" capture="environment" hidden><input id="msg-doc" type="file" hidden>
      <textarea id="msg-txt" name="texte" rows="1" placeholder="Écrire un message…" aria-label="Message">${esc(MSG.draft)}</textarea>
      <button class="btn primary" type="submit"${MSG.envoi ? ' disabled' : ''}>${MSG.envoi ? 'Envoi…' : 'Envoyer'}</button>
    </form>
    <p class="hint chat-aide">${matchMedia('(pointer: fine)').matches ? 'Entrée pour envoyer, Maj + Entrée pour aller à la ligne. ' : ''}⋯ (ou appui long) sur un message : réagir, répondre, épingler (${MAX_EPINGLES} au plus), modifier, supprimer, en faire une tâche. @Prénom : seule cette personne est notifiée. Les messages partent à la corbeille au bout de 3 mois, sauf ceux épinglés.</p></div>`;
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
    if (o && texte) DB.put(k, Object.assign({}, o, { texte, mentions: mentionsDe(texte), modifieLe: new Date().toISOString() }));
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
  const mentions = mentionsDe(texte); if (mentions.length) msg.mentions = mentions;
  const cite = MSG.repondA && DB.get(MSG.repondA); if (cite) msg.repond = MSG.repondA; MSG.repondA = '';
  /* Une réponse ne prévient que l'auteur du message cité (et les @mentions) */
  if (cite && cite.de && cite.de !== Sync.me) msg.pour = [cite.de];
  const vises = [...new Set(mentions.concat(msg.pour || []))];
  const mk = 'msg:' + uid('m'); DB.put(mk, msg);
  DB.put('lu:' + Sync.me, { jusqua: cree });
  Sync.schedule(0);
  notifierDiscord(Sync.me, (mentions.length ? mentions.map((k) => '@' + nomDe(k)).join(' ') + ' · ' : '') + (cite ? `↪ (réponse à ${nomDe(cite.de)} : « ${trunc(apercuMsg(cite), 50)} ») ` : '') + (texte || (fichier ? '📎 ' + fichier.nom : '')), ph && ph.blob, vises, mk);
  if (ph) Fichiers.local[photo.chemin] = Fichiers.local[photo.chemin] || ph.apercu;
  if (ph && !LOCAL_MODE) Fichiers.liens[photo.chemin] = { url: ph.apercu, exp: Date.now() + 50 * 60000 };
  render(); const n = $('msg-txt'); if (n && matchMedia('(pointer: fine)').matches) n.focus();
}
/* ---------- Réactions : une par personne et par message, dans sa propre ligne reac:<message>:<personne>
   (deux personnes qui réagissent en même temps ne s'écrasent pas) ---------- */
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🥕'];
const reacKey = (k, p) => `reac:${String(k).slice(4)}:${p}`;
const maReaction = (k) => (Sync.me && (DB.get(reacKey(k, Sync.me)) || {}).e) || '';
function reactionsHtml(m) {
  const par = {}; for (const p of personnes()) { const r = DB.get(reacKey(m.key, p.k)); if (r && r.e) (par[r.e] = par[r.e] || []).push(p); }
  const l = Object.entries(par); if (!l.length) return '';
  return `<div class="reacs">${l.map(([e, ps]) => `<button type="button" class="reac${ps.some((p) => p.k === Sync.me) ? ' moi' : ''}" data-act="msgReagir" data-key="${esc(m.key)}" data-e="${e}" title="${esc(ps.map((p) => p.nom).join(', '))}">${e}${ps.length > 1 ? ` <b>${ps.length}</b>` : ''}</button>`).join('')}</div>`;
}
ACTIONS.msgReagir = (el) => {
  if (!Sync.me) return; const k = el.dataset.key, rk = reacKey(k, Sync.me), e = el.dataset.e;
  if (maReaction(k) === e) DB.del(rk); else DB.put(rk, { e, le: new Date().toISOString() });
  if (document.body.classList.contains('sheet-open')) closeSheet();
};
/* Appui long sur une bulle (téléphone) : le même menu que ⋯ */
(() => {
  let t = null, x0 = 0, y0 = 0;
  const stop = () => { clearTimeout(t); t = null; };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.msg .bubble'); if (!b || e.pointerType === 'mouse' || e.target.closest('button, a, input')) return;
    const m = b.closest('[data-msg]'); x0 = e.clientX; y0 = e.clientY; stop();
    t = setTimeout(() => { t = null; if (navigator.vibrate) navigator.vibrate(15); ACTIONS.msgMenu({ dataset: { key: m.dataset.msg } }); }, 480);
  }, { passive: true });
  document.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); }, { passive: true });
  ['pointerup', 'pointercancel', 'scroll'].forEach((ev) => document.addEventListener(ev, stop, { passive: true, capture: true }));
  document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.msg .bubble') && !e.target.closest('a, img')) e.preventDefault(); });
})();

/* ---------- @mentions : « @Noé » dans le texte → seul Noé est notifié ---------- */
function mentionsDe(texte) {
  const t = normMot(texte);
  return personnes().filter((p) => p.k !== Sync.me && new RegExp('(^|[^\\p{L}\\d])@' + normMot(p.nom).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\d])', 'u').test(t)).map((p) => p.k);
}
function surlignerMentions(html, mentions) {
  for (const k of mentions || []) for (const n of new Set([nomDe(k), normMot(nomDe(k))])) {
    const nom = esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('@' + nom + '(?![\\p{L}\\d<])', 'giu'), (x) => `<span class="mention${k === Sync.me ? ' moi' : ''}">${x}</span>`);
  }
  return html;
}
/* Pendant qu'on tape « @… » : les prénoms à choisir au-dessus du champ */
function majSuggestionsMention(t) {
  const box = $('msg-mention'); if (!box) return;
  const avant = t.value.slice(0, t.selectionStart), m = /(^|\s)@([\p{L}]*)$/u.exec(avant);
  const ps = m ? personnes().filter((p) => p.k !== Sync.me && normMot(p.nom).startsWith(normMot(m[2]))) : [];
  box.hidden = !ps.length;
  box.innerHTML = ps.map((p) => `<button type="button" class="chip" data-act="msgMention" data-nom="${esc(p.nom)}">@${esc(p.nom)}</button>`).join('');
}
ACTIONS.msgMention = (el) => {
  const t = $('msg-txt'); if (!t) return;
  const pos = t.selectionStart, avant = t.value.slice(0, pos).replace(/@[\p{L}]*$/u, '@' + el.dataset.nom + ' '), apres = t.value.slice(pos);
  t.value = avant + apres; MSG.draft = t.value; t.focus(); t.setSelectionRange(avant.length, avant.length); majSuggestionsMention(t);
};

/* ---------- Émojis (ordinateur : le clavier n'en a pas) ---------- */
const EMOJIS = ['😀', '😂', '😅', '😊', '😍', '😎', '🤔', '😮', '😢', '😡', '😴', '🤗', '👍', '👎', '👌', '👏', '🙏', '💪', '🤝', '✌️', '❤️', '🔥', '🎉', '✅', '❌', '⚠️', '☀️', '🌧️', '❄️', '🌱', '🥕', '🥬', '🥔', '🍅', '🧅', '🎃', '🍓', '🚜', '🧰', '💧'];
ACTIONS.msgEmojis = () => { const b = $('msg-emojis'); if (b) b.hidden = !b.hidden; };
ACTIONS.msgEmoji = (el) => {
  const t = $('msg-txt'); if (!t) return;
  const a = t.selectionStart ?? t.value.length, z = t.selectionEnd ?? a;
  t.value = t.value.slice(0, a) + el.dataset.e + t.value.slice(z); MSG.draft = t.value;
  const pos = a + el.dataset.e.length; t.focus(); t.setSelectionRange(pos, pos);
};
document.addEventListener('click', (e) => { const b = $('msg-emojis'); if (b && !b.hidden && !e.target.closest('#msg-emojis, .emoji-btn')) b.hidden = true; });

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
  if (!f) return;
  /* Une image (même choisie comme fichier, glissée ou collée) part comme photo : elle a son aperçu dans la discussion */
  if (/^image\/(jpeg|png|webp|heic|heif|gif|bmp)$/i.test(f.type || '')) { choisirPhoto(f); return; } if (f.size > FICHIER_MSG_MAX) { toast(`Trop lourd : ${tailleTxt(f.size)} (5 Mo au plus). Mets-le plutôt dans le Drive.`, 6000); return; }
  const t = $('msg-txt'); if (t) MSG.draft = t.value; MSG.fichier = f; render();
}
ACTIONS.msgFichierOff = () => { MSG.fichier = null; render(); };
/* Glisser-déposer sur la discussion (ordinateur) et Ctrl+V d'une image ou d'un document dans la case du message */
function deposerFichiersMsg(files) {
  const l = [...(files || [])]; if (!l.length) return false;
  const img = l.find((f) => /^image\//.test(f.type || '')), doc = l.find((f) => !/^image\//.test(f.type || ''));
  if (img) choisirPhoto(img); if (doc) choisirFichierMsg(doc);
  if (l.length > (img ? 1 : 0) + (doc ? 1 : 0)) toast('Une photo et un fichier par message : envoie les autres ensuite.', 5000);
  return true;
}
document.addEventListener('paste', (e) => {
  if (ROUTE.mod !== 'messages' || !e.target.closest || !e.target.closest('.chat')) return;
  const fs = e.clipboardData && e.clipboardData.files;
  if (fs && fs.length && deposerFichiersMsg(fs)) e.preventDefault();
});
document.addEventListener('dragover', (e) => {
  if (ROUTE.mod !== 'messages' || !e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
  const c = e.target.closest && e.target.closest('.chat'); if (!c) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; c.classList.add('depot');
});
document.addEventListener('dragleave', (e) => { const c = e.target.closest && e.target.closest('.chat'); if (c && !c.contains(e.relatedTarget)) c.classList.remove('depot'); });
document.addEventListener('drop', (e) => {
  if (ROUTE.mod !== 'messages') return; const c = e.target.closest && e.target.closest('.chat'); if (!c) return;
  c.classList.remove('depot');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); deposerFichiersMsg(e.dataTransfer.files); }
});
/* Glisser une bulle vers la droite (téléphone) : y répondre */
(() => {
  let b = null, x0 = 0, y0 = 0, dx = 0, actif = false;
  document.addEventListener('touchstart', (e) => {
    const m = e.target.closest && e.target.closest('.msg[data-msg]'); if (!m || ROUTE.mod !== 'messages' || e.touches.length !== 1) { b = null; return; }
    b = m; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; actif = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!b) return; const x = e.touches[0].clientX - x0, y = e.touches[0].clientY - y0;
    if (!actif) { if (Math.abs(y) > 12 && Math.abs(y) > Math.abs(x)) { b = null; return; } if (x > 12 && x > Math.abs(y) * 1.5) actif = true; else return; }
    dx = Math.max(0, Math.min(90, x)); b.style.transform = `translateX(${dx}px)`; b.classList.toggle('glisse-ok', dx >= 60);
  }, { passive: true });
  const fin = () => {
    if (!b) return; const m = b; b = null;
    m.style.transition = 'transform .15s'; m.style.transform = ''; setTimeout(() => { m.style.transition = ''; m.classList.remove('glisse-ok'); }, 160);
    if (actif && dx >= 60) { if (navigator.vibrate) navigator.vibrate(10); ACTIONS.msgRepondre({ dataset: { key: m.dataset.msg } }); }
    actif = false; dx = 0;
  };
  document.addEventListener('touchend', fin, { passive: true }); document.addEventListener('touchcancel', fin, { passive: true });
})();
function fichierMsgHtml(f) {
  if (f.expire) return '<span class="photo-expiree">📎 Fichier retiré après 6 mois</span>';
  /* Une image envoyée comme fichier : on montre l'aperçu, comme une photo */
  if (/^image\//.test(f.type || '') && !/svg/.test(f.type)) return `<button type="button" class="msg-photo" data-act="voirFichier" data-fichier="${esc(f.chemin)}" data-titre="${esc(f.nom)}"><img data-fichier="${esc(f.chemin)}" alt="${esc(f.nom)}"></button>`;
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
    <div class="reac-choix" role="group" aria-label="Réagir">${REACTIONS.map((e) => `<button type="button" class="${maReaction(k) === e ? 'on' : ''}" data-act="msgReagir" data-key="${esc(k)}" data-e="${e}" aria-label="Réagir ${e}">${e}</button>`).join('')}</div>
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
ACTIONS.msgAnnuler = () => { if (MSG.edition) MSG._d = null; /* on retrouve le brouillon d'avant */ MSG.edition = ''; MSG.repondA = ''; render(); };
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
  for (const r of DB.all('reac:')) { const id = r.key.split(':')[1]; if (!DB.get('msg:' + id)) DB.del(r.key); }
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
/* Hors des jours et heures choisis : le message Discord attend (résumé envoyé par le serveur dès que la plage s'ouvre) */
function mettreEnAttenteDiscord(p, contenu, ref) {
  if (LOCAL_MODE || !Sync.sb || !navigator.onLine) return;
  Sync.sb.from('rows').upsert({ key: `notifq:${p}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, data: { quand: new Date().toISOString(), discord: contenu, ref: ref || '' }, deleted: false }, { onConflict: 'key' }).then(() => {}, () => {});
}
const discordEnAttente = (p) => !!discordDe(p).webhook && (DB.get('cfg:notif:' + p) || {}).d_messages !== false && typeof dansPlageNotif === 'function' && !dansPlageNotif(p);
function notifierDiscord(de, texte, image, mentions, ref) {
  if (LOCAL_MODE) return;
  for (const p of personnes()) {
    const vis = !mentions || !mentions.length || mentions.includes(p.k);
    if (p.k !== de && vis && discordEnAttente(p.k) && (!enSourdine(p.k) || (mentions || []).includes(p.k))) mettreEnAttenteDiscord(p.k, `${LIEN_MSG} ${image ? '📷 ' : ''}**${nomDe(de)}**${texte ? ' : ' + trunc(texte, 300) : image ? ' : une photo' : ''}`, ref);
  }
  /* Un message avec des @mentions ne prévient que les personnes mentionnées */
  const vise = (k) => !mentions || !mentions.length || mentions.includes(k);
  /* Avec une photo : envoi direct (une photo ne se garde pas dans la file d'attente) */
  if (image) {
    for (const p of personnes()) {
      const d = discordDe(p.k); if (p.k === de || !discordMessages(p.k) || !vise(p.k) || (enSourdine(p.k) && !(mentions || []).includes(p.k))) continue;
      const c = d.texte === false ? `${LIEN_MSG} 📷 Nouvelle photo de **${nomDe(de)}**` : `${LIEN_MSG} 📷 **${nomDe(de)}**${texte ? ' : ' + trunc(texte, 1500) : ''}`;
      posterDiscord(d.webhook, c, d.texte === false ? null : image).catch(() => {});
    }
    return;
  }
  const envois = personnes().filter((p) => p.k !== de && discordMessages(p.k) && vise(p.k) && (!enSourdine(p.k) || (mentions || []).includes(p.k))).map((p) => {
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
  const env = mailsEnvoyes();
  const chips = [['atraiter', `À traiter · ${mailsATraiter().length}`], ['moi', `Pour moi${nMoi ? ' · ' + nMoi : ''}`], ['traites', 'Traités'], ['tous', 'Tous'], ['envoyes', `📤 Envoyés${env.length ? ' · ' + env.length : ''}`]].map(([k, l]) => `<button class="chip${f === k ? ' on' : ''}${k === 'moi' && nMoi && f !== k ? ' fort' : ''}" type="button" data-act="mailFiltre" data-k="${k}">${esc(l)}</button>`).join('');
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
      <div class="mail-etat">${confie ? `<span class="hint">${esc(confie)}</span>` : ''}${(m.reponses || []).length ? `<span class="hint">↩ répondu par ${esc(m.reponses.map((r) => nomDe(r.par) + ' le ' + fmtDateCourt(String(r.le).slice(0, 10))).join(', '))}</span>` : (() => { const r = reponsesEnvoyees(m); return r.length ? `<span class="hint">↩ répondu le ${esc(fmtDateCourt(isoDate(new Date(r[r.length - 1].date))))} (depuis la boîte)</span>` : ''; })()}${vus.length ? `<span class="hint">vu par ${esc(vus.map(nomDe).join(', '))}</span>` : ''}</div>
      ${estMailTwint(m) ? twintMailHtml(m) : ''}
      <div class="row mail-actions">
        <button class="btn primary small" type="button" data-act="mailRepondre" data-key="${esc(m.key)}">↩ Répondre</button>
        <button class="btn small etat-mail ${et.cls}" type="button" data-act="mailPlus" data-key="${esc(m.key)}" title="Qui s'en occupe, traité, archiver…">${esc(et.txt)}</button></div></div>`;
  };
  return `<div class="panel"><div class="between"><h2>Mails${c.adresse ? ' · ' + esc(c.adresse) : ''}</h2><div class="row"><button class="btn primary small" type="button" data-act="mailEcrire">✉️ Nouveau mail</button><button class="btn small" type="button" data-act="mailRelever">Relever</button><button class="btn small" type="button" data-act="mailCfg">Réglages</button></div></div>
    <p class="hint">Les mails partent de ${esc(c.adresse || 'votre adresse')} ; une copie va dans « Envoyés ». <a href="${esc(c.webmail)}" target="_blank" rel="noopener">Ouvrir la boîte Infomaniak</a>. Dernière relève ${esc(depuis(etat.derniere))}${etat.erreur ? ` · <span class="bad">problème : ${esc(etat.erreur)}</span>` : ''}. Le bouton à côté de « Répondre » dit où en est chaque mail ; on clique dessus pour le confier à quelqu'un, le marquer traité, l'archiver…</p>
    <div class="chips">${chips}</div>
    ${f === 'envoyes' ? (env.length ? env.slice(0, 80).map(carteEnvoye).join('') : '<p class="empty">Aucun mail envoyé relevé pour l\'instant (la fonction « mails » les copie depuis le dossier « Envoyés »).</p>')
      : list.length ? list.slice(0, 80).map(carte).join('') : '<p class="empty">Rien ici.</p>'}</div>`;
}
/* ---------- Mails envoyés (dossier « Envoyés » d'Infomaniak, copiés par la fonction « mails ») : mailenv:… ---------- */
const mailsEnvoyes = () => DB.all('mailenv:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
/* La réponse envoyée à un mail reçu (par son Message-ID) */
const reponsesEnvoyees = (m) => (m && m.messageId ? mailsEnvoyes().filter((e) => e.inReplyTo && e.inReplyTo === m.messageId) : []);
function carteEnvoye(e) {
  const a = (e.a || [])[0] || {}, ct = contactDuMail(a.adresse);
  return `<div class="mail envoye">
    <div class="between"><b>→ ${esc((e.a || []).map((x) => x.nom || x.adresse).join(', ') || '?')}</b><span class="hint">${esc(depuis(e.date))}</span></div>
    <div class="mail-objet">${esc(e.objet || '(sans objet)')}</div>
    ${ct ? `<a class="hint" href="#/${ct.prospect ? 'contacts/prospect' : 'contacts/voir'}/${encodeURIComponent(ct.key)}">👤 ${esc(displayName(ct))}${ct.prospect ? ' (prospect)' : ''}</a>` : `<span class="hint">${esc(a.adresse || '')}</span>`}
    <p class="mail-extrait${MAIL.ouvert === e.key ? ' open' : ''}" data-act="mailOuvrir" data-key="${esc(e.key)}">${esc(e.extrait || '')}</p>
    ${(e.pieces || []).length ? `<p class="hint">📎 ${esc(e.pieces.join(', '))}</p>` : ''}</div>`;
}
/* ---------- Mail « paiement TWINT reçu » → recette en un clic ----------
   Vente directe : la recette est rattachée à la vente directe en cours ce jour-là (s'il y en a une). Autre vente : une recette simple.
   Dans les deux cas, un paiement TWINT tw: (déjà « compté ») est créé : l'import du relevé TWINT ne le comptera pas une deuxième fois. */
const estMailTwint = (m) => /twint/i.test(((m.de && m.de.adresse) || '') + ' ' + ((m.de && m.de.nom) || '')) || /twint/i.test(m.objet || '');
function montantDansTexte(t) {
  const r = /(?:CHF|Fr\.?)\s*([0-9'’]{1,7}(?:[.,]\d{1,2})?)|([0-9'’]{1,7}(?:[.,]\d{1,2})?)\s*(?:CHF|Fr\.)/i.exec(String(t || ''));
  if (!r) return null; const v = Number(String(r[1] || r[2]).replace(/['’]/g, '').replace(',', '.'));
  return v > 0 ? r2(v) : null;
}
const payeurDansTexte = (t) => { const r = /(?:de|von|from|par)\s+([A-ZÀ-Ý][\p{L}'’-]+(?:\s+[A-ZÀ-Ý][\p{L}'’.-]*){0,2})/u.exec(String(t || '')); return r ? r[1] : ''; };
function twintMailHtml(m) {
  const tw = DB.all('tw:').find((t) => t.mail === m.key), r = tw && tw.utilise && DB.get(tw.utilise);
  if (r && String(tw.utilise).startsWith('fac:')) return `<p class="twint-fait">✓ Facture ${esc(r.numero || '')} payée par TWINT (${chf(r.total)})</p>`;
  if (r) return `<p class="twint-fait">✓ Enregistré : ${chf(r.montant)} · ${esc(estVenteDirecte(r) ? 'vente directe' : 'autre vente')}${r.remarque && /tout seul/.test(r.remarque) ? ' (tout seul)' : ''} <a href="#" data-act="recEdit" data-key="${esc(tw.utilise)}">voir</a></p>`;
  if (m.twAttente) {
    const fs = (m.twAttente.factures || []).map((k) => Object.assign({ key: k }, DB.get(k) || {})).filter((f) => f.numero && f.statut === 'ouverte');
    if (fs.length) return `<div class="twint-acts"><p class="hint">💳 <b>${chf(m.twAttente.montant)}</b> par TWINT : c'est le montant ${fs.length > 1 ? 'de ces factures ouvertes' : 'd\'une facture ouverte'}. C'est elle ?</p><div class="row">${fs.map((f) => `<button class="btn small primary" type="button" data-act="twFacture" data-key="${esc(m.key)}" data-fac="${esc(f.key)}">Oui : ${esc(f.numero)} · ${esc((f.client && f.client.nom) || '')}</button>`).join('')}<button class="btn small" type="button" data-act="twMail" data-key="${esc(m.key)}" data-quoi="self">Non, vente directe</button><button class="btn small" type="button" data-act="twMail" data-key="${esc(m.key)}" data-quoi="autre">Non, autre vente</button></div></div>`;
  }
  const mt = montantDansTexte((m.objet || '') + ' ' + (m.extrait || ''));
  return `<div class="row twint-acts"><span class="hint">💳 Paiement TWINT${mt ? ' de <b>' + chf(mt) + '</b>' : ''} :</span><button class="btn small" type="button" data-act="twMail" data-key="${esc(m.key)}" data-quoi="self">Enregistrer comme vente directe</button><button class="btn small" type="button" data-act="twMail" data-key="${esc(m.key)}" data-quoi="autre">Enregistrer comme autre vente</button></div>`;
}
ACTIONS.twMail = async (el) => {
  const k = el.dataset.key, quoi = el.dataset.quoi, m = DB.get(k); if (!m) return;
  if (DB.all('tw:').some((t) => t.mail === k && t.utilise && DB.get(t.utilise))) { toast('Déjà enregistré.'); return; }
  let txt = (m.objet || '') + ' ' + (m.extrait || ''), mt = montantDansTexte(txt);
  if (!mt && !LOCAL_MODE && Sync.sb) { try { const c = MAIL.complet[k] || await boite(k, 'lire'); txt += ' ' + (c.texte || ''); mt = montantDansTexte(txt); } catch (e) { /* on demandera */ } }
  const date = jourDuMail(m);
  if (!mt) { twMailFeuille(k, quoi, date, payeurDansTexte(txt)); return; }
  enregistrerTwintMail(k, quoi, date, mt, payeurDansTexte(txt));
};
function twMailFeuille(k, quoi, date, payeur) {
  openSheet(`${sheetHead('Paiement TWINT', 'Montant introuvable dans le mail')}<form class="sbody form" data-form="twMail"><input type="hidden" name="key" value="${esc(k)}"><input type="hidden" name="quoi" value="${esc(quoi)}"><input type="hidden" name="payeur" value="${esc(payeur)}">
    <div class="grid2">${inp('twm-d', 'Date', date, { name: 'date', type: 'date', req: true })}${inp('twm-m', 'Montant CHF', '', { name: 'montant', type: 'number', req: true, attrs: { step: '0.05', min: '0', inputmode: 'decimal', autofocus: '' } })}</div>
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer comme ${quoi === 'self' ? 'vente directe' : 'autre vente'}</button></div></form>`);
}
FORMS.twMail = (v) => { const mt = r2(num(v.montant)); if (!(mt > 0)) { toast('Indique le montant.'); return; } closeSheet(); enregistrerTwintMail(v.key, v.quoi, v.date, mt, v.payeur); };
/* Le jour du mail (heure de Suisse), pas celui où on l'enregistre */
const jourDuMail = (m) => { const d = new Date(m && m.date); return isNaN(d) ? todayISO() : isoDate(d); };
function enregistrerTwintMail(k, quoi, date, montant, payeur, auto) {
  const id = String(k).replace(/^mail:/, '').replace(/[^\w-]/g, '');
  const m = DB.get(k) || {}, rk = 'rec:twm-' + id, par = (typeof titulaireCompte === 'function' && titulaireCompte()) || Sync.me || '';
  const s = quoi === 'self' && typeof misesEnVente === 'function' ? misesEnVente().find((x) => x.date <= date && (!x.closeLe || x.closeLe >= date)) : null;
  DB.put(rk, Object.assign({ date, montant, moyen: 'TWINT', par, client: quoi === 'self' ? (s ? s.lieu || 'Self-service' : 'Vente directe') : payeur || 'Paiement TWINT',
    libelle: quoi === 'self' ? `Vente directe${s ? ' du ' + fmtDate(s.date) : ''} · TWINT${payeur ? ' de ' + payeur : ''}` : `Paiement TWINT${payeur ? ' de ' + payeur : ''}`, remarque: (auto ? 'Enregistré tout seul depuis le mail TWINT : ' : 'Depuis le mail TWINT : ') + trunc(m.objet || '', 80), cree: new Date().toISOString(), creePar: auto ? '' : Sync.me || '' }, quoi === 'self' ? { vd: true } : {}, s ? { self: s.key } : {}));
  DB.put('tw:twm-' + id, { cle: 'mail:' + k, src: 'mail', mail: k, date, montant, ref: '', texte: payeur || m.objet || '', utilise: rk, importe: new Date().toISOString(), par: Sync.me || '' });
  /* Traité (sans en faire le référent de l'adresse TWINT) et lu aussi chez Infomaniak */
  const m2 = DB.get(k); if (m2) DB.put(k, Object.assign({}, m2, { statut: 'traite', traitePar: auto ? '' : Sync.me || '', twAttente: null }));
  if (!LOCAL_MODE) boite(k, 'lu').catch(() => {});
  toast(`${auto ? '💳 Paiement TWINT : ' : ''}${chf(montant)} enregistrés comme ${quoi === 'self' ? 'vente directe' + (s ? ' (' + (s.lieu || 'self-service') + ')' : '') : 'autre vente'}${auto ? ' (jour du mail : ' + fmtDateCourt(date) + ')' : ''}. Mail marqué traité.`, 5000);
}
/* ---------- Mails TWINT tout seuls : un paiement reçu devient une vente directe, au jour du mail ----------
   Sauf si le montant est celui d'une facture ouverte : on demande (dans le mail) si c'est elle.
   Clés fixes (rec:twm-…, tw:twm-…) : deux appareils qui le font en même temps n'en créent pas deux. */
const TW_AUTO_DEPUIS = '2026-11-12';
const estPaiementTwint = (m) => estMailTwint(m) && /re[çc]u|paiement|payment|zahlung|erhalten|bezahlt|pagamento/i.test((m.objet || '') + ' ' + (m.extrait || ''));
const facturesOuvertesDe = (mt) => (typeof factures === 'function' ? factures() : []).filter((f) => f.numero && f.statut === 'ouverte' && Math.abs(r2(f.total) - mt) < 0.005);
let twAutoEnCours = false;
async function twintAuto() {
  if (twAutoEnCours || !Sync.me || typeof mails !== 'function') return; twAutoEnCours = true;
  try {
    for (const m of mails()) {
      if (!estPaiementTwint(m) || m.statut === 'traite' || m.statut === 'ignore' || m.twAttente || jourDuMail(m) < TW_AUTO_DEPUIS) continue;
      if (DB.all('tw:').some((t) => t.mail === m.key)) continue;
      let txt = (m.objet || '') + ' ' + (m.extrait || ''), mt = montantDansTexte(txt);
      if (!mt && !LOCAL_MODE && Sync.sb && navigator.onLine) { try { const c = MAIL.complet[m.key] || await boite(m.key, 'lire'); MAIL.complet[m.key] = c; txt += ' ' + (c.texte || ''); mt = montantDansTexte(txt); } catch (e) { /* reste à la main */ } }
      if (!mt) continue;
      const cur = DB.get(m.key); if (!cur || cur.statut === 'traite' || cur.twAttente || DB.all('tw:').some((t) => t.mail === m.key)) continue;
      const fs = facturesOuvertesDe(mt);
      sansAnnuler(() => {
        if (fs.length) DB.put(m.key, Object.assign({}, cur, { twAttente: { montant: mt, factures: fs.map((f) => f.key), payeur: payeurDansTexte(txt) } }));
        else enregistrerTwintMail(m.key, 'self', jourDuMail(m), mt, payeurDansTexte(txt), true);
      });
    }
  } finally { twAutoEnCours = false; }
}
setTimeout(twintAuto, 3000);
/* Le montant est celui d'une facture ouverte : c'est elle → payée par TWINT au jour du mail */
ACTIONS.twFacture = (el) => {
  const k = el.dataset.key, m = DB.get(k), f = DB.get(el.dataset.fac); if (!m || !f) return;
  const date = jourDuMail(m), id = String(k).replace(/^mail:/, '').replace(/[^\w-]/g, '');
  DB.put(el.dataset.fac, Object.assign({}, f, { statut: 'payee', payeeLe: date, payeePar: 'twint', encaissePar: titulaireCompte() || Sync.me || '' }));
  DB.put('tw:twm-' + id, { cle: 'mail:' + k, src: 'mail', mail: k, date, montant: r2(f.total), ref: f.numero || '', texte: (m.twAttente && m.twAttente.payeur) || m.objet || '', utilise: el.dataset.fac, importe: new Date().toISOString(), par: Sync.me || '' });
  DB.put(k, Object.assign({}, DB.get(k), { statut: 'traite', traitePar: Sync.me || '', twAttente: null }));
  if (!LOCAL_MODE) boite(k, 'lu').catch(() => {});
  toast(`Facture ${f.numero} payée par TWINT le ${fmtDateCourt(date)}.`, 5000);
};

const ouvrirWebmail = () => { try { window.open(cfgMails().webmail, '_blank', 'noopener'); } catch (e) { /* */ } };
const majMail = (k, o) => {
  const m = DB.get(k); if (!m) return;
  DB.put(k, Object.assign({}, m, o, { vus: Object.assign({}, m.vus || {}, Sync.me ? { [Sync.me]: new Date().toISOString() } : {}) }));
  /* Quelqu'un s'occupe du mail (le confier, le traiter, répondre, l'archiver…) : les prochains mails de cette adresse seront pour lui */
  if ('par' in o) { if (o.par) noterReferentMail(m, o.par); } else if (Object.keys(o).length && Sync.me) noterReferentMail(m, Sync.me);
};
/* Référent d'une adresse : mref:<adresse> = { personne, le }. Sinon le contact principal du contact (Contacts). */
const adresseMail = (m) => String((m && m.de && m.de.adresse) || '').trim().toLowerCase();
function noterReferentMail(m, p) {
  const a = adresseMail(m); if (!a || !p) return; const k = 'mref:' + a, o = DB.get(k);
  if (!o || o.personne !== p) sansAnnuler(() => DB.put(k, { personne: p, le: new Date().toISOString() }));
}
function referentMail(m) {
  const a = adresseMail(m); if (!a) return null; const r = DB.get('mref:' + a); if (r && r.personne) return { p: r.personne, le: r.le };
  const c = typeof contactDuMail === 'function' ? contactDuMail(a) : null, p = c && typeof referentDe === 'function' ? referentDe(c) : '';
  return p ? { p, le: '2026-11-05T00:00:00Z' } : null;
}
/* Un nouveau mail d'une adresse qui a son référent : il lui est confié tout seul (seulement les mails arrivés après) */
function attribuerMailsAuto() {
  if (typeof mails !== 'function') return;
  for (const m of mails()) {
    if (m.par || m.statut || m.auto) continue; const r = referentMail(m); if (!r || !personnes().some((x) => x.k === r.p)) continue;
    if (String(m.date || '') < String(r.le)) continue;
    sansAnnuler(() => DB.put(m.key, Object.assign({}, DB.get(m.key), { par: r.p, statut: 'encours', auto: true })));
  }
}
setTimeout(attribuerMailsAuto, 2000);
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
  /* Prévenir la personne à qui on le confie (notification « Un mail qu'on me confie ») */
  const m = DB.get(el.dataset.key);
  if (p && p !== Sync.me && m && !LOCAL_MODE && Sync.sb && navigator.onLine) Sync.sb.functions.invoke('notifier', { body: { confier: { personne: p, key: el.dataset.key, objet: m.objet || '', de: (m.de && (m.de.nom || m.de.adresse)) || '' } } }).catch(() => {});
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
  titre: 'Contacts',
  tuile() {
    const nm = typeof mailsATraiter === 'function' ? mailsATraiter().length : 0, tous = typeof mails === 'function' ? mails() : [];
    if (!tous.length) return { line: 'La boîte ' + (cfgMails().adresse || 'info@') };
    return { line: nm ? `${nm} mail${nm > 1 ? 's' : ''} à traiter` : 'Rien à traiter', badge: nm };
  },
  render() { return (typeof relationsTabs === 'function' ? relationsTabs('mails') : '') + renderMails(); },
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
/* Pièce jointe : une fois reçue, une fenêtre propose Enregistrer / Ouvrir / Partager.
   (Un téléchargement lancé tout seul après plusieurs secondes d'attente est souvent bloqué en silence sur téléphone :
   il faut un vrai toucher sur le bouton.) */
const PJ = { url: '', fichier: null };
async function pieceDeMailSure(k, i) {
  let f = await pieceDeMail(k, i);
  if (/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') f = new File([f], f.name, { type: 'application/pdf' });
  return f;
}
ACTIONS.mailPiece = async (el) => {
  toast('Récupération de la pièce jointe…', 15000);
  let f; try { f = await pieceDeMailSure(el.dataset.key, el.dataset.i); } catch (e) { toast('Téléchargement impossible : ' + e.message, 7000); return; }
  if (PJ.url) URL.revokeObjectURL(PJ.url);
  PJ.url = URL.createObjectURL(f); PJ.fichier = f; $('toast').hidden = true;
  const voir = /^(application\/pdf|image\/|text\/plain)/.test(f.type), partage = !!(navigator.canShare && navigator.canShare({ files: [f] }));
  openSheet(`${sheetHead('📎 ' + trunc(f.name, 50), tailleTxt(f.size))}<div class="sbody">
    <div class="row">
      <a class="btn primary" href="${PJ.url}" download="${esc(nomFichierSur(f.name))}">Enregistrer sur l'appareil</a>
      ${voir ? `<a class="btn" href="${PJ.url}" target="_blank" rel="noopener">Ouvrir</a>` : ''}
      ${partage ? '<button class="btn" type="button" data-act="pjPartager">Partager…</button>' : ''}
    </div>
    <p class="hint">Le fichier va dans le dossier Téléchargements de l'appareil.${partage ? ' « Partager… » permet aussi de l\'envoyer vers Drive, Fichiers, une app de mail…' : ''}</p></div>`);
};
ACTIONS.pjPartager = async () => {
  try { await navigator.share({ files: [PJ.fichier], title: PJ.fichier.name }); } catch (e) { if (e.name !== 'AbortError') toast('Partage impossible : ' + e.message, 6000); }
};
/* Une facture fournisseur reçue par mail → une dépense avec ce justificatif (rangé dans l'app, comme une photo de ticket) */
ACTIONS.mailPieceDep = async (el) => {
  const m = DB.get(el.dataset.key); toast('Préparation du justificatif…'); if (m && Sync.me) noterReferentMail(m, Sync.me);
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
