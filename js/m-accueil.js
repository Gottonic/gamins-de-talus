/* Gamins de Talus — accueil : une tuile par module, et ce qui demande de l'attention. */
'use strict';

const ICONS = {
  factures: '<svg viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3"/><path d="M9 10h6M9 14h6M9 18h3"/></svg>',
  finances: '<svg viewBox="0 0 24 24"><ellipse cx="9" cy="7" rx="5" ry="2.5"/><path d="M4 7v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V7"/><path d="M10 15.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4c0-1.3-1.9-2.4-4.4-2.5"/><path d="M10 15.5v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4"/></svg>',
  heures: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  taches: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.5l2.7 2.7L16.5 9"/></svg>',
  cultures: '<svg viewBox="0 0 24 24"><path d="M12 21v-9"/><path d="M12 12c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5z"/><path d="M12 14.5c0-3-2.4-5-5.5-5 0 3 2.4 5 5.5 5z"/><path d="M4 21h16"/></svg>',
  inventaire: '<svg viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  contacts: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.5.2 4.3 1.9 4.9 4.9"/></svg>',
  reglages: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};
const ORDRE = ['factures', 'finances', 'heures', 'taches', 'cultures', 'inventaire', 'contacts', 'reglages'];

function renderAccueil() {
  const h = new Date().getHours();
  const salut = h < 11 ? 'Bonjour' : h < 18 ? 'Salut' : 'Bonsoir';
  const tiles = ORDRE.filter((k) => MODULES[k]).map((k) => {
    const m = MODULES[k]; let t = { line: '' };
    try { t = m.tuile ? m.tuile() : t; } catch (e) { console.error(e); }
    return `<a class="tile" href="#/${k}">${ICONS[k] || ''}<b>${esc(m.titre)}</b><span class="${t.warn ? 'warn' : ''}">${esc(t.line || '')}</span></a>`;
  }).join('');
  const attn = [];
  try { attn.push(...attentionFactures()); } catch (e) { /* */ }
  try { attn.push(...attentionTaches()); } catch (e) { /* */ }
  try { attn.push(...attentionFinances()); } catch (e) { /* */ }
  return `<section class="hello"><span class="eyebrow">Maraîchers · Marly</span><h2>${salut}${Sync.me ? ' ' + esc(nomDe(Sync.me)) : ''}</h2></section>
    <section class="tiles" aria-label="Modules">${tiles}</section>
    ${attn.length ? `<section class="panel"><h2>À voir</h2><div class="attn">${attn.map((a) => `<a href="${a.href}" class="${a.info ? 'info' : ''}"><span>${esc(a.txt)}</span><span class="num">${esc(a.val || '')}</span></a>`).join('')}</div></section>` : ''}`;
}
