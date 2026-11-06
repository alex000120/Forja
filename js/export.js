// Exportación: ZIP y subida a GitHub
import { state, current, save } from './state.js';
import { toast, openCfg } from './ui.js';

export async function exportZip() {
  const p = current();
  if (!window.JSZip) return toast('No se cargó la librería ZIP');
  const z = new JSZip();
  Object.entries(p.files).forEach(([k, v]) => z.file(k, v));
  const blob = await z.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = p.name.replace(/\W+/g, '-').toLowerCase() + '.zip';
  a.click(); toast('ZIP descargado');
}

export async function pushGithub() {
  const p = current(), token = state.cfg.gh;
  if (!token) { toast('Agregá tu token de GitHub en Configuración'); return openCfg(); }
  const repo = prompt('Repositorio destino (usuario/repo). Debe existir.', p.repo || '');
  if (!repo) return;
  p.repo = repo; save(); toast('Subiendo…');
  const h = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json' };
  try {
    for (const [k, v] of Object.entries(p.files)) {
      const url = 'https://api.github.com/repos/' + repo + '/contents/' + k.split('/').map(encodeURIComponent).join('/');
      const g = await fetch(url, { headers: h });
      const sha = g.ok ? (await g.json()).sha : undefined;
      const r = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({
        message: 'Actualizado con Forja: ' + k, content: btoa(unescape(encodeURIComponent(v))), sha }) });
      if (!r.ok) throw new Error((await r.json()).message);
    }
    toast('Subido a ' + repo + '. Pages o Vercel lo publicarán solos.');
  } catch (e) { toast('Error de GitHub: ' + e.message); }
}
