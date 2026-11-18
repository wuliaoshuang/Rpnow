import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'node:fs';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
const css = await zip.file('JS-Slash-Runner-main/dist/index.css').async('text');

console.log('index.js bytes:', js.length);
console.log('index.css bytes:', css.length);
console.log('\n=== index.js 开头 1200 字符 ===');
console.log(js.slice(0, 1200));
console.log('\n=== index.js 结尾 600 字符 ===');
console.log(js.slice(-600));

// 是否含有 import/export
console.log('\n含 import 语句:', /^\s*import[\s{*'"]/m.test(js));
console.log('含 export 语句:', /^\s*export[\s{*]/m.test(js));
console.log('含动态 import(:', /import\s*\(/.test(js));
console.log('含 require(:', /require\s*\(/.test(js));
console.log('含 SillyTavern:', js.includes('SillyTavern'));
console.log('含 activateTauriTavernChatSurface:', js.includes('activateTauriTavernChatSurface'));
console.log('含 getContext:', js.includes('getContext'));

writeFileSync('th-index.js', js);
writeFileSync('th-index.css', css);
