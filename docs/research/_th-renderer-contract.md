# 酒馆助手（TH）渲染契约 —— 真实包实地调查

> 调查对象：`D:\RPNow\tavern-helper-real.zip` → `JS-Slash-Runner-main/dist/index.js`（v4.12.1，1,154,272 B，Vite 产物）。
> 引用约定：`dist/index.js:L:C` 表示解压后该文件的**行:列**（该文件共 885 行，含多条 80 KB 级超长行，列号用于精确定位）；`src/iframe/*.js` 表示包内未压缩源文件。
> 所有结论均来自包内特征串反查，未在包内出现的字面量一律标注「未找到」。

---

## ① 渲染管线总览

TH 的「前端文档渲染」有三条互不相同的路径，共用同一套判定函数 `Ck` 与同一套 iframe 文档模板 `cI`：

| 路径 | 触发条件 | 入口 | 容器落点 |
|---|---|---|---|
| **A. 常规渲染**（ST 标准） | `render.enabled` 且非 managed | `AI()`（`message_iframe_runtimes`）→ `TI()` → Vue `Render.vue` → `Iframe.vue` | `.mes_text` 内的 `div.TH-render`（Vue Teleport 挂 iframe） |
| **B. 流式渲染** | 同上 + `render.allow_streaming` | `Streaming.vue` → `StreamingOne` | `.mes_text` 的**兄弟节点** `div.TH-streaming` |
| **C. 托管 ChatSurface** | ST ≥ 1.16.0 且 `window.__TAURITAVERN__.api.chatSurface` | `activateTauriTavernChatSurface`（= `$V`）注册 participant，`prepareContent`/`didCommitContent` 回调 | 同上（`qV` 造 `div.TH-render` + `claim`） |

三条路径的共同地基：

