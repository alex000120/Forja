// Punto de entrada: eventos y flujo principal
import { state, save, current, newProject } from './state.js';
import { listModels, PROVIDERS, streamTurn, classify } from './ai.js';
import { runAgent, cancel } from './agent.js';
import { importFiles } from './importer.js';
import { TOOLS, CATEGORIES, MAX_TOOLS } from './instructions.js';
import { refresh, errors, watchErrors } from './preview.js';
import { exportZip, pushGithub } from './export.js';
import { $$, toast, setV, openCfg, addMsg, paintLive, renderReport, renderAll, renderMsgs, renderCode, renderPages, syncProvider, fillModels, curFile, setCurFile } from './ui.js';
import { VERSION } from './version.js';
import { verifyProject, reportText } from './verify.js';

const $ = s => document.querySelector(s);
let busy = false;

/* chat: cada mensaje es un objetivo que el agente cumple con herramientas */
const setBusy = b => { busy = b; $('#send').textContent = b ? 'Detener' : 'Ejecutar'; };

// Ejecuta (o reanuda) al agente mostrando su trabajo en vivo. userText solo se usa para restaurar el cuadro si falla sin avance.
async function execute(p, used, resume, userText) {
  setBusy(true);
  const live = { text: '', log: [], plan: [], pending: '' };
  const w = addMsg('assistant', ''); w.classList.add('typing');
  let raf = 0; const paint = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintLive(w, live); }); };
  if (resume && p.session) { live.log = p.session.log.map(l => ({ ...l })); live.plan = p.session.plan || []; }
  paint();
  const res = await runAgent(p, used, {
    onText: txt => { live.text = txt; paint(); },
    onPending: name => { live.pending = name === 'write_file' ? '✍️ Escribiendo un archivo…' : '⚙️ Preparando ' + name + '…'; paint(); },
    onTool: ev => {
      live.pending = '';
      if (ev.phase === 'start') live.log.push({ id: ev.id, label: ev.label, ok: null });
      else { const l = live.log.find(x => x.id === ev.id); if (l) { l.ok = ev.ok; l.detail = ev.detail; } }
      paint();
    },
    onPlan: plan => { live.plan = plan; paint(); },
    onChanged: () => { save(); renderPages(); renderCode(); refresh(p); }
  }, resume);
  cancelAnimationFrame(raf);
  if ((res.error || res.aborted) && !res.progress) {
    // falló antes de hacer nada: no se perdió nada, se devuelve el pedido al cuadro de texto
    p.messages.pop(); save(); renderMsgs();
    if (res.error) addMsg('assistant', 'No se pudo completar: ' + res.error + '. Revisá tu API key, el modelo y la conexión en Configuración. El modo agente necesita un modelo con soporte de herramientas (tool use).');
    $('#inp').value = userText || '';
  } else {
    p.messages.push({ role: 'assistant', text: res.text || 'Listo.', files: res.changed, hist: res.hist, before: res.before, paused: res.paused, log: res.log.map(l => ({ label: l.label, ok: l.ok, detail: l.detail })), plan: res.plan });
    p.messages.filter(x => x.before).slice(0, -3).forEach(x => delete x.before);
    if (!save()) toast('Almacenamiento lleno: exportá un ZIP para no perder trabajo');
    renderAll();
  }
  setBusy(false);
  if (res.changed && res.changed.length) runVerify(false);   // verificación local gratuita tras cada cambio del agente
}

$('#form').onsubmit = async e => {
  e.preventDefault();
  if (busy) return cancel();
  const t = $('#inp').value.trim(); if (!t) return;
  if (!state.cfg.key) { toast('Primero pegá tu API key en Configuración'); return openCfg(); }
  const p = current();
  delete p.session;                                  // un pedido nuevo descarta cualquier ejecución pausada
  const used = [...active], tag = TOOLS.filter(x => active.has(x.id)).map(x => x.icon + ' ' + x.name).join(' · ');
  active.clear(); renderTools();
  p.messages.push({ role: 'user', text: (tag ? tag + '\n' : '') + t }); $('#inp').value = ''; renderMsgs();
  await execute(p, used, false, t);
};

// Reanudar una ejecución interrumpida desde su último punto de control
document.addEventListener('forja:resume', async () => {
  if (busy) return;
  const p = current(); if (!p.session) return;
  if (!state.cfg.key) { toast('Primero pegá tu API key en Configuración'); return openCfg(); }
  const last = p.messages[p.messages.length - 1];
  if (last && last.paused) { delete last.paused; p.messages.pop(); }
  renderMsgs();
  await execute(p, [], true, '');
});
$('#inp').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !busy) { e.preventDefault(); $('#form').requestSubmit(); } };

