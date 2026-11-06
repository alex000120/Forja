// Arma el HTML de la vista previa incrustando CSS y JS locales del proyecto
const isRemote = u => /^(https?:)?\/\//i.test(u) || u.startsWith('data:');

function norm(path) {
  const out = [];
  path.split('/').forEach(s => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
  return out.join('/');
}

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
  return h;
}

export function refresh(p, page) {
  document.getElementById('frame').srcdoc = buildPage(p, page || p.page || 'index.html');
}
