/* Gamins de Talus — « Quoi de neuf » : à la première ouverture après une mise à jour importante, quelques points en clair.
   Chacun ne voit que ce qui est nouveau pour lui (cfg:nouv:<personne> = { vu: id }). Historique : Réglages → Nouveautés.
   NOUVEAUTES : le plus récent en premier. Une entrée n'est ajoutée qu'une fois la note validée par Nicolas. */
'use strict';
const NOUVEAUTES = [
];
const vuNouveautes = () => (Sync.me && (DB.get('cfg:nouv:' + Sync.me) || {}).vu) || '';
function nouveautesAMontrer() {
  if (!Sync.me || !NOUVEAUTES.length) return [];
  const vu = vuNouveautes(); if (!vu) return NOUVEAUTES.slice(0, 1); /* première fois : juste la dernière */
  return NOUVEAUTES.filter((n) => n.id > vu);
}
const nouveauteHtml = (n) => `<div class="nouv"><h3>${esc(n.titre || 'Nouveautés')} <small class="hint">${fmtDate(String(n.id).slice(0, 10))}</small></h3><ul>${(n.points || []).map((p) => `<li>${p}</li>`).join('')}</ul></div>`;
function montrerNouveautes() {
  const l = nouveautesAMontrer(); if (!l.length) return;
  openSheet(`${sheetHead('Quoi de neuf ?', l.length > 1 ? `${l.length} mises à jour depuis ta dernière visite` : '')}<div class="sbody">${l.map(nouveauteHtml).join('')}
    <div class="row-end"><button class="btn primary" type="button" data-act="nouveautesVu">OK</button></div></div>`);
}
ACTIONS.nouveautesVu = () => { if (Sync.me && NOUVEAUTES.length) DB.put('cfg:nouv:' + Sync.me, { vu: NOUVEAUTES[0].id, le: new Date().toISOString() }); closeSheet(); };
/* Une fois par ouverture de l'app, quand rien d'autre n'est ouvert et qu'on n'écrit pas */
(function guetter(n) {
  if (n > 60) return;
  const libre = Sync.me && Object.keys(DB.data).length > 5 && $('scrim') && $('scrim').hidden && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  if (libre) { montrerNouveautes(); return; }
  setTimeout(() => guetter(n + 1), 2000);
})(0);
function renderNouveautes() {
  return `<div class="panel"><h2>Nouveautés</h2>${NOUVEAUTES.length ? NOUVEAUTES.map(nouveauteHtml).join('') : '<p class="empty">Rien pour l\'instant.</p>'}</div>`;
}