/* navegación y vista previa */
$$('.mnav button').forEach(b => b.onclick = () => setV(b.dataset.v));
$$('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.t));
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

/* herramientas (definidas en js/instructions.js) */
const active = new Set();
function toggleTool(id) {
  if (active.has(id)) active.delete(id);
  else if (active.size >= MAX_TOOLS) return toast('Máximo ' + MAX_TOOLS + ' herramientas por pedido');
  else active.add(id);
  renderTools(); renderToolList();
}
function renderTools() {
  const box = $('#tools'); box.innerHTML = '';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pri';
  b.textContent = '🧰 Herramientas' + (active.size ? ' (' + active.size + ')' : ''); b.onclick = openTools; box.append(b);
  TOOLS.filter(t => active.has(t.id)).forEach(t => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'on';
    c.textContent = t.icon + ' ' + t.name + ' ×'; c.title = 'Quitar'; c.onclick = () => toggleTool(t.id); box.append(c);
  });
  const first = TOOLS.find(x => active.has(x.id));
  $('#inp').placeholder = first ? first.hint : 'Dale un objetivo al agente: qué construir, arreglar o mejorar…';
}
function renderToolList() {
  const q = $('#tsearch').value.trim().toLowerCase(), box = $('#tlist'); box.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const list = TOOLS.filter(t => t.cat === cat.id && (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q)));
    if (!list.length) return;
    const h = document.createElement('div'); h.className = 'cat'; h.textContent = cat.icon + ' ' + cat.name; box.append(h);
    const g = document.createElement('div'); g.className = 'tgrid';
    list.forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tool' + (active.has(t.id) ? ' on' : '');
      b.setAttribute('aria-pressed', active.has(t.id));
      const n = document.createElement('strong'); n.textContent = t.icon + ' ' + t.name;
      const d = document.createElement('small'); d.textContent = t.desc; b.append(n, d);
      b.onclick = () => toggleTool(t.id); g.append(b);
    });
    box.append(g);
  });
  if (!box.children.length) box.textContent = 'No hay herramientas con ese nombre.';
}
function openTools() { $('#tsearch').value = ''; renderToolList(); $('#tdlg').showModal(); }
$('#tsearch').oninput = renderToolList;
$('#tclr').onclick = () => { active.clear(); renderTools(); renderToolList(); };
$('#tok').onclick = () => $('#tdlg').close();

