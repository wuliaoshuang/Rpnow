# SillyTavern 消息文本 → 楼层 DOM → 事件 管线（源码级调查）

> 研究阶段产物。仅做研究，未修改任何 `src/` 实现代码，未改动本文件以外的 `docs/` 文件。
> 权威源码：`D:\RPNow\_ref\SillyTavern\public\`（真实 git clone）。
> 引用格式统一写作 `[ST-SRC] <相对 public/ 的路径>:<行号>`；`script.js` 均指 `public/script.js`。
> 摘录片段均 ≤ 30 行。源码里没有的一律写「未在源码中找到」。

---

## ① 管线总览

```mermaid
flowchart TD
    A[chat[i].mes / extra.display_text<br/>原始文本] --> B[messageFormatting 开始<br/>script.js:1800]
    B --> B1[i==0 且非系统/非用户/非推理:<br/>substituteParams 宏替换, 回写 chat[0].mes<br/>1814-1812]
    B1 --> B2[mesForShowdownParse = mes<br/>保存 showdown 输入上下文 :1814]
    B2 --> B3[注释/隐藏消息归一化 isSystem<br/>COMMENT_NAME_DEFAULT / 隐藏系统消息 :1816-1824]
    B3 --> B4[prompt-bias 剥离 :1826-1830]
    B4 --> C{!isSystem ?}
    C -->|是| D[getRegexPlacement :1833-1848<br/>REASONING/USER_INPUT/SLASH_COMMAND/AI_OUTPUT]
    D --> E[算 depth :1851-1853<br/>过滤系统消息后距末尾的距离]
    E --> F[MessageFormatter BEFORE_REGEX 钩子 :1855-1857]
    F --> G[getRegexedString 显示层正则 :1860-1864<br/>characterOverride / isMarkdown:true / depth]
    G --> H[MessageFormatter AFTER_REGEX 钩子 :1866-1868]
    C -->|否| I
    H --> I[fixMarkdown 自动修 Markdown :1871-1873]
    I --> J[encode_tags: 转义 &lt; &gt; :1875-1879]
    J --> K[推理前后缀 escapeHtml :1882-1890]
    K --> L[引号 → &lt;q&gt; 标签 :1892-1926]
    L --> M[converter.makeHtml 即 showdown :1935]
    M --> N[code 标签内换行/&amp; 修复 :1937-1946]
    N --> O[MessageFormatter AFTER_MARKDOWN 钩子 :1948-1950]
    O --> P[allow_name2_display 去角色名前缀 :1953-1955]
    P --> Q[DOMPurify 配置 + sanitizerOverrides :1957-1965<br/>MESSAGE_SANITIZE / ADD_TAGS:custom-style]
    Q --> R[encodeStyleTags :1966 → DOMPurify.sanitize :1967<br/>→ decodeStyleTags 前缀 '.mes_text ' :1968]
    R --> S[返回 sanitized HTML 字符串 :1970]
    S --> T[messageElement.find('.mes_text').html(messageHTML)<br/>script.js:2696 / 2037]
    T --> U[#chat 容器 .mes[mesid=N] 楼层 DOM]
    U --> V[addCopyToCodeBlocks 扫描 'pre code' :2479-2496]
    U --> W[emit CHARACTER_MESSAGE_RENDERED /<br/>USER_MESSAGE_RENDERED / MESSAGE_UPDATED ...]
```

有序版本（与 `script.js:1769-1786` 的函数自带管线注释一致，注意注释把顺序写成 11 步，实际代码里 `mesForShowdownParse`、prompt-bias、quote 转换等步骤穿插其中）：

1. 入口 `messageFormatting(mes, ch_name, isSystem, isUser, messageId, sanitizerOverrides, isReasoning)` — `script.js:1800`。
2. 第 0 条消息做 `substituteParams` 宏替换并可能回写 `chat[0].mes`（`1805-1812`），把当前输入存进 `mesForShowdownParse`（`1814`）。
3. 注释/隐藏系统消息归一化 `isSystem`（`1816-1824`）；剥离 prompt bias（`1826-1830`）。
4. 非系统消息：确定 `regexPlacement`，计算 `depth`，跑 `BEFORE_REGEX` → `getRegexedString`（显示层正则）→ `AFTER_REGEX` 三段扩展钩子（`1832-1869`）。
5. `fixMarkdown`（`1871-1873`）→ `encode_tags` 转义尖括号（`1875-1879`）→ 推理前后缀转义（`1882-1890`）。
6. 各类引号转成 `<q>` 标签（`1892-1931`），`\begin{align*}` → `$$`（`1933-1934`）。
7. **showdown** `converter.makeHtml(mes)`（`1935`）把 Markdown 转 HTML；随后修复 `<code>` 内换行与 `&amp;`（`1937-1946`）。
8. `AFTER_MARKDOWN` 钩子（`1948-1950`）→ 去角色名前缀（`1953-1955`）。
9. DOMPurify 配置 + `sanitizerOverrides` 展开（`1957-1965`）→ `encodeStyleTags`/`sanitize`/`decodeStyleTags`（`1966-1968`）→ 返回字符串（`1970`）。
10. 调用方把返回 HTML 写进 `.mes_text`（`2696`、`2037`、`3728` 等），`addCopyToCodeBlocks` 扫描 `pre code`（`2479-2480`）。
11. 渲染/编辑/删除/滑动/加载等动作结束后 `eventSource.emit(...)` 发射事件（见第 4 问）。

---

## ② 逐问答复

### 第 1 问 `messageFormatting` 全函数（`script.js:1800-1971`）

**函数签名与 JSDoc**：`script.js:1769-1800`。参数语义（含 `messageId`、`sanitizerOverrides`、`isReasoning`）见 `1790-1799`：

```js
// [ST-SRC] script.js:1790-1800
 * @param {number} messageId - Index of the message in the chat array, or -1
 *   for transient messages (e.g. streaming previews).
 * @param {Partial<DOMPurify.Config>} [sanitizerOverrides] - DOMPurify option
 *   overrides. Merged on top of the default config.
 * @param {boolean} [isReasoning=false] - Whether the message is reasoning/thinking
 *   output (affects regex placement and some display rules).
 * @returns {string} Sanitized HTML string ready to assign to `innerHTML`.
 */
export function messageFormatting(mes, ch_name, isSystem, isUser, messageId, sanitizerOverrides = {}, isReasoning = false) {
    if (!mes) {
        return '';
    }
```

**(a) 第 0 条消息宏替换 + `mesForShowdownParse`**：`script.js:1805-1814`

```js
// [ST-SRC] script.js:1805-1814
    if (Number(messageId) === 0 && !isSystem && !isUser && !isReasoning) {
        const mesBeforeReplace = mes;
        const chatMessage = chat[messageId];
        mes = substituteParams(mes, undefined, ch_name);
        if (chatMessage && chatMessage.mes === mesBeforeReplace && chatMessage.extra?.display_text !== mesBeforeReplace) {
            chatMessage.mes = mes;
        }
    }

    mesForShowdownParse = mes;
```

`mesForShowdownParse` 是模块级导出变量，声明于 `script.js:399`：

```js
// [ST-SRC] script.js:398-401
// Markdown converter
export let mesForShowdownParse; //intended to be used as a context to compare showdown strings against
/** @type {import('showdown').Converter} */
export let converter;
```

**`mesForShowdownParse` 的作用（精确结论）**：它在 `messageFormatting` 内被赋值为「即将进入后续 Markdown 转换链之前的原始 `mes`」，按注释是「用作比较 showdown 字符串的上下文」。对整个 `public/` 目录 grep 只有 2 处命中（`script.js:399` 声明、`script.js:1814` 赋值）——**在当前这份源码里没有找到任何读取它的地方**（既无内部读取，也无外部 import 使用）。因此它是一个「供扩展/上下文对比用的导出变量」，但本仓库内**未在源码中找到**消费方；不要臆测它被 showdown 内部使用。它保存的是「正则/引号处理之前、但宏替换之后」的文本，不是 `makeHtml` 的输出。

**(b) markdown 解析器（showdown，非 marked）**：`converter` 是 `showdown.Converter` 实例，初始化于 `reloadMarkdownProcessor()` `script.js:521-539`：

```js
// [ST-SRC] script.js:521-538
export function reloadMarkdownProcessor() {
    converter = new showdown.Converter({
        emoji: true,
        literalMidWordUnderscores: true,
        parseImgDimensions: true,
        tables: true,
        underline: true,
        simpleLineBreaks: true,
        strikethrough: true,
        disableForced4SpacesIndentedSublists: true,
        extensions: [markdownUnderscoreExt()],
    });

    // Inject the dinkus extension after creating the converter
    // Maybe move this into power_user init?
    converter.addExtension(markdownExclusionExt(), 'exclusion');

    return converter;
}
```

`showdown` 来自 `lib.js:16`（`import showdown from 'showdown'`）并经 `script.js:2` 从 `lib.js` 重导入；另有 `addShowdownPatch(showdown)`（`script.js:731`、`scripts/util/showdown-patch.js:5-29`）覆盖 `unhashHTMLSpans` 子解析器以放宽 HTML span 的反哈希。**源码中未出现 `marked`**。转换调用点在 `script.js:1933-1946`：

```js
// [ST-SRC] script.js:1933-1950
        mes = mes.replaceAll('\\begin{align*}', '$$');
        mes = mes.replaceAll('\\end{align*}', '$$');
        mes = converter.makeHtml(mes);

        mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
            // Firefox creates extra newlines from <br>s in code blocks, so we replace them before converting newlines to <br>s.
            return match.replace(/\n/gm, '\u0000');
        });
        mes = mes.replace(/\u0000/g, '\n'); // Restore converted newlines
        mes = mes.trim();

        mes = mes.replace(/<code(.*)>[\s\S]*?<\/code>/g, function (match) {
            return match.replace(/&amp;/g, '&');
        });

        mes = MessageFormatter.runStage(MessageFormatter.stage.AFTER_MARKDOWN, mes,
            { ch_name, isSystem, isUser, messageId, isReasoning },
        );
    }
