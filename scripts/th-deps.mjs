import { readFileSync } from 'node:fs';

const js = readFileSync('th-index.js', 'utf8');

// 提取所有 import 的 specifier（含动态 import）
const specs = new Set();
for (const m of js.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specs.add(m[1]);
for (const m of js.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);

const rel = [...specs].filter((s) => s.startsWith('.'));
const bare = [...specs].filter((s) => !s.startsWith('.') && !s.startsWith('http'));
const http = [...specs].filter((s) => s.startsWith('http'));

console.log('相对导入总数:', rel.length);
const uniq = [...new Set(rel)].sort();
console.log('去重后:', uniq.length);
console.log(uniq.slice(0, 60).join('\n'));

// 归一化：这些路径都指向 public/scripts/ 下的文件
const norm = new Set();
for (const s of uniq) {
  // ../../../../../scripts/xxx.js → scripts/xxx.js
  const m = s.match(/(?:^|\/)(scripts\/[^/].*)$/);
  if (m) norm.add(m[1]);
  else norm.add(s);
}
console.log('\n归一化后唯一宿主文件:', norm.size);
console.log([...norm].sort().join('\n'));

console.log('\n裸模块导入:', bare.length, bare.slice(0, 20).join(', '));
console.log('http 导入:', http.length, http.slice(0, 5).join(', '));
