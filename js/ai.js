// Conexión directa con la API de IA: streaming + herramientas nativas (tool use) en Anthropic y compatibles con OpenAI
export const PROVIDERS = {
  anthropic:  { label: 'Anthropic (Claude)', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openrouter: { label: 'OpenRouter (muchos modelos)', base: 'https://openrouter.ai/api/v1', model: 'openrouter/free', keyUrl: 'https://openrouter.ai/keys' },
  gemini:     { label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  openai:     { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o', keyUrl: 'https://platform.openai.com/api-keys' },
  custom:     { label: 'Otro (compatible con OpenAI)', base: '', model: '', keyUrl: '' }
};

const baseUrl = c => String(c.provider === 'custom' ? c.base : PROVIDERS[c.provider].base).trim().replace(/\/(chat\/completions|completions|models)\/?$/i, '').replace(/\/+$/, '');
const authHeaders = c => c.provider === 'anthropic'
  ? { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
  : { authorization: 'Bearer ' + c.key };

const errMsg = j => { const e = Array.isArray(j) ? j[0] : j; return e?.error?.message || e?.message || ''; };

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}
const IDLE_MS = 90000; // si la API no manda nada en 90 s, se considera caída

/* Clasifica un error para decidir qué hacer:
   quota: se agotó el cupo gratis · down: caída/red/timeout (reintentar) · model: ese modelo no sirve · fatal: clave inválida u otro */
export function classify(e) {
  if (e.name === 'AbortError') return 'abort';
  const m = String(e.message || ''), st = e.status || 0;
  if (st === 401 || st === 403 || /api key|unauthorized|permission denied|invalid.*key/i.test(m) && st !== 429) return 'fatal';
  if (st === 429 || /quota|rate.?limit|resource.?exhausted|too many requests|exceeded your current/i.test(m)) return 'quota';
  if (st === 404 || st === 400 || st === 422 || /no endpoints|support.*tool|tool.*support|not support|model.*not found|context.*length|too long/i.test(m)) return 'model';
  if (st === 0 || st >= 500 || /overloaded|unavailable|network|fetch|timeout|no respondi|stream|terminated|connection/i.test(m)) return 'down';
  return 'fatal';
}

/* ---------- streaming (SSE) con vigilante de inactividad ---------- */
async function sse(url, headers, body, signal, onData) {
  const inner = new AbortController(); let timedOut = false, timer;
  const onAbort = () => inner.abort(); signal.addEventListener('abort', onAbort);
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; inner.abort(); }, IDLE_MS); };
  try {
    arm();
    const r = await fetch(url, { method: 'POST', signal: inner.signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...body, stream: true }) });
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch {} throw new ApiError(errMsg(j) || ('HTTP ' + r.status), r.status); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      arm(); buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') return;
        let j; try { j = JSON.parse(d); } catch { continue; }
        onData(j);
      }
    }
  } catch (e) {
    if (timedOut) throw new ApiError('La API no respondió en ' + IDLE_MS / 1000 + ' segundos', 0);
    if (e.name === 'AbortError') throw e;
    if (e instanceof ApiError) throw e;
    if (e instanceof TypeError || /network|fetch|terminated|stream/i.test(e.message)) throw new ApiError('Se cortó la conexión con la API (' + e.message + ')', 0);
    throw e;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}

const parseArgs = raw => { if (!raw || !raw.trim()) return { input: {}, bad: false }; try { return { input: JSON.parse(raw), bad: false }; } catch { return { input: {}, bad: true }; } };

/* ---------- un turno del modelo ----------
   Mensajes neutrales de entrada:
     {role:'user', text} · {role:'assistant', text, calls:[{id,name,input}]} · {role:'tool', results:[{id,name,content,error}]}
   Devuelve {text, calls:[{id,name,input,bad}], stop:'tools'|'end'|'length'} */
