const fs=require('fs'),path=require('path');
const OUT=path.join(process.env.TEMP||'C:/Users/shuang/AppData/Local/Temp','dsh-catgod');
const d=JSON.parse(fs.readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json','utf8'));
const out=[];
// Walk every string value in the preset and find any that looks like an embedded JS "script"
function walk(v,p,depth){
  if(depth>12)return;
  if(typeof v==='string'){
    if(/async \(\{ request \}\)|run_tool_replacement|resolveHostWin|globalThis\.fetch/.test(v)){
      out.push(`FOUND at ${p} len=${v.length}`);
      fs.writeFileSync(path.join(OUT,'stage1_'+p.replace(/[^a-z0-9]/gi,'_').slice(-40)+'.js'),v,'utf8');
    }
    return;
  }
  if(v&&typeof v==='object'){
    for(const k of Object.keys(v)) walk(v[k],p+'.'+k,depth+1);
  }
}
walk(d,'root',0);
// Also try parsing prompts[46] SPresetSettings content as JSON
const p46=(d.prompts||[]).find(p=>p.identifier==='SPresetSettings');
if(p46){
  out.push('SPresetSettings contentLen='+(p46.content||'').length);
  try{
    const o=JSON.parse(p46.content);
    out.push('SPresetSettings parsed keys: '+Object.keys(o).join(', '));
    fs.writeFileSync(path.join(OUT,'spreset_settings.json'),JSON.stringify(o,null,2).slice(0,200000),'utf8');
  }catch(e){out.push('parse failed: '+e.message);}
}
fs.writeFileSync(path.join(OUT,'stage1_notes.txt'),out.join('\n'),'utf8');
console.log(out.join('\n'));