```

注意 `makeHtml` 只在 `if (!isSystem)` 分支内执行（`script.js:1892` 起），系统消息不走 showdown。「引号 → `<q>`」与 `<style>`/代码围栏保护见 `1892-1931`（`1900-1901` 的正则把 ```` ```…``` 、`~~~…~~~`、反引号、`"…"` 等先排除，避免把围栏里的引号转成 `<q>`）。

**(c) `fixMarkdown`**：调用点 `script.js:1871-1873`：

```js
// [ST-SRC] script.js:1871-1873
    if (power_user.auto_fix_generated_markdown) {
        mes = fixMarkdown(mes, true);
    }
```

定义于 `scripts/power-user.js:429-468`（`forDisplay=true` 时额外补全未配对的 `*` 和 `"`）：

```js
// [ST-SRC] scripts/power-user.js:429-444
export function fixMarkdown(text, forDisplay) {
    // Find pairs of formatting characters and capture the text in between them
    const format = /([*_]{1,2})([\s\S]*?)\1/gm;
    let matches = [];
    let match;
    while ((match = format.exec(text)) !== null) {
        matches.push(match);
    }

    // Iterate through the matches and replace adjacent spaces immediately beside formatting characters
    let newText = text;
    for (let i = matches.length - 1; i >= 0; i--) {
        let matchText = matches[i][0];
        let replacementText = matchText.replace(/(\*|_)([\t \u00a0…]+)|([\t \u00a0…]+)(\*|_)/g, '$1$4');
        newText = newText.slice(0, matches[i].index) + replacementText + newText.slice(matches[i].index + matchText.length);
    }
```

`forDisplay` 分支（`power-user.js:446-467`）会把含奇数个 `*` 或 `"` 的行末尾补上对应字符——这是「显示层」独有的，prompt 清理走 `fixMarkdown(text, false)`（如 `script.js:6563`）。

**(d) DOMPurify / sanitizer 钩子与 `sanitizerOverrides`**：配置与收尾在 `script.js:1957-1970`：

```js
// [ST-SRC] script.js:1957-1971
    /** @type {DOMPurify.Config} */
    const config = {
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false,
        MESSAGE_SANITIZE: true,
        ADD_TAGS: ['custom-style'],
        ...sanitizerOverrides,
    };
    mes = encodeStyleTags(mes);
    mes = DOMPurify.sanitize(mes, config);
    mes = decodeStyleTags(mes, { prefix: '.mes_text ' });

    return mes;
}
```

关键点：
- `sanitizerOverrides` 用扩展运算符**最后**展开，可覆盖默认项（含自定义 `MESSAGE_ALLOW_SYSTEM_UI` 等标志）。
- `MESSAGE_SANITIZE: true` 会激活 `scripts/chats.js:1901-1972` 注册的三个 `DOMPurify.addHook`：`uponSanitizeAttribute`（类名被改写为 `custom-<原名>`，`chats.js:1910-1935`）、`uponSanitizeElement`（未知元素内换行转 `<br>`、外部媒体拦截，`chats.js:1937-1972`）、`afterSanitizeAttributes`（链接 `target=_blank`，`chats.js:1903-1908`）。钩子注册入口是 `script.js:732` 的 `addDOMPurifyHooks()`。
- `encodeStyleTags`/`decodeStyleTags` 在 `scripts/chats.js:536-541` / `551-...`：`<style>…</style>` 先编码成 `<custom-style>…</custom-style>`（因 `ADD_TAGS` 放行），sanitize 后再还原并给每条 CSS 选择器加前缀 `.mes_text `（`chats.js:551-560`），防止 CSS 污染全局 DOM。
- **返回值**：`script.js:1970` 返回的是**字符串**（sanitized HTML），不是 DOM 节点；`RETURN_DOM`/`RETURN_DOM_FRAGMENT`/`RETURN_TRUSTED_TYPE` 全为 `false`。