export async function streamTurn({ cfg, system, messages, tools, signal, onText, onPending }) {
  const c = cfg;
  if (c.provider === 'anthropic') {
    const msgs = messages.map(m => m.role === 'tool'
      ? { role: 'user', content: m.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content, ...(r.error ? { is_error: true } : {}) })) }
      : m.role === 'assistant' && m.calls?.length
        ? { role: 'assistant', content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...m.calls.map(x => ({ type: 'tool_use', id: x.id, name: x.name, input: x.input }))] }
        : { role: m.role, content: m.text });
    const defs = tools.map((t, k) => ({ name: t.name, description: t.description, input_schema: t.schema, ...(k === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}) }));
    const blocks = []; let stop = 'end';
    await sse(baseUrl(c) + '/messages', authHeaders(c), {
      model: c.model, max_tokens: 16000, tools: defs, messages: msgs,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    }, signal, j => {
      if (j.type === 'error') throw new Error(j.error?.message || 'Error de la API');
      if (j.type === 'content_block_start') {
        const b = j.content_block;
        blocks[j.index] = b.type === 'tool_use' ? { tool: true, id: b.id, name: b.name, json: '' } : { tool: false, text: '' };
        if (b.type === 'tool_use') onPending && onPending(b.name);
      } else if (j.type === 'content_block_delta') {
        const b = blocks[j.index]; if (!b) return;
        if (j.delta.type === 'text_delta') { b.text += j.delta.text; onText(blocks.filter(x => x && !x.tool).map(x => x.text).join('')); }
        else if (j.delta.type === 'input_json_delta') b.json += j.delta.partial_json;
      } else if (j.type === 'message_delta' && j.delta?.stop_reason) {
        stop = j.delta.stop_reason === 'tool_use' ? 'tools' : j.delta.stop_reason === 'max_tokens' ? 'length' : 'end';
      }
    });
    const live = blocks.filter(Boolean);
    return {
      text: live.filter(b => !b.tool).map(b => b.text).join(''),
      calls: live.filter(b => b.tool).map(b => ({ id: b.id, name: b.name, ...parseArgs(b.json) })).map(({ input, bad, id, name }) => ({ id, name, input, bad })),
      stop
    };
  }

  // Compatibles con OpenAI (OpenAI, Gemini, OpenRouter, otros)
  const msgs = [{ role: 'system', content: system }];
  messages.forEach(m => {
    if (m.role === 'tool') m.results.forEach(r => msgs.push({ role: 'tool', tool_call_id: r.id, content: r.content, ...(c.provider === 'gemini' ? { name: r.name } : {}) }));
    else if (m.role === 'assistant' && m.calls?.length)
      msgs.push({ role: 'assistant', content: m.text || null, tool_calls: m.calls.map(x => ({ id: x.id, type: 'function', function: { name: x.name, arguments: JSON.stringify(x.input || {}) } })) });
    else msgs.push({ role: m.role, content: m.text });
  });
  const defs = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  let text = '', finish = null; const calls = [], byIdx = {};
  await sse(baseUrl(c) + '/chat/completions', authHeaders(c), { model: c.model, max_tokens: 16000, messages: msgs, tools: defs }, signal, j => {
    if (j.error) throw new Error(j.error.message || 'Error de la API');
    const ch = j.choices?.[0]; if (!ch) return;
    const d = ch.delta || {};
    if (d.content) { text += d.content; onText(text); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? (calls.length ? calls.length - 1 : 0);
      let e = byIdx[i];
      if (!e || (tc.id && e.id && tc.id !== e.id)) {
        e = { id: tc.id || 'call_' + Math.random().toString(36).slice(2, 10), name: '', args: '' };
        calls.push(e); byIdx[i] = e;
      }
      if (tc.function?.name && !e.name) { e.name = tc.function.name; onPending && onPending(e.name); }
      if (tc.function?.arguments) e.args += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  });
  return {
    text,
    calls: calls.filter(e => e.name).map(e => { const { input, bad } = parseArgs(e.args); return { id: e.id, name: e.name, input, bad }; }),
    stop: finish === 'length' ? 'length' : calls.length ? 'tools' : 'end'
  };
}

// Normaliza la URL base: quita rutas de endpoint pegadas por error (/chat/completions, /models) y espacios
const cleanBase = u => String(u || '').trim().replace(/\/(chat\/completions|completions|models)\/?$/i, '').replace(/\/+$/, '');

// Mensaje de error legible (la API puede devolver objeto, array, string o HTML)
const readErr = (j, st) => {
  const e = Array.isArray(j) ? j[0] : j;
  const m = typeof e?.error === 'string' ? e.error : (e?.error?.message || e?.message || '');
  if (st === 401 || st === 403) return 'La API key no es válida o no tiene permiso (HTTP ' + st + ')' + (m ? ': ' + m : '');
  return m || ('HTTP ' + st);
};

async function getJson(url, headers) {
  let r;
  try { r = await fetch(url, { headers }); }
  catch (e) { throw new Error('No se pudo conectar (red, bloqueo CORS o URL incorrecta)'); }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(readErr(j, r.status));
  return j;
}

