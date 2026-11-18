// Research-only: dump preset extensions.SPreset / extensions.extensions / regex scripts meta + find regexBinding
const fs=require('fs'), path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const data=JSON.parse(fs.readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json','utf8'));
const out=[];
function log(s){out.push(s);}
const ex=data.extensions;
log('=== extensions.SPreset ===');
log(JSON.stringify(ex.SPreset,null,2).slice(0,4000));
log('=== extensions.extensions (type + first 2000 chars) ===');
const e2=ex.extensions;
log('typeof='+typeof e2+' isArray='+Array.isArray(e2));
log(JSON.stringify(e2,null,2).slice(0,3000));
log('=== regex_scripts meta (all fields except replaceString/findRegex) ===');
(ex.regex_scripts||[]).forEach((r,i)=>{
  const c={}; for(const k of Object.keys(r)){ if(!/replaceString|findRegex/.test(k)) c[k]=r[k]; }
  log(`[${i}] ${JSON.stringify(c)}`);
});
log('=== search regexBinding / inject / getScriptId across whole preset JSON ===');
const raw=fs.readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json','utf8');
for(const t of ['regexBinding','regexBinding_scriptId','getScriptId','injectScript','regex_bind','jnai2d9kgnbs6xzx5c','enableMenu','catgodml','Astro','SPreset']){
  const re=new RegExp(t,'g'); const n=(raw.match(re)||[]).length; log(`  ${t} = ${n}`);
}
log('=== prompts array: which contain catgodml markers ===');
(data.prompts||[]).forEach((p,i)=>{
  const s=JSON.stringify(p);
  if(/catgodml|enableMenu/.test(s)) log(`  prompts[${i}] identifier=${p.identifier} name=${JSON.stringify(p.name)} contentLen=${(p.content||'').length} hasEnable=/enableMenu/.test=${/enableMenu/.test(p.content||'')} snippet=${JSON.stringify((p.content||'').match(/<<<\|[^>]*>>>/g))}`);
});
fs.writeFileSync(path.join(OUT,'ctx.txt'),out.join('\n'),'utf8');
console.log('WROTE ctx.txt lines=',out.length);
