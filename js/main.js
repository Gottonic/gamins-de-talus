/* Gamins de Talus — démarrage, connexion, synchro et compte. */
'use strict';

function showLogin(msg) { const l = $('login'); l.hidden = false; const er = $('l-err'); er.className = 'errors'; er.hidden = !msg; er.textContent = msg || ''; try { $('l-mail').focus(); } catch (e) { /* */ } }

async function trouverPersonne() {
  try {
    const { data, error } = await Sync.sb.from('membres').select('personne,nom,user_id');
    if (error) throw error;
    const mine = (data || []).find((m) => m.user_id === Sync.uid);
    if (mine) { Sync.me = mine.personne; Sync.persist(); return true; }
    return (data || []).length ? true : false;
  } catch (e) { return !!Sync.me; }
}

async function enter(user) {
  Sync.uid = user.id; Sync.email = user.email || ''; $('login').hidden = true;
  const hadCache = Sync.loadCache();
  render(); UI.status(); majMoi();
  const okMember = await trouverPersonne(); majMoi();
  const ok = await Sync.pull(!hadCache);
  if (ok && !okMember && !Object.keys(DB.data).length) {
    $('view').innerHTML = `<div class="panel"><h2>Compte pas encore relié</h2><p class="hint">Ce compte (${esc(Sync.email)}) n'est pas encore membre de Gamins de Talus. Dans Supabase, exécute la ligne « insert into public.membres … » du fichier <code>supabase/schema.sql</code> avec cette adresse, puis recharge la page.</p></div>`;
    return;
  }
  render(); Sync.push(); ecouterEnDirect();
  setTimeout(async () => { ANNULER.actif = false; try { await nettoyerFichiers(); } finally { ANNULER.actif = true; } }, 8000);
}
/* Mises à jour en direct (messages, etc.) : actif si la table est publiée pour Realtime dans Supabase.
   Sinon rien ne casse : l'app regarde quand même toutes les minutes (toutes les 8 s dans la messagerie). */
function ecouterEnDirect() {
  if (ecouterEnDirect.on || !Sync.sb || !Sync.sb.channel) return; ecouterEnDirect.on = true;
  try {
    Sync.sb.channel('rows-direct').on('postgres_changes', { event: '*', schema: 'public', table: 'rows' }, () => {
      clearTimeout(ecouterEnDirect.t); ecouterEnDirect.t = setTimeout(() => Sync.pull(), 300);
    }).subscribe();
  } catch (e) { /* pas de direct : la synchro régulière suffit */ }
}
function majMoi() { const b = $('me'); if (Sync.me) { b.hidden = false; b.textContent = nomDe(Sync.me); } else b.hidden = true; }

async function startApp() {
  if ('serviceWorker' in navigator && !LOCAL_MODE) {
    try {
      /* Nouvelle version de l'app installée : on recharge une fois pour l'utiliser tout de suite */
      const avait = !!navigator.serviceWorker.controller; let fait = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (avait && !fait && !DB.dirty.size) { fait = true; location.reload(); } });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { setInterval(() => r.update(), 30 * 60000); });
    } catch (e) { /* */ }
  }
  if (LOCAL_MODE) {
    Sync.uid = 'local'; Sync.loadCache(); if (!Sync.me) Sync.me = 'nicolas';
    majMoi(); UI.status(); render(); return;
  }
  if (!window.supabase || !window.supabase.createClient) { $('view').innerHTML = '<p class="empty">Impossible de charger l\'app. Recharge la page.</p>'; return; }
  /* Arrivée par le lien « mot de passe oublié » reçu par mail : #access_token=…&type=recovery (ou une erreur si le lien a expiré) */
  const h = location.hash, recup = /type=recovery/.test(h), lienKo = /error_code=|error=/.test(h) && !/^#\//.test(h);
  Sync.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gdt-auth' } });
  let session = null; try { session = (await Sync.sb.auth.getSession()).data.session; } catch (e) { /* */ }
  if (recup || lienKo) { try { history.replaceState(null, '', location.pathname + location.search + '#/'); } catch (e) { /* */ } }
  if (session && session.user) { await enter(session.user); if (recup) setTimeout(() => ACTIONS.mdpChanger({ dataset: { recup: '1' } }), 300); }
  else showLogin(lienKo ? 'Ce lien ne marche plus (il a expiré ou a déjà servi). Redemande-en un avec « Mot de passe oublié ? ».' : '');
  Sync.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && Sync.uid) { Sync.uid = null; showLogin(); } if (ev === 'PASSWORD_RECOVERY' && Sync.uid) setTimeout(() => ACTIONS.mdpChanger({ dataset: { recup: '1' } }), 300); });
  addEventListener('online', () => { UI.status(); Sync.pull().then(() => Sync.push()); });
  addEventListener('offline', () => UI.status());
  document.addEventListener('visibilitychange', () => { if (!Sync.uid) return; if (document.visibilityState === 'visible') Sync.pull().then(() => Sync.push()); else Sync.push(); });
  setInterval(() => { if (Sync.uid && document.visibilityState === 'visible') Sync.pull(); }, 60000);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); e.stopPropagation(); const b = $('l-go'); b.disabled = true; b.textContent = 'Connexion…';
  try {
    const { data, error } = await Sync.sb.auth.signInWithPassword({ email: $('l-mail').value.trim(), password: $('l-pass').value });
    if (error) throw error; await enter(data.user);
  } catch (err) {
    const m = String((err && err.message) || err);
    showLogin(/invalid/i.test(m) ? 'Adresse ou mot de passe incorrect.' : !navigator.onLine ? 'Pas de réseau : la première connexion demande internet.' : 'Connexion impossible : ' + m);
  }
  b.disabled = false; b.textContent = 'Se connecter';
}, true);