const NOT_CHAT = /embed|tts|whisper|transcribe|image|dall-e|audio|realtime|moderation|speech|imagen|veo|lyria|aqa|robotics|computer-use|search-preview|instruct$/i;

// Detecta los modelos disponibles con la key y el proveedor indicados
export async function listModels(c) {
  const p = c.provider; let raw = [];
  if (p === 'anthropic') {
    // paginado: se piden todas las páginas
    let after = '';
    for (let i = 0; i < 5; i++) {
      const j = await getJson(baseUrl(c) + '/models?limit=1000' + (after ? '&after_id=' + encodeURIComponent(after) : ''), authHeaders(c));
      raw.push(...(j.data || []));
      if (!j.has_more || !j.last_id) break; after = j.last_id;
    }
  } else if (p === 'gemini') {
    // API nativa: devuelve TODOS los modelos y cuáles sirven para chat (generateContent). La compatible con OpenAI pagina y no lo indica.
    try {
      let tok = '';
      for (let i = 0; i < 5; i++) {
        const j = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), { 'x-goog-api-key': c.key });
        raw.push(...(j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')));
        if (!j.nextPageToken) break; tok = j.nextPageToken;
      }
    } catch (e) {
      if (/key|HTTP 40[13]/i.test(e.message)) throw e;
      raw = (await getJson(baseUrl(c) + '/models', authHeaders(c))).data || [];
    }
  } else {
    const j = await getJson(cleanBase(p === 'custom' ? c.base : PROVIDERS[p].base) + '/models', c.key ? authHeaders(c) : {});
    raw = Array.isArray(j) ? j : (j.data || j.models || []);
  }
  const seen = new Set();
  let list = raw.map(m => {
    const rawId = typeof m === 'string' ? m : (m.id || m.name || m.model || '');
    const id = String(rawId).replace(/^models\//, '');
    const free = !!(/:free$/.test(id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0));
    const tools = Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : undefined;
    return { id, label: (m.display_name || m.displayName || m.name || id).replace(/^models\//, '') + (free ? ' · gratis' : '') + (tools === false ? ' · sin herramientas' : ''), free, tools, ctx: m.context_length || m.inputTokenLimit || 0 };
  }).filter(m => m.id && !seen.has(m.id) && seen.add(m.id));
  if (p === 'gemini') list = list.filter(m => /^gemini/.test(m.id) && !NOT_CHAT.test(m.id));
  if (p === 'openai') list = list.filter(m => /^(gpt|o\d|chatgpt)/.test(m.id) && !NOT_CHAT.test(m.id));
  if (p === 'openrouter') list = list.filter(m => !/embed/i.test(m.id));
  if (p !== 'anthropic') list.sort((a, b) => (b.free - a.free) || a.id.localeCompare(b.id));
  return list;
}

/* ---------- cadena de modelos de respaldo ----------
   Gemini: familia gemini ordenada de más a menos conveniente. OpenRouter: SOLO modelos gratuitos con soporte de herramientas. */
export async function modelChain(cfg) {
  const chain = [cfg.model];
  if (!cfg.autoSwitch || !['gemini', 'openrouter'].includes(cfg.provider)) return chain;
  let list = cfg.modelsFor === cfg.provider ? cfg.models : [];
  if (!list || !list.length) { try { list = await listModels(cfg); } catch { list = []; } }
  let extra = [];
  if (cfg.provider === 'openrouter') {
    extra = list.filter(m => m.free && m.tools !== false && (!m.ctx || m.ctx >= 32000) && m.id !== 'openrouter/free' && !/guard|moderat|embed/i.test(m.id))
      .sort((a, b) => (b.tools === true) - (a.tools === true) || (b.ctx || 0) - (a.ctx || 0)).map(m => m.id).slice(0, 12);
    extra.push('openrouter/free');
  } else {
    const bad = /embed|tts|image|live|audio|learnlm|robotics|computer|research|banana|aqa|native|vision|gemma/i;
    const score = id => {
      const v = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
      const fam = /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 3 : /pro/.test(id) ? 0 : 1;
      const pre = /preview|exp|thinking/.test(id) ? -1.5 : 0;
      return fam * 10 + v + pre;
    };
    extra = list.map(m => m.id).filter(id => /^gemini-/.test(id) && !bad.test(id)).sort((a, b) => score(b) - score(a)).slice(0, 8);
  }
  extra.forEach(id => { if (!chain.includes(id)) chain.push(id); });
  return chain;
}
