const fs=require('fs'),path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const d=JSON.parse(fs.readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json','utf8'));
const out=[];
const s=d.extensions.tavern_helper.scripts;
s.forEach((x,i)=>{
  out.push(`=== script[${i}] ===`);
  for(const k of Object.keys(x)){
    if(k==='content'){out.push(`  ${k}: <${x[k].length} chars>`);continue;}
    out.push(`  ${k}: ${JSON.stringify(x[k]).slice(0,600)}`);
  }
});
// print where regexBinding appears
const raw=fs.readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json','utf8');
let i=0,n=0;
while((i=raw.indexOf('regexBinding',i))!==-1 && n<10){out.push('regexBinding @'+i+': '+raw.slice(i-120,i+160).replace(/\n/g,' '));i+=12;n++;}
fs.writeFileSync(path.join(OUT,'scripts_meta.txt'),out.join('\n'),'utf8');
console.log('WROTE',out.length);
