/* Gamins de Talus — contacts et prospection.
   Un prospect est un contact « en prospection » : il garde son statut, ses notes et le journal de ses appels.
   Quand il devient client, on change seulement son étape : tout son historique reste attaché. */
'use strict';

const TYPES = [
  { k: 'grossiste', label: 'Grossiste' }, { k: 'collectivite', label: 'Restauration collective' }, { k: 'pro', label: 'Client pro' },
  { k: 'particulier', label: 'Particulier' }, { k: 'fournisseur', label: 'Fournisseur' }, { k: 'partenaire', label: 'Partenaire' }, { k: 'autre', label: 'Autre' },
];
const typeLabel = (k) => (TYPES.find((t) => t.k === k) || { label: 'Autre' }).label;
const billName = (c) => (c.organisation || c.nom || '').trim();
const attnName = (c) => (c.organisation && c.nom ? c.nom.trim() : '');
const displayName = (c) => c.organisation || c.nom || 'Sans nom';
const byName = (a, b) => displayName(a).localeCompare(displayName(b), 'fr', { sensitivity: 'base' });
const tousContacts = () => DB.all('ct:');
const contacts = () => tousContacts().filter((c) => !c.prospect);
const prospects = () => tousContacts().filter((c) => c.prospect);
const CT = { search: '', type: '' };
const PR = { search: '', groupe: 'actifs', prio: '', categorie: '' };

/* Statuts de prospection (ceux du tableur) et leur groupe de couleur */
const STATUTS_P = [
  ['À contacter', 'afaire'], ['Appelé – pas joignable', 'relance'], ['Rappeler', 'relance'], ['Mail envoyé', 'relance'],
  ['Intéressé', 'discussion'], ['En cours', 'discussion'], ['Validé', 'valide'], ['Pas intéressé', 'clos'], ['Fermé', 'clos'],
];
const groupeStatut = (s) => (STATUTS_P.find((x) => x[0] === s) || ['', 'afaire'])[1];
const GROUPES_P = [['actifs', 'À traiter'], ['afaire', 'À contacter'], ['relance', 'À relancer'], ['discussion', 'En discussion'], ['valide', 'Validés'], ['clos', 'Clos'], ['tous', 'Tous']];
const CATEGORIES_P = ['Restauration collective', 'Restaurant', 'Épicerie', 'Magasin à la ferme', 'Plateforme / paniers', 'Grossiste', 'Réseau', 'Autre'];
const TYPE_DE_CATEGORIE = { 'Restauration collective': 'collectivite', Restaurant: 'pro', 'Épicerie': 'pro', 'Magasin à la ferme': 'pro', 'Plateforme / paniers': 'pro', Grossiste: 'grossiste', 'Réseau': 'partenaire', Autre: 'autre' };
const pStat = (c) => (c.prospection || {}).statut || 'À contacter';
const dernierContact = (c) => { const j = (c.journal || []).filter((e) => e.date).map((e) => e.date).sort(); return j[j.length - 1] || ''; };
const aRelancer = (c) => { const r = (c.prospection || {}).relanceLe; return r && r <= todayISO() && !['clos', 'valide'].includes(groupeStatut(pStat(c))); };
function pillStatut(s) { return `<span class="pill ps-${groupeStatut(s)}">${esc(s)}</span>`; }

