// Research-only statistical analysis of menu.js (script[1])
const fs = require('fs');
const path = require('path');
const OUT = path.join(process.env.TEMP || 'C:/Users/shuang/AppData/Local/Temp', 'dsh-catgod');
const text = fs.readFileSync(path.join(OUT, 'script1.js'), 'utf8');
const lines = text.split(/\r?\n/);
const out = [];
function log(s) { out.push(s); }
function count(re) { return (text.match(re) || []).length; }

log(`menu.js total chars=${text.length} lines=${lines.length}`);
log('=== COUNTS ===');
const pats = {
  'window.top': /window\.top/g,
  'window.parent': /window\.parent/g,
  'SillyTavern': /SillyTavern/g,
  'getContext': /getContext/g,
  'extensionSettings': /extensionSettings/g,
  'getRequestHeaders': /getRequestHeaders/g,
  'generate': /\.generate\b|generate\(/g,
  'saveSettingsDebounced': /saveSettingsDebounced/g,
  'postMessage': /postMessage/g,
  'localStorage': /localStorage/g,
  'CatGodOracle': /CatGodOracle/g,
  'iframe': /iframe/gi,
  'addEventListener': /addEventListener/g,
  'eventOn': /\beventOn\b/g,
  'tavern_events': /tavern_events/g,
  'iframe_events': /iframe_events/g,
  'document.createElement': /document\.createElement/g,
  'getElementById': /getElementById/g,
  'getSelectedPreset': /getSelectedPreset/g,
  'prompts': /\bprompts\b/g,
  'send_textarea': /send_textarea/g,
  'send_but': /send_but/g,
  'DSL <<<|': /<<<\|/g,
  'catgodml': /catgodml/g,
};
for (const [k, re] of Object.entries(pats)) log(`  ${k} = ${count(re)}`);

log('=== URL literals ===');
const urls = [...text.matchAll(/https?:\/\/[^\s'"`<>\\)]+/g)].map(m=>m[0]);
log('  distinct urls:');
[...new Set(urls)].forEach(u=>log('    '+u));
log('  (total occurrences '+urls.length+')');

log('=== localStorage keys (all quoted strings containing CatGod / Oracle / astro) ===');
const keys = [...text.matchAll(/["'`]([^"'`]*(?:CatGod|Oracle|astro|Astro|catgod)[^"'`]*)["'`]/g)].map(m=>m[1]);
[...new Set(keys)].forEach(k=>log('    '+JSON.stringify(k)));

log('=== postMessage: lines with postMessage (context) ===');
lines.forEach((l,i)=>{ if (/postMessage/.test(l)) log(`  L${i+1}: ${l.trim().slice(0,220)}`); });

log('=== addEventListener / eventOn lines ===');
lines.forEach((l,i)=>{ if (/addEventListener|\beventOn\b|tavern_events\.|iframe_events\.|\.on\(/.test(l)) log(`  L${i+1}: ${l.trim().slice(0,240)}`); });

log('=== all event-name string literals (UPPER_SNAKE and known patterns) ===');
const evs = [...text.matchAll(/["'`]([A-Z][A-Z0-9_]{3,})["'`]/g)].map(m=>m[1]);
[...new Set(evs)].forEach(e=>log('    '+e));
log('=== catgod-oracle: / resizeIframe / iframe_ types ===');
const types = [...text.matchAll(/["'`]([^"'`]*(?:catgod-oracle|resizeIframe|iframe|theme|usage|ready|request|response|preset|chat)[^"'`]*)["'`]/gi)].map(m=>m[1]);
[...new Set(types)].filter(t=>t.length<80).forEach(t=>log('    '+JSON.stringify(t)));

log('=== window.top.* / window.parent.* / W.* usage lines ===');
lines.forEach((l,i)=>{ if (/window\.top|window\.parent|\bW\.document|\bW\.\b/.test(l)) log(`  L${i+1}: ${l.trim().slice(0,260)}`); });

fs.writeFileSync(path.join(OUT,'menu_stats.txt'), out.join('\n'), 'utf8');
console.log('WROTE menu_stats.txt, lines=', out.length);
