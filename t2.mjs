globalThis.window = { addEventListener(){} };
globalThis.document = { getElementById(){return null}, body:{append(){}}, createElement(){ return { setAttribute(){}, style:{}, remove(){} }; } };
const { verifyProject, reportText } = await import('./js/verify.js');
const p = { page:'index.html', files:{ 'index.html':'<html><body><div><img src="a.png"></body></html>' } };
const r = await verifyProject(p, s => console.log('·', s));
console.log(r.errs, r.warns, JSON.stringify(r.groups.map(g=>[g.title,g.items.length])));
console.log(reportText(r));
console.log(JSON.stringify(await verifyProject({page:'x',files:{}})).slice(0,160));
