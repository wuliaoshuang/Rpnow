// Research-only: extract host-dependency call points from the two HTML regex replaceStrings
const fs = require('fs');
const path = require('path');
const OUT = path.join(process.env.TEMP || 'C:/Users/shuang/AppData/Local/Temp', 'dsh-catgod');
const out = [];
function log(s){out.push(s);}
for (const [file,label] of [['regex1_replace.html','FOLD (~10KB 思维链折叠栏)'],['regex5_replace.html','ORACLE (~36KB 前端综合面板/神谕面板)']]) {
  const text = fs.readFileSync(path.join(OUT,file),'utf8');
  const lines = text.split(/\r?\n/);
  log(`\n########## ${label}  file=${file}  chars=${text.length} lines=${lines.length} ##########`);
  log('DOCTYPE? ' + /^\s*<!DOCTYPE html>/i.test(text));
  const pats = {
    'window.top': /window\.top/g,
    'window.parent': /window\.parent/g,
    'SillyTavern': /SillyTavern/g,
    'getContext': /getContext/g,
    'extensionSettings': /extensionSettings/g,
    'Astro': /Astro/g,
    'saveSettingsDebounced': /saveSettingsDebounced/g,
    'getRequestHeaders': /getRequestHeaders/g,
    'generate': /\.generate\b|generate\(/g,
    'send_textarea': /send_textarea/g,
    'send_but': /send_but/g,
    'postMessage': /postMessage/g,
    'message event': /addEventListener\(['"]message|window\.onmessage|onmessage/g,
    'resizeIframe': /resizeIframe/g,
    'catgod-oracle:theme': /catgod-oracle:theme/g,
    'removeOwnIframe': /removeOwnIframe/g,
    'localStorage': /localStorage/g,
    'CatGod_Oracle_UI': /CatGod_Oracle_UI/g,
    'CatGodOracle': /CatGodOracle/g,
    'iframe': /iframe/gi,
    'getScriptId': /getScriptId/g,
    'TavernHelper': /TavernHelper/g,
    'eventSource': /eventSource/g,
  };
  for(const [k,re] of Object.entries(pats)) { const n=(text.match(re)||[]).length; if(n) log(`  ${k} = ${n}`); }
  log('--- all <script ...> tags ---');
  [...text.matchAll(/<script\b[^>]*>/gi)].forEach(m=>log('    '+m[0]));
  log('--- postMessage lines ---');
  lines.forEach((l,i)=>{ if(/postMessage/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,260)}`); });
  log('--- message listener lines ---');
  lines.forEach((l,i)=>{ if(/addEventListener\(['"]message|onmessage|\.message\b/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,260)}`); });
  log('--- window.top / window.parent / parent.document lines ---');
  lines.forEach((l,i)=>{ if(/window\.top|window\.parent|parent\.document|top\.document/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,300)}`); });
  log('--- SillyTavern / getContext / extensionSettings / saveSettings / generate lines ---');
  lines.forEach((l,i)=>{ if(/SillyTavern|getContext|extensionSettings|saveSettingsDebounced|\.generate\b|generate\(|getRequestHeaders|Astro/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,300)}`); });
  log('--- send_textarea / send_but lines ---');
  lines.forEach((l,i)=>{ if(/send_textarea|send_but/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,300)}`); });
  log('--- localStorage / CatGod_Oracle_UI lines ---');
  lines.forEach((l,i)=>{ if(/localStorage|CatGod_Oracle_UI|CatGodOracle/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,300)}`); });
  log('--- resizeIframe / removeOwnIframe / theme lines ---');
  lines.forEach((l,i)=>{ if(/resizeIframe|removeOwnIframe|catgod-oracle:theme/.test(l)) log(`    L${i+1}: ${l.trim().slice(0,300)}`); });
}
fs.writeFileSync(path.join(OUT,'html_stats.txt'), out.join('\n'),'utf8');
console.log('WROTE html_stats.txt lines=',out.length);