/* configuración y detección de modelos */
let loadSeq = 0, loadTimer = 0;
const setStat = (t, kind = '') => { const st = $('#mstat'); st.textContent = t; st.className = kind; };
async function loadModels(silent) {
  clearTimeout(loadTimer);
  const cfg = { provider: $('#prov').value, key: $('#key').value.trim(), base: $('#base').value.trim() };
  const needKey = cfg.provider !== 'openrouter'; // OpenRouter lista sus modelos sin clave
  if ((needKey && !cfg.key) || (cfg.provider === 'custom' && !cfg.base)) {
    if (!silent) setStat('Completá la API key' + (cfg.provider === 'custom' ? ' y la URL base' : '') + ' primero.', 'warn'); return;
  }
  const my = ++loadSeq;   // si el usuario cambia de proveedor/clave mientras carga, se descarta la respuesta vieja
  setStat('Buscando modelos…', 'busy'); $('#loadm').disabled = true;
  try {
    const list = await listModels(cfg);
    if (my !== loadSeq) return;
    state.cfg.models = list; state.cfg.modelsFor = cfg.provider; save();
    if (!$('#model').value && list[0]) $('#model').value = list[0].id;
    fillModels(list);
    const cur = $('#model').value.trim();
    setStat(list.length ? '✔ ' + list.length + ' modelos detectados.' + (cur && !list.some(m => m.id === cur) ? ' El modelo actual no figura en la lista: elegí uno.' : '') : 'La API respondió, pero sin modelos de chat. Escribí el ID a mano.', list.length ? 'ok' : 'warn');
  } catch (e) { if (my === loadSeq) setStat('✖ ' + e.message + '. Podés escribir el ID del modelo a mano.', 'err'); }
  if (my === loadSeq) $('#loadm').disabled = false;
}
const loadSoon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => loadModels(true), 600); };
$('#cfgb').onclick = () => { openCfg(); if ((state.cfg.key || state.cfg.provider === 'openrouter') && state.cfg.modelsFor !== state.cfg.provider) loadModels(true); };
$('#cx').onclick = () => $('#dlg').close();
$('#loadm').onclick = () => loadModels(false);
$('#key').oninput = loadSoon; $('#key').onchange = () => loadModels(true);
$('#base').oninput = loadSoon; $('#base').onchange = () => loadModels(true);
$('#mq').oninput = () => fillModels(state.cfg.modelsFor === $('#prov').value ? state.cfg.models : []);
$('#mfree').onchange = $('#mq').oninput;
$('#modelsel').onchange = e => { if (e.target.value) $('#model').value = e.target.value; };
$('#model').oninput = e => { const s = $('#modelsel'); s.value = [...s.options].some(o => o.value === e.target.value) ? e.target.value : ''; };
/* prueba de conexión: una llamada mínima con una herramienta de juguete (gasta unos pocos tokens) */
const TEST_MSG = { auth: 'Clave rechazada: revisá que sea correcta y del servicio elegido.', quota: 'La clave funciona, pero el cupo o el límite de uso está agotado ahora.', model: 'Ese modelo no existe o no admite herramientas: elegí otro.', down: 'El servicio no responde ahora (caída, red o CORS). Probá de nuevo.' };
let testBusy = false;
$('#testm').onclick = async () => {
  if (testBusy) return;
  const cfg = { provider: $('#prov').value, key: $('#key').value.trim(), base: $('#base').value.trim(), model: $('#model').value.trim() }, t = $('#tstat');
  const paint = (txt, kind) => { t.textContent = txt; t.className = kind; };
  if (!cfg.key || !cfg.model || (cfg.provider === 'custom' && !cfg.base)) return paint('Completá clave y modelo primero.', 'warn');
  testBusy = true; $('#testm').disabled = true; paint('Probando…', 'busy');
  const t0 = performance.now(), ac = new AbortController(), to = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await streamTurn({ cfg, system: 'Probá la herramienta ping y respondé muy breve.', messages: [{ role: 'user', text: 'Llamá a ping.' }],
      tools: [{ name: 'ping', description: 'Devuelve pong', schema: { type: 'object', properties: {} } }], signal: ac.signal, onText() {}, onPending() {} });
    const ms = Math.round(performance.now() - t0), usedTool = r.calls.some(c => c.name === 'ping');
    paint(usedTool ? '✔ Todo OK (' + ms + ' ms): la clave, el modelo y las herramientas funcionan.' : '⚠ Conecta (' + ms + ' ms), pero el modelo no usó la herramienta de prueba: puede fallar como agente.', usedTool ? 'ok' : 'warn');
  } catch (e) {
    const k = e.name === 'AbortError' ? 'down' : (e.status === 401 || e.status === 403 ? 'auth' : classify(e));
    paint('✖ ' + (TEST_MSG[k] || (k === 'fatal' ? TEST_MSG.auth : e.message)) + (e.message && k !== 'auth' ? ' (' + e.message.slice(0, 140) + ')' : ''), 'err');
  }
  clearTimeout(to); testBusy = false; $('#testm').disabled = false;
};
let draftKeys = {}, draftModel = {};
$('#dlg').addEventListener('close', () => { draftKeys = {}; draftModel = {}; loadSeq++; });
$('#prov').onchange = e => {
  const old = e.target.dataset.cur, now = e.target.value, c = state.cfg;
  draftKeys[old] = $('#key').value.trim(); draftModel[old] = $('#model').value.trim(); e.target.dataset.cur = now;
  $('#key').value = draftKeys[now] ?? c.keys[now] ?? '';
  $('#model').value = draftModel[now] || c.chosen[now] || PROVIDERS[now].model;
  $('#mq').value = ''; $('#mfree').checked = false; $('#tstat').textContent = '';
  syncProvider(); fillModels([]); setStat(''); loadModels(true);
};
$('#sv').onclick = () => {
  const prov = $('#prov').value, c = state.cfg, keep = c.modelsFor === prov;
  const key = $('#key').value.trim(), model = $('#model').value.trim();
  state.cfg = { provider: prov, key, model, base: $('#base').value.trim(),
    maxCtx: Math.max(5000, +$('#maxctx').value || 60000), maxSteps: Math.min(80, Math.max(5, +$('#maxsteps').value || 30)), autoSwitch: $('#autosw').checked, instructions: $('#ginst').value, gh: $('#ghk').value.trim(),
    keys: { ...c.keys, ...draftKeys, [prov]: key }, chosen: { ...c.chosen, ...draftModel, [prov]: model },
    models: keep ? c.models : [], modelsFor: keep ? prov : '' };
  save(); $('#dlg').close(); toast('Configuración guardada');
};