**(e) `sanitizerOverrides` 的实际传入**：唯一会传非空值的是 `getMessageTextHTML()` `script.js:2523-2537`（`extra.uses_system_ui` 时 `{ MESSAGE_ALLOW_SYSTEM_UI: true }`）；其余调用点一律传 `{}`。

```js
// [ST-SRC] script.js:2523-2537
function getMessageTextHTML(message, { messageId = chat.indexOf(message) }) {
    // if mes.extra.uses_system_ui is true, set an override on the sanitizer options
    /** @type {Partial<DOMPurify.Config>} */
    const sanitizerOverrides = message.extra?.uses_system_ui ? { MESSAGE_ALLOW_SYSTEM_UI: true } : {};

    return messageFormatting(
        message.extra?.display_text || message.mes,
        message.name,
        message.is_system,
        message.is_user,
        messageId,
        sanitizerOverrides,
        false,
    );
}
```

**(f) `.mes_text` 的最终写入**：`messageFormatting` 本身**不写 DOM**，只返回字符串。真正的写入发生在调用方：
- 初次/重绘楼层：`updateMessageElement()` `script.js:2696` `messageElement.find('.mes_text').html(messageHTML);`（`messageHTML` 来自 `2642` 的 `getMessageTextHTML`）。
- 局部重渲染：`updateMessageBlock()` `script.js:2037` `messageElement.find('.mes_text').html(messageFormatting(...))`。
- 流式：`StreamingProcessor` `script.js:3728` `this.messageTextDom.innerHTML = formattedText;`。
- 编辑相关：`8222`、`8320`、`8410-8411` 等。

`.mes_text` 这个类名来自 DOM 模板 `public/index.html:7461`（`<div class="mes_text"></div>`），`script.js:448` 把模板整体缓存为 `messageTemplate = $('#message_template .mes')`。

**(g) 返回值之外的注意点**：函数名虽叫 formatting，但它是**纯函数式（除第 0 条消息会回写 `chat[0].mes`、以及写 `mesForShowdownParse` 全局）**——`encodeStyleTags`/DOMPurify 用 DOM API 但不触碰 `#chat` 里的真实楼层节点。

---

### 第 2 问 `getRegexedString` 调用点与 `depth` 计算、为何在「生成楼层 HTML」这步跑

**调用点**：`script.js:1860-1864`（在 `if (!isSystem)` 分支内）：

```js
// [ST-SRC] script.js:1855-1868
        mes = MessageFormatter.runStage(MessageFormatter.stage.BEFORE_REGEX, mes,
            { ch_name, isSystem, isUser, messageId, isReasoning },
        );

        // Always override the character name
        mes = getRegexedString(mes, regexPlacement, {
            characterOverride: ch_name,
            isMarkdown: true,
            depth: depth,
        });

        mes = MessageFormatter.runStage(MessageFormatter.stage.AFTER_REGEX, mes,
            { ch_name, isSystem, isUser, messageId, isReasoning },
        );
```

三个参数的含义：
- `characterOverride: ch_name` — 覆盖角色名上下文（`engine.js:375` 传给 `runRegexScript`，用于 `{{char}}` 等宏）。
- `isMarkdown: true` — 见 `scripts/extensions/regex/engine.js:347-355`：只有 `markdownOnly` 的脚本此时会跑；**默认脚本（既非 markdownOnly 也非 promptOnly）在这里不跑**（第三分支要求 `!isMarkdown`），因为它们已在「写入 chat 历史」时改过源文本。这正是「显示层正则」的定义——只影响展示、不改 `chat[i].mes`。
- `depth` — 供 `minDepth`/`maxDepth` 门控（`engine.js:361-372`）。

**`depth` 的计算**：`script.js:1851-1853`：

```js
// [ST-SRC] script.js:1850-1853
        const regexPlacement = getRegexPlacement();
        const usableMessages = chat.map((x, index) => ({ message: x, index: index })).filter(x => !x.message.is_system);
        const indexOf = usableMessages.findIndex(x => x.index === Number(messageId));
        const depth = messageId >= 0 && indexOf !== -1 ? (usableMessages.length - indexOf - 1) : undefined;
```

即：把 `chat[]` 里**所有非系统消息**按原下标保留，找到当前 `messageId` 在其中的位置 `indexOf`，`depth = 可用消息总数 - indexOf - 1` = 「该消息距离聊天末尾还隔着多少条非系统消息」，最后一条消息 `depth=0`，越往前越大。`messageId < 0`（如流式预览、bias 渲染传 `-1`）或找不到时 `depth === undefined`（`engine.js:362` 的 `typeof depth === 'number'` 判断为假，跳过 depth 门控）。`regexPlacement` 由 `getRegexPlacement()` `1833-1848` 决定（REASONING=6 / USER_INPUT=1 / narrator→SLASH_COMMAND=3 / 否则 AI_OUTPUT=2），枚举见 `scripts/extensions/regex/engine.js:281-292`。

**为什么显示层正则在「生成楼层 HTML」这一步跑**（基于源码可证的推理，非臆测）：
1. `messageFormatting` 是**从 `chat[]` 原始文本到 `.mes_text` innerHTML 的唯一格式化入口**（`updateMessageElement:2642→2528`、`updateMessageBlock:2037`、流式 `3715`、编辑 `8411` 都经过它），且每次重绘/编辑/流式刷新都会重新调用。
2. 它的调用点全部位于「拿到消息对象、准备往 DOM 写 HTML」之前，且 `getRegexedString(..., isMarkdown:true)` 明确只跑 `markdownOnly` 脚本（`engine.js:350`）——这类脚本的语义就是「只改显示、不改底层 `chat[i].mes`」。
3. 正则产物（例如把某个标签替换成 HTML 代码块）必须**在 showdown `makeHtml` 之前**注入到 `mes` 里，才能被 `converter.makeHtml(mes)`（`1935`）一起转成 `<pre><code>`；随后 `AFTER_MARKDOWN` 钩子（`1948`）与 DOMPurify（`1967`）再统一处理。若放到 DOM 写完之后跑，就无法享受 showdown 转换与统一 sanitize。
4. 源码注释 `scripts/message-formatter.js:5-18` 明确「所有 stage 都在 DOMPurify 之前，扩展钩子输出永远被 sanitize」，而 `messageFormatting` 的 JSDoc 管线注释（`script.js:1769-1786`）把 `getRegexedString` 列为第 4 步、showdown 列为第 8 步——顺序即「先显示正则，再 Markdown，再净化」。