/* ---------- Mot de passe : oublié (lien par mail), changer, et assez fort ---------- */
$('l-oubli').addEventListener('click', async () => {
  const mail = $('l-mail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { showLogin('Écris d\'abord ton adresse e-mail ci-dessus, puis « Mot de passe oublié ? ».'); return; }
  if (!Sync.sb) return; const b = $('l-oubli'); b.disabled = true;
  try {
    const { error } = await Sync.sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    showLogin(''); const er = $('l-err'); er.hidden = false; er.className = 'banner'; er.textContent = `Si ${mail} a un compte, un mail avec un lien vient de partir. Ouvre-le sur cet appareil pour choisir un nouveau mot de passe.`;
  } catch (e) { showLogin('Envoi impossible : ' + (e.message || e)); }
  b.disabled = false;
});
/* Un mot de passe fort : 12 caractères au moins avec 3 sortes (minuscules, majuscules, chiffres, signes), ou une phrase de 16 caractères et plus */
const MDP_INTERDITS = ['gamins', 'talus', 'motdepasse', 'password', 'azerty', 'qwerty', '123456', 'marly', 'legume'];
function forceMdp(pw, mail) {
  const sortes = [/[a-zà-ÿ]/, /[A-ZÀ-Ý]/, /\d/, /[^A-Za-zÀ-ÿ0-9]/].filter((r) => r.test(pw)).length, bas = pw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const moi = String(mail || '').split('@')[0].toLowerCase();
  if (!pw) return { ok: false, niveau: 0, msg: '' };
  if (moi.length > 3 && bas.includes(moi)) return { ok: false, niveau: 1, msg: 'Évite ton adresse e-mail dans le mot de passe.' };
  if (MDP_INTERDITS.some((x) => bas.includes(x))) return { ok: false, niveau: 1, msg: 'Évite les mots trop évidents (gamins, talus, password, 123456…).' };
  if (/(.)\1\1\1/.test(pw)) return { ok: false, niveau: 1, msg: 'Pas plus de 3 fois le même caractère à la suite.' };
  if (pw.length >= 16 && sortes >= 2) return { ok: true, niveau: 4, msg: 'Très bien.' };
  if (pw.length >= 12 && sortes >= 3) return { ok: true, niveau: pw.length >= 14 ? 4 : 3, msg: 'Bien.' };
  return { ok: false, niveau: pw.length >= 10 ? 2 : 1, msg: pw.length < 12 ? `Encore ${12 - pw.length} caractère${12 - pw.length > 1 ? 's' : ''} au moins (ou une phrase de 16).` : 'Mélange minuscules, majuscules, chiffres ou signes (3 sortes), ou fais une phrase de 16 caractères.' };
}
ACTIONS.mdpChanger = (el) => {
  const recup = !!(el && el.dataset && el.dataset.recup);
  openSheet(`${sheetHead(recup ? 'Choisis un nouveau mot de passe' : 'Changer mon mot de passe', Sync.email)}<form class="sbody form" data-form="mdp" id="mdp-form"><input type="hidden" name="recup" value="${recup ? '1' : ''}">
    <input type="text" name="username" autocomplete="username" value="${esc(Sync.email)}" hidden>
    ${recup ? '' : `<div class="field"><label for="mdp-actuel">Mot de passe actuel</label><input id="mdp-actuel" name="actuel" type="password" autocomplete="current-password" required></div>`}
    <div class="field"><label for="mdp-n">Nouveau mot de passe</label><input id="mdp-n" name="nouveau" type="password" autocomplete="new-password" required><div class="mdp-barre"><span id="mdp-niv"></span></div><span class="sub" id="mdp-msg">12 caractères au moins, avec minuscules, majuscules et chiffres (ou une phrase de 16 caractères et plus).</span></div>
    <div class="field"><label for="mdp-n2">Encore une fois</label><input id="mdp-n2" name="nouveau2" type="password" autocomplete="new-password" required></div>
    <label class="row" style="font-size:14px"><input type="checkbox" id="mdp-voir"> Afficher</label>
    <p class="hint">Il protège les données des clients : ne le réutilise pas ailleurs. Un gestionnaire de mots de passe (Bitwarden, Proton Pass…) peut en inventer un et s'en souvenir.</p>
    <div class="row-end"><button class="btn primary" type="submit" id="mdp-ok">Enregistrer</button></div></form>`);
  const n = $('mdp-n'), maj = () => { const f = forceMdp(n.value, Sync.email); $('mdp-niv').style.width = (f.niveau * 25) + '%'; $('mdp-niv').className = 'n' + f.niveau; if (n.value) $('mdp-msg').textContent = f.msg; };
  n.addEventListener('input', maj);
  $('mdp-voir').addEventListener('change', (e) => document.querySelectorAll('#mdp-form input[type=password], #mdp-form input.mdp-vu').forEach((x) => { x.type = e.target.checked ? 'text' : 'password'; x.classList.toggle('mdp-vu', e.target.checked); }));
};
FORMS.mdp = async (v) => {
  const f = forceMdp(v.nouveau, Sync.email);
  if (!f.ok) { toast(f.msg || 'Mot de passe trop faible.'); return; }
  if (v.nouveau !== v.nouveau2) { toast('Les deux nouveaux mots de passe ne sont pas pareils.'); return; }
  if (LOCAL_MODE || !Sync.sb) { toast('En mode essai, rien ne change.'); return; }
  const b = $('mdp-ok'); b.disabled = true; b.textContent = 'Enregistrement…';
  try {
    if (!v.recup) { const { error } = await Sync.sb.auth.signInWithPassword({ email: Sync.email, password: v.actuel }); if (error) throw new Error('le mot de passe actuel n\'est pas le bon'); }
    const { error } = await Sync.sb.auth.updateUser({ password: v.nouveau });
    if (error) throw new Error(/different/i.test(error.message) ? 'il doit être différent de l\'ancien' : /weak|short|characters/i.test(error.message) ? 'trop faible pour les règles de Supabase' : error.message);
    closeSheet(); toast('Mot de passe changé. 🔒', 5000);
  } catch (e) { b.disabled = false; b.textContent = 'Enregistrer'; toast('Pas changé : ' + e.message, 6000); }
};

