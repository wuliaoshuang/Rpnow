/**
 * 测试夹具：开场白里带一整个 HTML 页面的角色卡（仿「属性标签系统」那类开局表单卡）。
 *
 * 页面自带 <style>（元素选择器、*、body、:root、@media、position:fixed 都有）
 * 和 <script>（选项是脚本生成的，确认按钮通过 triggerSlash 把首条消息交给宿主）。
 */
export const SETUP_STYLE = `
:root{--ink:#e6ecff;--line:#1d3a52;--accent:#4aa3d8}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#050510;color:var(--ink);font-family:system-ui,sans-serif}
body{padding:0}
header{position:fixed;top:0;left:0;width:100vw;height:6px;background:#f0f}
.wrap{width:100%;max-width:720px;margin:0 auto;padding:16px}
.tip{background:#eef0ff;color:#223;border:2px solid #a9b;border-radius:14px;padding:10px 14px;margin-bottom:14px}
.sec{margin:18px 0}
.sec h3{font-size:15px;color:var(--ink);border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:10px}
.sec h3 i{color:var(--accent);font-style:normal;margin-right:10px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--line);border-radius:10px;padding:8px 12px;color:var(--ink);background:#0b1220}
.chip.on{background:var(--accent);color:#001}
button{font:inherit;cursor:pointer;border-radius:12px;border:1px solid var(--line);background:#0b1220;color:var(--accent);padding:10px 16px}
textarea{width:100%;min-height:72px;background:#eef0ff;color:#223;border:1px solid #cfd6ee;border-radius:12px;padding:12px;resize:vertical}
input[type=radio]{accent-color:var(--accent)}
label{display:inline-flex;align-items:center;gap:6px;margin-right:14px}
details{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:12px 0}
#confirm{width:100%;background:linear-gradient(90deg,#3b8fb8,#6a4fd8);color:#fff;border:0;font-size:17px;letter-spacing:.5em;padding:16px}
@media (max-width:480px){
  textarea{font-size:16px}
  .wrap{padding:12px}
}
`;

export const SETUP_BODY = `
<header></header>
<div class="wrap">
  <div class="tip">选一个开场，第一幕里系统会按你的人设替你建档。</div>
  <div class="sec"><h3><i>01</i>开局倾向</h3><div class="chips" id="tend"></div></div>
  <div class="sec"><h3><i>02</i>开场情境</h3><div id="scene"></div><button type="button" id="reroll">换一张</button></div>
  <div class="sec"><h3><i>03</i>首名角色年龄</h3>
    <label><input type="radio" name="age" value="18-22" checked>18-22</label>
    <label><input type="radio" name="age" value="23-28">23-28</label>
    <label><input type="radio" name="age" value="29+">29+</label>
  </div>
  <div class="sec"><h3><i>04</i>运行模式</h3><div class="chips" id="mode"></div></div>
  <div class="sec"><h3><i>05</i>补充</h3><textarea id="extra" placeholder="例：故事在成都，今天刚请了半天假"></textarea></div>
  <details id="preview"><summary>将发出的首条消息</summary><pre id="out" style="white-space:pre-wrap"></pre></details>
  <button type="button" id="confirm">确认开局</button>
</div>
`;

export const SETUP_SCRIPT = `
(function(){
  var tends=['日常','暧昧','悬疑'], modes=['轻量','完整'], scenes=['雨夜便利店','清晨地铁','深夜办公室'];
  var st={tend:tends[0],mode:modes[0],scene:0};
  function chips(id,list,key){
    var box=document.getElementById(id); box.innerHTML='';
    list.forEach(function(t){
      var b=document.createElement('span'); b.className='chip'+(st[key]===t?' on':''); b.textContent=t;
      b.setAttribute('data-chip',key+':'+t);
      b.onclick=function(){st[key]=t;render();}; box.appendChild(b);
    });
  }
  function text(){
    var age=(document.querySelector('input[name=age]:checked')||{}).value||'';
    var extra=document.getElementById('extra').value.trim();
    return '【开局】倾向：'+st.tend+'；情境：'+scenes[st.scene]+'；年龄：'+age+'；模式：'+st.mode+(extra?'；补充：'+extra:'');
  }
  function render(){
    chips('tend',tends,'tend'); chips('mode',modes,'mode');
    document.getElementById('scene').textContent=scenes[st.scene];
    document.getElementById('out').textContent=text();
  }
  document.getElementById('reroll').onclick=function(){st.scene=(st.scene+1)%scenes.length;render();};
  document.getElementById('extra').oninput=render;
  document.querySelectorAll('input[name=age]').forEach(function(r){r.onchange=render;});
  document.getElementById('confirm').onclick=function(){
    if (typeof window.triggerSlash==='function') window.triggerSlash(text());
  };
  /* 越界探针：页面脚本试着去碰宿主，结果写在 body 的 data 属性上，测试读它。 */
  var probe={};
  try{ probe.parentDoc = !!(window.top && window.top.document && window.top.document.body); }catch(e){ probe.parentDoc='blocked'; }
  try{ probe.parentStore = !!(window.top && window.top.__rpnowStore); }catch(e){ probe.parentStore='blocked'; }
  try{ window.localStorage.setItem('rp_probe','1'); probe.localStorage = window.localStorage.getItem('rp_probe'); }catch(e){ probe.localStorage='blocked'; }
  try{ probe.indexedDB = !!window.indexedDB && !!window.indexedDB.open('rp_probe'); }catch(e){ probe.indexedDB='blocked'; }
  try{ probe.frameElement = !!window.frameElement; }catch(e){ probe.frameElement='blocked'; }
  try{ probe.cookie = document.cookie; }catch(e){ probe.cookie='blocked'; }
  document.body.setAttribute('data-probe', JSON.stringify(probe));
  try{ window.parent.postMessage({ __probe: probe }, '*'); }catch(e){}
  render();
})();
`;

/** 完整文档。 */
export const SETUP_DOC = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>属性标签系统</title>
<style>${SETUP_STYLE}</style>
</head>
<body>${SETUP_BODY}
<script>${SETUP_SCRIPT}</script>
</body>
</html>`;

export const PROSE_BEFORE = '夜色压下来的时候，系统的提示音在你耳边响了一声。';
export const PROSE_AFTER = '（选好之后点确认，故事就从这里开始。）';

/** 各种形态的开场白。 */
export const VARIANTS = {
  docOnly: SETUP_DOC,
  docWithProse: `${PROSE_BEFORE}\n\n${SETUP_DOC}\n\n${PROSE_AFTER}`,
  docInline: `${PROSE_BEFORE}${SETUP_DOC}${PROSE_AFTER}`,
  docFenced: `${PROSE_BEFORE}\n\n\`\`\`html\n${SETUP_DOC}\n\`\`\`\n\n${PROSE_AFTER}`,
  /** 没有 <html> 的片段：<style> + 结构 + <script>。 */
  fragment: `${PROSE_BEFORE}\n\n<style>${SETUP_STYLE}</style>\n${SETUP_BODY}\n<script>${SETUP_SCRIPT}</script>\n\n${PROSE_AFTER}`,
  /** 只有 <body>，没有 doctype/html。 */
  bodyOnly: `<body><style>${SETUP_STYLE}</style>${SETUP_BODY}<script>${SETUP_SCRIPT}</script></body>`,
  plain: '「请停一下。」\n\n这是一段普通的开场白，没有任何 HTML。',
};