/* verificación manual: local, sin gastar créditos de IA */
const reps = {};   // último informe por proyecto
function showTab(t) {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
  $('#view').style.display = t === 'view' ? 'flex' : 'none'; $('#code').style.display = t === 'code' ? 'flex' : 'none'; $('#report').style.display = t === 'report' ? 'flex' : 'none';
  if (t === 'code') renderCode(); if (t === 'report') paintReport();
}
const repHandlers = {
  rerun: () => runVerify(true),
  copy: () => navigator.clipboard.writeText(reportText(reps[current().id])).then(() => toast('Informe copiado'), () => toast('No se pudo copiar')),
  fix: () => {
    if (busy) return toast('El agente está trabajando');
    active.add('debug'); renderTools();
    $('#inp').value = 'La verificación encontró estos problemas. Corregilos de mayor a menor gravedad y volvé a verificar con check_project e inspect_page:\n' + reportText(reps[current().id]);
    setV('c'); $('#form').requestSubmit();
  }
};
const paintReport = () => renderReport(reps[current().id], repHandlers);
function paintVerify() {
  const b = $('#verify'), r = reps[current().id], n = r ? r.errs + r.warns : 0;
  b.className = r ? (r.errs ? 'bad' : r.warns ? 'warn' : 'ok') : '';
  b.textContent = !r ? '✔ Verificar' : n ? '⚠ ' + n + ' · Verificar' : '✔ Todo OK';
  if ($('#report').style.display === 'flex') paintReport();
}
let vbusy = false;
async function runVerify(show) {
  if (vbusy) return; vbusy = true;
  const p = current(), b = $('#verify'); b.disabled = true; b.textContent = '⏳ Verificando…';
  if (show) { showTab('report'); $('#report').textContent = 'Verificando…'; }
  try { reps[p.id] = await verifyProject(p, s => { if (show && current() === p) $('#report').textContent = s; }); }
  catch (e) { toast('No se pudo verificar: ' + e.message); }
  vbusy = false; b.disabled = false; paintVerify();
}
$('#verify').onclick = () => runVerify(true);
document.addEventListener('forja:render', paintVerify);

/* errores de la vista previa e importación */
const fixb = $('#fix');
watchErrors(() => { fixb.hidden = !errors.length; fixb.textContent = '🐞 ' + errors.length + (errors.length === 1 ? ' error' : ' errores') + ' · Arreglar'; });
fixb.onclick = () => {
  if (busy) return;
  active.add('debug'); renderTools();
  $('#inp').value = 'La vista previa muestra estos errores. Diagnosticá la causa raíz, corregilos y verificá que desaparezcan:\n' + errors.map(x => '- ' + x).join('\n');
  setV('c'); $('#form').requestSubmit();
};
$('#impb').onclick = () => $('#imp').click();
$('#imp').onchange = async e => {
  try { await importFiles(e.target.files); } catch (err) { toast('Error al importar: ' + err.message); }
  e.target.value = '';
};

/* inicio: si una ejecución quedó cortada (pestaña cerrada, corte de luz…), se ofrece continuarla */
state.projects.forEach(p => {
  if (p.session && p.session.running) {
    p.session.running = false;
    const n = Object.keys(p.session.before || {}).length;
    p.messages.push({ role: 'assistant', paused: true, text: '⏸ La ejecución anterior se cortó antes de terminar. Tu proyecto está a salvo' + (n ? ' (' + n + ' archivos ya guardados)' : '') + '. Tocá «Continuar» y sigo desde el último punto de control.', files: Object.keys(p.session.before || {}), before: p.session.before, plan: p.session.plan, log: p.session.log, hist: 'Ejecución interrumpida.' });
  }
});
save();
/* inicio */
if (!state.projects.length) newProject('Mi primer proyecto'); else if (!current()) state.cur = state.projects[0].id;
renderTools(); renderAll(); if (!state.cfg.key) setTimeout(() => { if (!$('#dlg').open) openCfg(); }, 400);

document.getElementById('ver') && (document.getElementById('ver').textContent = 'v' + VERSION);
