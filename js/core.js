/* Gamins de Talus — noyau : réglages, données, synchro, interface commune. */
'use strict';

/* ================= Configuration ================= */
const SB_URL = 'https://faouvytsqxridrwffrth.supabase.co';
const SB_KEY = 'sb_publishable_EQKYeWZcBAPl_PjuMdfQjw_iRrc_7ak';
const LOCAL_MODE = /[?&]local=1/.test(location.search) || !SB_URL; // mode essai : tout reste dans ce navigateur

/* ================= Petits outils ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => isoDate(new Date());
const fmtDate = (iso) => iso ? String(iso).slice(8, 10) + '.' + String(iso).slice(5, 7) + '.' + String(iso).slice(0, 4) : '';
const fmtDateCourt = (iso) => iso ? String(iso).slice(8, 10) + '.' + String(iso).slice(5, 7) : '';
const group = (n, sep, dec = 2) => { const neg = n < 0; const [i, d] = Math.abs(r2(n)).toFixed(dec).split('.'); return (neg ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (dec ? '.' + d : ''); };
const money = (n) => group(Number(n) || 0, '’');
const chf = (n) => 'CHF ' + money(n);
const fmtH = (n) => { n = Number(n) || 0; return (Math.round(n * 100) / 100).toString().replace('.', ','); };
const fmtNum = (n, dec = 0) => group(Number(n) || 0, '’', dec);
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const street = (o) => [o.rue, o.numero].filter(Boolean).join(' ');
const place = (o) => [o.npa, o.localite].filter(Boolean).join(' ');
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* plein ou bloqué */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } } };

function toast(msg, ms = 3200) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }

/* ================= Données ================= */
/* Chaque élément est une ligne « clé → objet ». Préfixes :
   cfg:   réglages        ct:  contacts      prod: produits        fac: factures
   dep:   dépenses        rec: recettes      reg:  remboursements entre associés
   h:     heures (h:AAAA-MM-JJ:personne)     jour: remarque du jour (jour:AAAA-MM-JJ)
   t:     tâches          cul: cultures      inv:  inventaire      achat: achats prévus */