⚠️ 与已有笔记 `docs/research/formats.md:1175` 的结论一致：`markdownOnly=true` 的脚本在此处运行；默认脚本（`false/false`）在这里**不会**重跑，因为它们改的是 chat 历史源文本（`formats.md:1175`）。

---

### 第 3 问 DOM 生成：`updateMessageBlock` / `.mes[mesid=N]` / `mesid` 与 `chat[]` / `.mes_text` / `pre>code`

**`updateMessageBlock` 定义**：`script.js:2033-2044`：

```js
// [ST-SRC] script.js:2026-2044
/**
 * Re-renders a message block with updated content.
 * @param {number} messageId Message ID
 * @param {object} message Message object
 * @param {object} [options={}] Optional arguments
 * @param {boolean} [options.rerenderMessage=true] Whether to re-render the message content (inside <c>.mes_text</c>)
 */
export function updateMessageBlock(messageId, message, { rerenderMessage = true } = {}) {
    const messageElement = chatElement.find(`[mesid="${messageId}"]`);
    if (rerenderMessage) {
        const text = message?.extra?.display_text ?? message.mes;
        messageElement.find('.mes_text').html(messageFormatting(text, message.name, message.is_system, message.is_user, messageId, {}, false));
    }

    updateReasoningUI(messageElement);

    addCopyToCodeBlocks(messageElement);
    appendMediaToMessage(message, messageElement);
}
```

**真正的楼层生成函数**是 `updateMessageElement()`（`script.js:2618-2705`，JSDoc 见 `2609-2617`）与 `addOneMessage()`（`script.js:2540-2607`）。`addOneMessage` 里 `messageElement` 来自 `updateMessageElement`，随后 `chatElement.append(messageElement)`（`2589`）或 `insertAfter/insertBefore`（`2583-2587`）。

**`.mes[mesid=N]` 结构在哪里生成**：模板在 `public/index.html:7391-7471`：

```html
<!-- [ST-SRC] index.html:7391-7392, 7403, 7461 -->
        <div id="message_template" class="template_element">
            <div class="mes" mesid="" ch_name="" is_user="" is_system="" bookmark_link="">
                ...
                    <div class="mes_block">
                        ...
                        <div class="mes_text"></div>
                        <div class="mes_media_wrapper"></div>
```

- `script.js:448` `const messageTemplate = $('#message_template .mes');` 缓存该 `.mes` 节点。
- `updateMessageElement` 默认参数 `messageElement = messageTemplate.clone()`（`script.js:2618`）。
- `script.js:2647-2658` 用 `.attr({...})` 写入 `mesid` 等属性：

```js
// [ST-SRC] script.js:2647-2658
    messageElement.attr({
        'mesid': messageId,
        'swipeid': mes.swipe_id ?? 0,
        'ch_name': mes.name,
        'is_user': mes.is_user,
        'is_system': !!mes.is_system,
        'bookmark_link': bookmarkLink,
        'force_avatar': !!mes.force_avatar,
        'timestamp': timestamp,
        'type': mes.extra?.type ?? '',
    });
```

- `script.js:2696` `messageElement.find('.mes_text').html(messageHTML);` 写入正文 HTML。

**`mesid` 与全局 `chat[]` 下标的对应关系**：`mesid` **就是 `chat[]` 的数组下标**，源码里处处按此假设：
- `redisplayChat()` `script.js:1508-1524`：`targetChat.slice(startIndex)` 后 `messages.map((message, offset) => { const i = startIndex + offset; updateMessageElement(message, { messageId: i }); ... })`，即 `mesid = startIndex + offset = chat 下标`。
- `addOneMessage()` `script.js:2563-2567`：`const index = chat.indexOf(mes); ... return index;`；末尾 push 时 `chat_id = chat.length - 1` 作为 id（`script.js:5916`、`6690`）。
- `getMessageTextHTML()` 默认 `messageId = chat.indexOf(message)`（`script.js:2523`）。
- `updateMessageItemizedPromptButton()` 默认 `messageId = chat.indexOf(message)`（`script.js:2506`）。
- 删除/截断后重编号：`script.js:9471` `$(element).attr('mesid', minId + index);`（截断头部消息后把剩余楼层 mesid 平移）。
- 读取反查：`script.js:8144` `const mes = chat[mesElement.attr('mesid')];`、`script.js:9971` `const mesId = Number(...closest('.mes')?.getAttribute('mesid') ...)`、`script.js:11856` `var edit_mes_id = Number($(this).closest('.mes').attr('mesid'));`。
- 注意 `messageId = -1` 是「临时/非 chat 消息」的哨兵值（`script.js:1792-1793` JSDoc 明写：`-1 for transient messages (e.g. streaming previews)`），此时 `depth` 为 `undefined`（见第 2 问）。

**`.mes_text` 类名**：来自模板 `index.html:7461`；所有正文写入/读取都用它（`2037`、`2696`、`8142`、`8221`、`8260`、`8316`、`8407`、`9999`、`10281`）。容器是 `#chat`（`script.js:449` `export const chatElement = $('#chat');`）。流式预览的浮动面板也**刻意复用**这个类名，见第 5 问。

**`pre>code` 是 markdown 代码围栏渲染的结果**：可证链条——
1. `messageFormatting` 用 showdown `converter.makeHtml(mes)`（`script.js:1935`）把 ```` ```…``` ```` 围栏转成 `<pre><code>…</code></pre>`（showdown 是 npm 依赖，`lib.js:16`，**本仓库内 `public/` 下没有 showdown 自身的源码文件**，因此「围栏→`pre>code`」这一步的**实现代码未在源码中找到**，只能从 `makeHtml` 调用点与 ST 对 `pre code` 的消费反推，符合 showdown 的标准行为）。
2. `script.js:1900-1901` 的引号保护正则显式列出 ```` ```[\s\S]*?``` ```` / `~~~…~~~` / 反引号，证明代码围栏在进入 `makeHtml` 前被识别并保护。
3. `addCopyToCodeBlocks()` `script.js:2479-2480` 直接 `$(messageElement).find('pre code')` 扫描并 `hljs.highlightElement`，证明最终 DOM 里确实存在 `pre > code`：

```js
// [ST-SRC] script.js:2479-2487
export function addCopyToCodeBlocks(messageElement) {
    const codeBlocks = $(messageElement).find('pre code');
    for (let i = 0; i < codeBlocks.length; i++) {
        hljs.highlightElement(codeBlocks.get(i));
        const copyButton = document.createElement('i');
        copyButton.classList.add('fa-solid', 'fa-copy', 'code-copy', 'interactable');
        copyButton.title = 'Copy code';
        codeBlocks.get(i).appendChild(copyButton);
```

它在每次写完 `.mes_text` 后被调用（`updateMessageBlock:2042`、`updateMessageElement:2697`、`3759`、编辑 `8330`/`8424`）。`decodeStyleTags` 的 CSS 前缀 `.mes_text `（`script.js:1968`）也佐证样式只作用于 `.mes_text` 子树。

