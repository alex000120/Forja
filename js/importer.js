// Importar un sitio existente: un ZIP (nuevo proyecto) o archivos sueltos (se suman al proyecto actual)
import { current, save, newProject, state } from './state.js';
import { renderAll, toast, setCurFile } from './ui.js';

const TEXT = /\.(html?|css|js|mjs|json|svg|md|txt|xml|webmanifest|csv)$/i;
const SKIP = /(^|\/)(node_modules|\.git|\.github)\//;
const MAX = 400000; // caracteres por archivo

export async function importFiles(list) {
  let skipped = 0, added = 0, target = null;
  const put = (path, text) => {
    if (text.length > MAX) { skipped++; return; }
    (target || (target = current())).files[path] = text; added++;
  };
  for (const f of [...list]) {
    if (/\.zip$/i.test(f.name)) {
      if (!window.JSZip) { toast('No se cargó la librería ZIP'); continue; }
      const z = await JSZip.loadAsync(f);
      const entries = Object.values(z.files).filter(e => !e.dir && !SKIP.test(e.name));
      const tops = new Set(entries.map(e => e.name.split('/')[0]));
      const strip = tops.size === 1 && entries.every(e => e.name.includes('/')) ? [...tops][0] + '/' : '';
      target = newProject(f.name.replace(/\.zip$/i, '')); target.files = {};
      for (const e of entries) {
        const name = e.name.slice(strip.length);
        if (!TEXT.test(name)) { skipped++; continue; }
        put(name, await e.async('string'));
      }
    } else if (TEXT.test(f.name)) put(f.name, await f.text());
    else skipped++;
  }
  if (!target) return toast('No había archivos de texto para importar');
  state.cur = target.id; setCurFile(target.files['index.html'] != null ? 'index.html' : Object.keys(target.files)[0]);
  save(); renderAll();
  toast(added + ' archivos importados' + (skipped ? ' · ' + skipped + ' omitidos (imágenes, fuentes o muy grandes)' : ''));
}
