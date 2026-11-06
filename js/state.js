// Estado global y persistencia (localStorage)
const KEY = 'forja.v2';

export const DEFAULT_CFG = {
  provider: 'anthropic', key: '', model: 'claude-sonnet-4-6',
  base: '', gh: '', instructions: '', maxCtx: 60000, maxSteps: 30, autoSwitch: true, models: [], modelsFor: '', keys: {}, chosen: {}
};

export const TEMPLATE = {
  'index.html': '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Mi sitio</title>\n<link rel="stylesheet" href="css/styles.css">\n</head>\n<body>\n<main><h1>Mi sitio nuevo</h1><p>Pedile a Forja que lo construya.</p></main>\n<script src="js/app.js"></script>\n</body>\n</html>',
  'css/styles.css': 'body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f2f4f8;color:#1b2433}',
  'js/app.js': '// JavaScript del sitio'
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) {
      const c = s.cfg = { ...DEFAULT_CFG, ...s.cfg };
      c.keys = { ...c.keys }; c.chosen = { ...c.chosen };
      if (c.key && !c.keys[c.provider]) c.keys[c.provider] = c.key;
      return s;
    }
  } catch {}
  return { cfg: { ...DEFAULT_CFG, keys: {}, chosen: {} }, projects: [], cur: null };
}

export const state = load();
export const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch { return false; }
};
export const current = () => state.projects.find(p => p.id === state.cur);
const uid = () => Math.random().toString(36).slice(2, 9);

export function newProject(name) {
  const p = { id: uid(), name: name || 'Proyecto ' + (state.projects.length + 1),
    instructions: '', page: 'index.html', files: { ...TEMPLATE }, messages: [] };
  state.projects.push(p); state.cur = p.id; save(); return p;
}
export function deleteProject(id) {
  state.projects = state.projects.filter(p => p.id !== id);
  if (!state.projects.length) newProject();
  if (state.cur === id || !current()) state.cur = state.projects[0].id;
  save();
}
