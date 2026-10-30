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
const apercuMsg = (m) => (m.texte ? m.texte.replace(/\s+/g, ' ') : '') || (m.photo ? '📷 Photo' : '');
const messages = () => DB.all('msg:').sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
const luJusqua = (p) => ((DB.get('lu:' + p) || {}).jusqua || '');
function nonLus(p) { p = p || Sync.me; const l = luJusqua(p); return messages().filter((m) => m.de !== p && String(m.cree) > l); }
const discordDe = (p) => DB.get('cfg:discord:' + p) || {};
const APP_URL = 'https://gottonic.github.io/gamins-de-talus/';
/* Petit lien 🔗 au début de chaque message Discord : ouvre la messagerie pour répondre (les < > évitent l'aperçu du site) */
const LIEN_MSG = `[🔗](<${APP_URL}#/messages>)`;

MODULES.messages = {
  titre: 'Messageries',
  tuile() {
    const n = nonLus().length, ms = messages(), der = ms[ms.length - 1];
    const nm = typeof mailsATraiter === 'function' ? mailsATraiter().length : 0, mt = nm ? ` · ${nm} mail${nm > 1 ? 's' : ''} à traiter` : '';
    if (!der) return { line: 'Discuter entre associés' + mt };
    return { qui: der.de === Sync.me ? 'Toi :' : nomDe(der.de) + ' :', line: (der.photo && der.texte ? '📷 ' : '') + trunc(apercuMsg(der), 90) + mt, clamp: true, badge: n + nm };
  },
  render(sub) {
    const nm = typeof mailsATraiter === 'function' ? mailsATraiter().length : 0;
    const t = tabs('messages', [['', 'Discussion'], ['mails', `Mails${nm ? ' · ' + nm : ''}`]], sub || '');
    if (sub === 'mails') return t + renderMails();
    return t + renderMessages();
  },
  after(sub) {
    if (sub === 'mails') { if (typeof releverMails === 'function') releverMails(); return; }
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
      const f = $('msg-file'); if (f) f.addEventListener('change', () => choisirPhoto(f.files[0]));
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
  const ms = messages(), me = Sync.me, prevenus = personnes().filter((p) => discordDe(p.k).webhook).map((p) => p.nom);
  let jour = '', html = '';
  ms.forEach((m, i) => {
    const j = isoDate(new Date(m.cree));
    if (j !== jour) { jour = j; html += `<div class="msg-day">${esc(jourMsg(m.cree))}</div>`; }
    const mien = m.de === me, suite = i > 0 && ms[i - 1].de === m.de && isoDate(new Date(ms[i - 1].cree)) === j;
    const cite = m.repond ? DB.get(m.repond) || DB.trash[m.repond] : null;
    html += `<div class="msg${mien ? ' mine' : ''}${suite && !m.repond ? ' suite' : ''}${m.epingle ? ' pinned' : ''}" id="m-${esc(m.key.slice(4))}">
      ${!mien && (!suite || m.repond) ? `<span class="msg-who">${esc(nomDe(m.de))}</span>` : ''}
      ${m.repond ? `<button type="button" class="msg-cite" data-act="msgVoir" data-key="${esc(m.repond)}">↪ ${cite ? `<b>${esc(nomDe(cite.de))}</b> ${esc(trunc(apercuMsg(cite), 70))}` : 'message supprimé'}</button>` : ''}
      <div class="bubble${m.photo && !m.photo.expire ? ' has-photo' : ''}">${m.photo && m.photo.expire ? '<span class="photo-expiree">📷 Photo retirée après 6 mois</span>' : ''}${m.photo && !m.photo.expire ? `<button type="button" class="msg-photo" data-act="voirFichier" data-fichier="${esc(m.photo.chemin)}" data-titre="${esc(nomDe(m.de) + ' · ' + jourMsg(m.cree) + ' ' + heureMsg(m.cree))}"><img data-fichier="${esc(m.photo.chemin)}" alt="Photo de ${esc(nomDe(m.de))}"${taillePhoto(m.photo)}></button>` : ''}${texteMsg(m.texte || '')}<span class="msg-t">${m.epingle ? '📌 ' : ''}${heureMsg(m.cree)}${m.modifieLe ? ' · modifié' : ''} <button type="button" class="msg-menu" data-act="msgMenu" data-key="${esc(m.key)}" title="Options" aria-label="Options du message">⋯</button></span></div></div>`;
  });
  /* « Vu par » sous le dernier message */
  const der = ms[ms.length - 1];
  if (der) {
    const vus = personnes().filter((p) => p.k !== der.de && p.k !== me && luJusqua(p.k) >= String(der.cree)).map((p) => p.nom);
    if (der.de === me || vus.length) html += `<div class="msg-vu${der.de === me ? ' mine' : ''}">${vus.length ? 'Vu par ' + esc(vus.join(', ')) : 'Pas encore vu'}</div>`;
  }
  const d = discordDe(me), dOn = !!d.webhook;
  const pins = ms.filter((m) => m.epingle).sort((a, b) => String(a.epingle.le).localeCompare(String(b.epingle.le)));
  const pinsHtml = pins.length ? `<div class="pins">${pins.map((m) => `<button type="button" class="pin" data-act="msgVoir" data-key="${esc(m.key)}">📌 <b>${esc(nomDe(m.de))}</b> ${esc(trunc(apercuMsg(m), 80))}</button>`).join('')}</div>` : '';
  const cible = MSG.repondA ? DB.get(MSG.repondA) : null, edit = MSG.edition ? DB.get(MSG.edition) : null;
  const bandeau = edit ? `<div class="msg-prev"><span>✏️ Modifier ton message</span><button type="button" class="btn small" data-act="msgAnnuler">Annuler</button></div>`
    : cible ? `<div class="msg-prev"><span>↪ Réponse à <b>${esc(nomDe(cible.de))}</b> : ${esc(trunc(apercuMsg(cible), 80))}</span><button type="button" class="btn small" data-act="msgAnnuler">Annuler</button></div>` : '';
  return `<div class="panel chat">
    <div class="between chat-head"><h2>Entre nous</h2>
      <button class="btn small${dOn ? ' on' : ''}" type="button" data-act="discordSheet">${ICON_DISCORD}${dOn ? 'Notifications Discord activées' : 'Recevoir les notifications sur Discord'}</button></div>
    <p class="hint chat-who">${esc(personnes().map((p) => p.nom).join(', '))} · ${prevenus.length ? 'prévenus sur Discord : ' + esc(prevenus.join(', ')) : 'personne n\'est encore prévenu sur Discord'}</p>
    ${pinsHtml}
    <div class="msg-list" id="msg-list" aria-live="polite">${html || '<p class="empty">Aucun message pour l\'instant. Écris le premier !</p>'}</div>
    ${bandeau}
    ${MSG.photo ? `<div class="msg-prev"><img src="${MSG.photo.apercu}" alt="Photo à envoyer"><span>Photo prête à envoyer${MSG.envoi ? ' : envoi…' : ' · ajoute une légende si tu veux'}</span><button type="button" class="btn small" data-act="msgPhotoOff"${MSG.envoi ? ' disabled' : ''}>Retirer</button></div>` : ''}
    <form class="composer" data-form="msg">
      <label class="btn photo-btn" title="Ajouter une photo" aria-label="Ajouter une photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.6-2.3h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/></svg><input id="msg-file" type="file" accept="image/*" hidden></label>
      <textarea id="msg-txt" name="texte" rows="1" placeholder="Écrire un message…" aria-label="Message">${esc(MSG.draft)}</textarea>
      <button class="btn primary" type="submit"${MSG.envoi ? ' disabled' : ''}>${MSG.envoi ? 'Envoi…' : 'Envoyer'}</button>
    </form>
    <p class="hint">${matchMedia('(pointer: fine)').matches ? 'Entrée pour envoyer, Maj + Entrée pour aller à la ligne. ' : ''}⋯ sur un message : répondre, épingler (${MAX_EPINGLES} au plus), modifier, supprimer, en faire une tâche. Les messages partent à la corbeille au bout de 3 mois, sauf ceux épinglés.</p></div>`;
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
  if (!texte && !MSG.photo) return;
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
  const cree = new Date().toISOString();
  MSG.draft = ''; MSG.photo = null; const tt = $('msg-txt'); if (tt) tt.value = '';
  const msg = { de: Sync.me, texte, cree }; if (photo) msg.photo = photo;
  const cite = MSG.repondA && DB.get(MSG.repondA); if (cite) msg.repond = MSG.repondA; MSG.repondA = '';
  DB.put('msg:' + uid('m'), msg);
  DB.put('lu:' + Sync.me, { jusqua: cree });
  Sync.schedule(0);
  notifierDiscord(Sync.me, cite ? `↪ (réponse à ${nomDe(cite.de)} : « ${trunc(apercuMsg(cite), 50)} ») ${texte}` : texte, ph && ph.blob);
  if (ph) Fichiers.local[photo.chemin] = Fichiers.local[photo.chemin] || ph.apercu;
  if (ph && !LOCAL_MODE) Fichiers.liens[photo.chemin] = { url: ph.apercu, exp: Date.now() + 50 * 60000 };
  render(); const n = $('msg-txt'); if (n && matchMedia('(pointer: fine)').matches) n.focus();
}
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
setTimeout(rangerVieuxMessages, 10000);

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
      const d = discordDe(p.k); if (p.k === de || !d.webhook) continue;
      const c = d.texte === false ? `${LIEN_MSG} 📷 Nouvelle photo de **${nomDe(de)}**` : `${LIEN_MSG} 📷 **${nomDe(de)}**${texte ? ' : ' + trunc(texte, 1500) : ''}`;
      posterDiscord(d.webhook, c, d.texte === false ? null : image).catch(() => {});
    }
    return;
  }
  const envois = personnes().filter((p) => p.k !== de && discordDe(p.k).webhook).map((p) => {
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
    <p class="hint">Quand quelqu'un écrit dans la messagerie, l'app poste un message dans <b>ton</b> salon Discord : ton ordinateur ou ton téléphone sonne comme pour n'importe quel message Discord. À faire une seule fois :</p>
    <ol class="steps">
      <li>Dans Discord : <b>+</b> (à gauche) → <b>Créer le mien</b> → <b>Pour moi et mes amis</b>. Nomme-le par exemple « Gamins de Talus ». (Ou utilise un salon d'un serveur qui existe déjà.)</li>
      <li>Sur le salon <b>#général</b> : roue dentée <b>Modifier le salon</b> → <b>Intégrations</b> → <b>Webhooks</b> → <b>Nouveau webhook</b> → <b>Copier l'URL du webhook</b>.</li>
      <li>Colle l'adresse ci-dessous, enregistre, puis <b>Envoyer un test</b>.</li>
      <li>Pour être sûr d'être prévenu : clic droit sur le serveur → <b>Paramètres de notification</b> → <b>Tous les messages</b>.</li>
    </ol>
    ${inp('dc-url', 'Adresse du webhook', d.webhook || '', { name: 'webhook', attrs: { placeholder: 'https://discord.com/api/webhooks/…', autocomplete: 'off', spellcheck: 'false' }, sub: 'Elle reste dans votre base, pas dans le code public. Garde-la pour toi : qui la connaît peut écrire dans ce salon.' })}
    <label class="row" style="font-size:14px"><input type="checkbox" name="texte"${d.texte === false ? '' : ' checked'}> Mettre le texte du message dans la notification (sinon : juste « Nouveau message de … »)</label>
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
  try { await posterDiscord(u, `${LIEN_MSG} ✅ Test : les messages de l'app Gamins de Talus arriveront ici, ${nomDe(Sync.me)}. Le 🔗 au début ouvre la messagerie pour répondre.`); toast('Test envoyé : regarde dans Discord.'); }
  catch (e) { toast("Envoi impossible : vérifie la connexion et l'adresse."); }
};
ACTIONS.discordOff = () => { if (DB.get('cfg:discord:' + Sync.me)) DB.del('cfg:discord:' + Sync.me); closeSheet(); toast('Notifications Discord désactivées.'); };

/* ---------- Mails de l'adresse commune ----------
   La fonction Supabase « mails » relève la boîte Infomaniak (IMAP) et ajoute chaque nouveau mail :
   mail:<id> = { de: { nom, adresse }, objet, date, extrait, uid, messageId,
                 statut: '' | 'encours' | 'traite' | 'ignore', par (qui s'en occupe), vus: { personne: date }, tache }
   cfg:mails = { adresse, webmail } (réglages) ; cfg:mails:etat = { derniere, erreur, nouveaux } (écrit par la fonction). */
const MAIL = { filtre: 'atraiter', ouvert: '' };
const mails = () => DB.all('mail:').sort((a, b) => String(b.date).localeCompare(String(a.date)));
const mailsATraiter = () => mails().filter((m) => !['traite', 'ignore'].includes(m.statut || ''));
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
  const f = MAIL.filtre, list = all.filter((m) => f === 'tous' ? true : f === 'moi' ? m.par === Sync.me && m.statut === 'encours' : f === 'traites' ? ['traite', 'ignore'].includes(m.statut || '') : !['traite', 'ignore'].includes(m.statut || ''));
  const chips = [['atraiter', `À traiter · ${mailsATraiter().length}`], ['moi', 'Je m\'en occupe'], ['traites', 'Traités'], ['tous', 'Tous']].map(([k, l]) => `<button class="chip${f === k ? ' on' : ''}" type="button" data-act="mailFiltre" data-k="${k}">${esc(l)}</button>`).join('');
  if (!all.length && !etat.derniere) return `<div class="panel"><h2>Mails</h2><p>Les mails reçus sur votre adresse commune (${esc(c.adresse || 'Infomaniak')}) apparaîtront ici : qui s'en occupe, ce qui est traité, en lien avec vos contacts.</p>
    <p class="hint">Il reste à installer la fonction « mails » dans Supabase (voir le README, partie « Mails »). Ensuite, la boîte est relevée chaque fois que quelqu'un ouvre cette page, et toutes les 10 minutes par Supabase.</p>
    <div class="row"><button class="btn" type="button" data-act="mailRelever">Essayer de relever maintenant</button><button class="btn" type="button" data-act="mailCfg">Réglages</button></div></div>`;
  const carte = (m) => {
    const ct = contactDuMail(m.de && m.de.adresse), vus = Object.keys(m.vus || {}).filter((p) => p !== m.par);
    const etatTxt = m.statut === 'traite' ? `✓ traité${m.par ? ' par ' + nomDe(m.par) : ''}` : m.statut === 'ignore' ? 'ignoré' : m.statut === 'encours' ? `${m.par === Sync.me ? 'Tu t\'en occupes' : nomDe(m.par) + ' s\'en occupe'}` : 'personne ne s\'en occupe encore';
    return `<div class="mail${m.statut === 'encours' ? ' encours' : ''}${['traite', 'ignore'].includes(m.statut || '') ? ' fini' : ''}">
      <div class="between"><b>${esc((m.de && (m.de.nom || m.de.adresse)) || '?')}</b><span class="hint">${esc(depuis(m.date))}</span></div>
      <div class="mail-objet">${esc(m.objet || '(sans objet)')}</div>
      ${ct ? `<a class="hint" href="#/${ct.prospect ? 'contacts/prospect' : 'contacts/voir'}/${encodeURIComponent(ct.key)}">👤 ${esc(displayName(ct))}${ct.prospect ? ' (prospect)' : ''}</a>` : `<span class="hint">${esc((m.de && m.de.adresse) || '')}</span>`}
      <p class="mail-extrait${MAIL.ouvert === m.key ? ' open' : ''}" data-act="mailOuvrir" data-key="${esc(m.key)}">${esc(m.extrait || '')}</p>
      <div class="mail-etat"><span class="tpill">${esc(etatTxt)}</span>${vus.length ? `<span class="hint">vu par ${esc(vus.map(nomDe).join(', '))}</span>` : ''}</div>
      <div class="row mail-actions">
        ${!['traite', 'ignore'].includes(m.statut || '') && m.par !== Sync.me ? `<button class="btn primary small" type="button" data-act="mailMoi" data-key="${esc(m.key)}">Je m'en occupe</button>` : ''}
        <button class="btn small" type="button" data-act="mailVerifier" data-key="${esc(m.key)}">Je vais juste vérifier</button>
        ${!['traite', 'ignore'].includes(m.statut || '') ? `<button class="btn small" type="button" data-act="mailStatut" data-s="traite" data-key="${esc(m.key)}">✓ Traité</button>` : `<button class="btn small" type="button" data-act="mailStatut" data-s="" data-key="${esc(m.key)}">Remettre à traiter</button>`}
        <button class="btn small" type="button" data-act="mailPlus" data-key="${esc(m.key)}" aria-label="Plus d'options">⋯</button></div></div>`;
  };
  return `<div class="panel"><div class="between"><h2>Mails${c.adresse ? ' · ' + esc(c.adresse) : ''}</h2><div class="row"><button class="btn small" type="button" data-act="mailRelever">Relever</button><button class="btn small" type="button" data-act="mailCfg">Réglages</button></div></div>
    <p class="hint">Dernière relève ${esc(depuis(etat.derniere))}${etat.erreur ? ` · <span class="bad">problème : ${esc(etat.erreur)}</span>` : ''}. « Je m'en occupe » et « Je vais juste vérifier » ouvrent la boîte Infomaniak dans un nouvel onglet.</p>
    <div class="chips">${chips}</div>
    ${list.length ? list.slice(0, 80).map(carte).join('') : '<p class="empty">Rien ici.</p>'}</div>`;
}
const ouvrirWebmail = () => { try { window.open(cfgMails().webmail, '_blank', 'noopener'); } catch (e) { /* */ } };
const majMail = (k, o) => { const m = DB.get(k); if (m) DB.put(k, Object.assign({}, m, o, { vus: Object.assign({}, m.vus || {}, Sync.me ? { [Sync.me]: new Date().toISOString() } : {}) })); };
ACTIONS.mailFiltre = (el) => { MAIL.filtre = el.dataset.k; render(); };
ACTIONS.mailOuvrir = (el) => { MAIL.ouvert = MAIL.ouvert === el.dataset.key ? '' : el.dataset.key; render(); };
ACTIONS.mailMoi = (el) => { ouvrirWebmail(); majMail(el.dataset.key, { statut: 'encours', par: Sync.me }); };
ACTIONS.mailVerifier = (el) => { ouvrirWebmail(); majMail(el.dataset.key, {}); };
ACTIONS.mailStatut = (el) => { const s = el.dataset.s; majMail(el.dataset.key, s ? { statut: s, par: (DB.get(el.dataset.key) || {}).par || Sync.me } : { statut: '', par: '' }); closeSheet(); };
ACTIONS.mailRelever = () => releverMails(true);
ACTIONS.mailPlus = (el) => {
  const k = el.dataset.key, m = DB.get(k); if (!m) return; const ct = contactDuMail(m.de && m.de.adresse);
  const b = (act, txt, extra = '') => `<button type="button" class="menu-it" data-act="${act}" data-key="${esc(k)}"${extra}>${txt}</button>`;
  openSheet(`${sheetHead(m.objet || '(sans objet)', (m.de && m.de.adresse) || '')}<div class="sbody"><p style="white-space:pre-wrap;margin-top:0">${esc(m.extrait || '')}</p><div class="menu-list">
    ${b('mailTache', '✅ En faire une tâche')}
    ${b('mailStatut', '🙈 Pas important : ignorer', ' data-s="ignore"')}
    ${!ct && m.de && m.de.adresse ? b('mailContact', '👤 Ajouter l\'expéditeur aux contacts') : ''}
    ${m.statut ? b('mailStatut', '↩︎ Remettre à traiter', ' data-s=""') : ''}
  </div></div>`);
};
ACTIONS.mailTache = (el) => {
  const m = DB.get(el.dataset.key); if (!m) return; const k = 't:' + uid('t');
  DB.put(k, { titre: trunc('Mail : ' + (m.objet || (m.de && m.de.nom) || ''), 80), statut: 'afaire', responsable: Sync.me || '', tag: 'admin', remarques: `De ${(m.de && (m.de.nom + ' <' + m.de.adresse + '>')) || ''} le ${fmtDate(String(m.date || '').slice(0, 10))}\n\n${m.extrait || ''}`, cree: new Date().toISOString(), creePar: Sync.me || '' });
  majMail(el.dataset.key, { statut: m.statut || 'encours', par: m.par || Sync.me, tache: k }); closeSheet(); ACTIONS.taEdit({ dataset: { key: k } });
};
ACTIONS.mailContact = (el) => {
  const m = DB.get(el.dataset.key); if (!m || !m.de) return; const k = 'ct:' + uid('c');
  DB.put(k, { nom: m.de.nom || '', email: m.de.adresse, type: 'autre', cree: new Date().toISOString() });
  closeSheet(); go('#/contacts/modifier/' + encodeURIComponent(k));
};
ACTIONS.mailCfg = () => {
  const c = cfgMails();
  openSheet(`${sheetHead('Mails : réglages')}<form class="sbody form" data-form="mailCfg">
    ${inp('ml-adr', 'Adresse relevée', c.adresse, { name: 'adresse', attrs: { placeholder: 'info@gaminsdetalus.ch' }, sub: 'Pour l\'affichage. Le mot de passe, lui, est rangé dans les secrets de Supabase, jamais ici.' })}
    ${inp('ml-web', 'Adresse du webmail', c.webmail, { name: 'webmail', sub: 'Ouverte par « Je m\'en occupe » et « Je vais juste vérifier ».' })}
    <div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.mailCfg = (v) => { DB.put('cfg:mails', Object.assign({}, DB.get('cfg:mails') || {}, { adresse: v.adresse, webmail: v.webmail || 'https://mail.infomaniak.com' })); closeSheet(); toast('Enregistré.'); };
setTimeout(() => releverMails(), 15000);