> 对 RPNow 预设/TH 插件的含义：预设正则把标签转成「HTML 代码块」→ 经 showdown 变成 `.mes_text` 内的 `pre>code` → TH 扫描 `pre>code` 包进 iframe。这个契约的每一环都在本节得到源码印证。

---

### 第 4 问 事件：定义表 + 发射点 + payload

**定义（`event_types` 常量表）**：`scripts/events.js:3-70`，本问 7 个事件全在 `3-49`：

```js
// [ST-SRC] scripts/events.js:3-21, 48-49
export const event_types = {
    APP_INITIALIZED: 'app_initialized',
    APP_READY: 'app_ready',
    EXTRAS_CONNECTED: 'extras_connected',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_DELETED: 'message_deleted',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_FILE_EMBEDDED: 'message_file_embedded',
    MESSAGE_REASONING_EDITED: 'message_reasoning_edited',
    MESSAGE_REASONING_DELETED: 'message_reasoning_deleted',
    MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    IMPERSONATE_READY: 'impersonate_ready',
    CHAT_CHANGED: 'chat_id_changed',
    // TODO: Naming convention is inconsistent with other events
    CHAT_LOADED: 'chatLoaded',
    ...
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
```

⚠️ 字符串值注意：`CHAT_LOADED` 的实际事件名是 **`'chatLoaded'`**（驼峰，源码自带 TODO 说命名不一致），其余 6 个都是 snake_case。`eventSource` 是 `EventEmitter`（`scripts/events.js:1` `import { EventEmitter } from '../lib/eventemitter.js';`）；`emit` 支持多参数透传（见下方 payload）。

**发射点 `eventSource.emit`（逐事件，`script.js` 内）**：

| 事件 | 定义 | 发射点（`script.js`） | payload 形状 |
|---|---|---|---|
| `CHARACTER_MESSAGE_RENDERED` | `events.js:49` (`'character_message_rendered'`) | `3800`、`3829`（流式结束/错误）、`6693`/`6718`/`6740`/`6783`（`saveReply` 各分支，带 `!fromStreaming &&` 守卫）、`7706`（首条消息）、`9919`（首条消息另一分支） | `(messageId, type)` —— 第一个参数就是 `message_id`，第二个是生成类型字符串（`'first_message'`、`'continue'`、`'swipe'`、`type` 等） |
| `USER_MESSAGE_RENDERED` | `events.js:48` | `5912`（`insertAt` 插入分支）、`5919`（追加分支） | `(messageId)` —— 单个数字 `message_id` |
| `MESSAGE_UPDATED` | `events.js:12` | `8337`（`messageEditCancel`）、`8431`（`messageEditDone`） | `(messageId)` —— 单个数字 `message_id` |
| `MESSAGE_DELETED` | `events.js:11` | `1611`、`1699`、`4411`、`11734` | `(chat.length)` —— **删除后的剩余长度**，不是被删的 id |
| `MESSAGE_SWIPED` | `events.js:7` | `10315` | `(mesId)` —— 单个数字 `message_id` |
| `CHAT_LOADED` | `events.js:21` (`'chatLoaded'`) | `7669` | `({ detail: { id: this_chid, character: characters[this_chid] } })` —— **一个对象**，不是 id |
| `MORE_MESSAGES_LOADED` | `events.js:17` | `1474` | 无参数（空 payload） |

关键片段：

```js
// [ST-SRC] script.js:3798-3803（流式结束，payload = messageId + type）
        if (this.type !== 'impersonate') {
            await eventSource.emit(event_types.MESSAGE_RECEIVED, this.messageId, this.type);
            await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, this.messageId, this.type);
        } else {
            await eventSource.emit(event_types.IMPERSONATE_READY, text);
        }
```

```js
// [ST-SRC] script.js:6690-6693（saveReply，非流式才 emit）
            const chat_id = (chat.length - 1);
            !fromStreaming && await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, type);
            addOneMessage(chat[chat_id], { type: 'swipe' });
            !fromStreaming && await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, type);
```

```js
// [ST-SRC] script.js:5907-5920（用户消息：插入 / 追加两条分支）
    if (typeof insertAt === 'number' && insertAt >= 0 && insertAt <= chat.length) {
        chat.splice(insertAt, 0, message);
        await saveChatConditional();
        await eventSource.emit(event_types.MESSAGE_SENT, insertAt);
        await reloadCurrentChat();
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, insertAt);
    } else {
        chat.push(message);
        await saveChatConditional();
        const chat_id = (chat.length - 1);
        await eventSource.emit(event_types.MESSAGE_SENT, chat_id);
        addOneMessage(message);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, chat_id);
    }
```

```js
// [ST-SRC] script.js:7669（CHAT_LOADED 的对象 payload）
        eventSource.emit(event_types.CHAT_LOADED, { detail: { id: this_chid, character: characters[this_chid] } });

// [ST-SRC] script.js:7703-7707（首条消息也补发 CHARACTER_MESSAGE_RENDERED）
    if (chat.length === 1) {
        const chat_id = (chat.length - 1);
        await eventSource.emit(event_types.MESSAGE_RECEIVED, chat_id, 'first_message');
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat_id, 'first_message');
    }
```

```js
// [ST-SRC] script.js:10315（SWIPED）、8337 / 8431（UPDATED）、1611（DELETED）、1474（MORE_MESSAGES_LOADED）
        await eventSource.emit(event_types.MESSAGE_SWIPED, (mesId));            // :10315
    await eventSource.emit(event_types.MESSAGE_UPDATED, messageId);           // :8337
    await eventSource.emit(event_types.MESSAGE_UPDATED, this_edit_mes_id);    // :8431
    await eventSource.emit(event_types.MESSAGE_DELETED, chat.length);         // :1611
    await eventSource.emit(event_types.MORE_MESSAGES_LOADED);                 // :1474
```

**补充（不在 `script.js` 但在 `public/` 内，供兼容层参考）**：`scripts/group-chats.js:302` 也 emit `CHARACTER_MESSAGE_RENDERED`（`(chat.length-1, 'first_message')`）；`scripts/slash-commands.js:5857/5923`（`MESSAGE_UPDATED, modifyAt`）、`6008/6013`（`CHARACTER_MESSAGE_RENDERED, insertAt/chat.length-1, 'command'`）、`6060/6065/6109/6146/6151`（`USER_MESSAGE_RENDERED`）；`scripts/extensions/caption/index.js:221`（`USER_MESSAGE_RENDERED, messageId`）；`scripts/extensions/stable-diffusion/index.js:4999`（`CHARACTER_MESSAGE_RENDERED, messageId, 'extension'`）。这些发射点的 `message_id` 语义与 `script.js` 一致（第一个参数为 chat 下标）。