$('scrim').addEventListener('click', (e) => { if (e.target === $('scrim')) closeSheet(); });

/* Fenêtre synchro + compte */
ACTIONS.syncSheet = () => {
  const st = LOCAL_MODE ? 'Mode essai : rien n\'est envoyé en ligne.' : !navigator.onLine ? 'Hors ligne' : Sync.err ? 'Problème : ' + Sync.err : DB.dirty.size ? DB.dirty.size + ' changement' + (DB.dirty.size > 1 ? 's' : '') + ' en attente d\'envoi' : 'Tout est enregistré';
  const t = Sync.lastOk ? new Date(Sync.lastOk).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }) : '—';
  openSheet(`${sheetHead('Synchro et compte', Sync.email || (LOCAL_MODE ? 'Mode essai' : ''))}<div class="sbody">
    <p><b>${esc(st)}</b><br><span class="hint">Dernier contact avec le serveur : ${t}</span></p>
    ${LOCAL_MODE ? sel('me-pick', 'Je suis', Sync.me, persOptions()) : `<p class="hint">Connecté en tant que <b>${esc(nomDe(Sync.me) || '?')}</b>.</p>`}
    <div class="row">
      ${LOCAL_MODE ? '' : '<button class="btn" type="button" data-act="syncNow">Synchroniser maintenant</button>'}
      <a class="btn" href="#/reglages/donnees">Exporter ou importer les données</a>
      ${LOCAL_MODE ? '' : '<button class="btn" type="button" data-act="mdpChanger">🔒 Changer mon mot de passe</button><button class="btn danger" type="button" data-act="logout">Se déconnecter</button>'}
    </div>
  </div>`);
  const mp = $('me-pick'); if (mp) mp.addEventListener('change', () => { Sync.me = mp.value; Sync.persist(); majMoi(); render(); });
};
ACTIONS.syncNow = async () => { await Sync.pull(); await Sync.push(); closeSheet(); toast(Sync.err ? 'Problème : ' + Sync.err : 'Synchronisé.'); };
ACTIONS.logout = () => {
  if (DB.dirty.size) { confirmSheet('Se déconnecter ?', `${DB.dirty.size} changement(s) ne sont pas encore envoyés et seraient perdus. Reconnecte-toi au réseau d'abord si possible.`, 'logoutOk', 'Se déconnecter quand même'); return; }
  ACTIONS.logoutOk();
};
ACTIONS.logoutOk = async () => { ls.del(Sync.cacheKey()); Sync.uid = null; try { await Sync.sb.auth.signOut(); } catch (e) { /* */ } location.reload(); };

startApp();
