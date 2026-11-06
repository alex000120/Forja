// Verificación manual: corre en el navegador, sin usar créditos de IA.
// Análisis estático del proyecto + render real de la página a 1280 y 390 px.
import { checkProject } from './tools.js';
import { inspectPage } from './preview.js';

const sevOf = l => l.startsWith('❌') ? 'err' : l.startsWith('⚠') ? 'warn' : 'info';
const clean = l => l.replace(/^(❌|⚠|ℹ)\uFE0F?\s*/, '');
const count = rep => {
  const all = rep.groups.flatMap(g => g.items);
  rep.errs = all.filter(i => i.sev === 'err').length; rep.warns = all.filter(i => i.sev === 'warn').length; return rep;
};

function viewItems({ errors, report: r }) {
  const items = []; let meta = '';
  if (!r) items.push({ sev: 'err', text: 'La página no terminó de cargar en 7 segundos' });
  else if (r.error) items.push({ sev: 'err', text: 'No se pudo generar el informe: ' + r.error });
  else {
    meta = 'alto ' + r.height + 'px';
    if (r.overflowX) items.push({ sev: 'err', text: 'Scroll horizontal; se salen: ' + ((r.wide || []).join(', ') || 'elemento desconocido') });
    if (r.brokenImgs) items.push({ sev: 'err', text: r.brokenImgs + ' imagen(es) rota(s)' });
    if (r.imgsNoAlt) items.push({ sev: 'warn', text: r.imgsNoAlt + ' imagen(es) sin alt' });
    if (r.noName) items.push({ sev: 'warn', text: r.noName + ' botón(es) o enlace(s) sin texto ni aria-label' });
  }
  errors.forEach(e => items.push({ sev: 'err', text: 'Consola: ' + e }));
  return { items, meta };
}

export async function verifyProject(p, onStep = () => {}) {
  const pages = Object.keys(p.files).filter(f => /\.html?$/i.test(f)), page = pages.includes(p.page) ? p.page : pages[0];
  if (!page) return count({ at: Date.now(), page: '—', groups: [{ title: 'Estructura y código', items: [{ sev: 'err', text: 'No hay ninguna página HTML.' }] }] });
  onStep('Revisando estructura y código…');
  const groups = [{ title: 'Estructura y código', items: checkProject(p).split('\n').filter(l => /^(❌|⚠|ℹ)/.test(l)).map(l => ({ sev: sevOf(l), text: clean(l) })) }];
  for (const [w, name] of [[1280, 'Escritorio'], [390, 'Móvil']]) {
    onStep('Probando ' + name.toLowerCase() + ' (' + w + 'px)…');
    groups.push({ title: name + ' · ' + w + 'px', ...viewItems(await inspectPage(p, page, w)) });
  }
  return count({ at: Date.now(), page, groups });
}

// Texto plano para copiar o para pedirle al agente que lo corrija (sin los avisos solo informativos)
export const reportText = rep => rep.groups.flatMap(g => g.items.filter(i => i.sev !== 'info').map(i => '- [' + g.title + '] ' + i.text)).join('\n');