**payload 形状总结（对 TH 插件最重要）**：
- 所有「消息级」事件的第一个参数都是 **`message_id` = `chat[]` 下标**（数字），与 `.mes[mesid=N]` 的 `N` 一致。
- `CHARACTER_MESSAGE_RENDERED` 多一个第二参数 `type`（字符串）；`USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` 只传一个数字。
- `MESSAGE_DELETED` 传的是**删除后 `chat.length`**（不是被删 id）；`CHAT_LOADED` 传**对象** `{detail:{id,character}}`；`MORE_MESSAGES_LOADED` **无 payload**。
- `eventSource.emit` 是 `await` 的（异步、按监听器顺序），监听器常用 `eventSource.on / makeFirst / makeLast`（如 `scripts/extensions/memory/index.js:1080-1081`、`scripts/extensions/translate/index.js:768-772`）。

---

### 第 5 问 流式渲染 `public/scripts/streaming-display.js` 约 265 / 281 行

**两处 `messageFormatting` 调用**（`scripts/streaming-display.js:261-284`）：

```js
// [ST-SRC] scripts/streaming-display.js:261-284
    updateReasoning(text) {
        if (!this.#reasoningContent || !this.#reasoningSection || !text) return this;

        this.#reasoningSection.style.display = '';
        this.#reasoningContent.innerHTML = messageFormatting(text, '', false, false, -1, {}, true);   // :265
        this.#reasoningContent.scrollTop = this.#reasoningContent.scrollHeight;
        return this;
    }

    updateContent(text) {
        if (!this.#textContent || !this.#textSection || !text) return this;

        this.#hasContent = true;
        this.#textSection.style.display = '';
        this.#textContent.innerHTML = messageFormatting(text, '', false, false, -1, {}, false);      // :281
        this.#textContent.scrollTop = this.#textContent.scrollHeight;
        return this;
    }
```

要点：
- `messageFormatting` 从 `/script.js` 导入（`streaming-display.js:23` `import { animation_duration, messageFormatting } from '/script.js';`）。
- 两处都传 `messageId = -1`（临时预览，JSDoc `script.js:1792-1793` 明写 `-1` = transient/streaming previews），因此 `depth === undefined`（`script.js:1853`）、第 0 条消息宏替换逻辑不触发（`1805` 的 `Number(messageId) === 0` 为假）。
- 推理内容 `updateReasoning` 传 `isReasoning = true`（第 7 个参数），正文 `updateContent` 传 `false`。前者使 `getRegexPlacement()` 返回 `REASONING(6)`（`script.js:1835-1837`）。
- `ch_name` 传空字符串 `''`，`isSystem/isUser` 均 `false` → placement 落到 `AI_OUTPUT(2)`（`script.js:1843`）。
- 每次 chunk 都**整体重新 `innerHTML = messageFormatting(累积文本)`**（不是增量追加），且 `if (!text) return this`（`262`、`277`）——空文本不刷新。

**流式期间 DOM 是否也用 `.mes_text`**：
- **浮动预览面板（StreamingDisplay）：正文节点刻意加了 `mes_text` 类**，见 `scripts/streaming-display.js:181-183`：

```js
// [ST-SRC] scripts/streaming-display.js:176-183
        // Content section (hidden until content arrives)
        this.#textSection = document.createElement('div');
        this.#textSection.classList.add(`${CSS_PREFIX}-text`);
        this.#textSection.style.display = 'none';

        this.#textContent = document.createElement('div');
        this.#textContent.classList.add(`${CSS_PREFIX}-text-content`, 'mes_text'); // Allow formatting based on how chat messages are formatted too
        this.#textSection.appendChild(this.#textContent);
```

注释明说「Allow formatting based on how chat messages are formatted too」——为了让基于 `.mes_text` 的样式/插件（含 `decodeStyleTags` 的 `.mes_text ` CSS 前缀、`script.js:1968`）同样生效。**但推理内容节点（`#reasoningContent`，`streaming-display.js:170-171`）没有 `mes_text` 类**（只有 `streaming-display-reasoning-content`）。该面板是 append 到「最顶层打开的 `<dialog>`」里的浮动 toast（`streaming-display.js:1-8`），**不是** `#chat` 里的 `.mes` 楼层。

- **聊天内的真实流式楼层（StreamingProcessor）**：`#checkDomElements()` `script.js:3593-3603` 直接取 `#chat .mes[mesid="${messageId}"] .mes_text`：

```js
// [ST-SRC] script.js:3593-3599
    async #checkDomElements(messageId, continueOnReasoning = null) {
        if (this.messageDom === null || this.messageTextDom === null) {
            this.messageDom = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
            this.messageTextDom = this.messageDom?.querySelector('.mes_text');
            this.messageTimerDom = this.messageDom?.querySelector('.mes_timer');
            this.messageTokenCounterDom = this.messageDom?.querySelector('.tokenCounterDisplay');
        }
```

并且每个 chunk 用**真实 `messageId`**（非 `-1`）重新格式化后写回 `innerHTML`（`script.js:3715-3729`）：

```js
// [ST-SRC] script.js:3715-3729
            const formattedText = messageFormatting(
                processedText,
                chat[messageId].name,
                chat[messageId].is_system,
                chat[messageId].is_user,
                messageId,
                {},
                false,
            );
            if (this.messageTextDom instanceof HTMLElement) {
                if (power_user.stream_fade_in) {
                    applyStreamFadeIn(this.messageTextDom, formattedText);
                } else {
                    this.messageTextDom.innerHTML = formattedText;
                }
            }
```

`onStartStreaming` 会先 `saveReply({ fromStreaming: true })` 建好 `messageId = chat.length - 1` 的楼层（`script.js:3633-3636`）。流式期间 `CHARACTER_MESSAGE_RENDERED` **不随每个 chunk 发射**：`saveReply` 用 `!fromStreaming &&` 守卫（`6693` 等），事件只在 `onFinishStreaming`/`onErrorStreaming` 的 `finalizeIntermediaryMessage` 里发一次（`3800`、`3829`）。

**结论**：流式期间**聊天内楼层确实用 `.mes_text`**，且复用完整的 `messageFormatting` 管线（含显示层正则、showdown、DOMPurify）；浮动预览面板的正文容器也带 `mes_text` 类但只是个独立的 `div`，没有 `.mes[mesid]` 外壳。

---

### 第 6 问 其它 `messageFormatting` 调用点（场景）

先给出 `script.js` 内全部调用点（grep 结果）：`2037`、`2528`、`2670`、`3715`、`8222`、`8232`、`8320`、`8411`、`8422`（其中 `8232`/`8422` 是 bias 渲染，传 `-1`）。逐条：

