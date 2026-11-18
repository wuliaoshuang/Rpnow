import { readFileSync, writeFileSync } from 'node:fs';

const js = readFileSync('th-index.js', 'utf8');

// 用 es-module-lexer 精确解析（Node 侧直接 require）
const { init, parse } = await import('es-module-lexer');
await init;
const [imports] = parse(js);

const byTarget = new Map();
for (const imp of imports) {
  if (!imp.n) continue;
  const target = imp.n;
  if (!target.startsWith('.')) continue;
  const key = target;
  if (!byTarget.has(key)) byTarget.set(key, { spec: key, names: new Set() });
  // 导入的绑定：从语句文本里取（lexer 只给 specifier 位置）
}

// lexer 给出每个 import 语句的起止，用文本提取绑定名
const statements = [];
for (const imp of imports) {
  if (!imp.n) continue;
  // ss/se = 整条 import 语句的起止；s/e 只是说明符本身。
  statements.push({ spec: imp.n, start: imp.ss, end: imp.se, d: imp.d });
}

const out = [];
for (const st of statements) {
  if (!st.spec.startsWith('.')) continue;
  const stmt = js.slice(st.start, st.end);
  // import {a as b, c} from "x"  /  import d from "x"  /  import * as ns from "x"
  // import{a as b,c}from"x" —— 注意 import 与 { 之间、} 与 from 之间都可能没有空格。
  const m = stmt.match(/^import\s*([\s\S]*?)\s*from\s*["'][^"']+["']/);
  let names = [];
  if (m) {
    const clause = m[1].trim();
    if (clause.startsWith('*')) {
      names = [`*${clause.replace(/\*\s*as\s*/, '')}`];
    } else if (clause.startsWith('{')) {
      names = clause
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
    } else {
      names = [clause.split(',')[0].trim()];
    }
  }
  out.push({ spec: st.spec, names });
}

// 归一化到宿主路径
const norm = (s) => {
  const m = s.match(/(scripts\/(?:[^"']*))$/);
  return m ? m[1] : s;
};

const grouped = new Map();
for (const { spec, names } of out) {
  const k = norm(spec);
  if (!grouped.has(k)) grouped.set(k, new Set());
  names.forEach((n) => grouped.get(k).add(n));
}

console.log('宿主模块数:', grouped.size);
let total = 0;
for (const [k, names] of [...grouped.entries()].sort()) {
  console.log(`\n${k}  (${names.size} 个绑定)`);
  console.log('  ' + [...names].sort().join(', '));
  total += names.size;
}
console.log('\n总绑定数:', total);
