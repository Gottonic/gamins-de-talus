/* Gamins de Talus — messagerie entre associés, avec notifications Discord (facultatives, par personne).
   msg:<id>          un message { de, texte, cree }
   lu:<personne>     jusqu'où la personne a lu { jusqua } : une ligne par personne, donc jamais de conflit
   cfg:discord:<p>   le webhook Discord de la personne { webhook, texte } (dans la base, pas dans le code public) */
'use strict';

const MSG = { draft: '', timer: null };
const messages = () => DB.all('msg:').sort((a, b) => String(a.cree).localeCompare(String(b.cree)));
const luJusqua = (p) => ((DB.get('lu:' + p) || {}).jusqua || '');
function nonLus(p) { p = p || Sync.me; const l = luJusqua(p); return messages().filter((m) => m.de !== p && String(m.cree) > l); }
const discordDe = (p) => DB.get('cfg:discord:' + p) || {};
const APP_URL = 'https://gottonic.github.io/gamins-de-talus/';

MODULES.messages = {
  titre: 'Messages',
  tuile() {
    const n = nonLus().length, ms = messages(), der = ms[ms.length - 1];
    if (n) return { line: `${n} message${n > 1 ? 's' : ''} non lu${n > 1 ? 's' : ''}`, warn: true };
    return { line: der ? `${nomDe(der.de)} : ${trunc(der.texte, 40)}` : 'Discuter entre associés' };
  },
  render() { return renderMessages(); },
  after() {
    marquerLu();
    const box = $('msg-list'); if (box) box.scrollTop = box.scrollHeight;
    const t = $('msg-txt');
    if (t) {
      const grow = () => { t.style.height = 'auto'; t.style.height = Math.min(220, t.scrollHeight + 2) + 'px'; };
      t.addEventListener('input', () => { MSG.draft = t.value; grow(); }); grow();
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
    html += `<div class="msg${mien ? ' mine' : ''}${suite ? ' suite' : ''}">
      ${!mien && !suite ? `<span class="msg-who">${esc(nomDe(m.de))}</span>` : ''}
      <div class="bubble">${texteMsg(m.texte)}<span class="msg-t">${heureMsg(m.cree)}${mien ? ` <button type="button" class="msg-del" data-act="msgDel" data-key="${esc(m.key)}" title="Supprimer ce message" aria-label="Supprimer ce message">×</button>` : ''}</span></div></div>`;
  });
  /* « Vu par » sous le dernier message */
  const der = ms[ms.length - 1];
  if (der) {
    const vus = personnes().filter((p) => p.k !== der.de && p.k !== me && luJusqua(p.k) >= String(der.cree)).map((p) => p.nom);
    if (der.de === me || vus.length) html += `<div class="msg-vu${der.de === me ? ' mine' : ''}">${vus.length ? 'Vu par ' + esc(vus.join(', ')) : 'Pas encore vu'}</div>`;
  }
  const d = discordDe(me), dOn = !!d.webhook;
  return `<div class="panel chat">
    <div class="between chat-head"><h2>Entre nous</h2>
      <button class="btn small${dOn ? ' on' : ''}" type="button" data-act="discordSheet">${ICON_DISCORD}${dOn ? 'Notifications Discord activées' : 'Recevoir les notifications sur Discord'}</button></div>
    <p class="hint chat-who">${esc(personnes().map((p) => p.nom).join(', '))} · ${prevenus.length ? 'prévenus sur Discord : ' + esc(prevenus.join(', ')) : 'personne n\'est encore prévenu sur Discord'}</p>
    <div class="msg-list" id="msg-list" aria-live="polite">${html || '<p class="empty">Aucun message pour l\'instant. Écris le premier !</p>'}</div>
    <form class="composer" data-form="msg">
      <textarea id="msg-txt" name="texte" rows="1" placeholder="Écrire un message…" aria-label="Message">${esc(MSG.draft)}</textarea>
      <button class="btn primary" type="submit">Envoyer</button>
    </form>
    <p class="hint">${matchMedia('(pointer: fine)').matches ? 'Entrée pour envoyer, Maj + Entrée pour aller à la ligne. ' : ''}Les messages restent dans la base, comme tout le reste.</p></div>`;
}

const ICON_DISCORD = '<svg class="ic-d" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8.5c4-2 8-2 12 0l1.5 7c-1.5 1.3-3 2-4.5 2.3l-1-1.6m-4 0-1 1.6C7.5 17.5 6 16.8 4.5 15.5z"/><circle cx="9.5" cy="12.5" r="1.1"/><circle cx="14.5" cy="12.5" r="1.1"/></svg>';

FORMS.msg = () => envoyerMessage();
function envoyerMessage() {
  const t = $('msg-txt'); const texte = String((t && t.value) || '').trim();
  if (!texte) return;
  if (!Sync.me) { toast('Connecte-toi pour envoyer un message.'); return; }
  const cree = new Date().toISOString();
  MSG.draft = ''; if (t) t.value = '';
  DB.put('msg:' + uid('m'), { de: Sync.me, texte, cree });
  DB.put('lu:' + Sync.me, { jusqua: cree });
  Sync.schedule(0);
  notifierDiscord(Sync.me, texte);
  render(); const n = $('msg-txt'); if (n && matchMedia('(pointer: fine)').matches) n.focus();
}
ACTIONS.msgDel = (el) => confirmSheet('Supprimer ce message ?', 'Il disparaît pour tout le monde (il reste récupérable dans la corbeille).', 'delItemOk', 'Supprimer', { key: el.dataset.key });

/* ---------- Discord ----------
   Chaque personne colle l'adresse d'un webhook de son propre salon Discord. Quand quelqu'un écrit,
   l'app poste dans le salon des autres. Envoi en « multipart » : Discord l'accepte sans autorisation spéciale du navigateur. */
const DQ_KEY = 'gdt-discord-file';
function posterDiscord(webhook, contenu) {
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({ username: 'Gamins de Talus', content: contenu.slice(0, 1900), allowed_mentions: { parse: [] } }));
  return fetch(webhook, { method: 'POST', mode: 'no-cors', body: fd });
}
function notifierDiscord(de, texte) {
  if (LOCAL_MODE) return;
  const envois = personnes().filter((p) => p.k !== de && discordDe(p.k).webhook).map((p) => {
    const d = discordDe(p.k);
    return { webhook: d.webhook, contenu: d.texte === false ? `💬 Nouveau message de **${nomDe(de)}** · ${APP_URL}#/messages` : `💬 **${nomDe(de)}** : ${trunc(texte, 1500)}\n${APP_URL}#/messages` };
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
  try { await posterDiscord(u, `✅ Test : les messages de l'app Gamins de Talus arriveront ici, ${nomDe(Sync.me)}.`); toast('Test envoyé : regarde dans Discord.'); }
  catch (e) { toast("Envoi impossible : vérifie la connexion et l'adresse."); }
};
ACTIONS.discordOff = () => { if (DB.get('cfg:discord:' + Sync.me)) DB.del('cfg:discord:' + Sync.me); closeSheet(); toast('Notifications Discord désactivées.'); };