| 行号 | 所在函数 / 场景 | 参数要点 |
|---|---|---|
| `2037` | `updateMessageBlock()` — 局部重渲染一条已存在楼层（如外部扩展改了 `chat[i]` 后调它） | `text = extra.display_text ?? mes`，真实 `messageId` |
| `2528` | `getMessageTextHTML()` → `updateMessageElement()` — **初次生成/重绘楼层**（`2642` 调用，`2696` 写入 `.mes_text`） | 唯一会传非空 `sanitizerOverrides` 的点（`uses_system_ui`） |
| `2670` | `updateMessageElement()` — 渲染 `mes.extra.bias`（prompt bias / 用户前缀）到 `.mes_bias` | `messageId = -1`，`isSystem/isUser=false` |
| `3715` | `StreamingProcessor` — 聊天内流式每个 chunk 重算 HTML 写 `.mes_text` | 真实 `messageId`，累积文本 `processedText` |
| `8222` | `messageEditAuto()` — 编辑态自动（把 `.mes_text` 当 textarea 用 `.val()`）塞入格式化后的文本 | `this_edit_mes_id` |
| `8232` | `messageEditAuto()` — bias 框 `.mes_bias` 追加 | `-1` |
| `8320` | `messageEditCancel()` — 取消编辑，用 `chat[messageId].mes` 还原 `.mes_text` | 真实 `messageId`，随后 emit `MESSAGE_UPDATED`（`8337`） |
| `8411` | `messageEditDone()` — 确认编辑，把最终文本写回 `.mes_text` | `this_edit_mes_id`，随后 emit `MESSAGE_UPDATED`（`8431`） |
| `8422` | `messageEditDone()` — bias 框还原 | `-1` |

补充片段（编辑三处，均为「重画 `.mes_text`」家族）：

```js
// [ST-SRC] script.js:8315-8320（取消编辑）
    const thisMesBlock = thisMesDiv.find('.mes_block');
    thisMesBlock.find('.mes_text').empty();
    thisMesDiv.find('.mes_edit_buttons').css('display', 'none');
    thisMesBlock.find('.mes_buttons').css('display', '');
    thisMesBlock.find('.mes_text')
        .append(messageFormatting(
            text, this_edit_mes_chname, chat[messageId].is_system, chat[messageId].is_user,
            messageId, {}, false,
        ));
```

```js
// [ST-SRC] script.js:8407-8422（确认编辑）
    mesBlock.find('.mes_text').empty();
    ...
    mesBlock.find('.mes_text').append(
        messageFormatting(
            text, this_edit_mes_chname, mes.is_system, mes.is_user,
            this_edit_mes_id, {}, false,
        ),
    );
    mesBlock.find('.mes_bias').empty();
    mesBlock.find('.mes_bias').append(messageFormatting(bias, '', false, false, -1, {}, false));
```

**关于题目给的 2037 / 8222 / 8320 / 8411 / 3715 / 2670**：与源码完全对应（见上表）。题目另提到的 `8222` 场景是「编辑自动填充」、`8320` 是「取消编辑还原」、`8411` 是「确认编辑写回」——三者都是编辑 UI 家族；`2670` 是 bias 显示；`3715` 是流式；`2037` 是局部重渲染。

**另有 `script.js` 之外的调用点**（`public/` 内）：`scripts/streaming-display.js:265`/`281`（第 5 问）。`scripts/reasoning.js` 的 `MESSAGE_RECEIVED`/`MESSAGE_UPDATED` 监听（`:1617`）里是否直接调 `messageFormatting` —— **未在源码中找到**直接调用（该处监听后走 `ReasoningHandler`，其渲染路径不在此次 grep 的 `messageFormatting` 命中里）。全局 grep `messageFormatting` 于 `public/` 共命中 `script.js`(1+9 处) 与 `streaming-display.js`(2 处 import+调用)、`scripts/message-formatter.js:1`(import)、`scripts/st-context.js:246`(把 `MessageFormatter` 挂到上下文)。

---

## ③ 对 RPNow 兼容层的启示

### A. 必须复刻的 DOM 契约

1. **楼层容器**：`#chat > .mes[mesid="N"]`，`N` 为字符串化的 `chat[]` 下标（`script.js:2647-2648`、`1508-1524`、`8144`）。属性还有 `ch_name`、`is_user`、`is_system`、`swipeid`、`type`（`2647-2658`）。TH 插件会 `closest('.mes').getAttribute('mesid')` 反查（`script.js:9971`、`11856`）。
2. **正文节点**：`.mes_block > .mes_text`（`index.html:7403`/`7461`）。所有正文 HTML 只写进这里（`2696`、`2037`、`3728`），`updateMessageBlock` 等按 `.find('.mes_text')` 定位。
3. **`pre > code`**：由 showdown 把 ```` ```…``` ```` 围栏渲染而来（`script.js:1935` + `1900-1901` + `2479-2480`）。预设正则转成 HTML 代码块 → 必须最终落在 `.mes_text` 内的 `pre>code`，TH 才能扫描到。RPNow 若用别的 Markdown 库，必须保证围栏输出**同样是 `<pre><code>`**（不是 `<div class="code">` 之类）。
4. **`addCopyToCodeBlocks` 之后 DOM 会被追加 `<i class="code-copy">` 到 `<code>` 内**（`script.js:2483-2486`）——TH 扫描/包 iframe 时要注意 `code` 内可能已有高亮 `span` 与复制按钮。
5. **CSS 作用域**：`decodeStyleTags(mes, { prefix: '.mes_text ' })`（`script.js:1968`、`chats.js:551-560`）会把 `<style>` 里每条选择器加 `.mes_text ` 前缀。RPNow 的预设若自带 `<style>`，必须放在 `.mes_text` 内才会生效。
6. **系统消息不进 showdown**：`isSystem` 为 true 时跳过 `1892-1951` 整段（含 `makeHtml`、正则、`AFTER_MARKDOWN`），但仍走 DOMPurify。RPNow 若把预设正则结果当系统消息渲染，会得不到 `pre>code`。

### B. 必须复刻的事件名与 payload

| 事件 | 字符串值 | payload | 发射时机 |
|---|---|---|---|
| `CHARACTER_MESSAGE_RENDERED` | `character_message_rendered` | `(message_id:number, type:string)` | 楼层 HTML 已写入后（非流式 `saveReply`、`onFinishStreaming`、首条消息） |
| `USER_MESSAGE_RENDERED` | `user_message_rendered` | `(message_id:number)` | 用户消息 `addOneMessage`/`reloadCurrentChat` 之后 |
| `MESSAGE_UPDATED` | `message_updated` | `(message_id:number)` | 编辑确认/取消、或 `updateMessageBlock` 类重绘后 |
| `MESSAGE_DELETED` | `message_deleted` | `(remainingLength:number)` = **删除后 `chat.length`** | 删除后 |
| `MESSAGE_SWIPED` | `message_swiped` | `(message_id:number)` | swipe 切换完 |
| `CHAT_LOADED` | **`chatLoaded`**（注意驼峰！） | `({detail:{id, character}})` **对象** | 聊天数据载入 `getChatResult()` 之后 |
| `MORE_MESSAGES_LOADED` | `more_messages_loaded` | 无参数 | 展开「显示更多消息」之后 |

