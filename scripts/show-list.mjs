import { readFileSync } from 'node:fs';

const list = JSON.parse(readFileSync('th-src-list.json', 'utf8'));
console.log(JSON.stringify(list, null, 1).slice(0, 2000));
