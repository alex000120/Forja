// Render de la interfaz
import { state, save, current, newProject, deleteProject } from './state.js';
import { refresh } from './preview.js';
import { PROVIDERS } from './ai.js';

const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export let curFile = 'index.html';
export const setCurFile = f => { curFile = f; };

export function toast(t) {
  const e = $('#toast'); e.textContent = t; e.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', 3000);
}
export function setV(v) {
  document.body.dataset.v = v;
  $$('.mnav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
export function syncProvider() {
  const v = $('#prov').value, P = PROVIDERS[v];
  $('#baseW').style.display = v === 'custom' ? 'block' : 'none';
  const k = $('#keylink'); k.style.display = P.keyUrl ? '' : 'none'; k.href = P.keyUrl || '#';
}
export function fillModels(list = []) {
  const s = $('#modelsel'); s.innerHTML = '';
  const q = ($('#mq').value || '').trim().toLowerCase(), onlyFree = $('#mfree').checked;
  const shown = list.filter(m => (!q || (m.id + ' ' + m.label).toLowerCase().includes(q)) && (!onlyFree || m.free));
  const o0 = document.createElement('option'); o0.value = '';
  o0.textContent = !list.length ? 'Sin modelos cargados' : shown.length === list.length ? 'Elegí un modelo (' + list.length + ' disponibles)' : 'Elegí un modelo (' + shown.length + ' de ' + list.length + ')'; s.append(o0);
  shown.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; s.append(o); });
  $('#mfilter').hidden = list.length < 12;
  $('#mfreeW').hidden = !list.some(m => m.free);
  s.value = shown.some(m => m.id === $('#model').value) ? $('#model').value : '';
}
export function openCfg() {
  const c = state.cfg;
  $('#prov').value = c.provider; $('#prov').dataset.cur = c.provider; $('#key').value = c.key; $('#model').value = c.model; $('#base').value = c.base;
  $('#maxctx').value = c.maxCtx; $('#maxsteps').value = c.maxSteps; $('#autosw').checked = c.autoSwitch !== false; $('#ginst').value = c.instructions; $('#ghk').value = c.gh; $('#mstat').textContent = ''; $('#mstat').className = ''; $('#mq').value = ''; $('#mfree').checked = false; $('#tstat').textContent = '';
  syncProvider(); fillModels(c.modelsFor === c.provider ? c.models : []);
  $('#dlg').showModal();
}

function addChips(d, list, prefix) {
  if (!list.length) return;
  const w = document.createElement('div'); w.className = 'chips';
  list.forEach(f => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = prefix + f; w.append(c); });
  d.append(w);
}
const MARK = { pending: '☐', doing: '◐', done: '☑' };
function addPlan(d, plan) {
  if (!plan || !plan.length) return;
  const w = document.createElement('ul'); w.className = 'plan';
  plan.forEach(x => { const li = document.createElement('li'); li.className = x.status; li.textContent = MARK[x.status] + ' ' + x.text; w.append(li); });
  const n = plan.filter(x => x.status === 'done').length, h = document.createElement('div'); h.className = 'planh'; h.textContent = '📋 Plan · ' + n + '/' + plan.length;
  const pr = document.createElement('progress'); pr.max = plan.length; pr.value = n; h.append(pr);
  d.append(h, w);
}
const logLine = (l, live) => (l.ok === null ? '⏳ ' : l.ok ? '✓ ' : '✗ ') + l.label;
function addLog(d, log, open) {
  if (!log || !log.length) return;
  const det = document.createElement('details'); det.className = 'log'; det.open = !!open;
  const sm = document.createElement('summary'); sm.textContent = log.length + (log.length === 1 ? ' acción del agente' : ' acciones del agente'); det.append(sm);
  const ul = document.createElement('ul'); (open ? log.slice(-8) : log).forEach(l => {
    const li = document.createElement('li');
    if (l.detail) { const dd = document.createElement('details'), s = document.createElement('summary'), pre = document.createElement('pre'); dd.className = 'ld'; s.textContent = logLine(l); pre.textContent = l.detail; dd.append(s, pre); li.append(dd); }
    else li.textContent = logLine(l);
    if (l.ok === false) li.className = 'bad'; ul.append(li);
  });
  det.append(ul); d.append(det);
}
export function addMsg(role, text, o = {}) {
  const d = document.createElement('div'); d.className = 'm ' + role;
  if (text) { const t = document.createElement('div'); t.textContent = text; d.append(t); }
  addPlan(d, o.plan); addLog(d, o.log, false); addChips(d, o.files || [], '✓ ');
  if (o.resume) { const r = document.createElement('button'); r.type = 'button'; r.className = 'pri resume'; r.textContent = '▶ Continuar donde quedó'; r.onclick = o.resume; d.append(r); }
  if (o.undo) { const b = document.createElement('button'); b.type = 'button'; b.className = 'undo'; b.textContent = '↩ Deshacer cambios'; b.onclick = o.undo; d.append(b); }
  $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d;
}
// Actualiza la burbuja del agente mientras trabaja: texto, plan y acciones en curso
export function paintLive(el, v) {
  const op = new Set([...el.querySelectorAll('details.ld[open] summary')].map(s => s.textContent));   // conserva lo que el usuario abrió
  el.textContent = '';
  if (v.text) { const t = document.createElement('div'); t.textContent = v.text; el.append(t); }
  addPlan(el, v.plan);
  const log = v.pending ? [...v.log, { label: v.pending, ok: null }] : v.log;
  if (log.length) addLog(el, log, true); else if (!v.text) { const t = document.createElement('div'); t.textContent = 'El agente está analizando tu pedido…'; el.append(t); }
  el.querySelectorAll('details.ld').forEach(d => { if (op.has(d.firstChild.textContent)) d.open = true; });
  $('#msgs').scrollTop = 1e9;
}
export function undoTurn(p, m) {
  Object.entries(m.before).forEach(([f, c]) => { if (c === null) delete p.files[f]; else p.files[f] = c; });
  m.files = []; m.text += '\n(Cambios deshechos)'; m.hist = m.text; delete m.before; delete m.paused; delete p.session;
  save(); renderAll();
}

