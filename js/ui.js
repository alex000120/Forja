// Render de la interfaz
import { state, save, current, newProject, deleteProject } from './state.js';
import { refresh } from './preview.js';

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
export function openCfg() {
  const c = state.cfg;
  $('#prov').value = c.provider; $('#key').value = c.key; $('#model').value = c.model; $('#base').value = c.base;
  $('#maxctx').value = c.maxCtx; $('#ginst').value = c.instructions; $('#ghk').value = c.gh;
  $('#baseW').style.display = c.provider === 'openai' ? 'block' : 'none';
  $('#dlg').showModal();
}

export function addMsg(role, text, files) {
  const d = document.createElement('div'); d.className = 'm ' + role; d.textContent = text;
  (files || []).forEach(f => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = '✓ ' + f; d.append(document.createElement('br'), c); });
  $('#msgs').append(d); $('#msgs').scrollTop = 1e9; return d;
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
    m.innerHTML = '<div class="empty"><b>¿Qué construimos?</b>Describí tu sitio y lo armo. Después seguimos mejorándolo juntos.<div class="sug"></div></div>';
    ['Landing para una cafetería de especialidad', 'Portfolio de fotógrafa', 'Página de producto con precios'].forEach(t => {
      const b = document.createElement('button'); b.textContent = t; b.type = 'button';
      b.onclick = () => { $('#inp').value = t; $('#inp').focus(); }; m.querySelector('.sug').append(b);
    });
  }
  p.messages.forEach(x => addMsg(x.role, x.text, x.files));
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
}
