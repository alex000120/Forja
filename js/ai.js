// Conexión con la API de IA, armado de instrucciones y aplicación de cambios
import { state } from './state.js';

export const BASE_SYSTEM = `Sos Forja, un asistente experto en crear, modificar y hacer crecer sitios web estáticos para publicar en GitHub Pages o Vercel.
Reglas:
1. Respondé en el idioma del usuario, con una explicación breve (máximo 3 frases).
2. Para crear o reemplazar un archivo devolvé su contenido COMPLETO (nunca fragmentos) con este formato exacto:
\`\`\`file:ruta/archivo.ext
contenido completo
\`\`\`
3. Para borrar un archivo: un bloque \`\`\`delete:ruta/archivo.ext vacío.
4. Organizá el proyecto en carpetas: HTML en la raíz, CSS en css/, JavaScript en js/, imágenes SVG en assets/. Enlazá todo con rutas relativas.
5. Usá scripts clásicos (<script src="js/x.js"></script>), sin import/export entre archivos propios, para que funcione la vista previa. Sin pasos de compilación; las librerías van por CDN (cdnjs o jsdelivr).
6. Solo devolvé los archivos que cambian. No repitas archivos intactos.
7. Diseño cuidado, responsive, accesible y con identidad propia; evitá plantillas genéricas. No inventes URLs de imágenes.
8. Si el pedido es ambiguo, hacé una suposición razonable y decila.
9. Si un archivo figura como omitido por tamaño, no lo reescribas a ciegas: pedile al usuario que lo pegue o te indique qué cambiar.`;

export function buildSystem(p) {
  const { cfg } = state;
  const names = Object.keys(p.files).sort((a, b) => (/\.html$/.test(b) - /\.html$/.test(a)) || a.localeCompare(b));
  let used = 0; const inc = [], skip = [];
  names.forEach(k => { const n = p.files[k].length; if (used + n <= cfg.maxCtx) { inc.push(k); used += n; } else skip.push(k); });

  let s = BASE_SYSTEM;
  if (cfg.instructions.trim()) s += '\n\nINSTRUCCIONES GLOBALES DEL USUARIO:\n' + cfg.instructions.trim();
  if (p.instructions.trim()) s += '\n\nINSTRUCCIONES DE ESTE PROYECTO («' + p.name + '»):\n' + p.instructions.trim();
  s += '\n\nESTRUCTURA DEL PROYECTO:\n' + names.map(k => '- ' + k + ' (' + p.files[k].length + ' caracteres)' + (skip.includes(k) ? ' [OMITIDO por tamaño]' : '')).join('\n');
  s += '\n\nCONTENIDO DE LOS ARCHIVOS:\n' + inc.map(k => '--- ' + k + ' ---\n' + p.files[k]).join('\n');
  return s;
}

async function request(url, headers, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  return j;
}

export async function callAI(p) {
  const c = state.cfg, system = buildSystem(p);
  const messages = p.messages.slice(-14).map(m => ({ role: m.role, content: m.hist || m.text }));
  if (c.provider === 'anthropic') {
    const j = await request('https://api.anthropic.com/v1/messages', {
      'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
    }, { model: c.model, max_tokens: 12000, system, messages });
    return j.content.map(x => x.text || '').join('');
  }
  const j = await request(c.base.replace(/\/$/, '') + '/chat/completions', { authorization: 'Bearer ' + c.key },
    { model: c.model, max_tokens: 12000, messages: [{ role: 'system', content: system }, ...messages] });
  return j.choices[0].message.content;
}

// Aplica los bloques file:/delete: de la respuesta; devuelve texto limpio y archivos tocados
export function applyReply(p, out) {
  const changed = [];
  out = out.replace(/```delete:([^\n]+)\n?```/g, (_, f) => { f = f.trim(); delete p.files[f]; changed.push('− ' + f); return ''; });
  out = out.replace(/```file:([^\n]+)\n([\s\S]*?)```/g, (_, f, body) => {
    f = f.trim().replace(/^\/+/, ''); p.files[f] = body.replace(/\n$/, ''); changed.push(f); return '';
  });
  const text = out.trim() || 'Listo.';
  return { text, changed, hist: text + (changed.length ? '\n[Archivos modificados: ' + changed.join(', ') + ']' : '') };
}
