// Bucle del agente: el modelo decide, llama herramientas por la API, recibe resultados y sigue hasta terminar.
import { state, save } from './state.js';
import { BASE_SYSTEM, PLAYBOOK, TOOLS as PLAYBOOKS } from './instructions.js';
import { AGENT_TOOLS, runTool, label, treeText } from './tools.js';
import { streamTurn, classify, modelChain } from './ai.js';

let ctl = null;
export const cancel = () => ctl && ctl.abort();

export function buildSystem(p, toolIds = []) {
  const { cfg } = state;
  let s = BASE_SYSTEM + '\n\n' + PLAYBOOK;
  if (cfg.instructions.trim()) s += '\n\nINSTRUCCIONES GLOBALES DEL USUARIO:\n' + cfg.instructions.trim();
  if (p.instructions.trim()) s += '\n\nINSTRUCCIONES DE ESTE PROYECTO («' + p.name + '»):\n' + p.instructions.trim();
  const act = PLAYBOOKS.filter(t => toolIds.includes(t.id));
  if (act.length) s += '\n\nGUÍAS OBLIGATORIAS PARA ESTE PEDIDO (cargalas con use_playbook antes de escribir código): ' + act.map(t => t.id + ' («' + t.name + '»)').join(', ') + '.';
  if (p.files['PLAN.md']) { const pl = p.files['PLAN.md'], k = pl.indexOf('## Notas del agente'); s += '\n\nPLAN.md DEL PROYECTO (contexto de pedidos anteriores):\n' + (k < 0 ? pl.slice(0, 6000) : pl.slice(0, k).slice(0, 3500) + '\n' + pl.slice(k, k + 2500)); }
  s += '\n\nARCHIVOS DEL PROYECTO AL EMPEZAR ESTE PEDIDO (usá read_file para ver su contenido):\n' + treeText(p) + '\nPágina en vista previa: ' + p.page;
  return s;
}

// Libera contexto: resultados viejos de herramientas y contenido de write_file ya guardado en los archivos
const STUB = '[omitido para ahorrar contexto; repetí la llamada si lo necesitás]';
function compact(msgs, budget) {
  const size = m => m.role === 'tool' ? m.results.reduce((a, r) => a + r.content.length, 0)
    : m.role === 'assistant' ? (m.calls || []).reduce((a, c) => a + ((c.name === 'write_file' || c.name === 'append_file') ? String(c.input.content || '').length : 0), 0) : 0;
  let total = msgs.reduce((a, m) => a + size(m), 0);
  for (let i = 0; i < msgs.length - 8 && total > budget; i++) {
    const m = msgs[i];
    if (m.role === 'tool') m.results.forEach(r => { if (r.content.length > 200) { total -= r.content.length - STUB.length; r.content = STUB; } });
    else if (m.role === 'assistant') (m.calls || []).forEach(c => {
      const n = String(c.input?.content || '').length;
      if ((c.name === 'write_file' || c.name === 'append_file') && n > 200) { total -= n - STUB.length; c.input = { ...c.input, content: STUB }; }
    });
  }
}

const RETRY_WAITS = [4000, 10000, 25000]; // reintentos automáticos por paso ante caídas de la API
const cooling = new Map();                   // proveedor|modelo -> hasta cuándo está sin cupo
const wait = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Abort', 'AbortError')); }, { once: true });
});

const VERIFY = '[Sistema] Modificaste archivos pero todavía no verificaste el resultado. Corré check_project e inspect_page (y interact_page si hay interacciones), corregí lo que falle y recién entonces cerrá con el resumen.';
const NUDGE = '[Sistema] La ejecución anterior se interrumpió (corte de la API, de conexión o pausa del usuario). Continuá exactamente donde quedaste: algunas acciones pudieron aplicarse y otras no, así que revisá primero el estado real con list_files y read_file, completá lo que falte del plan, verificá con check_project e inspect_page y cerrá con el resumen. No rehagas lo que ya está bien.';

// Copia liviana del hilo del agente para poder reanudar (nunca deja una llamada a herramienta sin su resultado)
function snapshot(msgs, ws, log, toolIds) {
  const m = JSON.parse(JSON.stringify(msgs));
  while (m.length && m[m.length - 1].role === 'assistant' && m[m.length - 1].calls?.length) m.pop();
  compact(m, 40000);
  return { msgs: m, plan: ws.plan, loaded: [...ws.loaded], before: ws.before, toolIds, log: log.map(l => ({ id: l.id, label: l.label, ok: l.ok, detail: l.detail })), running: true };
}

