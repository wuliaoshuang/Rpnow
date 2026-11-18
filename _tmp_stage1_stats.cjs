const fs=require('fs'),path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const f=path.join(OUT,'stage1_ns_SPreset_FinalRequestProcessing_script.js');
const t=fs.readFileSync(f,'utf8');
const lines=t.split(/\r?\n/);
const out=[];
function log(s){out.push(s);}
log(`FinalRequestProcessing.script chars=${t.length} lines=${lines.length}`);
log('=== counts ===');
for(const [k,re] of Object.entries({
  'window.top':/window\.top/g,'window.parent':/window\.parent/g,'SillyTavern':/SillyTavern/g,
  'getContext':/getContext/g,'extensionSettings':/extensionSettings/g,'Astro':/Astro/g,
  'saveSettingsDebounced':/saveSettingsDebounced/g,'getRequestHeaders':/getRequestHeaders/g,
  'generate':/\.generate\b|generate\(/g,'send_textarea':/send_textarea/g,'send_but':/send_but/g,
  'postMessage':/postMessage/g,'resizeIframe':/resizeIframe/g,'removeOwnIframe':/removeOwnIframe/g,
  'localStorage':/localStorage/g,'CatGod_Oracle_State':/CatGod_Oracle_State/g,'CatGod_Oracle_UI':/CatGod_Oracle_UI/g,
  'CatGod_Oracle_Usage':/CatGod_Oracle_Usage/g,'CatGodOracle':/CatGodOracle/g,
  'catgod-oracle:final-request':/catgod-oracle:final-request/g,'catgod-oracle:theme':/catgod-oracle:theme/g,
  'catgod-oracle:usage':/catgod-oracle:usage/g,'catgod-oracle:change':/catgod-oracle:change/g,
  'globalThis.fetch':/globalThis\.fetch/g,'CustomEvent':/CustomEvent/g,'chatMetadata':/chatMetadata/g,
  'getTokenCountAsync':/getTokenCountAsync/g,'getTokenizerModel':/getTokenizerModel/g,
  'eventSource':/eventSource/g,'enableMenu':/enableMenu/g,'catgodml':/catgodml/g,
})) {const n=(t.match(re)||[]).length; if(n)log(`  ${k} = ${n}`);}
log('=== host-global / context lines ===');
lines.forEach((l,i)=>{if(/window\.top|window\.parent|SillyTavern|getContext|extensionSettings|localStorage|CatGodOracle|catgod-oracle|globalThis\.fetch|chatMetadata|CustomEvent|postMessage/.test(l))log(`  L${i+1}: ${l.trim().slice(0,240)}`);});
log('=== URL literals ===');
[...new Set([...t.matchAll(/https?:\/\/[^\s'"`<>\\)]+/g)].map(m=>m[0]))].forEach(u=>log('  '+u));
fs.writeFileSync(path.join(OUT,'stage1_stats.txt'),out.join('\n'),'utf8');
console.log('WROTE stage1_stats.txt lines=',out.length);