function contactMatches(c, q) {
  if (!q) return true;
  const p = c.prospection || {};
  const hay = [c.nom, c.organisation, c.fonction, c.localite, c.npa, c.email, c.telephone, c.site, c.notes, typeLabel(c.type), p.categorie, p.lieu, p.pourquoi, p.statut, ...(c.journal || []).map((e) => e.note)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function liveSearch(id, setter) {
  const s = $(id); if (!s) return;
  s.addEventListener('input', () => { setter(s.value); const pos = s.selectionStart; render(); const n = $(id); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* */ } });
}

MODULES.contacts = {
  titre: 'Contacts',
  tuile() {
    const n = contacts().length, ps = prospects(), rel = ps.filter(aRelancer).length, af = ps.filter((c) => groupeStatut(pStat(c)) === 'afaire').length;
    return { line: `${n} contact${n > 1 ? 's' : ''}` };
  },
  render(sub, id) {
    /* La prospection est maintenant dans Ventes : les anciennes adresses y mènent */
    const pr = sub === 'prospection' || sub === 'prospect' || sub === 'convertir' || (sub === 'modifier' && (DB.get(id) || {}).prospect);
    if (pr) { setTimeout(() => location.replace(`#/factures/${sub === 'modifier' ? 'pmodifier' : sub}${id ? '/' + encodeURIComponent(id) : ''}`), 0); return ''; }
    return renderContacts(sub, id);
  },
  after(sub) { afterContactsProspection(sub); },
};

function afterContactsProspection(sub) {
  liveSearch('ct-search', (v) => { CT.search = v; });
  liveSearch('pr-search', (v) => { PR.search = v; });
  const cat = $('pr-cat'); if (cat) cat.addEventListener('change', () => { PR.categorie = cat.value; render(); });
  const pb = $('pitchbox'); if (pb) pb.addEventListener('toggle', () => { ls.set('gdt-pitch-ouvert', pb.open ? '1' : '0'); const h = pb.querySelector('summary .hint'); if (h) h.textContent = pb.open ? 'fermer' : 'ouvrir'; });
  if (['voir', 'nouveau', 'modifier', 'pmodifier', 'prospect', 'convertir'].includes(sub) && innerWidth < 900) { const r = $('ct-right'); if (r) r.scrollIntoView({ block: 'start' }); }
}

/* ================= Clients et contacts ================= */
function renderContacts(sub, id) {
  const all = contacts().sort(byName);
  const counts = {}; for (const c of all) counts[c.type || 'autre'] = (counts[c.type || 'autre'] || 0) + 1;
  const shown = all.filter((c) => (!CT.type || (c.type || 'autre') === CT.type) && contactMatches(c, CT.search));
  const chips = [`<button class="chip${!CT.type ? ' on' : ''}" type="button" data-act="ctType" data-t="">Tous<span class="n">${all.length}</span></button>`]
    .concat(TYPES.filter((t) => counts[t.k]).map((t) => `<button class="chip${CT.type === t.k ? ' on' : ''}" type="button" data-act="ctType" data-t="${t.k}">${t.label}<span class="n">${counts[t.k]}</span></button>`)).join('');
  const list = !all.length ? '<p class="empty">Pas encore de contact. Ajoute-les avec « + Nouveau », ou fais passer un prospect en client depuis la Prospection.</p>'
    : !shown.length ? '<p class="empty">Aucun contact ne correspond.</p>'
    : shown.map((c) => {
      const subl = [c.organisation && c.nom ? c.nom : '', c.fonction, c.localite].filter(Boolean).join(' · ');
      return `<a class="item${c.key === id ? ' sel' : ''}" href="#/contacts/voir/${encodeURIComponent(c.key)}"><span class="who"><strong>${esc(displayName(c))}</strong>${subl ? `<span class="meta">${esc(subl)}</span>` : ''}</span><span class="tpill">${esc(typeLabel(c.type))}</span></a>`;
    }).join('');
  let right = '';
  if (sub === 'nouveau') right = contactForm(null);
  else if (sub === 'modifier' && DB.get(id)) right = contactForm(Object.assign({ key: id }, DB.get(id)));
  else if (sub === 'voir' && DB.get(id)) right = contactFiche(Object.assign({ key: id }, DB.get(id)));
  else if (all.length) right = '<div class="panel"><p class="hint">Choisis un contact pour voir sa fiche, ses factures et le facturer.</p></div>';
  return `<div class="split"><div class="panel">
      <div class="between"><h2>Clients et contacts</h2><a class="btn primary small" href="#/contacts/nouveau">+ Nouveau</a></div>
      ${fld('ct-search', 'Rechercher', `<input id="ct-search" type="search" value="${esc(CT.search)}" placeholder="Nom, organisation, localité, téléphone, note…" autocomplete="off">`)}
      <div class="chips">${chips}</div><div class="items">${list}</div></div>
    <div id="ct-right">${right}</div></div>`;
}
ACTIONS.ctType = (el) => { CT.type = el.dataset.t; render(); };

function lignesContact(c) {
  const copy = (v, what) => v ? `<span>${esc(v)}</span><button class="copy" type="button" data-act="copy" data-v="${esc(v)}" aria-label="Copier ${what}">Copier</button>` : '<span class="meta">—</span>';
  const addr = [street(c), place(c)].filter(Boolean).join(', ') || (c.prospection || {}).adresseTexte || '';
  const tel = String(c.telephone || '').match(/\+?\d[\d\s]{7,}\d/);
  const site = c.site ? (/^https?:/.test(c.site) ? c.site : 'https://' + c.site) : '';
  return `<dl class="dl">
    ${c.organisation && c.nom ? `<dt>Personne</dt><dd>${esc(c.nom)}</dd>` : ''}
    ${c.fonction ? `<dt>Fonction</dt><dd>${esc(c.fonction)}</dd>` : ''}
    <dt>Téléphone</dt><dd>${copy(c.telephone, 'le téléphone')}${tel ? ` <a class="copy" href="tel:${esc(tel[0].replace(/[^+\d]/g, ''))}">Appeler</a>` : ''}</dd>
    <dt>E-mail</dt><dd>${copy(c.email, "l'e-mail")}</dd>
    ${site ? `<dt>Site</dt><dd><a href="${esc(site)}" target="_blank" rel="noopener">${esc(c.site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></dd>` : ''}
    <dt>Adresse</dt><dd>${addr ? copy(addr, "l'adresse") : '<span class="meta">À compléter</span>'}</dd>
  </dl>`;
}
function journalHtml(c) {
  const j = (c.journal || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  if (!j.length) return '<p class="hint">Aucun échange noté.</p>';
  return `<div class="journal">${j.map((e) => `<div class="jl"><div class="between"><span class="hint">${e.date ? fmtDate(e.date) : 'sans date'}${e.par ? ' · ' + esc(nomDe(e.par)) : ''}${e.source ? ' · ' + esc(e.source) : ''}</span>${e.statut ? pillStatut(e.statut) : ''}</div>${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>`).join('')}</div>`;
}
function contactFiche(c) {
  const invs = factures().filter((f) => f.client && f.client.id === c.key).sort((a, b) => String(b.date).localeCompare(a.date));
  const recs = DB.all('rec:').filter((r) => r.contactId === c.key);
  const billed = invs.filter((i) => i.statut !== 'annulee').reduce((a, i) => a + i.total, 0);
  const open = invs.filter((i) => ['ouverte', 'retard'].includes(facStatut(i))).reduce((a, i) => a + i.total, 0);
  return `<div class="panel">
    <div class="between"><div><h2>${esc(displayName(c))}</h2><span class="tpill">${esc(typeLabel(c.type))}</span>${c.devenuClientLe ? ` <span class="hint">client depuis le ${fmtDate(c.devenuClientLe)}</span>` : ''}</div>
      <div class="row"><a class="btn primary" href="#/factures/nouvelle/${encodeURIComponent(c.key)}">Facturer</a><a class="btn" href="#/contacts/modifier/${encodeURIComponent(c.key)}">Modifier</a></div></div>
    ${lignesContact(c)}
    ${c.notes ? `<div><h3>Notes</h3><div class="notes">${esc(c.notes)}</div></div>` : ''}
    <div><h3>Factures</h3>${invs.length ? `<p class="hint">Facturé : <span class="num">${chf(billed)}</span>${open ? ` · à encaisser : <span class="num">${chf(open)}</span>` : ''}</p>
      <div class="table-wrap"><table class="list"><tbody>${invs.map((i) => `<tr class="click" data-act="go" data-href="#/factures/voir/${encodeURIComponent(i.key)}"><td class="num">${esc(i.numero || i.blNumero || 'Vente')}</td><td class="num">${fmtDate(i.date)}</td><td class="r num">${money(i.total)}</td><td><span class="pill ${facStatut(i)}">${esc(facLabel(i))}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">Aucune facture pour ce contact.</p>'}</div>
    ${recs.length ? `<div><h3>Ventes directes</h3><div class="items">${recs.map((r) => `<div class="item" style="cursor:default"><span class="who"><span>${fmtDate(r.date)} · ${esc(r.moyen || '')}</span></span><span class="amt">${chf(r.montant)}</span></div>`).join('')}</div></div>` : ''}
    ${(c.journal || []).length ? `<details class="fold"><summary>Historique de prospection (${c.journal.length})</summary>${(c.prospection || {}).pourquoi ? `<p class="hint">${esc(c.prospection.pourquoi)}</p>` : ''}${journalHtml(c)}</details>` : ''}
    <div class="row-end"><button class="btn small" type="button" data-act="ctVersProspect" data-key="${esc(c.key)}">Remettre en prospection</button><button class="btn danger small" type="button" data-act="ctDel" data-key="${esc(c.key)}">Supprimer ce contact</button></div>
  </div>`;
}
function contactForm(c, prospect) {
  const k = c ? c.key : '';
  c = c || { type: CT.type || 'pro', prospect: !!prospect, prospection: prospect ? { statut: 'À contacter', priorite: 2, categorie: 'Restaurant' } : undefined };
  const p = c.prospection || {}, isP = !!c.prospect;
  const back = k ? (isP ? '#/factures/prospect/' : '#/contacts/voir/') + encodeURIComponent(k) : isP ? '#/factures/prospection' : '#/contacts';
  return `<form class="panel form" data-form="contact"><input type="hidden" name="key" value="${esc(k)}"><input type="hidden" name="prospect" value="${isP ? '1' : ''}">
    <h2>${k ? 'Modifier ' + esc(displayName(c)) : isP ? 'Nouveau prospect' : 'Nouveau contact'}</h2>
    <div class="grid2">
      ${inp('ct-organisation', 'Établissement / organisation', c.organisation, { name: 'organisation', attrs: { maxlength: 90 } })}
      ${inp('ct-nom', 'Personne de contact', c.nom, { name: 'nom', attrs: { maxlength: 70, placeholder: 'facultatif' } })}
      ${inp('ct-fonction', 'Fonction', c.fonction, { name: 'fonction', attrs: { maxlength: 70, placeholder: 'ex. resp. achats, chef' } })}
      ${isP ? sel('ct-pcat', 'Catégorie', p.categorie || 'Autre', CATEGORIES_P.map((x) => [x, x]), { name: 'categorie' }) : sel('ct-type', 'Type', c.type || 'autre', TYPES.map((t) => [t.k, t.label]), { name: 'type' })}
      ${inp('ct-telephone', 'Téléphone', c.telephone, { name: 'telephone', type: 'tel', attrs: { maxlength: 90 } })}
      ${inp('ct-email', 'E-mail', c.email, { name: 'email', attrs: { maxlength: 160 } })}
      ${inp('ct-site', 'Site internet', c.site, { name: 'site', attrs: { maxlength: 120 } })}
    </div>
    <div class="grid2">
      ${inp('ct-rue', 'Rue', c.rue, { name: 'rue', attrs: { maxlength: 70 } })}${inp('ct-numero', 'N°', c.numero, { name: 'numero', attrs: { maxlength: 16 } })}
      ${inp('ct-npa', 'NPA', c.npa, { name: 'npa', attrs: { maxlength: 16 } })}${inp('ct-localite', 'Localité', c.localite, { name: 'localite', attrs: { maxlength: 35 } })}
    </div>
    ${isP ? `<div class="grid2">${sel('ct-prio', 'Priorité', String(p.priorite || 2), [['1', '1 · en premier'], ['2', '2'], ['3', '3 · plus tard']], { name: 'priorite' })}${inp('ct-lieu', 'Lieu', p.lieu, { name: 'lieu' })}</div>
      ${inp('ct-horaires', "Horaires d'appel", p.horaires, { name: 'horaires' })}
      ${txt('ct-pourquoi', 'Pourquoi eux', p.pourquoi, { name: 'pourquoi', rows: 2 })}` : '<p class="hint">Pour une facture par virement, NPA et localité sont obligatoires. La facture est au nom de l\'organisation, « à l\'att. de » la personne.</p>'}
    ${txt('ct-notes', 'Notes', c.notes, { name: 'notes' })}
    <div class="row-end"><a class="btn" href="${back}">Annuler</a><button class="btn primary" type="submit">${k ? 'Enregistrer' : 'Ajouter'}</button></div>
  </form>`;
}
FORMS.contact = (v) => {
  if (!v.nom && !v.organisation) { toast('Donne au moins un nom ou un établissement.'); return; }
  const k = v.key || 'ct:' + uid('c'), old = DB.get(k) || { cree: new Date().toISOString() };
  const o = Object.assign({}, old); for (const f of ['nom', 'organisation', 'fonction', 'telephone', 'email', 'site', 'rue', 'numero', 'npa', 'localite', 'notes']) o[f] = v[f] || '';
  if (v.prospect) {
    o.prospect = true;
    o.prospection = Object.assign({ statut: 'À contacter' }, old.prospection || {}, { categorie: v.categorie, priorite: Number(v.priorite) || 2, lieu: v.lieu, horaires: v.horaires, pourquoi: v.pourquoi });
    o.type = TYPE_DE_CATEGORIE[v.categorie] || 'autre';
  } else o.type = v.type || 'autre';
  DB.put(k, o); toast(v.key ? 'Fiche mise à jour.' : `${displayName(o)} ajouté.`);
  go((o.prospect ? '#/factures/prospect/' : '#/contacts/voir/') + encodeURIComponent(k));
};
ACTIONS.ctDel = (el) => { const c = DB.get(el.dataset.key); confirmSheet('Supprimer ' + displayName(c) + ' ?', 'Ses factures restent intactes. La fiche reste récupérable dans la corbeille (Réglages → Données).', 'ctDelOk', 'Supprimer', { key: el.dataset.key }); };
ACTIONS.ctDelOk = (el) => { const c = DB.get(el.dataset.key); DB.del(el.dataset.key); closeSheet(); toast('Supprimé.'); go(c && c.prospect ? '#/factures/prospection' : '#/contacts'); };
ACTIONS.copy = async (el) => { try { await navigator.clipboard.writeText(el.dataset.v); toast('Copié.'); } catch (e) { toast('Copie impossible : sélectionne le texte à la main.'); } };
ACTIONS.ctVersProspect = (el) => {
  const c = DB.get(el.dataset.key); if (!c) return;
  const j = (c.journal || []).concat([{ date: todayISO(), par: Sync.me || '', statut: 'En cours', note: 'Remis en prospection.' }]);
  DB.put(el.dataset.key, Object.assign({}, c, { prospect: true, journal: j, prospection: Object.assign({ categorie: 'Autre', priorite: 2 }, c.prospection || {}, { statut: 'En cours' }) }));
  go('#/factures/prospect/' + encodeURIComponent(el.dataset.key));
};

/* ================= Prospection ================= */
function renderProspection(sub, id) {
  const all = prospects();
  const g = (c) => groupeStatut(pStat(c));
  const cnt = { afaire: 0, relance: 0, discussion: 0, valide: 0, clos: 0 }; all.forEach((c) => { cnt[g(c)]++; });
  const dus = all.filter(aRelancer);
  const filtre = (c) => {
    if (PR.groupe === 'actifs') { if (['clos', 'valide'].includes(g(c))) return false; }
    else if (PR.groupe !== 'tous' && g(c) !== PR.groupe) return false;
    if (PR.prio && String((c.prospection || {}).priorite) !== PR.prio) return false;
    if (PR.categorie && (c.prospection || {}).categorie !== PR.categorie) return false;
    return contactMatches(c, PR.search);
  };
  const ordre = { relance: 0, discussion: 1, afaire: 2, valide: 3, clos: 4 };
  const shown = all.filter(filtre).sort((a, b) => (aRelancer(b) ? 1 : 0) - (aRelancer(a) ? 1 : 0) || ((a.prospection || {}).priorite || 9) - ((b.prospection || {}).priorite || 9) || ordre[g(a)] - ordre[g(b)] || byName(a, b));
  const nGroupe = (k) => k === 'actifs' ? all.filter((c) => !['clos', 'valide'].includes(g(c))).length : k === 'tous' ? all.length : cnt[k];
  const chips = GROUPES_P.map(([k, l]) => `<button class="chip${PR.groupe === k ? ' on' : ''}" type="button" data-act="prGroupe" data-k="${k}">${l}<span class="n">${nGroupe(k)}</span></button>`).join('');
  const prios = ['1', '2', '3'].map((x) => `<button class="chip${PR.prio === x ? ' on' : ''}" type="button" data-act="prPrio" data-k="${x}">Priorité ${x}</button>`).join('');
  const cats = [...new Set(all.map((c) => (c.prospection || {}).categorie).filter(Boolean))].sort();
  const list = !all.length ? '<p class="empty">Aucun prospect. Ajoute-en avec « + Prospect », ou importe le fichier de prospection (Réglages → Données).</p>'
    : !shown.length ? '<p class="empty">Aucun prospect ne correspond à ces filtres.</p>'
    : shown.map((c) => {
      const p = c.prospection || {}, last = dernierContact(c);
      return `<a class="item prow${c.key === id ? ' sel' : ''}${aRelancer(c) ? ' due' : ''}" href="#/factures/prospect/${encodeURIComponent(c.key)}">
        <span class="prio p${p.priorite || 0}" title="Priorité ${p.priorite || '—'}">${p.priorite || '·'}</span>
        <span class="who"><strong>${esc(displayName(c))}</strong><span class="meta">${esc([p.categorie, p.lieu || c.localite].filter(Boolean).join(' · '))}${aRelancer(c) ? ` · <b class="err">à relancer (${fmtDateCourt(p.relanceLe)})</b>` : last ? ` · dernier échange ${fmtDateCourt(last)}` : ''}</span></span>
        ${pillStatut(pStat(c))}</a>`;
    }).join('');
  let right = '';
  if (sub === 'prospect' && id === 'nouveau') right = contactForm(null, true);
  else if (sub === 'prospect' && DB.get(id)) right = ficheProspect(Object.assign({ key: id }, DB.get(id)));
  else if (sub === 'convertir' && DB.get(id)) right = formConversion(Object.assign({ key: id }, DB.get(id)));
  else if (sub === 'modifier' && DB.get(id)) right = contactForm(Object.assign({ key: id }, DB.get(id)));
  else right = '<div class="panel"><p class="hint">Choisis un prospect pour voir sa fiche et noter un appel.</p></div>';
  return `${pitchBox()}<div class="stats">
      <div class="stat good"><span class="k">À contacter</span><span class="v">${cnt.afaire}</span></div>
      <div class="stat blue"><span class="k">À relancer</span><span class="v">${cnt.relance}</span><span class="s ${dus.length ? 'err' : ''}">${dus.length ? `${dus.length} relance${dus.length > 1 ? 's' : ''} prévue${dus.length > 1 ? 's' : ''} aujourd'hui ou avant` : 'pas joignable, à rappeler, mail envoyé'}</span></div>
      <div class="stat good"><span class="k">En discussion</span><span class="v">${cnt.discussion}</span><span class="s">intéressés, en cours</span></div>
      <div class="stat"><span class="k">Validés</span><span class="v">${cnt.valide}</span><span class="s">${((n) => `${n} déjà passé${n > 1 ? 's' : ''} en client${n > 1 ? 's' : ''}`)(contacts().filter((c) => c.devenuClientLe || (c.prospection || {}).statut === 'Validé').length)}</span></div>
    </div>
    <div class="split wide-left"><div class="panel">
      <div class="between"><h2>Prospection</h2><a class="btn primary small" href="#/factures/prospect/nouveau">+ Prospect</a></div>
      <div class="grid2">${fld('pr-search', 'Rechercher', `<input id="pr-search" type="search" value="${esc(PR.search)}" placeholder="Nom, lieu, note…" autocomplete="off">`)}
        ${sel('pr-cat', 'Catégorie', PR.categorie, [['', 'Toutes']].concat(cats.map((x) => [x, x])))}</div>
      <div class="chips">${chips}</div><div class="chips">${prios}</div>
      <div class="items">${list}</div></div>
      <div id="ct-right">${right}</div></div>`;
}
ACTIONS.prGroupe = (el) => { PR.groupe = el.dataset.k; render(); };
ACTIONS.prPrio = (el) => { PR.prio = PR.prio === el.dataset.k ? '' : el.dataset.k; render(); };

/* Le dernier échange du journal, affiché en haut de la fiche */
function dernierEchange(c) {
  const j = (c.journal || []).map((e, i) => [e, i]).sort((a, b) => String(b[0].date || '').localeCompare(String(a[0].date || '')) || b[1] - a[1]);
  if (!j.length) return '<div class="lastj vide"><span class="hint">Aucun échange noté pour l\'instant.</span></div>';
  const e = j[0][0];
  return `<div class="lastj"><div class="between"><span class="hint"><b>Dernier échange</b> · ${e.date ? fmtDate(e.date) : 'sans date'}${e.par ? ' · ' + esc(nomDe(e.par)) : ''}</span>${e.statut ? pillStatut(e.statut) : ''}</div>${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>`;
}
function ficheProspect(c) {
  const p = c.prospection || {}, st = pStat(c), g = groupeStatut(st);
  return `<div class="panel">
    <div class="between"><div><h2>${esc(displayName(c))}</h2><div class="row">${pillStatut(st)}<span class="tpill">${esc(p.categorie || '—')}</span>${p.priorite ? `<span class="tpill">Priorité ${p.priorite}</span>` : ''}</div></div>
      <div class="row"><a class="btn primary" href="#/factures/convertir/${encodeURIComponent(c.key)}">Devenir client</a><a class="btn" href="#/factures/pmodifier/${encodeURIComponent(c.key)}">Modifier</a></div></div>
    ${dernierEchange(c)}
    ${p.horaires ? `<div class="banner callhours"><span><b>Quand appeler :</b> ${esc(p.horaires)}</span></div>` : ''}
    ${lignesContact(c)}
    ${p.pourquoi ? `<div><h3>Pourquoi eux</h3><p class="hint" style="color:var(--ink)">${esc(p.pourquoi)}</p></div>` : ''}
    ${c.notes ? `<div><h3>Notes</h3><div class="notes">${esc(c.notes)}</div></div>` : ''}
    <form class="callbox form" data-form="appel"><input type="hidden" name="key" value="${esc(c.key)}">
      <h3>Noter un appel ou un échange</h3>
      <div class="seg">${STATUTS_P.map(([s, gg]) => `<label class="ps-${gg}"><input type="radio" name="statut" value="${esc(s)}"${s === st ? ' checked' : ''}> ${esc(s)}</label>`).join('')}</div>
      ${txt('ap-note', 'Ce qui a été dit', '', { name: 'note', rows: 3 })}
      <div class="grid2">${inp('ap-date', 'Date', todayISO(), { name: 'date', type: 'date' })}${inp('ap-rel', 'Relancer le', p.relanceLe || '', { name: 'relanceLe', type: 'date', sub: 'Apparaît sur l\'accueil et dans le calendrier.' })}</div>
      <div class="row-end"><button class="btn primary" type="submit">Enregistrer l'échange</button></div>
    </form>
    <div><h3>Journal</h3>${journalHtml(c)}</div>
    ${p.source ? `<p class="hint">Source : <a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50))}</a></p>` : ''}
    <div class="row-end">${g !== 'clos' ? `<button class="btn small" type="button" data-act="prClore" data-key="${esc(c.key)}">Pas intéressé</button>` : ''}<button class="btn danger small" type="button" data-act="ctDel" data-key="${esc(c.key)}">Supprimer</button></div>
  </div>`;
}
FORMS.appel = (v) => {
  const c = DB.get(v.key); if (!c) return;
  const e = { date: v.date || todayISO(), par: Sync.me || '', statut: v.statut, note: v.note };
  const j = (c.journal || []).concat([e]);
  const relance = groupeStatut(v.statut) === 'clos' ? '' : v.relanceLe;
  DB.put(v.key, Object.assign({}, c, { journal: j, prospection: Object.assign({}, c.prospection || {}, { statut: v.statut, relanceLe: relance }) }));
  toast('Échange noté.' + (groupeStatut(v.statut) === 'valide' ? ' Tu peux maintenant le passer en client.' : ''), 4000);
  render();
};
ACTIONS.prClore = (el) => {
  const c = DB.get(el.dataset.key); if (!c) return;
  DB.put(el.dataset.key, Object.assign({}, c, { journal: (c.journal || []).concat([{ date: todayISO(), par: Sync.me || '', statut: 'Pas intéressé', note: '' }]), prospection: Object.assign({}, c.prospection || {}, { statut: 'Pas intéressé', relanceLe: '' }) }));
  toast('Marqué « pas intéressé ».');
};

/* ---------- Passage en client ---------- */
function formConversion(c) {
  const p = c.prospection || {};
  return `<form class="panel form" data-form="convertir"><input type="hidden" name="key" value="${esc(c.key)}">
    <h2>${esc(displayName(c))} devient client</h2>
    <p class="hint">Sa fiche passe dans « Clients et contacts », avec tout son journal d'appels. Vérifie le type (il fixe les prix sur les factures) et l'adresse (nécessaire pour une facture QR).</p>
    ${sel('cv-type', 'Type de client', c.type || TYPE_DE_CATEGORIE[p.categorie] || 'pro', TYPES.map((t) => [t.k, t.label]), { name: 'type' })}
    <div class="grid2">
      ${inp('cv-org', 'Nom sur la facture', c.organisation || c.nom, { name: 'organisation' })}${inp('cv-nom', "À l'attention de", c.organisation ? c.nom : '', { name: 'nom' })}
      ${inp('cv-rue', 'Rue', c.rue, { name: 'rue' })}${inp('cv-num', 'N°', c.numero, { name: 'numero' })}
      ${inp('cv-npa', 'NPA', c.npa, { name: 'npa' })}${inp('cv-loc', 'Localité', c.localite || p.lieu, { name: 'localite' })}
    </div>
    ${p.adresseTexte ? `<p class="hint">Adresse notée dans le tableur : ${esc(p.adresseTexte)}</p>` : ''}
    ${txt('cv-note', 'Note', '', { name: 'note', rows: 2, sub: 'Ex. première commande : 10 kg de butternut' })}
    <div class="row-end"><a class="btn" href="#/factures/prospect/${encodeURIComponent(c.key)}">Annuler</a><button class="btn" type="submit" name="ensuite" value="fiche">Passer en client</button><button class="btn primary" type="submit" name="ensuite" value="facture">Passer en client et facturer</button></div>
  </form>`;
}
FORMS.convertir = (v, form) => {
  const c = DB.get(v.key); if (!c) return;
  const ensuite = (form.querySelector('button[type=submit]:focus') || {}).value || form._ensuite || 'fiche';
  const j = (c.journal || []).concat([{ date: todayISO(), par: Sync.me || '', statut: 'Validé', note: 'Devenu client.' + (v.note ? ' ' + v.note : '') }]);
  DB.put(v.key, Object.assign({}, c, { prospect: false, type: v.type, organisation: v.organisation, nom: v.nom, rue: v.rue, numero: v.numero, npa: v.npa, localite: v.localite, devenuClientLe: todayISO(), journal: j, prospection: Object.assign({}, c.prospection || {}, { statut: 'Validé', relanceLe: '' }) }));
  toast(`${v.organisation || v.nom} est maintenant client.`);
  go(ensuite === 'facture' ? '#/factures/nouvelle/' + encodeURIComponent(v.key) : '#/contacts/voir/' + encodeURIComponent(v.key));
};
document.addEventListener('click', (e) => { const b = e.target.closest('form[data-form="convertir"] button[type=submit]'); if (b) b.form._ensuite = b.value; }, true);

/* ---------- Pitch d'appel (modifiable) ---------- */
const PITCH_DEFAUT = "1. Qui : « Bonjour, je suis [prénom], maraîcher à Marly, Gamins de Talus. »\n2. Quoi : « J'ai cette saison des patates douces et des courges de Marly, en quantité. »\n3. Pour eux : « Vous travaillez local et de saison, je me suis dit que ça pourrait vous intéresser. »\n4. Question : « Qui s'occupe des achats de légumes chez vous, et quel est le meilleur moment pour en parler ? »\n5. Suite : proposer de passer avec un échantillon, ou envoyer prix et quantités par mail.";
/* Boîte « pitch et prix », repliable, en haut de la prospection */
function pitchBox() {
  const P = DB.get('cfg:prospection') || {}, ouvert = ls.get('gdt-pitch-ouvert') === '1';
  const prods = produits(), cols = TARIFS.filter(([k]) => prods.some((p) => !vide((p.prixParType || {})[k])));
  const prix = prods.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Produit</th><th class="r">Fourchette</th>${cols.map(([, l]) => `<th class="r">${esc(l.replace(/ \(.*\)/, ''))}</th>`).join('')}</tr></thead><tbody>
    ${prods.map((p) => `<tr><td>${esc(p.nom)}${p.remarque ? `<br><span class="hint">${esc(p.remarque)}</span>` : ''}</td><td class="r num" style="white-space:nowrap">${fourchette(p) || '—'}</td>${cols.map(([k]) => `<td class="r num">${vide((p.prixParType || {})[k]) ? '—' : money(p.prixParType[k])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="hint">CHF par ${esc(prods[0].unite || 'kg')}. À modifier dans Factures → <a href="#/factures/produits">Produits et prix</a>.</p>` : '<p class="hint">Aucun produit. Ajoute-les dans Factures → Produits et prix.</p>';
  return `<details class="pitchbox" id="pitchbox"${ouvert ? ' open' : ''}><summary><span>Pitch d'appel et prix</span><span class="hint">${ouvert ? 'fermer' : 'ouvrir'}</span></summary>
    <div class="split"><div class="form"><div class="between"><h3>Pitch</h3><button class="btn small" type="button" data-act="pitchEdit">Modifier</button></div>
      <div class="notes">${esc(P.pitch || PITCH_DEFAUT)}</div>${P.memo ? `<h3>À avoir sous la main</h3><div class="notes">${esc(P.memo)}</div>` : ''}</div>
      <div class="form"><h3>Prix</h3>${prix}</div></div></details>`;
}
ACTIONS.pitchEdit = () => {
  const P = DB.get('cfg:prospection') || {};
  openSheet(`${sheetHead("Pitch d'appel")}<form class="sbody form" data-form="pitch">${txt('pi-p', 'Pitch', P.pitch || PITCH_DEFAUT, { name: 'pitch', rows: 8 })}${txt('pi-m', 'À avoir sous la main', P.memo, { name: 'memo', rows: 5 })}<div class="row-end"><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
FORMS.pitch = (v) => { DB.put('cfg:prospection', Object.assign({}, DB.get('cfg:prospection') || {}, { pitch: v.pitch, memo: v.memo })); closeSheet(); toast('Pitch enregistré.'); };

/* Pour l'accueil et le calendrier */
function relancesProspection(de, a) { return prospects().filter((c) => { const r = (c.prospection || {}).relanceLe; return r && r >= de && r <= a && !['clos', 'valide'].includes(groupeStatut(pStat(c))); }); }
