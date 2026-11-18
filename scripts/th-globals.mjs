import { readFileSync } from 'node:fs';

const js = readFileSync('th-index.js', 'utf8');

// 常见的酒馆全局
const globals = [
  '_', '$', 'jQuery', 'Vue', 'SillyTavern', 'moment', 'DOMPurify', 'localforage',
  'Handlebars', 'hljs', 'library', 'popper', 'toastmanager', 'CryptoJS', 'saveAs',
];
for (const g of globals) {
  const re = new RegExp(`\\b${g.replace(/\$/g, '\\$')}\\b`, 'g');
  const n = (js.match(re) ?? []).length;
  if (n) console.log(`${g}: ${n} 次`);
}

// 找出 bundle 中"未声明就使用"的标识符里，最像全局库的
console.log('\n--- 关键片段 ---');
const i = js.indexOf('_.');
console.log(js.slice(Math.max(0, i - 120), i + 200));