- `message_id` 恒等于 `chat[]` 下标 = `.mes[mesid]` 的 `N`。TH 插件拿到 id 后会 `chat[id]` / `querySelector('.mes[mesid="id"]')`，两者必须一致。
- `eventSource.emit` 是 **await 的异步多参数透传**；监听器有 `on / makeFirst / makeLast` 优先级（如 `scripts/extensions/translate/index.js:768-772` 用 `makeFirst` 抢在别人前面改文本）。RPNow 的事件总线至少要支持「同步注册 + 按优先级 + await 串行 + 多参数」。
- 流式期间**不要每个 chunk 发 `CHARACTER_MESSAGE_RENDERED`**：ST 用 `!fromStreaming &&` 守卫（`6693` 等），只在收尾发一次（`3800`）。否则 TH 插件会在每个 token 上重复包 iframe。

### C. 必须复刻的 `depth` 语义

```js
// [ST-SRC] script.js:1851-1853
const usableMessages = chat.map((x, index) => ({ message: x, index })).filter(x => !x.message.is_system);
const indexOf = usableMessages.findIndex(x => x.index === Number(messageId));
const depth = messageId >= 0 && indexOf !== -1 ? (usableMessages.length - indexOf - 1) : undefined;
```

- 从**聊天末尾倒数**、**跳过 `is_system` 消息**：最后一条非系统消息 `depth=0`，往前递增 1。
- `messageId < 0`（流式预览、bias）→ `depth = undefined` → `minDepth`/`maxDepth` 门控被整体跳过（`engine.js:362`）。
- 门控规则（`engine.js:361-372`）：`minDepth >= -1 && depth < minDepth` 跳过；`maxDepth >= 0 && depth > maxDepth` 跳过。
- `isMarkdown: true` 时只跑 `markdownOnly` 脚本（`engine.js:350`）；默认脚本（`false/false`）在**写入 chat 历史**时已改过源文本，显示层不重跑（`formats.md:1175`）。RPNow 若把「显示正则」和「历史正则」混在同一处跑，会出现双重替换。

### D. 容易踩的坑（源码级证据）

1. **正则顺序**：显示层正则在 showdown **之前**（`1860` → `1935`）。若 RPNow 先转 HTML 再跑正则，正则里的 ```` ``` ```` 匹配不到，TH 需要的 `pre>code` 就生不出来。
2. **sanitize 会改写 class**：`MESSAGE_SANITIZE: true` 触发 `uponSanitizeAttribute` 钩子把每个 class 变成 `custom-<原名>`（`chats.js:1921-1933`），仅 `fa-*`/`note-*`/`monospace` 和 `menu_button`（`MESSAGE_ALLOW_SYSTEM_UI` 时）豁免。预设正则若依赖某个自定义 class 命中 TH，会被改名 → 必须改用 `fa-`/`note-` 前缀或用 `<pre><code>` 结构定位。
3. **`encode_tags` 会吃掉尖括号**：`power_user.encode_tags` 开启时 `<`/`>` 被转义（`script.js:1875-1879`），预设想注入 HTML 标签的代码块必须依赖**代码围栏**（被 `1900-1901` 保护），而不是裸 `<div>`。
4. **引号会被转成 `<q>`**：`script.js:1892-1926` 把 `"…"`/`“…”`/`「…」` 等转 `<q>`，但先在 `1900-1901` 排除了 ```` ```…``` ````、反引号、`<style>`。TH 的正则若在围栏外写带引号的替换串，会被改写。
5. **`CHAT_LOADED` 名字是 `chatLoaded`**（`events.js:21`），与其余 snake_case 不一致；且 payload 是对象而非 id。直接照抄其他事件名会漏监听。
6. **`MESSAGE_DELETED` 传的是剩余长度**（`1611` `chat.length`），不是被删 id；按「被删 id」处理会错位。
7. **`messageId === 0` 有特殊副作用**：`messageFormatting` 会跑 `substituteParams` 并可能**回写 `chat[0].mes`**（`1805-1812`）。RPNow 若把「首条消息」也传 `0`，要复制这个宏替换+回写行为，否则 greeting 里的 `{{char}}` 不展开。
8. **`mesForShowdownParse` 是导出的全局上下文变量**（`script.js:399`），但本仓库内**没有读取方**；TH/ST 扩展可能用它对比 showdown 输入。RPNow 的 shim 至少要导出它并在每次格式化时赋值，避免 `undefined`。
9. **`.mes_text` 写入是全量替换**（`innerHTML =`，`3728`/`2696`/`streaming-display.js:281`），不是增量。TH 在 `.mes_text` 里塞的 iframe 会在下一次流式 chunk 或编辑重绘时**被整体冲掉**——必须监听 `CHARACTER_MESSAGE_RENDERED`/`MESSAGE_UPDATED` 后重新扫描并重新挂载，或做 MutationObserver。
10. **浮动流式预览不是楼层**：`StreamingDisplay` 的正文虽然有 `mes_text` 类（`streaming-display.js:182`），但没有 `.mes[mesid]` 外壳、且 `messageId=-1`（`depth=undefined`），TH 若按 `#chat .mes` 扫描会**扫不到**它；若按 `.mes_text` 全局扫描又会误命中这个临时面板。需要按「`#chat .mes[mesid] .mes_text`」精确定位。
11. **`updateMessageBlock` 的 `rerenderMessage:false`**（`script.js:2033`）只刷新 reasoning/媒体/复制按钮、不重画 `.mes_text`——RPNow 重绘调度要区分「正文变了」和「只变元数据」。
12. **DOMPurify 无 post-sanitize stage**（`scripts/message-formatter.js:18-23` 明写）：扩展钩子插入的 HTML 一律被 sanitize。RPNow 的 TH 若想在净化后插 iframe，只能走「事件后二次 DOM 操作」，不能指望格式化管线里留后门。

---

## 附：本次调查中「未在源码中找到」的项

- `mesForShowdownParse` 的任何**读取方/消费方**（全 `public/` 仅 `script.js:399` 声明、`script.js:1814` 赋值）。
- `marked` 及任何 showdown 等价替代库的使用；`public/` 下 **showdown 自身的实现源码文件**（它是 npm 依赖 `lib.js:16`，只有补丁 `scripts/util/showdown-patch.js` 与两个扩展 `showdown-exclusion.js`/`showdown-underscore.js`）。因此「围栏 → `<pre><code>`」的**转换实现代码本身未在源码中找到**，结论依据 `makeHtml` 调用点 + `find('pre code')` 消费点反推。
- `scripts/reasoning.js:1617` 那一带对 `messageFormatting` 的**直接调用**（该处是事件监听，未命中 `messageFormatting`）。
- `updateMessageElement` 之外任何生成 `.mes[mesid]` 骨架的第二套模板（唯一模板是 `index.html:7391-7471`）。
