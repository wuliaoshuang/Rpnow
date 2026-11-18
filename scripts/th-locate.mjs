import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const js = readFileSync('th-index.js', 'utf8');
// 压缩后基本是 1 行；报错位置 74:64817 对应行 74。拆行后定位。
const lines = js.split('\n');
console.log('总行数:', lines.length);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].length > 60000) {
    console.log(`行 ${i + 1} 长度 ${lines[i].length}`);
    console.log('64817 附近:');
    console.log(lines[i].slice(64700, 65100));
    writeFileSync('th-line.txt', lines[i]);
    break;
  }
}
