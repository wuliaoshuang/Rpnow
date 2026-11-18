// Research-only: locate resizeIframe message handler & iframe id scheme in TH dist
const fs=require('fs'),path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const t=fs.readFileSync(path.join(OUT,'th_JS-Slash-Runner-main_dist_index.js.txt'),'utf8');
const out=[];
function around(needle,span=260){
  let i=0,n=0;
  while((i=t.indexOf(needle,i))!==-1 && n<8){
    out.push(`--- "${needle}" @${i} ---`);
    out.push(t.slice(Math.max(0,i-span),i+needle.length+span).replace(/\n/g,'\\n'));
    i+=needle.length;n++;
  }
  if(n===0) out.push(`NOT FOUND: ${needle}`);
}
for(const s of ['resizeIframe','TH-script--','frameElement','contentWindow','addEventListener(`message`',"addEventListener('message'",'iframe_events']){
  around(s);
}
fs.writeFileSync(path.join(OUT,'th_probe.txt'),out.join('\n'),'utf8');
console.log('WROTE th_probe.txt lines=',out.length);
