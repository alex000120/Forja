// Arma el HTML de la vista previa y captura los errores que ocurren dentro de ella
const isRemote = u => /^(https?:)?\/\//i.test(u) || u.startsWith('data:');

export function norm(path) {
  const out = [];
  path.split('/').forEach(s => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
  return out.join('/');
}

// Se ejecuta DENTRO del iframe: avisa a Forja de errores y de recursos que no cargan
function hook() {
  var send = function (m) { try { parent.postMessage({ forja: 1, msg: String(m).slice(0, 400) }, '*'); } catch (e) {} };
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window) { send('No se pudo cargar: ' + (e.target.src || e.target.href || e.target.tagName)); return; }
    var where = e.filename && e.filename.indexOf('srcdoc') < 0 ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : (e.lineno ? ' (línea ' + e.lineno + ')' : '');
    send((e.message || 'Error') + where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) { send('Promesa rechazada: ' + ((e.reason && e.reason.message) || e.reason)); });
  window.addEventListener('load', function () { setTimeout(function () {
    try {
      var d = document, de = d.documentElement, q = function (s) { return d.querySelectorAll(s); };
      var over = de.scrollWidth > window.innerWidth + 1, wide = [];
      if (over) q('body *').forEach(function (el) {
        if (wide.length >= 4) return;
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
          wide.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));
      });
      parent.postMessage({ forjaReport: {
        title: d.title, lang: de.lang, h1: q('h1').length,
        viewport: !!d.querySelector('meta[name=viewport]'), description: !!d.querySelector('meta[name=description]'),
        imgsNoAlt: q('img:not([alt])').length,
        brokenImgs: [].filter.call(q('img'), function (i) { return i.complete && !i.naturalWidth; }).length,
        noName: [].filter.call(q('button,a[href]'), function (b) { return !(b.textContent.trim() || b.getAttribute('aria-label') || b.getAttribute('title') || b.querySelector('img[alt]')); }).length,
        overflowX: over, wide: wide, width: window.innerWidth, height: de.scrollHeight,
        headings: [].slice.call(q('h1,h2,h3'), 0, 12).map(function (h) { return h.tagName + ': ' + h.textContent.trim().slice(0, 60); }),
        text: (d.body ? d.body.innerText : '').trim().replace(/\s+/g, ' ').slice(0, 240)
      } }, '*');
    } catch (e) { parent.postMessage({ forjaReport: { error: String(e) } }, '*'); }
  }, 500); });
  window.addEventListener('message', function (e) {
    var cmd = e.data && e.data.forjaCmd; if (!cmd) return;
    var out = [], sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    (async function () {
      for (var i = 0; i < cmd.length && i < 25; i++) {
        var s = cmd[i] || {};
        try {
          if (s.do === 'wait') { await sleep(Math.min(+s.ms || 300, 3000)); out.push('⏱ espera ' + (s.ms || 300) + 'ms'); continue; }
          if (s.do === 'eval') { var v = await (new Function('return (' + s.js + ')'))(); out.push('eval → ' + String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, Math.min(+s.max || 400, 3000))); continue; }
          if (s.do === 'count') { out.push(s.sel + ' → ' + document.querySelectorAll(s.sel).length + ' elemento(s)'); continue; }
          var el = s.sel ? document.querySelector(s.sel) : null;
          if (!el) { out.push('✗ ' + s.do + ': no existe «' + s.sel + '»'); continue; }
          if (s.do === 'click') { el.click(); out.push('✓ click ' + s.sel); }
          else if (s.do === 'type') { el.focus(); el.value = s.value || ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); out.push('✓ escribió en ' + s.sel); }
          else if (s.do === 'text') out.push('texto de ' + s.sel + ': «' + el.innerText.trim().replace(/\s+/g, ' ').slice(0, 300) + '»');
          else out.push('✗ acción desconocida «' + s.do + '»');
          await sleep(60);
        } catch (err) { out.push('✗ ' + s.do + ': ' + ((err && err.message) || err)); }
      }
      parent.postMessage({ forjaResult: out }, '*');
    })();
  });
  var ce = console.error;
  console.error = function () { send([].slice.call(arguments).join(' ')); return ce.apply(console, arguments); };
}
const HOOK = '<script>(' + hook.toString() + ')()<\/script>';

export const errors = [];
let onChange = () => {};
export const watchErrors = fn => { onChange = fn; };
const frame = () => document.getElementById('frame');

window.addEventListener('message', e => {
  const d = e.data;
  if (!d || !d.forja || e.source !== frame().contentWindow) return;
  if (errors.length < 8 && !errors.includes(d.msg)) { errors.push(d.msg); onChange(); }
});

export function buildPage(p, page) {
  let h = p.files[page];
  if (h == null) return '<p style="font-family:sans-serif;padding:20px">No existe ' + page + '</p>';
  const dir = page.includes('/') ? page.replace(/[^/]*$/, '') : '';
  const get = ref => p.files[norm(ref.startsWith('/') ? ref : dir + ref)];

  h = h.replace(/<link\b[^>]*>/gi, tag => {
    if (!/stylesheet/i.test(tag)) return tag;
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m || isRemote(m[1])) return tag;
    const css = get(m[1]);
    return css == null ? tag : '<style>' + css + '</style>';
  });
  h = h.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src) => {
    if (isRemote(src)) return tag;
    const js = get(src);
    return js == null ? tag : '<script>' + js.replace(/<\/script/gi, '<\\/script') + '<\/script>';
  });
  return /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, m => m + HOOK) : HOOK + h;
}

export function refresh(p, page) {
  errors.length = 0; onChange();
  frame().srcdoc = buildPage(p, page || p.page || 'index.html');
}

// Renderiza la página en un iframe oculto (sin tocar la vista previa visible) y devuelve errores + informe del DOM
export function inspectPage(p, page, width = 1280, ms = 7000, steps = null) {
  return new Promise(resolve => {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;visibility:hidden;height:800px;width:' + width + 'px';
    const errs = []; let report = null, results = null, done = false;
    const fin = () => {
      if (done) return; done = true;
      window.removeEventListener('message', on); f.remove(); resolve({ errors: errs, report, results });
    };
    const on = e => {
      if (e.source !== f.contentWindow || !e.data) return;
      if (e.data.forja && errs.length < 10 && !errs.includes(e.data.msg)) errs.push(e.data.msg);
      if (e.data.forjaReport) { report = e.data.forjaReport; if (steps && steps.length) f.contentWindow.postMessage({ forjaCmd: steps }, '*'); else setTimeout(fin, 400); }
      if (e.data.forjaResult) { results = e.data.forjaResult; setTimeout(fin, 500); }
    };
    window.addEventListener('message', on);
    setTimeout(fin, ms);
    document.body.append(f); f.srcdoc = buildPage(p, page);
  });
}
