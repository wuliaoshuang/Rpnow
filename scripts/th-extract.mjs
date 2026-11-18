import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
writeFileSync('th-index.js', js);

// `.boolean(` 的上下文 —— 这是 SlashCommandParser/ARGUMENT_TYPE 的枚举校验
let i = -1, n = 0;
while ((i = js.indexOf('.boolean(', i + 1)) !== -1 && n < 3) {
  console.log('---', i);
  console.log(js.slice(Math.max(0, i - 160), i + 60));
  n++;
}
