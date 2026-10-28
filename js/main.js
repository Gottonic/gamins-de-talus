/* Gamins de Talus — démarrage, connexion, synchro et compte. */
'use strict';

function showLogin(msg) { const l = $('login'); l.hidden = false; const er = $('l-err'); er.hidden = !msg; er.textContent = msg || ''; try { $('l-mail').focus(); } catch (e) { /* */ } }

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
  Sync.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'gdt-auth' } });
  let session = null; try { session = (await Sync.sb.auth.getSession()).data.session; } catch (e) { /* */ }
  if (session && session.user) await enter(session.user); else showLogin();
  Sync.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && Sync.uid) { Sync.uid = null; showLogin(); } });
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
      ${LOCAL_MODE ? '' : '<button class="btn danger" type="button" data-act="logout">Se déconnecter</button>'}
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