/* hooks: onText(txt) · onPending(name) · onTool({phase:'start'|'end', id, label, ok}) · onPlan(items) · onChanged()
   resume=true continúa el hilo guardado en p.session.
   Devuelve siempre un resultado (no lanza): { text, changed, before, hist, log, plan, error, aborted, paused } */
export async function runAgent(p, toolIds, hooks = {}, resume = false) {
  const cfg = state.cfg, S = resume && p.session ? p.session : null;
  if (S) toolIds = S.toolIds || [];
  const system = buildSystem(p, toolIds);
  const maxSteps = Math.min(80, Math.max(5, +cfg.maxSteps || 30));
  const ws = { p, before: S ? S.before : {}, plan: S ? S.plan : [], loaded: new Set(S ? S.loaded : []), dirty: false, stale: false, onPlan: hooks.onPlan };
  const log = S ? S.log.map(l => ({ ...l })) : [];
  let finalText = '', error = '', aborted = false, steps = 0, progress = !!S, nid = 0, nudged = false;
  const fails = new Map();
  const hk = (n, ...a) => hooks[n] && hooks[n](...a);

  let msgs;
  if (S) { msgs = S.msgs; if (msgs.length && msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', text: NUDGE }); }
  else {
    msgs = p.messages.slice(-14).map(m => ({ role: m.role, text: m.hist || m.text }));
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  }
  const note = label => { const e = { id: 'n' + (nid++), label, ok: true }; log.push(e); hk('onTool', { phase: 'start', id: e.id, label }); hk('onTool', { phase: 'end', id: e.id, label, ok: true }); };

  ctl = new AbortController(); const signal = ctl.signal;
  try {
    let chain = await modelChain(cfg), mi = 0;
    const key = m => cfg.provider + '|' + m;
    const usable = () => chain.map((m, i) => i).filter(i => !(cooling.get(key(chain[i])) > Date.now()));
    { const u = usable(); mi = u.length ? u[0] : 0; }           // si todos están sin cupo, se prueba igual desde el principal

    // Un turno del modelo con recuperación: reintento ante caídas y cambio de modelo ante falta de cupo
    const turn = async () => {
      let tries = 0;
      for (;;) {
        try {
          return await streamTurn({ cfg: { ...cfg, model: chain[mi] }, system, messages: msgs, tools: AGENT_TOOLS, signal, onText: hooks.onText || (() => {}), onPending: hooks.onPending });
        } catch (e) {
          const kind = classify(e);
          if (kind === 'abort' || kind === 'fatal') throw e;
          hk('onText', '');
          const canSwitch = chain.length > 1;
          if (kind === 'down' && tries < RETRY_WAITS.length) {
            note('🔁 ' + e.message + ' · reintentando en ' + RETRY_WAITS[tries] / 1000 + 's');
            await wait(RETRY_WAITS[tries++], signal); continue;
          }
          if (canSwitch) {
            const daily = /per.?day|daily|PerDay/i.test(e.message);
            cooling.set(key(chain[mi]), Date.now() + (kind === 'model' ? 3600e3 : daily ? 30 * 60e3 : 2 * 60e3));
            const next = chain.map((m, i) => i).find(i => i !== mi && !(cooling.get(key(chain[i])) > Date.now()));
            if (next !== undefined) {
              note('🔄 «' + chain[mi] + '» ' + (kind === 'quota' ? 'sin cupo' : kind === 'model' ? 'no disponible para agentes' : 'no responde') + ' → probando «' + chain[next] + '»');
              mi = next; tries = 0; continue;
            }
            throw new Error('Se agotaron todos los modelos de respaldo (' + e.message + ')');
          }
          if (kind === 'quota') throw new Error('Se agotó el cupo del modelo (' + e.message + ')');
          throw e;
        }
      }
    };

    for (; steps < maxSteps; steps++) {
      compact(msgs, Math.max(120000, cfg.maxCtx * 3));
      const r = await turn();
      if (!r.text.trim() && !r.calls.length) throw new Error('El modelo no devolvió contenido');
      msgs.push({ role: 'assistant', text: r.text, calls: r.calls });
      if (!r.calls.length && ws.stale && !nudged && steps < maxSteps - 1) {   // no cierra sin verificar lo que cambió
        nudged = true; note('🧪 Verificación automática pendiente'); msgs.push({ role: 'user', text: VERIFY }); continue;
      }
      if (!r.calls.length) {
        finalText = r.text.trim();
        if (r.stop === 'length') finalText += '\n\n⚠️ La respuesta se cortó por límite de salida. Pedime que continúe.';
        if (!log.length && /```/.test(finalText)) finalText += '\n\n⚠️ El modelo respondió con código en el chat en vez de usar herramientas. Probá con un modelo que soporte tool use.';
        break;
      }
      const results = [];
      for (const c of r.calls) {
        if (signal.aborted) throw new DOMException('Abort', 'AbortError');
        const entry = { id: c.id, label: label(c.name, c.input), ok: null }; log.push(entry);
        hk('onTool', { phase: 'start', id: c.id, label: entry.label });
        const res = c.bad
          ? { ok: false, text: 'Error: la llamada se cortó o llegó con JSON inválido (probablemente por límite de salida). Dividí el archivo en partes más chicas (varios archivos, o write_file corto + edit_file) y reintentá.' }
          : await runTool(c.name, c.input, ws);
        entry.ok = res.ok;
        if (/^(check_project|inspect_page|interact_page|audit_page|diff_changes|find_unused)$/.test(c.name)) entry.detail = res.text.slice(0, 700);   // se muestra desplegable en el chat
        hk('onTool', { phase: 'end', id: c.id, label: entry.label, ok: res.ok, detail: entry.detail });
        let out = res.text;
        if (!res.ok) { const sig = c.name + JSON.stringify(c.input || {}), n = (fails.get(sig) || 0) + 1; fails.set(sig, n); if (n >= 2) out += '\n⚠️ Ya falló ' + n + ' veces con exactamente estos argumentos. No lo repitas: revisá el estado real (read_file, outline_file, search_files) o cambiá de enfoque.'; }
        results.push({ id: c.id, name: c.name, content: out, error: !res.ok });
      }
      msgs.push({ role: 'tool', results }); progress = true;
      if (ws.dirty) { ws.dirty = false; hk('onChanged'); }
      p.session = snapshot(msgs, ws, log, toolIds); save();      // punto de control tras cada ronda completa
    }
    if (steps >= maxSteps) finalText = (finalText || '') + '\n\n⚠️ Llegué al límite de ' + maxSteps + ' pasos. Tocá «Continuar» y retomo desde donde quedé.';
  } catch (e) {
    if (e.name === 'AbortError') aborted = true; else error = e.message || 'Error desconocido';
  } finally { ctl = null; }

  // Cambios netos (comparando contra el estado previo) para chips y deshacer
  const changed = [], before = {};
  Object.entries(ws.before).forEach(([f, old]) => {
    const now = p.files[f] ?? null;
    if (now === old) return;
    before[f] = old; changed.push(now === null ? '− ' + f : f);
  });

  const interrupted = (error || aborted) && progress;
  const hitLimit = !error && !aborted && steps >= maxSteps;
  let text = finalText || (changed.length && !interrupted ? 'Listo.' : '');
  if (interrupted) {
    const n = changed.length;
    text = (aborted ? '⏸ Detenido por vos.' : '⏸ Se interrumpió: ' + error + '.') +
      '\n\nTu proyecto está a salvo' + (n ? ': ' + n + (n === 1 ? ' archivo' : ' archivos') + ' ya guardados.' : '.') +
      ' Tocá «Continuar» y sigo desde donde quedé, sin empezar de nuevo (o deshacé los cambios).';
    p.session = p.session ? { ...p.session, running: false } : undefined;
  } else if (hitLimit) { p.session = p.session ? { ...p.session, running: false } : undefined; }
  else { delete p.session; }                                       // terminó bien: no queda nada pendiente

  return {
    text, changed, before: changed.length ? before : undefined, log, plan: ws.plan, error, aborted,
    paused: !!(interrupted || hitLimit) && !!p.session, progress,
    hist: text + (changed.length ? '\n[Archivos modificados: ' + changed.join(', ') + ']' : '')
  };
}