const DB = {
  data: {},          // clé → objet
  sig: {},           // clé → texte canonique (pour savoir ce qui a changé)
  trash: {},         // clé → dernier contenu des éléments supprimés (corbeille)
  dirty: new Set(),  // clés à envoyer
  lastPull: null,
  get(k) { return this.data[k]; },
  all(prefix) { const out = []; for (const k in this.data) if (k.startsWith(prefix)) out.push(Object.assign({ key: k }, this.data[k])); return out; },
  put(k, obj) {
    const clean = JSON.parse(JSON.stringify(obj)); delete clean.key;
    const s = canon(clean); if (this.sig[k] === s) return false;
    this.data[k] = clean; this.sig[k] = s; delete this.trash[k];
    this.dirty.add(k); Sync.changed(); return true;
  },
  del(k) {
    if (!(k in this.data)) return false;
    this.trash[k] = Object.assign({ _supprimeLe: new Date().toISOString(), _supprimePar: Sync.me || '' }, this.data[k]);
    delete this.data[k]; delete this.sig[k];
    this.dirty.add(k); Sync.changed(); return true;
  },
  restore(k) { const d = this.trash[k]; if (!d) return false; const c = Object.assign({}, d); delete c._supprimeLe; delete c._supprimePar; delete this.trash[k]; this.put(k, c); return true; },
};
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x === undefined ? null : x)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/* ================= Synchro Supabase (même principe que l'Établi) ================= */
const Sync = {
  sb: null, uid: null, email: '', me: '', pushing: false, timer: null, err: '', lastOk: null,
  cacheKey() { return 'gdt-cache-' + (this.uid || 'local'); },
  persist() { ls.set(this.cacheKey(), JSON.stringify({ data: DB.data, trash: DB.trash, dirty: [...DB.dirty], lastPull: DB.lastPull, email: this.email, me: this.me })); },
  loadCache() {
    let c = null; try { c = JSON.parse(ls.get(this.cacheKey()) || 'null'); } catch (e) { c = null; }
    if (!c) return false;
    DB.data = c.data || {}; DB.trash = c.trash || {}; DB.dirty = new Set(c.dirty || []); DB.lastPull = c.lastPull || null;
    DB.sig = {}; for (const k in DB.data) DB.sig[k] = canon(DB.data[k]);
    if (c.me && !this.me) this.me = c.me;
    return true;
  },
  changed() { if (LOCAL_MODE) DB.dirty.clear(); this.persist(); this.schedule(); UI.status(); UI.dataChanged(); },
  schedule(d) { if (LOCAL_MODE) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.push(), d == null ? 1200 : d); },
  async push() {
    if (LOCAL_MODE || !this.sb || !this.uid || this.pushing || !DB.dirty.size) { UI.status(); return; }
    if (!navigator.onLine) { UI.status(); return; }
    this.pushing = true; UI.status('envoi');
    const keys = [...DB.dirty].slice(0, 200), sent = {};
    const rows = keys.map((k) => { sent[k] = DB.sig[k] ?? ('del:' + canon(DB.trash[k] ?? null)); return (k in DB.data) ? { key: k, data: DB.data[k], deleted: false } : { key: k, data: DB.trash[k] ?? null, deleted: true }; });
    try {
      const { error } = await this.sb.from('rows').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
      keys.forEach((k) => { const now = DB.sig[k] ?? ('del:' + canon(DB.trash[k] ?? null)); if (now === sent[k]) DB.dirty.delete(k); });
      this.persist(); this.lastOk = Date.now(); this.err = ''; this.pushing = false; UI.status();
      if (DB.dirty.size) this.schedule(300);
    } catch (e) { this.pushing = false; this.err = (e && e.message) || String(e); UI.status(); this.schedule(15000); }
  },
  async pull(full) {
    if (LOCAL_MODE || !this.sb || !this.uid) return false;
    if (!navigator.onLine) { UI.status(); return false; }
    try {
      const since = full ? null : DB.lastPull; let changed = false, maxTs = DB.lastPull, from = 0;
      for (;;) {
        let q = this.sb.from('rows').select('key,data,deleted,updated_at').order('updated_at', { ascending: true }).range(from, from + 999);
        if (since) q = q.gte('updated_at', since);
        const { data, error } = await q; if (error) throw error;
        for (const r of data) {
          if (!maxTs || r.updated_at > maxTs) maxTs = r.updated_at;
          if (DB.dirty.has(r.key)) continue;
          if (r.deleted || r.data == null) {
            if (r.key in DB.data) { delete DB.data[r.key]; delete DB.sig[r.key]; changed = true; }
            if (r.data) DB.trash[r.key] = r.data;
          } else {
            const s = canon(r.data);
            if (DB.sig[r.key] !== s) { DB.data[r.key] = r.data; DB.sig[r.key] = s; changed = true; }
            delete DB.trash[r.key];
          }
        }
        if (data.length < 1000) break; from += 1000;
      }
      DB.lastPull = maxTs; this.persist(); this.lastOk = Date.now(); this.err = ''; UI.status();
      if (changed) UI.dataChanged();
      return true;
    } catch (e) { this.err = (e && e.message) || String(e); UI.status(); return false; }
  },
  async history(key) {
    if (LOCAL_MODE || !this.sb) return [];
    const { data, error } = await this.sb.from('rows_history').select('data,deleted,changed_at,changed_by').eq('key', key).order('changed_at', { ascending: false }).limit(50);
    if (error) throw error; return data;
  },
};

