/* Gamins de Talus — contacts : clients, grossistes, fournisseurs, partenaires. */
'use strict';

const TYPES = [
  { k: 'grossiste', label: 'Grossiste' }, { k: 'pro', label: 'Client pro' }, { k: 'particulier', label: 'Particulier' },
  { k: 'fournisseur', label: 'Fournisseur' }, { k: 'partenaire', label: 'Partenaire' }, { k: 'autre', label: 'Autre' },
];
const typeLabel = (k) => (TYPES.find((t) => t.k === k) || { label: 'Autre' }).label;
const billName = (c) => (c.organisation || c.nom || '').trim();
const attnName = (c) => (c.organisation && c.nom ? c.nom.trim() : '');
const displayName = (c) => c.nom || c.organisation || 'Sans nom';
const byName = (a, b) => displayName(a).localeCompare(displayName(b), 'fr', { sensitivity: 'base' });
const contacts = () => DB.all('ct:');
const CT = { search: '', type: '' };

function contactMatches(c, q) {
  if (!q) return true;
  const hay = [c.nom, c.organisation, c.fonction, c.localite, c.npa, c.email, c.telephone, c.notes, typeLabel(c.type)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

MODULES.contacts = {
  titre: 'Contacts',
  tuile() { const n = contacts().length; return { line: n ? `${n} contact${n > 1 ? 's' : ''}` : 'Aucun contact' }; },
  render(sub, id) {
    const all = contacts().sort(byName);
    const counts = {}; for (const c of all) counts[c.type || 'autre'] = (counts[c.type || 'autre'] || 0) + 1;
    const shown = all.filter((c) => (!CT.type || (c.type || 'autre') === CT.type) && contactMatches(c, CT.search));
    const chips = [`<button class="chip${!CT.type ? ' on' : ''}" type="button" data-act="ctType" data-t="">Tous<span class="n">${all.length}</span></button>`]
      .concat(TYPES.filter((t) => counts[t.k]).map((t) => `<button class="chip${CT.type === t.k ? ' on' : ''}" type="button" data-act="ctType" data-t="${t.k}">${t.label}<span class="n">${counts[t.k]}</span></button>`)).join('');
    const list = !all.length ? '<p class="empty">Pas encore de contact. Clients, grossistes, fournisseurs, commune : ajoute-les avec « + Nouveau ».</p>'
      : !shown.length ? '<p class="empty">Aucun contact ne correspond.</p>'
      : shown.map((c) => {
        const subl = [c.organisation && c.nom ? c.organisation : '', c.fonction, c.localite].filter(Boolean).join(' · ');
        return `<a class="item${c.key === id ? ' sel' : ''}" href="#/contacts/voir/${encodeURIComponent(c.key)}"><span class="who"><strong>${esc(displayName(c))}</strong>${subl ? `<span class="meta">${esc(subl)}</span>` : ''}</span><span class="tpill">${esc(typeLabel(c.type))}</span></a>`;
      }).join('');
    let right = '';
    if (sub === 'nouveau') right = contactForm(null);
    else if (sub === 'modifier' && DB.get(id)) right = contactForm(Object.assign({ key: id }, DB.get(id)));
    else if (sub === 'voir' && DB.get(id)) right = contactFiche(Object.assign({ key: id }, DB.get(id)));
    else if (all.length) right = '<div class="panel"><p class="hint">Choisis un contact pour voir sa fiche, ses factures et le facturer.</p></div>';
    return `<div class="split"><div class="panel">
        <div class="between"><h2>Contacts</h2><a class="btn primary small" href="#/contacts/nouveau">+ Nouveau</a></div>
        ${fld('ct-search', 'Rechercher', `<input id="ct-search" type="search" value="${esc(CT.search)}" placeholder="Nom, organisation, localité, téléphone, note…" autocomplete="off">`)}
        <div class="chips">${chips}</div><div class="items" id="ct-list">${list}</div></div>
      <div id="ct-right">${right}</div></div>`;
  },
  after(sub) {
    const s = $('ct-search');
    if (s) s.addEventListener('input', () => { CT.search = s.value; const pos = s.selectionStart; render(); const n = $('ct-search'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* */ } });
    if ((sub === 'voir' || sub === 'nouveau' || sub === 'modifier') && innerWidth < 900) $('ct-right').scrollIntoView({ block: 'start' });
  },
};
ACTIONS.ctType = (el) => { CT.type = el.dataset.t; render(); };

function contactFiche(c) {
  const copy = (v, what) => v ? `<span>${esc(v)}</span><button class="copy" type="button" data-act="copy" data-v="${esc(v)}" aria-label="Copier ${what}">Copier</button>` : '<span class="meta">—</span>';
  const addr = [street(c), place(c)].filter(Boolean).join(', ');
  const invs = factures().filter((f) => f.client && f.client.id === c.key).sort((a, b) => String(b.date).localeCompare(a.date));
  const recs = DB.all('rec:').filter((r) => r.contactId === c.key);
  const billed = invs.filter((i) => i.statut !== 'annulee').reduce((a, i) => a + i.total, 0);
  const open = invs.filter((i) => ['ouverte', 'retard'].includes(facStatut(i))).reduce((a, i) => a + i.total, 0);
  return `<div class="panel">
    <div class="between"><div><h2>${esc(displayName(c))}</h2><span class="tpill">${esc(typeLabel(c.type))}</span></div>
      <div class="row"><a class="btn primary" href="#/factures/nouvelle/${encodeURIComponent(c.key)}">Facturer</a><a class="btn" href="#/contacts/modifier/${encodeURIComponent(c.key)}">Modifier</a></div></div>
    <dl class="dl">
      ${c.organisation && c.nom ? `<dt>Organisation</dt><dd>${esc(c.organisation)}</dd>` : ''}
      ${c.fonction ? `<dt>Fonction</dt><dd>${esc(c.fonction)}</dd>` : ''}
      <dt>Téléphone</dt><dd>${copy(c.telephone, 'le téléphone')}${c.telephone ? ` <a class="copy" href="tel:${esc(c.telephone.replace(/[^+\d]/g, ''))}">Appeler</a>` : ''}</dd>
      <dt>E-mail</dt><dd>${copy(c.email, "l'e-mail")}</dd>
      <dt>Adresse</dt><dd>${addr ? copy(addr, "l'adresse") : '<span class="meta">À compléter pour facturer par virement</span>'}</dd>
    </dl>
    ${c.notes ? `<div><h3>Notes</h3><div class="notes">${esc(c.notes)}</div></div>` : ''}
    <div><h3>Factures</h3>${invs.length ? `<p class="hint">Facturé : <span class="num">${chf(billed)}</span>${open ? ` · à encaisser : <span class="num">${chf(open)}</span>` : ''}</p>
      <div class="table-wrap"><table class="list"><tbody>${invs.map((i) => `<tr class="click" data-act="go" data-href="#/factures/voir/${encodeURIComponent(i.key)}"><td class="num">${esc(i.numero)}</td><td class="num">${fmtDate(i.date)}</td><td class="r num">${money(i.total)}</td><td><span class="pill ${facStatut(i)}">${esc(facLabel(i))}</span></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">Aucune facture pour ce contact.</p>'}</div>
    ${recs.length ? `<div><h3>Ventes directes</h3><div class="items">${recs.map((r) => `<div class="item" style="cursor:default"><span class="who"><span>${fmtDate(r.date)} · ${esc(r.moyen || '')}</span></span><span class="amt">${chf(r.montant)}</span></div>`).join('')}</div></div>` : ''}
    <div class="row-end"><button class="btn danger small" type="button" data-act="ctDel" data-key="${esc(c.key)}">Supprimer ce contact</button></div>
  </div>`;
}
function contactForm(c) {
  const k = c ? c.key : '';
  c = c || { type: CT.type || 'pro' };
  return `<form class="panel form" data-form="contact"><input type="hidden" name="key" value="${esc(k)}">
    <h2>${k ? 'Modifier ' + esc(displayName(c)) : 'Nouveau contact'}</h2>
    <div class="grid2">
      ${inp('ct-nom', 'Nom', c.nom, { name: 'nom', attrs: { maxlength: 70, placeholder: 'Personne ou établissement' } })}
      ${inp('ct-organisation', 'Organisation', c.organisation, { name: 'organisation', attrs: { maxlength: 70, placeholder: 'facultatif' } })}
      ${inp('ct-fonction', 'Fonction', c.fonction, { name: 'fonction', attrs: { maxlength: 70, placeholder: 'facultatif' } })}
      ${sel('ct-type', 'Type', c.type || 'autre', TYPES.map((t) => [t.k, t.label]), { name: 'type' })}
      ${inp('ct-telephone', 'Téléphone', c.telephone, { name: 'telephone', type: 'tel', attrs: { maxlength: 30 } })}
      ${inp('ct-email', 'E-mail', c.email, { name: 'email', type: 'email', attrs: { maxlength: 80 } })}
    </div>
    <div class="grid2">
      ${inp('ct-rue', 'Rue', c.rue, { name: 'rue', attrs: { maxlength: 70 } })}${inp('ct-numero', 'N°', c.numero, { name: 'numero', attrs: { maxlength: 16 } })}
      ${inp('ct-npa', 'NPA', c.npa, { name: 'npa', attrs: { maxlength: 16 } })}${inp('ct-localite', 'Localité', c.localite, { name: 'localite', attrs: { maxlength: 35 } })}
    </div>
    <p class="hint">Pour une facture par virement, NPA et localité sont obligatoires. Si une organisation est remplie, la facture est à son nom, « à l'att. de » la personne.</p>
    ${txt('ct-notes', 'Notes', c.notes, { name: 'notes' })}
    <div class="row-end"><a class="btn" href="${k ? '#/contacts/voir/' + encodeURIComponent(k) : '#/contacts'}">Annuler</a><button class="btn primary" type="submit">${k ? 'Enregistrer' : 'Ajouter le contact'}</button></div>
  </form>`;
}
FORMS.contact = (v) => {
  if (!v.nom && !v.organisation) { toast('Donne au moins un nom ou une organisation.'); return; }
  const k = v.key || 'ct:' + uid('c'), old = DB.get(k) || { cree: new Date().toISOString() };
  const o = Object.assign({}, old); for (const f of ['nom', 'organisation', 'fonction', 'type', 'telephone', 'email', 'rue', 'numero', 'npa', 'localite', 'notes']) o[f] = v[f] || '';
  DB.put(k, o); toast(v.key ? 'Contact mis à jour.' : `${displayName(o)} ajouté.`);
  go('#/contacts/voir/' + encodeURIComponent(k));
};
ACTIONS.ctDel = (el) => { const c = DB.get(el.dataset.key); confirmSheet('Supprimer ' + displayName(c) + ' ?', 'Ses factures restent intactes. Le contact reste récupérable dans la corbeille (Réglages).', 'ctDelOk', 'Supprimer', { key: el.dataset.key }); };
ACTIONS.ctDelOk = (el) => { DB.del(el.dataset.key); closeSheet(); toast('Contact supprimé.'); go('#/contacts'); };
ACTIONS.copy = async (el) => {
  try { await navigator.clipboard.writeText(el.dataset.v); toast('Copié.'); }
  catch (e) { toast('Copie impossible : sélectionne le texte à la main.'); }
};