1. **判定**：对 `pre` 的**原始文本**做子串匹配 `['html>', '<head>', '<body']`（`Ck`，`dist/index.js:74:67584`）。
2. **包裹**：把符合条件的 `pre` 包进 `<div class="TH-render">`，原 `pre` 隐藏（`hidden!`）。
3. **渲染**：把 `pre > code` 的文本重写成一份完整 HTML 文档（`cI`，`dist/index.js:511:1098`），以 `srcdoc`（默认）或 `blob:` URL（`render.use_blob_url`）灌进 iframe。
4. **自适应**：iframe 内 `adjust_iframe_height.js` 用 `ResizeObserver(body)` + rAF 直接写 `frameElement.style.height = body.scrollHeight + 'px'`；父窗口 resize 时父页 `postMessage({type:'TH_UPDATE_VIEWPORT_HEIGHT'}, '*')`，iframe 内据此重设 `--TH-viewport-height`（`vh` 单位在灌入前被 `sI` 改写）。
5. **重扫**：由 ST 事件总线驱动（`chatLoaded` / `*_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `MESSAGE_DELETED` / `MORE_MESSAGES_LOADED` / 自有 `TH_REQUEST_RENDER_MESSAGE`）。

---

## ② 逐问答复

### 第 1 问　楼层扫描：`mes[mesid` 的 11 处、选择器形态、`mesid → chat[message_id]`、触发回调

#### 1.1 11 处 `mes[mesid` 全表

| # | 位置 | 代码（节选） | 用途 |
|---|---|---|---|
| 1 | `dist/index.js:651:2759` | `` DV(e){EV($(`#chat > .mes[mesid="${e}"]`))} `` | 单楼重渲染（宏替换路径） |
| 2 | `651:3955` | `` MV(e,t,n){$(`#chat > .mes[mesid=${e}]`).find(`pre`)…} `` | 单楼折叠代码块 |
| 3 | `651:4530` | `` $(`#chat > .mes[mesid=${x.length-1}]`).find(`.mes_text`) `` | 流式期间观察最后一楼正文 |
| 4 | `651:10940` | `` $(`#chat > .mes[mesid = "${e}"]`,window.parent.document).find(`div.mes_text`) `` | `retrieveDisplayedMessage`（**在 iframe 里跑**，故用 `window.parent.document`；选择器带空格） |
| 5 | `651:11099` | `` t??=$(`#chat > .mes[mesid = "${e}"]`) `` | `refreshOneMessage` 单楼重建 |
| 6 | `651:36566` | `` rH(e+a.length, $(`#chat > .mes[mesid="${e}"]`).last()) `` | `createChatMessages` 插入后补挂 |
| 7 | `651:36992` | `` n=$(`#chat > .mes[mesid="${e}"]`); e===t?n.remove():rH(t,n) `` | `deleteChatMessages` 删除/平移 |
| 8 | `651:38300` | `` n=$(`#chat > .mes[mesid = "${t}"]`) `` | `setChatMessage`（swipe 更新） |
| 9 | `768:61572` | `` c=$(`.mes[mesid="${r.messageId}"]`).find(`.mes_text`) `` | `StreamingOne`（**无 `#chat >` 前缀**，后代选择器） |
| 10 | `768:63469` | `` $(`#chat > .mes[mesid="${e}"]`).find(`.mes_streaming`) `` | `Streaming.destroyIfInvalid` |
| 11 | `768:63812` | `` $(`#chat > .mes[mesid="${e}"]`).find(`.mes_text`) `` | `Streaming.renderOneMessage` |

#### 1.2 直接子选择器还是后代选择器？

**主体是直接子选择器**。`#chat > .mes` 在包内共 **21 处**，覆盖 535/651/768 三个模块：

```js
// dist/index.js:651:2797
function OV(){$(`#chat > .mes`).each((e,t)=>{EV($(t))})}
// dist/index.js:535:1903
function EI(e,t){return TI($(`#chat > .mes`).filter((t,n)=>_.includes(e,Number($(n).attr(`mesid`)))),t)}
// dist/index.js:535:2010
function DI(e,t){let n=Number($(`#chat > .mes`).first().attr(`mesid`));…}
```

**少数例外**（扫描语义不同，不是定位楼层）：

- `NV(e,t){$(`#chat`).find(`pre`).each(…)}`（`651:3946`）—— 折叠代码块时按**后代 `pre`** 全扫。
- `PV(){…$(`#chat`).find(`pre`).filter((e,t)=>$(t).siblings(`iframe`).length===0)…}`（`651:3990` 附近）。
- `$(`.mes[mesid="${r.messageId}"]`)`（`768:61572`）—— 流式组件用后代选择器。
- `$(`#chat`).children(`.mes.last_mes`).attr(`mesid`)`（`768:64609`）—— 取流式中的「最后一楼」。
- `$(`#chat`).find(`#curEditTextarea`)`（`768:61200` 附近）—— 探测编辑器是否打开。

> 结论：**楼层定位契约 = `#chat` 的直接子节点必须是 `.mes`**。RPNow 若保留布局包裹层，TH 的 `OV/DI/EI` 全部扫不到（与 `st-plugin-preset-coupling.md` §2.9 一致）。

#### 1.3 `mesid` 如何用于 `chat[message_id]`

- `x` 即 ST 的 `chat`（`dist/index.js:1` 导入：`chat as x`）。
- `TI` 把 DOM 属性直接转成运行时下标：

```js
// dist/index.js:535:1553
function TI(e,t){return _(e.toArray()).map(e=>({
  message_id:Number($(e).attr(`mesid`)),
  reload_memo:t,
  elements:$(e).find(`pre`).filter((e,t)=>Ck($(t).text()))
    .filter((e,t)=>!hF().settings.render.allow_streaming||$(t).closest(`.mes_text, .TH-streaming`).length===0)
    .map((e,t)=>{let n=$(t),r=n.parent(`div.TH-render`);return r.length>0?r[0]:(n.wrap(`<div class="TH-render">`),n.parent(`div.TH-render`)[0])})
    .toArray()
})).filter(({elements:e})=>e.length>0).value()}
```

- `rH(e,t)` 用 `let n=x[e]`（`651:11099` 起）取该楼数据；`KV(e,…)` 用 `x[e]?.is_system` 做深度/隐藏门控（`651:7300` 附近）。
- `DI` 以**首楼层 `mesid` 作为 `chat[]` 的起始下标**（`535:2010`），因此 `mesid` 不是「全局常量 0 起」，而是「当前 DOM 中第一个楼层对应的 `chat` 下标」——windowing/截断时二者会错位，TH 用首楼层 mesid 兜住。
- `qF`（`74:152922`）负责把用户传入的「楼层号」（可为负数）换算成 `chat` 下标，`tH`（`651:9600` 附近）在 `formatAsDisplayedMessage` 里用它。

#### 1.4 它在哪个事件回调里触发扫描

见第 4 问事件表。与「扫描」直接相关的订阅：

- `chatLoaded` → `AI()` 全量重建 runtimes（`535:2966`）；`OV()` 全量重跑宏替换（`651:3050`）。
- `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `TH_REQUEST_RENDER_MESSAGE` → `AI()` 增量更新（`535:3089`）；`DV(Number(t))` 单楼重跑（`651:3084`）。
- `MESSAGE_DELETED` / `MORE_MESSAGES_LOADED` → `AI()` 全量重算（`535:3422`）。
- `TH_REQUEST_RENDER_MESSAGE` 由 `wI()` 的 MutationObserver 在 `#chat` 子树增删 `.mes` 时发出（`535:894`）：

```js
// dist/index.js:535:894
var CI=`TH_REQUEST_RENDER_MESSAGE`;
function wI(e){let t=document.getElementById(`chat`);if(!t)return;
  let n=e=>{if(e.nodeType!==Node.ELEMENT_NODE)return;let t=e;
    if(!t.classList.contains(`mes`))return;let n=t.getAttribute(`mesid`);return n===null?void 0:Number(n)};
  let r=new MutationObserver(e=>{let t=t=>e.flatMap(e=>Array.from(e[t],n)).filter(e=>e!==void 0);
    _.intersection(t(`removedNodes`),t(`addedNodes`)).forEach(e=>{k.emit(CI,e)})});
  I(e,e=>{r.disconnect(),e&&r.observe(t,{childList:!0})},{immediate:!0}),Ar(()=>r.disconnect())}
```

---

### 第 2 问　前端文档判定（`isFrontend` 未找到，真判定是 `Ck`）

#### 2.1 判定函数（唯一真源）

```js
// dist/index.js:74:67584
function Ck(e){return[`html>`,`<head>`,`<body`].some(t=>e.includes(t))}
```

包内**没有** `isFrontend` 字面量（0 处）。`html>` 的 7 处中，只有这一处是判定；其余 6 处是 iframe 文档模板自身的 `<!DOCTYPE html>` / `<html>` / `</html>`（`511:1141`、`512:2`、`532:3`、`778:39`、`779:2`、`793:3`）。

#### 2.2 判定条件逐条

| 条件 | 说明 |
|---|---|
| `e.includes('html>')` | 命中 `<!DOCTYPE html>`、`<html>`、`</html>`，也命中任何含 `html>` 的字符串（如 `data-x="html>"`） |
| `e.includes('<head>')` | **必须带 `>`**，`<head `（带属性）不命中 |
| `e.includes('<body')` | **不带 `>`**，所以 `<body>`、`<body class=…>` 命中，连 `<bodyx` 也命中（误报） |

匹配对象是 **`pre` 的文本内容**（`Ck(e.textContent ?? '')` / `Ck($(t).text())` / `Ck(e.text())`），即 code 围栏里的**原始字符串**，不是渲染后的 DOM。**大小写敏感**，无 `<!DOCTYPE` 单独判定（`<!DOCTYPE` 只因 `html>` 子串而间接命中）。

#### 2.3 判定结果的使用点（哪些形状被当成可渲染文档）

| 位置 | 代码 | 作用 |
|---|---|---|
| `74:67691` | `wk(e){let t=$(e);return t.hasClass('TH-render')\|\|t.is('pre')&&Ck(t.text())}` | 「这个元素是否已是/应是渲染容器」 |
| `74:67785` | `Tk(e){let t=$(e);return wk(t[0])\|\|t.find('div.TH-render').length>0\|\|t.find('pre').filter((e,t)=>wk(t)).length>0}` | 「这个容器内是否已有可渲染物」（流式去重用） |
| `74:70644` | `Mk(e){let t=$(e);t.hasClass('hljs')\|\|Ck(t.text())\|\|(hljs.highlightElement(e),…)}` | 复制按钮：**命中则不加复制按钮**（避免污染文档） |
| `535:1553` | `TI` 的 `filter((e,t)=>Ck($(t).text()))` | 常规渲染：筛出要渲染的 `pre` |
| `651:3402` | `let i=Ck(e.text());if(t==='frontend_only'&&!i)return;` | 折叠代码块：`frontend_only` 模式下**只折叠可渲染但未被渲染**的块 |
| `651:7395` | `for(let e of t.querySelectorAll('pre'))Ck(e.textContent??'')&&(qV(e),n.claim(e,e=>XV(e,i.use_blob_url)))` | 托管路径 `prepareContent` |
| `651:8872/9177` | `XV` 入口断言 `if(!(e instanceof HTMLPreElement)\|\|!Ck(e.textContent??''))throw …` | 托管渲染前的合法性校验 |
| `768:59960` | `StreamingNestedIframe` 内 `$(r.value).find('pre').filter((e,t)=>Ck($(t).text()))` | 流式嵌套 iframe 收集 |
| `768:65420` | `function n0(){hljs.highlightElement=e=>{Ck($(e).text())\|\|t0(e)}}` | **劫持 hljs**：命中则跳过语法高亮（`optimize_hljs`，默认开） |

#### 2.4 会被当成文档 / 被忽略的形状

**会渲染**：`<!DOCTYPE html><html>…` 、裸 `<html>`、含 `<head>`、含 `<body>`、`</html>`、文本里任何位置出现 `html>` / `<head>` / `<body`。
**不渲染**：纯 `<div>…</div>`、`<iframe>`、`<script>`、纯 markdown、`<HTML>`/`<BODY>`（大写）、`<head `（`<head>` 要求闭括号）、代码里出现 `body` 单词但无 `<body`。

> 副产物：`sI`（`511:3`）会在灌入前把文档里的 `vh` 单位改写成 `var(--TH-viewport-height)` / `calc(var(--TH-viewport-height) * n/100)`，覆盖 CSS `min-height`、内联 `style=`、`.style.minHeight =`、`setProperty('min-height', …)` 四种写法。

---

### 第 3 问　iframe 渲染：`TH-render` 的生命周期与 iframe 属性

#### 3.1 `<div class="TH-render">` 的创建 / 挂载 / 销毁

**创建（三种写法）**

```js
// 常规（TI，535:1553）：已有容器则复用，否则 wrap
let n=$(t), r=n.parent(`div.TH-render`);
return r.length>0 ? r[0] : (n.wrap(`<div class="TH-render">`), n.parent(`div.TH-render`)[0]);

// 折叠（AV，651:3265）：pre 已带折叠按钮或位于 .mes_text/.TH-streaming 内则跳过
function AV(e,t,n){let r=e.parent(`div.TH-render`);
  if(r.children(`div.TH-collapse-code-block-button`).length>0||n&&e.closest(`.mes_text, .TH-streaming`).length>0)return;
  let i=Ck(e.text()); if(t===`frontend_only`&&!i)return;
  r.length===0&&e.wrap(`<div class="TH-render">`); …

// 托管（qV，651:7699）：replaceWith + append，保证容器内只有一个 pre
function qV(e){let t=e.parentElement;
  if(t?.matches(`div.TH-render`)&&t.querySelectorAll(`pre`).length===1)return t;
  let n=document.createElement(`div`); return n.className=`TH-render`,e.replaceWith(n),n.append(e),n}
```

**挂载 iframe**：`Render.vue`（`768:65556`）遍历 `runtimes`，用 Vue `Teleport`（包内别名 `ko`）把 `Iframe.vue` 送进 `.TH-render`：

```js
// dist/index.js:768:69600 附近
(z(!0),B(R,null,gs(r.runtimes,({message_id:e,reload_memo:t,elements:n})=>(z(),B(R,{key:e+t},
  [(z(!0),B(R,null,gs(n,(t,n)=>(z(),V(ko,{key:n,defer:``,to:t},
    [U(r.Iframe,{id:`${e}--${n}`,element:t,"use-blob-url":r.use_blob_url},null,8,[`id`,`element`,`use-blob-url`])]],8,[`to`]))),128))],64))),128))
```

`Iframe.vue`（`533:13`）在挂载时清掉容器内旧 iframe，并把除 iframe 外的子节点全部隐藏：

```js
// dist/index.js:533
var lI=L({__name:`Iframe`,props:{id:{},element:{},useBlobUrl:{type:Boolean}},setup(e,{expose:t){t();
  let n=e,r=$(n.element),i=r.children(`pre`),a=Jo(`iframe`);
  os(()=>{r.find(`iframe`).remove()}),
  Ad(window,`resize`,()=>{a.value?.contentWindow?.postMessage({type:`TH_UPDATE_VIEWPORT_HEIGHT`},`*`)});
  let o=G(e=>{e?.src&&URL.revokeObjectURL(e.src);let t=cI(i.find(`code`).text(),n.useBlobUrl);
    return n.useBlobUrl?{src:URL.createObjectURL(new Blob([t],{type:`text/html`}))}:{srcdoc:t}});
  ls(()=>{o.value.src&&URL.revokeObjectURL(o.value.src)});
  let s=G(()=>`TH-message--${n.id}`);
  ss(()=>{k.emit(`message_iframe_render_started`,s.value)});
  function c(){k.emit(`message_iframe_render_ended`,s.value)}
  ss(()=>{r.children().filter((e,t)=>!$(t).is(`iframe`)).addClass(`hidden!`)}),
  cs(()=>{let e=r.children(`.TH-collapse-code-block-button`);e.length===0?i.removeClass(`hidden!`):e.text(`显示前端代码块`).removeClass(`hidden!`)});
  …
})});
// 渲染（533:736 附近）
function dI(e,t,n,r,i,a){return z(),B(`iframe`,Vc({id:r.prefixed_id,ref:`iframe_ref`,name:r.prefixed_id,loading:`lazy`},
  r.src_prop,{class:`w-full`,frameborder:`0`,onLoad:r.onLoad}),null,16,uI)}
```

**销毁 / 复原**

| 位置 | 动作 |
|---|---|
| `651:2529` | `EV`：`t.find('.TH-render > iframe').remove()` —— 单楼重跑宏替换前先清 iframe |
| `651:4093` | `PV()`：移除 `.TH-collapse-code-block-button`，把「无 iframe 兄弟」的 `pre` 去掉 `hidden!`（设置变更时整体复原） |
| `533` | `os(()=>{r.find('iframe').remove()})`：每次挂载前清旧 iframe |
| `533` | `cs`（组件卸载）：若容器内没有折叠按钮则 `i.removeClass('hidden!')` 让 `pre` 重新可见 |
| `651:9043` | `XV` 返回的清理函数：`JV(i)` 记录占位高度并隐藏容器 → `Ru(null,i)` 卸载 Vue |
| `768:61200` | `StreamingOne` 卸载：断开两个 MutationObserver、`s.remove()`、若无一 `.mes_streaming` 兄弟则给 `.mes_text` 去 `hidden!` |

**托管路径的占位/复原**（`JV`/`YV`，`651:7815` / `651:8400`）：提交前把容器高度与 iframe 高度记进 `data-tt-runtime-placeholder-height` / `data-tt-runtime-iframe-height`，设 `style.height`、`visibility:hidden`、`inert`、`aria-hidden`；iframe 挂载完成后再把高度写回 iframe 并移除这些属性。

#### 3.2 iframe 属性清单

| 属性 | 值 | 证据 |
|---|---|---|
| `id` / `name` | `` `TH-message--${id}` ``，`id` 由 `Render.vue` 传 `` `${message_id}--${elementIndex}` `` | `533:554`、`768:69600` |
| `srcdoc` | 默认；值为 `cI(codeText, useBlobUrl)` 生成的完整 HTML 文档 | `533:353` |
| `src` | `render.use_blob_url` 时改为 `URL.createObjectURL(new Blob([doc],{type:'text/html'}))`，并**额外注入** `<base href="${window.location.origin}"/>` | `533:353`、`511:516` |
| `sandbox` | **未找到**（包内唯一 `sandbox` 字面量是 Vue 的 `domPropAttrConfig`，与 iframe 无关） | `dist/index.js:1:79592` |
| `allow` / `allowfullscreen` | **未找到**（4 处 `allow=` 全是 Vue `ref` 内部实现） | `1:18875/23421/23490/24564` |
| `class` | `w-full`（TH 自带 Tailwind 工具类，见 `dist/index.css`） | `533:736` |
| `frameborder` | `0` | 同上 |
| `loading` | `lazy` | 同上 |
| `style` | 由 iframe 内脚本写 `frameElement.style.height` | `src/iframe/adjust_iframe_height.js:21` |
| CSS 容器规则 | `.TH-render:has(.TH-collapse-code-block-button:not(.hidden!)):has(pre.hidden!){display:inline-block}` | `dist/index.css` |
| 折叠按钮 CSS | `.TH-collapse-code-block-button{…display:inline-block}` | `dist/index.css` |

> 安全提示：iframe **无 sandbox、无 allow**，且 `srcdoc` 文档里预置了指向 `window.parent` 的 lodash / jQuery / `TavernHelper` 全量 API（见第 7 问）。这是一份「同源全权限」契约，RPNow 若引入必须有等价能力或显式降级。

#### 3.3 高度自适应（两套机制）

1. **iframe → 父（直接改样式，不走 postMessage）**：`src/iframe/adjust_iframe_height.js`（包内源文件，`dist/index.js:74:153014` 内联为 `YF`）：

```js
// src/iframe/adjust_iframe_height.js:14-26
let height = 0;
height = body.scrollHeight;
if (!Number.isFinite(height) || height <= 0) return;
frameElement.style.height = `${height}px`;
…
const throttledMeasureAndPost = _.throttle(measureAndPost, 500);
…
const resize_observer = new ResizeObserver(entries => { postIframeHeight(); });
resize_observer.observe(body);
$(() => { postIframeHeight(); observeHeightChange(); });
```

2. **父 → iframe（postMessage）**：父页 `window` resize 时 `postMessage({type:'TH_UPDATE_VIEWPORT_HEIGHT'}, '*')`；iframe 内 `src/iframe/adjust_viewport.js`（内联 `XF`）监听后重设 `--TH-viewport-height`：

```js
// src/iframe/adjust_viewport.js
$('html').css('--TH-viewport-height', `${window.parent.innerHeight}px`);
window.addEventListener('message', function (event) {
  if (event.data?.type === 'TH_UPDATE_VIEWPORT_HEIGHT') {
    $('html').css('--TH-viewport-height', `${window.parent.innerHeight}px`);
  }
});
```

#### 3.4 挂载到哪个父节点

- **常规**：`pre` 位于 `.mes_text` 内，`div.TH-render` 也位于 `.mes_text` 内（`wrap` / `replaceWith` 不改变层级），iframe 由 Teleport 挂进该 div。**不是替换 `pre`**，`pre` 保留在容器内并被 `hidden!` 隐藏。
- **流式**：`StreamingOne`（`768:60683`）把 `.mes_text` 整个加 `hidden!`，再 `insertAfter` 一个 `div.TH-streaming w-full`，iframe 挂进 `.TH-streaming`（`.mes_text` 的兄弟节点，仍在 `.mes_block` 内）。
- **托管**：`qV` 同样在 `.mes_text` 内造 `div.TH-render`。

#### 3.5 iframe 文档模板（`cI`，`dist/index.js:511:1098`；模板体跨 511–531 行）

```
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${useBlobUrl ? `<base href="${window.location.origin}"/>` : ``}
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0!important;padding:0;overflow:hidden!important;max-width:100%!important;}
.user_avatar,.user-avatar{background-image:url('${Lk()}')}
.char_avatar,.char-avatar{background-image:url('${Rk()}')}
</style>
${oI}                        <!-- fontawesome + tailwind + jquery + jquery-ui + vue + vue-router -->
<script src="${aI}"><\/script>   <!-- $F = src/iframe/predefine.js -->
<script src="https://testingcf.jsdelivr.net/gh/N0VI028/JS-Slash-Runner/src/iframe/node_modules/log.js"><\/script>
<script src="${nI}"><\/script>   <!-- XF = src/iframe/adjust_viewport.js -->
<script src="${tI}"><\/script>   <!-- YF = src/iframe/adjust_iframe_height.js -->
</head>
<body>
${codeText}
</body>
</html>
```

脚本 URL 由 `eI(e)=URL.createObjectURL(new Blob([e],{type:'application/javascript'}))` 生成（`503:12`），即 **iframe 运行时的全部预置脚本都是 blob URL**，不依赖宿主的相对路径（唯一例外是 `log.js` 的 jsdelivr 绝对 URL 与 `/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js`）。

`oI`（`503:136`）内容：
```
<link rel="stylesheet" href="https://testingcf.jsdelivr.net/npm/@fortawesome/fontawesome-free/css/all.min.css" />
<script src="/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js"></script>
<script src="https://testingcf.jsdelivr.net/npm/jquery/dist/jquery.min.js"></script>
<script src="https://testingcf.jsdelivr.net/npm/jquery-ui/dist/jquery-ui.min.js"></script>
<link rel="stylesheet" href="https://testingcf.jsdelivr.net/npm/jquery-ui/themes/base/theme.min.css" />
<script src="https://testingcf.jsdelivr.net/npm/jquery-ui-touch-punch"></script>
<script src="https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js"></script>
<script src="https://testingcf.jsdelivr.net/npm/vue-router/dist/vue-router.global.prod.min.js"></script>
```
> 注意：这里硬编码了 ST 的扩展目录绝对路径 `/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js`，以及若干 jsdelivr CDN。RPNow 需替换为本地/自有 CDN，否则 iframe 内 UI 无样式。

---

### 第 4 问　事件订阅表（全量）

TH 的事件源是 ST 的 `eventSource`（包内别名 `k`，`dist/index.js:1` 导入 `eventSource as k`），事件名常量是 `event_types`（别名 `A`）。另有自有事件 `CI` / `QU`。

#### 4.1 渲染主链路（`dist/index.js:535`，`AI()` = `message_iframe_runtimes`）

| 事件 | 回调 | payload 使用 |
|---|---|---|
| `chatLoaded` | `t.value = kI(depth, depth_ignore_hidden)` 全量重建 runtimes | 无 |
| `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `TH_REQUEST_RENDER_MESSAGE` | `OI(_.reject(runtimes, {message_id:Number(n)}), depth, …)` —— 先剔除该楼再按深度重算 | **`message_id`（单数字）** |
| `MESSAGE_DELETED` / `MORE_MESSAGES_LOADED` | `OI(runtimes, depth, …)` 全量重算 | 无（ST 的 `MESSAGE_DELETED` 传删除后长度，TH 未使用） |

初始化兜底（`535:2700` / `535:2853`）：若 `render.enabled` 且 `#chat > .welcomePanel` 存在，立即 `kI(...)`；否则 `setTimeout(…, 3000)` 再试一次。

#### 4.2 宏替换 / 代码折叠（`dist/index.js:651`）

| 事件 | 回调 | payload |
|---|---|---|
| `GENERATE_AFTER_DATA`（ST ≥ 1.13.5） | `TV(t,n)`：把 `{{get_*_variable}}` / `{{format_*_variable}}` 替换进 `t.prompt` | `{prompt, …}` |
| `CHAT_COMPLETION_SETTINGS_READY`（低版本回退） | `TV({prompt:t.messages}, false)` | `t.messages` |
| `chatLoaded` | `OV()`：遍历 `#chat > .mes` 重跑 `EV` | 无 |
| `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `TH_REQUEST_RENDER_MESSAGE` | `DV(Number(t))` → `EV($('#chat > .mes[mesid="${e}"]'))` | **`message_id`** |
| `STREAM_TOKEN_RECEIVED` | 对最后一楼 `.mes_text` 挂 `MutationObserver({childList:true})` | 无（自取 `x.length-1`） |
| `MESSAGE_RECEIVED`（`k.once`） | 断开上面的 observer | 无 |
| `MORE_MESSAGES_LOADED` | `NV(...)` 全量折叠 | 无 |

`EV`（`651:2529`）的行为：找 `.mes_text` → 先用 `cV` 里注册的正则（`{{get_*_variable}}` 等）替换 `innerHTML` → 删 `.TH-render > iframe` → 对命中正则的 `code` 再替换文本 → `Mk`（复制按钮）。

#### 4.3 消息截断（`651:31197` 起）

| 事件 | 回调 |
|---|---|
| `SETTINGS_UPDATED`（`k.once`） | 把「# Messages to Load」文案改成「# Messages to Render」 |
| `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` | `t >= x.length-1` 且开启截断时 `dU()` 删除超出楼层 |
| `MESSAGE_DELETED` | `uU()` 补挂被截断的楼层 |

#### 4.4 流式渲染（`dist/index.js:768:63158`，`Streaming.vue`）

| 事件 | 回调 | payload |
|---|---|---|
| `chatLoaded` | `l({destroy_all:true})` | 无 |
| `CHARACTER_MESSAGE_RENDERED` | `s(); c(e)` | **`message_id`** |
| `MESSAGE_EDITED` / `MESSAGE_SWIPED` / `TH_REQUEST_RENDER_MESSAGE` | `s(); a(e); await Pa(); setTimeout(()=>c(e))` | **`message_id`** |
| `STREAM_TOKEN_RECEIVED` | `c(Number($('#chat').children('.mes.last_mes').attr('mesid')), true)` | 无（自取 last_mes） |
| `MORE_MESSAGES_LOADED` / `MESSAGE_DELETED` | `l()` | 无 |

`Render.vue`（`768:65556`）另有托管专用：`Z1([CHARACTER_MESSAGE_RENDERED, USER_MESSAGE_RENDERED, MESSAGE_DELETED], …)` → `depth>0` 时 `eH()`（`redisplayChat`）。

#### 4.5 设置 / 预设 / 角色联动

| 位置 | 事件 | 用途 |
|---|---|---|
| `74:144484` | `CHAT_CHANGED`（`makeFirst`） | 跟踪当前角色 avatar |
| `74:144705` | `CHAT_CHANGED`（`once`） | 世界书迁移 |
| `74:146402` | `CHAT_CHANGED`（`makeFirst`） | 聊天设置 store |
| `74:148203` | `OAI_PRESET_CHANGED_AFTER`（`makeFirst`） | 预设设置 store |
| `74:148420` | `OAI_PRESET_EXPORT_READY` | 读 `extensions.tavern_helper.scripts` 做导出提示 |
| `74:145732` | `character_export_ready`（自定义事件） | 角色卡导出后写回 `data.extensions.tavern_helper` |
| `768:54683` | `OAI_PRESET_CHANGED_AFTER` | 最大化预设上下文 |
| `794:11570` | `PRESET_RENAMED_BEFORE` | 同步脚本弹窗记录 |
| `794:11897` | `PRESET_DELETED` | 清理 |
| `794:12023` | `OAI_PRESET_CHANGED_AFTER` | 清理 |
| `794:12698` | `CHARACTER_RENAMED` | 同步 |
| `794:13021` | `CHARACTER_DELETED` | 清理 |
| `794:10943` | `SETTINGS_UPDATED`（`once`） | 清理失效预设/角色 |
| `794:12240` | `chatLoaded`（`once`） | 角色脚本首次注入确认 |
| `884:71` | `MESSAGE_SWIPE_DELETED`（ST ≥ 1.13.5） | payload `{message_id, swipe_id}`，维护 `chat[e]` 的 swipes 数组 |
| `855:9007` | `GENERATION_STARTED` / `WORLD_INFO_ACTIVATED` / `CHAT_COMPLETION_SETTINGS_READY` | 提示词查看器数据采集 |
| `862:2284` | `GENERATION_STARTED` / `CHAT_COMPLETION_SETTINGS_READY` | 提示词查看器 |
| `862:1675` | `GENERATION_ENDED` | 查看器等待生成结束 |
| `864:8896` | `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` | 楼层折叠 UI 刷新 |
| `864:11387` | `MESSAGE_DELETED` / `MESSAGE_RECEIVED` / `MESSAGE_SENT` / `MESSAGE_UPDATED` / `*_RENDERED` | 楼层计数 |
| `864:11814` | `STREAM_TOKEN_RECEIVED` + `MESSAGE_RECEIVED`（`once`） | 聊天滚动 |
| `864:11889` | `CHAT_CHANGED` | 聊天滚动 |

#### 4.6 TH 自己发出的事件

| 事件 | 发出点 | payload |
|---|---|---|
| `TH_REQUEST_RENDER_MESSAGE`（`CI`） | `wI` 的 MutationObserver（`535:894`） | **`message_id`** |
| `message_iframe_render_started` / `message_iframe_render_ended` | `Iframe.vue`（`533:592/655`）、`StreamingIframe`（`768:59167/59230`） | iframe 的 `TH-message--*` id |
| `character_export_ready` | `74:144800` 劫持 `window.fetch` 拦截 `/api/characters/export` | `{scripts_summary}` |
| `CHAT_CHANGED` | `uH()`（`651:14707`） | `se()`（当前 chat id） |
| `CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` | `Fk()`（`74:71127`）、`rH`（`651:11953`）、`oU`/`cU`/`uU`/`vU`/`xU` | **`message_id`** |
| `CHAT_COMPLETION_PROMPT_READY` | `659` 的 `JW` | `{chat, dryRun:false}` |

> `CHARACTER_MESSAGE_RENDERED` 在包内 16 处、`USER_MESSAGE_RENDERED` 14 处（含 `A.` 与字符串两种写法），其中订阅 6 处、发射 6 处、其余为 `tavern_events` 常量表（`651:43200`）与 iframe 事件包装（`651:40146` 的 `zU` 会把这些事件的第一个参数 `parseInt`）。

---

### 第 5 问　生命周期：`activateTauriTavernChatSurface` 与初始化链

#### 5.1 导出钩子的定义

包底（`dist/index.js:884`）：

```js
export{$V as activateTauriTavernChatSurface};
```

`$V` 定义在 `651:9454`：

```js
function $V(){
  if(!UV)return;                                  // 非 managed 环境直接 no-op
  if(QV)throw Error(`JS-Slash-Runner managed ChatSurface participant is already registered`);
  WV();                                           // 校验：managed 下不允许 allow_streaming
  let e=HV();
  if(e?.protocolVersion!==1||typeof e.registerParticipant!=`function`)
    throw Error(`TauriTavern ChatSurface participant v1 API is unavailable`);
  QV=e.registerParticipant({
    id:`js-slash-runner/message-runtime`,
    protocolVersion:1,
    prepareContent:GV,
    didCommitContent:ZV
  });
}
```

相关定义：

```js
// 651:6561
function HV(){return window.__TAURITAVERN__?.api?.chatSurface}
// 651:6623
var UV=(()=>{if(bV(Ok,`1.16.0`,`<`))return!1;
  let e=HV()?.isManagedOwnershipRequired;
  if(e===void 0)return!1;
  if(typeof e!=`function`)throw Error(`TauriTavern ChatSurface ownership query is unavailable`);
  let t=e(); if(typeof t!=`boolean`)throw TypeError(`…must return a boolean`); return t})();
// 651:6951
function WV(){let e=hF().settings;
  if(e.render.enabled&&e.render.allow_streaming)throw Error(`JS-Slash-Runner streaming rendering is not supported by managed ChatSurface`);
  return e}
```

**结论**：`hooks.activate` 指向的导出**只负责注册 TauriTavern 托管 ChatSurface 参与者**；在标准 ST（无 `window.__TAURITAVERN__`）下它是 **no-op**。TH 的全部渲染能力由「DOM ready 即执行」的初始化链驱动（见下），与 `activate` 钩子无关。这也解释了为什么 RPNow 即使漏调 `hooks.activate`，TH 的常规渲染代码仍会运行（只是托管路径不注册）。

#### 5.2 托管渲染回调

```js
// 651:7131  prepareContent：宏替换 + 造容器 + 认领 pre
function GV({mesid:e,content:t},n){
  let r=WV();
  if(r.macro.enabled){let n=x[e],r=t.innerHTML,i=wV(r,{role:n?.is_user?`user`:`assistant`});
    i!==r&&(t.innerHTML=i)}
  let{render:i}=r;
  if(i.enabled&&KV(e,i.depth,i.depth_ignore_hidden))
    for(let e of t.querySelectorAll(`pre`))Ck(e.textContent??``)&&(qV(e),n.claim(e,e=>XV(e,i.use_blob_url)))
}
// 651:7300 深度门控：depth=0 全渲染；depth=N 只渲染最近 N 条非系统消息
function KV(e,t,n){if(n&&x[e]?.is_system)return!1;if(t===0)return!0;let r=t;
  for(let t=x.length-1;t>=0;t--)if(!(n&&x[t]?.is_system)){if(t===e)return r>0;if(r--,r===0)return!1}return!1}
// 651:9332  didCommitContent：折叠代码块
function ZV({content:e}){let{render:t}=WV();t.enabled&&t.collapse_code_block!==`none`&&jV(e,t.collapse_code_block)}
// 651:9600 附近
async function eH(){if(UV)try{let{redisplayChat:e}=await VV(async()=>{let{redisplayChat:e}=await import(`../../../../../script.js`);return{redisplayChat:e}},[]);
  await e({startIndex:0,fade:!1})}catch(e){throw QV?.fault(e),e}}
```

`XV`（`651:9043`）是「挂 iframe 并返回清理函数」：

```js
function XV({source:e,mesid:t,content:n},r){
  if(!(e instanceof HTMLPreElement)||!Ck(e.textContent??``))throw Error(`JS-Slash-Runner managed runtime source is no longer eligible`);
  let i=e.parentElement;
  if(!(i instanceof HTMLDivElement)||!i.matches(`div.TH-render`))throw Error(`JS-Slash-Runner managed runtime container is missing`);
  let a=Array.from(n.querySelectorAll(`pre`)).filter(e=>Ck(e.textContent??``)).indexOf(e);
  try{Ru(ul(fI,{id:`${t}--${a}`,element:i,useBlobUrl:r}),i),YV(i)}
  catch(e){throw Ru(null,i),e}
  return()=>{JV(i),Ru(null,i)}
}
```

#### 5.3 DOM ready 初始化链（`dist/index.js:884`）

```js
function Kae(){Gae(),Sq()}                       // 注册斜杠命令 event-emit / audioenable …
function qae(){bV(Ok,`1.13.5`,`>=`)&&k.on(A.MESSAGE_SWIPE_DELETED,({message_id:e,swipe_id:t})=>{…})}
function Jae(){globalThis.YAML=tV,globalThis.z=jee}
var $9=zu(Uae),Yae=qP();$9.use(Yae);var Xae=nm();$9.use(Xae),$9.use(t1),
  $9.use({install:e=>{e.config.globalProperties.t=p}}),
  $(()=>{Um(f().includes(`zh`)?qx():vb()),   // i18n
         Dq(),                               // registerMacro: userAvatarPath / charAvatarPath
         qae(),                              // MESSAGE_SWIPE_DELETED
         Tq(),                               // globalThis.TavernHelper = wq()
         Jae(),                              // globalThis.YAML / globalThis.z
         Kae(),                              // 斜杠命令
         let e=$(`<div id="tavern_helper">`).appendTo(`#extensions_settings`);
         $9.mount(e[0])}),
  $(window).on(`pagehide`,()=>{$9.unmount()});
```

要点：
- `#extensions_settings` 容器在 **DOM ready** 时创建并挂载 Vue 应用（`#tavern_helper`），**不是**由 `activate` 钩子触发。
- `globalThis.TavernHelper = wq()`（`753:290`）暴露 `_th_impl` 与 `_bind`（见第 7 问）。
- 全局设置 store `hF()`（`74:146694`）等 `kk=[APP_READY, 'chatLoaded', SETTINGS_UPDATED]` 三者**任一** `k.once` 命中即 `app_ready=true`。
- 设置持久化：全局在 `extension_settings['tavern_helper']`（`mt` = `extension_settings`，`ik='tavern_helper'`），聊天在 `chat_metadata['tavern_helper']`，预设在 `preset.extensions['tavern_helper']`，角色在 `character.data.extensions['tavern_helper']`。

#### 5.4 首次全量重扫时机

1. `chatLoaded` → `AI()` 的 `kI()`（`535:2966`）+ `kV` 的 `OV()`（`651:3050`）。
2. 若 `#chat > .welcomePanel` 存在（空聊天）→ 立即 `kI()`，否则 3 秒后重试（`535:2700/2853`）。
3. 宏开关（`macro.enabled`）变化 → `Ik()` → `Pk()`（等待当前聊天稳定：`reloadChatWithoutEvents`）→ `Fk()` 遍历 `#chat > .mes` 逐楼发射 `CHARACTER_MESSAGE_RENDERED`/`USER_MESSAGE_RENDERED`（`74:71127`），从而触发第 4 问的渲染订阅。
4. `dH = _.debounce(uH, 1000)`（`651:15339`）：正则脚本增删后 1 秒防抖，`uH()` 重挂所有楼层并发 `CHAT_CHANGED`。

---

### 第 6 问　预设关联：`regex_scripts` 的 18 处与数据流向

#### 6.1 `regex_scripts` 18 处分类

| 类别 | 位置 | 代码方向 |
|---|---|---|
| **读·角色卡扩展** | `74:152108` | `getCharacterBook` 邻近，`…regex_scripts\|\|[]` 取卡片扩展 |
| **读·按作用域** | `651:12695` | `aH(e)`：`global → mt.regex`；`character → b.at(n)?.data?.extensions?.regex_scripts`；`preset → (in_use?Ct:jk(name))?.extensions?.regex_scripts` |
| **写·全局** | `651:15314` | `fH`：`case 'global': mt.regex = n` |
| **写·预设（使用中）** | `651:15544` | `_.set(Ct,'extensions.regex_scripts',n)` + `Ae()`（saveSettingsDebounced） |
| **写·预设（具名）** | `651:15609` | `_.set(e,'extensions.regex_scripts',n)` + `Ak.savePreset(name,e,{skipUpdate:true})` |
| **写·角色** | `651:15861` | `Uk(String(e),'regex_scripts',n)`（写角色卡扩展字段） |
| **导出角色卡** | `651:26778/26804` | `eU`：`_.get(r,'regex_scripts',[]).map(oH)` 转成 TH 内部形状 |
| **导入角色卡** | `651:27609/27642/27670` | `tU`：`_.set(i,'regex_scripts', t.extensions.regex_scripts.map(sH))` |
| **预设导出/导入** | `660:10261/10280`、`660:11819/11849/11865` | `importRawPreset` / `getPreset`：`regex_scripts.map(oH/sH)` 与 `regex_scripts[0].source` 形状判断 |

`oH`（读）/`sH`（写）是 ST 正则脚本 ↔ TH 内部脚本的双向映射（`651:12799` / `651:13200`），字段含 `id/scriptName/disabled/runOnEdit/findRegex/trimStrings/replaceString/placement/substituteRegex/minDepth/maxDepth/markdownOnly/promptOnly`。

#### 6.2 官方通道的使用情况

- `readPresetExtensionField`：**未找到**（0 处）。
- `getRegexedString`：字面量仅 1 处（`dist/index.js:1` 的 import，别名 `ut`），运行期以 `ut(...)` 出现 **7 处**：

| 位置 | 调用 |
|---|---|
| `74:72004` / `74:72091` | 角色卡处理：`ut(e, dt.AI_OUTPUT)` |
| `651:12063` | `iH` = `formatAsTavernRegexedString`：`ut(e,{user_input,ai_output,slash_command,world_info,reasoning},…)` |
| `653:76` / `653:5471` | `injectPrompts` 相关：`ut(e, dt.USER_INPUT,{isPrompt:true,depth:…})` |
| `855:2307` | 提示词查看器：`ut(e.content, dt.WORLD_INFO,{depth, isMarkdown:false,…})` |

#### 6.3 「预设 ↔ 插件」调用点

| 位置 | 代码 | 数据流 |
|---|---|---|
| `74:148420` | `k.on(A.OAI_PRESET_EXPORT_READY, e=>{let t=_.get(e,'extensions.tavern_helper.scripts',[]);…})` | 预设导出 JSON → 读 TH 内嵌脚本，弹「本次导出包含 N 个带变量或按钮的酒馆助手脚本」 |
| `74:143718` | 迁移：`_.get(t,'data.extensions.TavernHelper_scripts')` / `TavernHelper_characterScriptVariables` → `data.extensions.tavern_helper` | 旧版角色卡字段迁移到 `tavern_helper` |
| `74:146694` | `_.get(mt,ik,{})` → `_.set(mt,ik,…)` | 全局设置读写（`extension_settings['tavern_helper']`） |
| `74:147500` | `_.get(Ak.getPresetList().presets[i],'extensions.tavern_helper',{})` | 预设设置读（`gF`） |
| `74:147600` | `_.set(Ct,'extensions.tavern_helper',n)` / `_.set(preset,'extensions.tavern_helper',n)` | 预设设置写（使用中预设 / 具名预设） |
| `74:145700` | `data.extensions.tavern_helper` 经 `uF` → `Uk(e, ik, n)` | 角色卡设置写 |
| `651:26865` | 导出角色卡时 `_.omit(r,['TavernHelper_scripts','TavernHelper_characterScriptVariables',…])`，并把 `tavern_helper` 由数组转对象 | 角色卡导出清洗 |

> 结论：TH 读**两类**预设数据 ——（a）ST 官方正则 `extensions.regex_scripts`（走 `getRegexedString` 与 `getTavernRegexes`）；（b）TH 自己的 `extensions.tavern_helper.scripts`（走 `_.get` 点号路径，不经 `readPresetExtensionField`）。RPNow 若只实现 `extractPresetDisplayRegexes` 而丢掉 `tavern_helper`，TH 的脚本管理/导出提示会静默失效（不报错，但功能缺）。

---

### 第 7 问　`src/iframe/predefine.js`：iframe 内部运行时如何拿到宿主能力

包内源文件 `JS-Slash-Runner-main/src/iframe/predefine.js`（48 行），被内联为 `dist/index.js` 的 `$F` 常量（`453:3` 起），在 iframe 文档 `<head>` 里以 `<script src="${aI}">`（blob URL）注入。

#### 7.1 `getContext`（源文件 4 处，行 29–32）

```js
// src/iframe/predefine.js:26-34
Object.defineProperty(window, 'SillyTavern', {
  get: () => {
    const SillyTavern = _.get(window.parent, 'SillyTavern');
    const getContext = () => {
      return { ...SillyTavern.getContext(), writeExtensionField: _th_impl.writeExtensionField };
    };
    return { ...getContext(), getContext };
  },
});
```

机制：iframe 不直接引用 `window.parent.SillyTavern` 的快照，而是定义**getter**，每次访问都回父页取最新对象；返回值 = 宿主 `getContext()` 的全字段展开 **＋** 一个 `getContext` 方法 ＋ 一个额外的 `writeExtensionField`（来自 `TavernHelper._th_impl.writeExtensionField`，宿主侧即 `Uk`）。因此 iframe 内脚本可以：

- `SillyTavern.getContext()` —— 拿到父页上下文（角色/聊天/预设/事件总线等）；
- `SillyTavern.someField` —— 直接当对象字段用（因为 getter 已展开）；
- `SillyTavern.writeExtensionField(...)` —— 写角色卡扩展字段。

#### 7.2 预定义的全局名与用途

`predefine.js` 主体（`src/iframe/predefine.js:1-24`）：

```js
window._ = window.parent._;
const iframeId = window.frameElement?.id || window.name;
if (iframeId) {
  window.__TH_IFRAME_ID = iframeId;          // Firefox 移除 srcdoc iframe 后 frameElement 会丢
  if (!window.name) { window.name = iframeId; }
}
let result = _(window);
result = result.merge(_.pick(window.parent, ['EjsTemplate', 'TavernHelper', 'YAML', 'showdown', 'toastr', 'z']));
result = result.merge(_.omit(_.get(window.parent, 'TavernHelper'), '_bind'));
result = result.merge(
  ...Object.entries(_.get(window.parent, 'TavernHelper')._bind).map(([key, value]) => ({
    [key.replace('_', '')]: value.bind(window),
  })),
);
result.value();
_.set(window, '__VUE_PROD_DEVTOOLS__', true);
_.set(window, '__VUE_OPTIONS_API__', true);
_.set(window, '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__', false);
```

| 全局名 | 来源 | 用途 |
|---|---|---|
| `_` | `window.parent._` | lodash，TH 脚本/前端必用 |
| `$` / `jQuery` | 由 `parent_jquery.js`（`QF`/`iI`）注入：`window.$ = window.parent.$` | jQuery |
| `__TH_IFRAME_ID` / `window.name` | `frameElement.id \|\| name` | iframe 身份，供 `getIframeName()` / `getMessageId()` / `getScriptId()` 解析 |
| `EjsTemplate` / `YAML` / `showdown` / `toastr` / `z` | `_.pick(window.parent, …)` | 父页同名全局（`z` 是 yaml 库，见 `Jae()`） |
| `TavernHelper` | 父页 `TavernHelper`（不含 `_bind`） | TH 脚本 API 命名空间（`getVariables`/`triggerSlash`/`generate`…） |
| `eventOn` / `eventEmit` / `eventOnce` / `eventMakeLast` / `eventMakeFirst` / `eventEmitAndWait` / `eventRemoveListener` / `eventClearEvent` / `eventClearListener` / `eventClearAll` | `TavernHelper._bind` 的 `_` 前缀被剥掉 + `bind(window)` | 脚本事件 API |
| `initializeGlobal` / `waitGlobalInitialized` / `registerMacroLike` / `getButtonEvent` / `getScriptButtons` / `replaceScriptButtons` / `updateScriptButtonsWith` / `appendInexistentScriptButtons` / `getScriptName` / `getScriptInfo` / `replaceScriptInfo` / `getVariables` / `getAllVariables` / `replaceVariables` / `updateVariablesWith` / `insertOrAssignVariables` / `insertVariables` / `deleteVariable` / `reloadIframe` / `errorCatched` / `getIframeName` / `getScriptId` / `getCurrentMessageId` | 同上 | 脚本运行时 API |
| `SillyTavern` | getter → `window.parent.SillyTavern` | 见 7.1 |
| `Mvu` | 若父页有 `Mvu` 则定义 getter/setter | 兼容旧脚本 |
| `__VUE_*` 三个标志 | 直接写 | 让 Vue 前端在 iframe 内正常工作 |
| `log.js`（远程脚本） | `<script src="…/log.js">` | 日志 |
| `adjust_viewport` / `adjust_iframe_height` | `<script src="${nI}">` / `${tI}` | 高度自适应 |

> 注：`_bind` 完整键表见 `dist/index.js:753:396-590`（宿主侧 `wq()`）。

#### 7.3 iframe id 命名契约（宿主必须遵守）

| 模式 | 正则/用途 | 位置 |
|---|---|---|
| `TH-message--<mesid>--<index>[_<n>]` | `SI(e)` 解析出 `mesid`，`TH-message--(\d+)--\d+(_\d+)?` | `535:577` |
| `TH-script--<name>--<id>` | `bI()` 校验并剥离前缀得脚本 id | `535:476` |

宿主若自造 iframe，**必须**用这两个命名规则，否则 `getMessageId()`/`getScriptId()` 直接抛错。

---

## ③ TH 需要宿主提供什么（清单表）

### 3.1 DOM 节点

| 节点/选择器 | 要求 | 证据 |
|---|---|---|
| `#chat` | 容器；**其直接子节点必须是 `.mes`** | `651:2797`、`535:1903` |
| `.mes[mesid=N]` | `N = chat[] 下标`；属性还含 `is_user`（TH 用 `attr('is_user')==='true'` 判角色） | `74:71127`、`651:11099` |
| `.mes_text` | 每楼正文容器，内部是 `pre>code`；TH 用 `$('#chat > .mes[mesid=N]').find('.mes_text')` 与 `div.mes_text`（iframe 内） | `651:10940` |
| `.avatar img` / `.ch_name .name_text` / `.mesIDDisplay` / `.tokenCounterDisplay` / `.swipes-counter` | `refreshOneMessage` 会写这些 | `651:11099` 起（`.mes_block` 包内**未找到**，TH 不直接依赖） |
| `.last_mes` | 流式渲染取「当前最后一楼」 | `768:64609` |
| `#chat > .welcomePanel` | 空聊天占位，用于判定「首次全量重扫」时机 | `535:2700` |
| `#extensions_settings` | 设置面板容器；TH 在 DOM ready 时 `append('<div id="tavern_helper">')` 并挂 Vue | `884` |
| `.TH-render` / `.TH-streaming` / `.TH-collapse-code-block-button` | TH 自建，宿主只需保证 Tailwind 工具类（`hidden!`/`w-full`）可用（TH 自带 `dist/index.css`） | `dist/index.css` |
| `#curEditTextarea` / `.mes_streaming` | 流式渲染判定编辑器/流式块 | `768:61200` |

### 3.2 全局对象

| 全局 | 用途 |
|---|---|
| `_`（lodash）、`$`/`jQuery` | 全囊操作 |
| `hljs` | 语法高亮（TH 会临时替换 `hljs.highlightElement`） |
| `toastr`、`Popper` | 提示/弹层 |
| `YAML`、`z`、`showdown`、`EjsTemplate` | iframe 内被 pick 过来 |
| `TavernHelper`（父页） | 脚本 API 命名空间 + `_bind` + `_th_impl` |
| `SillyTavern`（父页，`getContext()`） | iframe 内 `SillyTavern.getContext()` |
| `eventSource`（ST 事件总线）、`event_types` | 订阅/发射 |
| `chat`、`characters`、`chat_metadata`、`extension_settings`、`oai_settings`、`world_info`、`world_names`、`power_user`、`user_avatar`、`persona` 等 | 运行时数据 |
| `MacrosParser`、`PromptManager`、`SlashCommand*`、`getPresetManager`、`getRegexedString`、`parseRegexFromString`、`getContext`、`extensionTypes` | 见 `dist/index.js:1` 的 152 个绑定 |
| `window.__TAURITAVERN__?.api?.chatSurface` | 托管路径（可选；不存在则 `UV=false`） |

### 3.3 事件名 + payload（TH 订阅，必须提供）

`chatLoaded`（payload 对象 `{detail:{id,character}}`，TH 不使用 payload）、`character_message_rendered` / `user_message_rendered` / `message_updated` / `message_swiped`（**单参数 `message_id`**）、`message_edited`、`message_deleted`、`message_received`、`message_sent`、`message_swipe_deleted`（`{message_id, swipe_id}`）、`more_messages_loaded`、`stream_token_received`、`generate_after_data`（`{prompt,…}`）、`chat_completion_settings_ready`（`{messages,…}`）、`settings_updated`、`chat_id_changed`、`oai_preset_changed_after`、`oai_preset_export_ready`、`preset_renamed_before`、`preset_deleted`、`character_renamed`、`character_deleted`、`character_edited`、`generation_started`、`generation_ended`、`generation_stopped`、`world_info_activated`、`app_ready`、`chatcompletion_model_changed`。

TH 自建事件（宿主可选择性实现/转发）：`TH_REQUEST_RENDER_MESSAGE`、`message_iframe_render_started`、`message_iframe_render_ended`、`character_export_ready`。

### 3.4 iframe 通信协议

| 方向 | 通道 | 内容 |
|---|---|---|
| 父 → iframe | `contentWindow.postMessage({type:'TH_UPDATE_VIEWPORT_HEIGHT'}, '*')` | 父窗口 resize 或需要重算视口高度时 |
| iframe → 父 | **直接写** `frameElement.style.height = body.scrollHeight + 'px'` | rAF + `ResizeObserver(body)`，节流 500 ms |
| 父 → iframe | `srcdoc` 文档内预置 `--TH-viewport-height`（`vh` 已被改写） | 文档注入时 |
| iframe 内 | `window.parent.$` / `_.pick(window.parent,…)` / `SillyTavern.getContext()` | 直接同源访问 |
| id | `TH-message--<mesid>--<idx>`、`TH-script--<name>--<id>` | 双向身份解析 |

### 3.5 容器 ID / 类名

`#chat`、`.mes`、`.mes_text`、`.last_mes`、`#extensions_settings`、`#tavern_helper`、`.TH-render`、`.TH-streaming`、`.TH-collapse-code-block-button`、`.mes_streaming`、`.mes[mesid]`。（`.mes_block` 包内未找到，TH 不直接依赖。）

---

## ④ 对 RPNow 的最小契约建议

按「先让 TH 渲染出东西」的顺序，最小可用集如下（不含托管 ChatSurface 路径）：

1. **DOM 契约（最高优先，断链则全盘无渲染）**
   - `#chat` 的**直接子节点**就是 `.mes[mesid=N]`；若必须保留布局层，用 `display:contents` 或把布局类挪到 `#chat` 自身。
   - `.mes` 上保留 `mesid`（= `chat` 下标）、`is_user`、`is_system`、`swipeid`、`ch_name`。
   - 正文容器同时带 `.mes_text` 类名（可在现有 `.rp-md` 上加）。
   - 正文内部保留 `pre>code` 结构（围栏代码块），且 `code.textContent` 未被复制按钮等污染（TH 直接取文本当 HTML 文档）。
   - `#extensions_settings` 存在且可见（TH 在 DOM ready 时挂载设置 UI）。

2. **判定契约**
   - 复刻 `Ck`：`['html>','<head>','<body'].some(s => text.includes(s))`，大小写敏感，作用于 `pre` 文本。
   - 只要 `pre>code` 文本命中，就包 `div.TH-render` 并隐藏原 `pre`；`render.collapse_code_block='frontend_only'` 时只折叠命中项。

3. **iframe 契约**
   - 容器：`.mes_text` 内 `div.TH-render`（流式时用 `.mes_text` 的兄弟 `div.TH-streaming`）。
   - iframe 属性：`id/name = TH-message--<mesid>--<idx>`、`loading=lazy`、`class=w-full`、`frameborder=0`、**不设 sandbox/allow**（或显式评估风险后降级）。
   - `srcdoc` 文档必须包含：`<!DOCTYPE html><html><head>` + `meta viewport` + `<style>`（`overflow:hidden` 等）+ 第三方脚本（tailwind/jquery/jquery-ui/vue/vue-router/fontawesome）+ `predefine.js` + `log.js` + `adjust_viewport.js` + `adjust_iframe_height.js`，body 为 `pre>code` 文本。
   - 高度：iframe 内 `ResizeObserver` 写 `frameElement.style.height`；父页 resize 发 `TH_UPDATE_VIEWPORT_HEIGHT`；`vh` 改写为 `--TH-viewport-height`。
   - 宿主需替换包内硬编码的 `/scripts/extensions/third-party/JS-Slash-Runner/lib/tailwindcss.min.js` 与 jsdelivr URL（或保证可访问）。

4. **事件契约**
   - 在**正文 HTML 写入完成后**发 `character_message_rendered` / `user_message_rendered`（payload = `message_id`）；编辑/滑动发 `message_updated` / `message_swiped`；删除发 `message_deleted`；聊天加载完发 `chatLoaded`。
   - 首次全量：`chatLoaded` 时必须已存在 `.mes` 节点；空聊天给 `#chat > .welcomePanel`。
   - 事件总线用**唯一一条**（避免 `window.eventSource` 与 shim `eventSource` 分裂，见 `st-plugin-preset-coupling.md` §2.10）。
   - `MESSAGE_DELETED` 之后 TH 会自行重算，不依赖 payload。

5. **预设 / 正则契约**
   - 提供 `extensions.regex_scripts`（角色/预设/全局三处）的读取，形状与 ST 一致（`id/scriptName/findRegex/replaceString/placement/markdownOnly/promptOnly/…`）。
   - 提供 `extensions.tavern_helper.scripts`（TH 自有脚本）与 `extensions.tavern_helper.variables` 的读写（全局/聊天/预设/角色四个载体）。
   - `getRegexedString` 需真实实现（TH 在 `formatAsTavernRegexedString`、`injectPrompts`、提示词查看器中共用 7 处）。
   - `readPresetExtensionField` 可后补（TH 未用，但生态其他插件会用）。

6. **生命周期契约**
   - `manifest.hooks.activate` 必须真正调用（RPNow 当前丢失，见 §2.8）；对 TH 而言调不调都能跑，但其他 ST 扩展会依赖。
   - 钩子调用时机在 `#extensions_settings` 与宿主全局就绪之后。
   - TH 的 `activate`（`$V`）在标准 ST 下是 no-op；若 RPNow 不提供 `__TAURITAVERN__.api.chatSurface`，托管路径自动关闭，无需额外处理。

7. **样式契约**
   - 必须加载 TH 的 `dist/index.css`（内含 Tailwind 工具类与 `.TH-render` / `.TH-collapse-code-block-button` 规则），否则 `hidden!`/`w-full` 失效，隐藏逻辑退化为「明文留在页面上」。

8. **验证用例（阶段 D 真机断言）**
   - 导入带显示层正则（`placement=2` + `markdownOnly`）的预设 → 产出代码围栏包裹的 HTML 文档楼层 → 断言 `.mes_text .TH-render iframe#TH-message--<mesid>--0` 存在、原 `pre` 带 `hidden!`、iframe 高度随内容增长、无源码泄露、0 页面错误。

---

## 附：本次「未找到」项

- `isFrontend` 字面量：**未找到**（判定见第 2 问 `Ck`）。
- iframe `sandbox` / `allow` / `allowfullscreen`：**未找到**。
- `readPresetExtensionField`：**未找到**。
- `#chat .mes`（后代形式）：**未找到**；包内只有 `#chat > .mes`（21 处）与 `$('#chat').find('pre')` / `.mes[mesid=…]`（少数）。
- `settings.html`：包内**没有**（设置 UI 为运行时注入，见第 5 问）。
