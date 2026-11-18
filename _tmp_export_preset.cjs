// Research-only export helper. Writes extracted preset artifacts to $env:TEMP\dsh-catgod\
const fs = require('fs');
const path = require('path');
const JSZip = require('D:/RPNow/node_modules/jszip');

const PRESET = 'C:/Users/shuang/Downloads/Meowssiah-2.1.6.json';
const OUT = path.join(process.env.TEMP || 'C:/Users/shuang/AppData/Local/Temp', 'dsh-catgod');
fs.mkdirSync(OUT, { recursive: true });

const data = JSON.parse(fs.readFileSync(PRESET, 'utf8'));
console.log('TOP KEYS:', Object.keys(data).join(', '));
console.log('extensions keys:', Object.keys(data.extensions || {}).join(', '));

const scripts = (data.extensions && data.extensions.tavern_helper && data.extensions.tavern_helper.scripts) || [];
console.log('tavern_helper.scripts count:', scripts.length);
scripts.forEach((s, i) => {
  console.log(`  [${i}] name=${JSON.stringify(s.name)} keys=${Object.keys(s).join(',')} contentLen=${(s.content||'').length}`);
  fs.writeFileSync(path.join(OUT, `script${i}.js`), s.content || '', 'utf8');
});

const regex = (data.extensions && data.extensions.regex_scripts) || [];
console.log('regex_scripts count:', regex.length);
regex.forEach((r, i) => {
  console.log(`  [${i}] id=${r.id} scriptName=${JSON.stringify(r.scriptName)} replaceStringLen=${(r.replaceString||'').length} findRegex=${JSON.stringify((r.findRegex||'').slice(0,80))}`);
  fs.writeFileSync(path.join(OUT, `regex${i}_replace.html`), r.replaceString || '', 'utf8');
});

// Also dump the whole extensions.tavern_helper object shape (minus scripts content) for context
const th = Object.assign({}, data.extensions.tavern_helper);
delete th.scripts;
fs.writeFileSync(path.join(OUT, 'tavern_helper_rest.json'), JSON.stringify(th, null, 2), 'utf8');

// Top-level prompt/preset related stats
for (const k of ['prompts','prompt_order','preset','name','openai_settings']) {
  if (data[k] !== undefined) {
    const v = data[k];
    console.log(`TOP ${k}: typeof=${typeof v} ${Array.isArray(v)?'len='+v.length:''} ${typeof v==='string'?'len='+v.length:''}`);
  }
}

// TH zip: list entries
const zipBuf = fs.readFileSync('D:/RPNow/tavern-helper-real.zip');
JSZip.loadAsync(zipBuf).then(async (zip) => {
  const names = Object.keys(zip.files);
  console.log('TH ZIP entry count:', names.length);
  const lines = names.map(n => `${zip.files[n].dir?'[D]':'[F]'} ${n} ${zip.files[n]._data? zip.files[n]._data.uncompressedSize:''}`);
  fs.writeFileSync(path.join(OUT, 'th_zip_list.txt'), lines.join('\n'), 'utf8');
  // extract any predefine / iframe / inject / regex / tavern_helper related files
  const wanted = names.filter(n => !zip.files[n].dir && /predefine|inject|regex|iframe|helper|script|index\.js|manifest|tavern/i.test(n));
  for (const n of wanted) {
    try {
      const txt = await zip.file(n).async('string');
      const safe = n.replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(path.join(OUT, 'th_' + safe + '.txt'), txt, 'utf8');
    } catch (e) { /* binary */ }
  }
  console.log('TH extracted text files:', wanted.length);
  console.log('OUT DIR:', OUT);
  console.log('DONE');
}).catch(e => { console.error('ZIP ERR', e); });
