// Punto de entrada: eventos y flujo principal
import { state, save, current, newProject } from './state.js';
import { callAI, applyReply } from './ai.js';
import { refresh } from './preview.js';
import { exportZip, pushGithub } from './export.js';
import { $$, toast, setV, openCfg, addMsg, renderAll, renderMsgs, renderCode, renderPages, curFile, setCurFile } from './ui.js';

const $ = s => document.querySelector(s);
let busy = false;

/* chat */
$('#form').onsubmit = async e => {
  e.preventDefault();
  const t = $('#inp').value.trim(); if (!t || busy) return;
  if (!state.cfg.key) { toast('Primero pegá tu API key en Configuración'); return openCfg(); }
  const p = current(); p.messages.push({ role: 'user', text: t }); $('#inp').value = ''; renderMsgs();
  busy = true; $('#send').disabled = true;
  const w = addMsg('assistant', 'Trabajando en tu sitio…'); w.classList.add('typing');
  try {
    const { text, changed, hist } = applyReply(p, await callAI(p));
    p.messages.push({ role: 'assistant', text, files: changed, hist });
    if (!save()) toast('Almacenamiento lleno: exportá un ZIP para no perder trabajo');
    renderAll();
  } catch (err) {
    w.remove(); p.messages.pop(); save();
    addMsg('assistant', 'No se pudo completar: ' + err.message + '. Revisá tu API key, el modelo y la conexión en Configuración.');
    $('#inp').value = t;
  }
  busy = false; $('#send').disabled = false;
};
$('#inp').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#form').requestSubmit(); } };

/* navegación y vista previa */
$$('.mnav button').forEach(b => b.onclick = () => setV(b.dataset.v));
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  const code = b.dataset.t === 'code';
  $('#view').style.display = code ? 'none' : 'flex'; $('#code').style.display = code ? 'flex' : 'none';
  if (code) renderCode();
});
$$('.dev').forEach(b => b.onclick = () => { $('#frame').style.width = b.dataset.w; $$('.dev').forEach(x => x.classList.toggle('on', x === b)); });
$('#reload').onclick = () => refresh(current());
$('#page').onchange = e => { current().page = e.target.value; save(); refresh(current()); };

/* editor de código */
$('#fsel').onchange = e => { setCurFile(e.target.value); $('#ed').value = current().files[e.target.value]; };
let tm; $('#ed').oninput = e => {
  current().files[curFile] = e.target.value; clearTimeout(tm);
  tm = setTimeout(() => { save(); refresh(current()); }, 500);
};
$('#newf').onclick = () => {
  const n = (prompt('Ruta del archivo (ej: css/hero.css)') || '').trim().replace(/^\/+/, '');
  if (!n) return; if (current().files[n] != null) return toast('Ese archivo ya existe');
  current().files[n] = ''; setCurFile(n); save(); renderCode(); renderPages();
};
$('#delf').onclick = () => {
  if (!confirm('¿Borrar ' + curFile + '?')) return;
  delete current().files[curFile]; save(); renderCode(); renderPages(); refresh(current());
};

/* proyectos */
$('#newp').onclick = () => { const n = prompt('Nombre del proyecto'); if (n === null) return; newProject(n.trim() || undefined); setCurFile('index.html'); renderAll(); };
$('#ren').onclick = () => { const n = prompt('Nuevo nombre', current().name); if (n && n.trim()) { current().name = n.trim(); save(); renderAll(); } };
$('#zip').onclick = exportZip; $('#gh').onclick = pushGithub;

/* instrucciones del proyecto */
$('#instb').onclick = () => { $('#pinst').value = current().instructions; $('#idlg').showModal(); };
$('#icx').onclick = () => $('#idlg').close();
$('#isv').onclick = () => { current().instructions = $('#pinst').value; save(); $('#idlg').close(); toast('Instrucciones del proyecto guardadas'); };

/* configuración */
$('#cfgb').onclick = openCfg; $('#cx').onclick = () => $('#dlg').close();
$('#prov').onchange = e => {
  $('#baseW').style.display = e.target.value === 'openai' ? 'block' : 'none';
  if (e.target.value === 'openai' && $('#model').value.startsWith('claude-')) $('#model').value = 'anthropic/claude-sonnet-4.5';
};
$('#sv').onclick = () => {
  state.cfg = { provider: $('#prov').value, key: $('#key').value.trim(), model: $('#model').value.trim(), base: $('#base').value.trim(),
    maxCtx: Math.max(5000, +$('#maxctx').value || 60000), instructions: $('#ginst').value, gh: $('#ghk').value.trim() };
  save(); $('#dlg').close(); toast('Configuración guardada');
};

/* inicio */
if (!state.projects.length) newProject('Mi primer proyecto'); else if (!current()) state.cur = state.projects[0].id;
renderAll(); if (!state.cfg.key) setTimeout(openCfg, 400);
