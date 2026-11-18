import JSZip from 'jszip';
import { readFileSync } from 'node:fs';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');

// 定位 74:147035
const lines = js.split('\n');
const l = lines[73] ?? '';
console.log('line74 len', l.length);
console.log(l.slice(146900, 147300));