export function renderList() {
  const l = $('#plist'); l.innerHTML = '';
  state.projects.forEach(p => {
    const d = document.createElement('div'); d.className = 'pi' + (p.id === state.cur ? ' on' : ''); d.tabIndex = 0;
    const s = document.createElement('span'); s.textContent = p.name;
    const x = document.createElement('i'); x.textContent = '×'; x.title = 'Eliminar'; x.setAttribute('role', 'button');
    x.onclick = e => { e.stopPropagation(); if (confirm('¿Eliminar «' + p.name + '»?')) { deleteProject(p.id); renderAll(); } };
    d.append(s, x);
    d.onclick = d.onkeydown = e => {
      if (e.type === 'keydown' && e.key !== 'Enter') return;
      state.cur = p.id; curFile = 'index.html'; save(); renderAll(); setV('c');
    };
    l.append(d);
  });
}

export function renderMsgs() {
  const m = $('#msgs'), p = current(); m.innerHTML = '';
  if (!p.messages.length) {
    m.innerHTML = '<div class="empty"><b>¿Qué construimos?</b>Dame un objetivo y lo cumplo de punta a punta: planifico, escribo los archivos, pruebo la página y corrijo lo que falle.<div class="sug"></div></div>';
    ['Landing para una cafetería de especialidad', 'Portfolio de fotógrafa', 'Página de producto con precios'].forEach(t => {
      const b = document.createElement('button'); b.textContent = t; b.type = 'button';
      b.onclick = () => { $('#inp').value = t; $('#inp').focus(); }; m.querySelector('.sug').append(b);
    });
  }
  const last = p.messages.length - 1;
  p.messages.forEach((x, i) => addMsg(x.role, x.text, { files: x.files, log: x.log, plan: x.plan, undo: i === last && x.before ? () => undoTurn(p, x) : null, resume: i === last && x.paused && p.session ? () => document.dispatchEvent(new Event('forja:resume')) : null }));
}

export function renderCode() {
  const p = current(), s = $('#fsel'); s.innerHTML = '';
  Object.keys(p.files).sort().forEach(f => { const o = document.createElement('option'); o.textContent = f; s.append(o); });
  if (p.files[curFile] == null) curFile = Object.keys(p.files)[0];
  s.value = curFile; $('#ed').value = p.files[curFile] ?? '';
}

export function renderPages() {
  const p = current(), s = $('#page'); s.innerHTML = '';
  const pages = Object.keys(p.files).filter(f => /\.html?$/i.test(f));
  pages.forEach(f => { const o = document.createElement('option'); o.textContent = f; s.append(o); });
  if (!pages.includes(p.page)) p.page = pages[0] || 'index.html';
  s.value = p.page; s.style.display = pages.length > 1 ? '' : 'none';
}

export function renderAll() {
  const p = current(); $('#pname').textContent = p.name;
  renderList(); renderMsgs(); renderCode(); renderPages(); refresh(p);
  document.dispatchEvent(new Event('forja:render'));
}

// Informe de verificación (pestaña «Informe»)
export function renderReport(rep, h) {
  const el = $('#report'); el.textContent = '';
  const mk = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  if (!rep) {
    el.append(mk('p', 'mute', 'Todavía no se verificó este proyecto. Es gratis: corre en tu navegador y no usa créditos de IA.'));
    const b = mk('button', 'pri', '✔ Verificar ahora'); b.onclick = h.rerun; el.append(b); return;
  }
  const n = rep.errs + rep.warns;
  el.append(mk('h3', 'rh ' + (rep.errs ? 'bad' : n ? 'warn' : 'ok'), n ? '⚠ ' + rep.errs + ' error(es) · ' + rep.warns + ' aviso(s)' : '✔ Todo en orden'));
  el.append(mk('div', 'mute', rep.page + ' · ' + new Date(rep.at).toLocaleTimeString()));
  rep.groups.forEach(g => {
    const box = mk('section', 'rg'); box.append(mk('h4', null, g.title + (g.meta ? ' · ' + g.meta : '')));
    if (!g.items.length) box.append(mk('div', 'ok', '✔ Sin problemas'));
    g.items.forEach(i => box.append(mk('div', 'ri ' + i.sev, (i.sev === 'err' ? '✗ ' : i.sev === 'warn' ? '! ' : 'i ') + i.text)));
    el.append(box);
  });
  const row = mk('div', 'tools');
  const a = mk('button', null, '🔁 Verificar de nuevo'), c = mk('button', null, '📋 Copiar informe'); a.onclick = h.rerun; c.onclick = h.copy; row.append(a, c);
  if (n) { const f = mk('button', 'pri', '🛠 Pedir al agente que lo corrija'); f.onclick = h.fix; row.append(f); }
  el.append(row);
}
