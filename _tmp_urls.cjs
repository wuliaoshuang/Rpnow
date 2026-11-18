const fs=require('fs'),path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const files=['script0.js','script1.js','regex1_replace.html','regex5_replace.html'];
const out=[];
for(const f of files){
  const t=fs.readFileSync(path.join(OUT,f),'utf8');
  const urls=[...t.matchAll(/https?:\/\/[^\s'"`<>\\)]+/g)].map(m=>m[0]);
  out.push(`=== ${f} (${urls.length} occurrences, ${new Set(urls).size} distinct) ===`);
  [...new Set(urls)].forEach(u=>out.push('  '+u));
}
fs.writeFileSync(path.join(OUT,'urls.txt'),out.join('\n'),'utf8');
console.log(out.join('\n'));
