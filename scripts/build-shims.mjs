/**
 * 实验：为酒馆助手依赖的 26 个宿主模块生成 shim，看它能否加载。
 *
 * 目的不是交付，而是用数据回答「离可用还有多远」——加载后会暴露它接下来
 * 还缺什么（jQuery？DOM 容器？全局对象？）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const js = readFileSync('th-index.js', 'utf8');
const { init, parse } = await import('es-module-lexer');
await init;
const [imports] = parse(js);

const stmts = imports.filter((i) => i.n && i.n.startsWith('.')).map((i) => ({
  spec: i.n,
  stmt: js.slice(i.ss, i.se),
}));

/** 归一化到包内可解析的键：../../../../../scripts/x.js → scripts/x.js */
const norm = (s) => {
  const m = s.match(/(scripts\/[^"']+)$/) ?? s.match(/^(\.\.\/lib\/[^"']+)$/);
  return m ? m[1] : s;
};

const bindingsByModule = new Map();
for (const { spec, stmt } of stmts) {
  const key = norm(spec);
  if (!bindingsByModule.has(key)) bindingsByModule.set(key, new Set());
  const m = stmt.match(/^import\s*([\s\S]*?)\s*from\s*["'][^"']+["']/);
  if (!m) continue;
  const clause = m[1].trim();
  if (clause.startsWith('*')) {
    bindingsByModule.get(key).add('*');
  } else if (clause.startsWith('{')) {
    clause.slice(1, -1).split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      .forEach((n) => bindingsByModule.get(key).add(n));
  } else {
    bindingsByModule.get(key).add(clause.split(',')[0].trim());
  }
}

/** 生成每个宿主模块的 shim 源码。 */
function shimSource(names) {
  const lines = [];
  const star = names.has('*');
  const list = [...names].filter((n) => n !== '*');
  for (const n of list) {
    // 类/函数/常量都用 let 占位，导出同名绑定。
    lines.push(`export const ${n} = globalThis.__rpShimMake(${JSON.stringify(n)});`);
  }
  if (star) {
    lines.push(`const __ns = {};`);
    lines.push(`export default __ns;`);
  }
  return lines.join('\n');
}

const manifest = {};
for (const [key, names] of bindingsByModule) {
  manifest[key] = { count: names.size, source: shimSource(names) };
}
writeFileSync('th-shims.json', JSON.stringify(manifest, null, 1));
console.log('模块数:', manifest ? Object.keys(manifest).length : 0);
for (const [k, v] of Object.entries(manifest)) {
  console.log(`  ${k}  -> ${v.count} 个绑定`);
}
