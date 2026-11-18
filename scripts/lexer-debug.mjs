import { readFileSync } from 'node:fs';

const js = readFileSync('th-index.js', 'utf8');
const { init, parse } = await import('es-module-lexer');
await init;
const [imports] = parse(js);

console.log('imports:', imports.length);
const first = imports.slice(0, 3);
for (const imp of first) {
  console.log('---');
  console.log(JSON.stringify(imp));
  console.log('n =', imp.n);
  console.log('ss..se =', JSON.stringify(js.slice(imp.ss, imp.se)).slice(0, 200));
}