/* ================= Réglages et personnes ================= */
const DEFAULT_CFG = {
  nom: 'Gamins de Talus', titulaire: '', rue: '', numero: '', npa: '', localite: '', telephone: '', email: '',
  iban: '', delai: 30, prefixe: 'GDT', mention: 'Non assujetti à la TVA',
  personnes: [{ k: 'nicolas', nom: 'Nicolas', part: 1 }, { k: 'noe', nom: 'Noé', part: 1 }],
  compteDe: 'nicolas', objectifAnnuel: 10000, amortirDesAchat: false,
};
function cfg() { return Object.assign({}, DEFAULT_CFG, DB.get('cfg:reglages') || {}); }
function personnes() { return cfg().personnes || DEFAULT_CFG.personnes; }
function nomDe(k) { if (k === 'ensemble') return 'Ensemble'; const p = personnes().find((x) => x.k === k); return p ? p.nom : (k || '—'); }

/* ================= Interface commune ================= */
const ACTIONS = {};   // data-act="nom" → fonction(el, ev)
const FORMS = {};     // data-form="nom" → fonction(valeurs, form)
const MODULES = {};   // nom → { titre, render(sub, id), tuile() }
const ROUTE = { mod: '', sub: '', id: '' };

const UI = {
  pending: false,
  status(force) {
    const el = $('sync'); if (!el) return;
    let cls = 'ok', txt = 'Enregistré', tip = 'Tout est enregistré';
    if (LOCAL_MODE) { cls = 'off'; txt = 'Mode essai'; tip = 'Mode essai : les données restent dans ce navigateur'; }
    else if (!navigator.onLine) { cls = 'off'; txt = 'Hors ligne' + (DB.dirty.size ? ' · ' + DB.dirty.size : ''); tip = 'Hors ligne : les changements partiront au retour du réseau'; }
    else if (Sync.err) { cls = 'err'; txt = 'Problème' + (DB.dirty.size ? ' · ' + DB.dirty.size : ''); tip = 'Problème de synchro : ' + Sync.err; }
    else if (force === 'envoi' || DB.dirty.size) { cls = 'pend'; txt = 'Envoi…' + (DB.dirty.size ? ' ' + DB.dirty.size : ''); tip = 'Envoi en cours'; }
    el.className = 'sync ' + cls; el.textContent = txt; el.title = tip;
  },
  /* Différé d'un instant : pendant un « change », le navigateur n'a pas encore déplacé le focus vers la case suivante. */
  dataChanged() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      const a = document.activeElement;
      if (a && $('view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { this.pending = true; return; }
      render();
    }, 0);
  },
};
document.addEventListener('focusout', () => { setTimeout(() => { if (UI.pending) { const a = document.activeElement; if (!(a && $('view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { UI.pending = false; render(); } } }, 0); });

/* Ré-affiche la page en gardant la case où l'on est (pour passer d'une case à l'autre avec Tab) */
function renderGardeFocus() {
  setTimeout(() => {
    const a = document.activeElement, id = a && a.id; let s0 = null, s1 = null;
    try { s0 = a.selectionStart; s1 = a.selectionEnd; } catch (e) { /* */ }
    UI.pending = false; render();
    if (id && $(id)) { const n = $(id); n.focus(); try { if (s0 != null) n.setSelectionRange(s0, s1); } catch (e) { /* */ } }
  }, 1);
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function parseRoute() { const p = location.hash.replace(/^#\/?/, '').split('/'); ROUTE.mod = p[0] || ''; ROUTE.sub = p[1] || ''; ROUTE.id = decodeURIComponent(p[2] || ''); }

function render() {
  parseRoute();
  const m = MODULES[ROUTE.mod];
  const view = $('view');
  document.body.dataset.mod = m ? ROUTE.mod : 'accueil';
  $('title').textContent = m ? m.titre : cfg().nom;
  $('home-btn').hidden = !m;
  $('drive').classList.toggle('on', ROUTE.mod === 'drive');
  const sy = window.scrollY, same = render._last === location.hash; render._last = location.hash;
  try { view.innerHTML = m ? m.render(ROUTE.sub, ROUTE.id) : renderAccueil(); }
  catch (e) { console.error(e); view.innerHTML = `<div class="panel"><p class="err">Cette page n'a pas pu s'afficher : ${esc(e.message)}. Tes données ne sont pas touchées.</p></div>`; }
  if (same) window.scrollTo(0, sy); else window.scrollTo(0, 0);
  if (m && m.after) try { m.after(ROUTE.sub, ROUTE.id); } catch (e) { console.error(e); }
}
addEventListener('hashchange', () => { closeSheet(); render(); });

/* Onglets d'un module */
function tabs(mod, items, cur) {
  return `<nav class="subtabs" aria-label="Sections">${items.map(([k, label]) => `<a href="#/${mod}/${k}" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>`;
}

/* Feuille (formulaire en bas d'écran sur téléphone, fenêtre au centre sur ordinateur) */
function openSheet(html) {
  $('sheet').innerHTML = html; $('scrim').hidden = false; document.body.classList.add('sheet-open');
  const f = $('sheet').querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select');
  if (f && matchMedia('(pointer: fine)').matches) setTimeout(() => f.focus(), 30);
}
function closeSheet() { $('scrim').hidden = true; $('sheet').innerHTML = ''; document.body.classList.remove('sheet-open'); }
function sheetHead(titre, sous) { return `<div class="shead"><h2>${esc(titre)}${sous ? `<small>${esc(sous)}</small>` : ''}</h2><button type="button" class="xbtn" data-act="close" aria-label="Fermer">Fermer</button></div>`; }

/* Champs de formulaire */
function fld(id, label, inner, sub) { return `<div class="field"><label for="${id}">${esc(label)}</label>${inner}${sub ? `<span class="sub">${sub}</span>` : ''}</div>`; }
function inp(id, label, val, opts = {}) {
  const a = Object.entries(opts.attrs || {}).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  // Les nombres passent par un champ texte « décimal » : la virgule (7,5) et le point (7.5) sont acceptés.
  const t = opts.type === 'number' ? 'text" inputmode="decimal" autocomplete="off' : (opts.type || 'text');
  return fld(id, label, `<input id="${id}" name="${opts.name || id}" type="${t}" value="${esc(val ?? '')}" ${opts.req ? 'required' : ''} ${a}>`, opts.sub);
}
function sel(id, label, val, options, opts = {}) {
  return fld(id, label, `<select id="${id}" name="${opts.name || id}">${options.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(val ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`, opts.sub);
}
function txt(id, label, val, opts = {}) { return fld(id, label, `<textarea id="${id}" name="${opts.name || id}" rows="${opts.rows || 3}">${esc(val ?? '')}</textarea>`, opts.sub); }
function persOptions(withEnsemble) { const o = personnes().map((p) => [p.k, p.nom]); if (withEnsemble) o.push(['ensemble', 'Ensemble']); return o; }
function formValues(form) { const o = {}; for (const el of form.elements) { if (!el.name) continue; if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value.trim(); } return o; }

/* Confirmation dans la page (pas de boîte de dialogue du navigateur) */
function confirmSheet(titre, texte, actOk, labelOk, data) {
  openSheet(`${sheetHead(titre)}<div class="sbody"><p>${texte}</p><div class="row-end">
    <button class="btn" type="button" data-act="close">Annuler</button>
    <button class="btn danger" type="button" data-act="${actOk}" ${Object.entries(data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${esc(labelOk)}</button></div></div>`);
}

/* Téléchargement d'un fichier généré */
function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const safe = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safe; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function csv(head, rows) { const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; return '﻿' + [head.map(q).join(';')].concat(rows.map((r) => r.map(q).join(';'))).join('\r\n'); }

/* Délégation des clics et des formulaires */
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  const f = ACTIONS[a.dataset.act]; if (!f) return;
  e.preventDefault(); f(a, e);
});
document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]'); if (!form) return;
  e.preventDefault(); const f = FORMS[form.dataset.form]; if (f) f(formValues(form), form);
});
ACTIONS.close = () => closeSheet();
ACTIONS.go = (el) => go(el.dataset.href);
ACTIONS.closeGo = (el) => { closeSheet(); go(el.dataset.href); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('scrim').hidden) closeSheet(); });
