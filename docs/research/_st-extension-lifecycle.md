# SillyTavern 扩展生命周期与「设置 UI 挂载契约」源码研究

> 研究阶段产出，只做源码阅读，未修改 `src/` 与 `docs/` 其他文件。
> 权威源码：`D:\RPNow\_ref\SillyTavern`（真实 git clone）。
> 引用格式：`[ST-SRC] 相对路径:行号`，片段均 ≤ 30 行。
> 所有行号基于本次 clone 的当前工作区。

---

## ① 加载 / 激活时序图（有序列表）

入口：`jQuery(async function () { … await firstLoadInit(); … })`。

1. **`firstLoadInit()` 启动** — `[ST-SRC] public/script.js:12591` → 函数体 `public/script.js:694`。
2. **`initExtensions()`** — `script.js:747` → `[ST-SRC] public/scripts/extensions.js:2302-2324`：只注册 UI（wand 菜单、按钮、弹窗按钮、事件委托），**不加载任何扩展 JS**。
3. **`await getSettings(initLoaderHandle)`** — `script.js:752` → `getSettings` 定义 `script.js:7913`。
4. 拉取 `/api/settings`，`settings = JSON.parse(data.settings)` — `script.js:7927-7929`。
5. **`SETTINGS_LOADED_BEFORE`** — `script.js:7940`（允许订阅者改写 settings）。
6. 各核心模块装载设置（Kobold/Novel/TextGen/OpenAI/Horde/power_user/tags/background/proxy）— `script.js:7942-7979`。
7. **`SETTINGS_LOADED_AFTER`** — `script.js:7982`。
8. **`loadExtensionSettings(settings, isVersionChanged, enableAutoUpdate)`** — `script.js:8021-8025` → `extensions.js:1783`。
   - `Object.assign(extension_settings, settings.extension_settings)` — `extensions.js:1784-1786`。
   - 回填 Extras 表单 — `extensions.js:1788-1791`。
9. **`EXTENSIONS_FIRST_LOAD`** — `extensions.js:1794`。⚠️ 此时扩展**尚未加载**（见第 12 步），所以首次加载时扩展监听不到该事件；只有后续再次调用 `loadExtensionSettings`（如安装后）时已加载的扩展才收得到。
10. **`discoverExtensions()`** — `extensions.js:1795` → `298-312`：`fetch('/api/extensions/discover')`，返回 `[{name, type}]`。
11. **`extensionNames` / `extensionTypes` 赋值** — `extensions.js:1796-1797`。
12. **`getManifests(extensionNames)`** — `extensions.js:1798` → `537-562`：并发 `fetch('/scripts/extensions/${name}/manifest.json')`，`Promise.allSettled`。
13. **丢弃无 manifest 的扩展** — `extensions.js:1802-1807`（防幽灵条目）。
14. 可选自动更新 — `extensions.js:1809-1811`。
15. **`activateExtensions()`** — `extensions.js:1813` → `568-666`。
16. 每个扩展按 `loading_order` 排序后**顺序**执行（`await` 在循环体内）：
    `addExtensionLocale` → `Promise.all([addExtensionScript, addExtensionStyle])` → `activeExtensions.add(name)` → **`callExtensionHook(name, 'activate')`** — `extensions.js:631-638`。
17. **`EXTENSION_SETTINGS_LOADED`** — `script.js:8025`（携带安装返回的 `response` 时见 `extensions.js:1767`）。
18. **`SETTINGS_LOADED`** — `script.js:8046-8047`（`settingsReady = true` 之后）。
19. 后续初始化（角色、背景、persona、世界书…）— `script.js:753-786`。
20. **`APP_INITIALIZED`** — `script.js:787`。
21. **`APP_READY`** — `script.js:788-790`。

**关键顺序结论**：`SETTINGS_LOADED_BEFORE` → `SETTINGS_LOADED_AFTER` → `EXTENSIONS_FIRST_LOAD` → 扩展 activate 钩子 → `EXTENSION_SETTINGS_LOADED` → `SETTINGS_LOADED` → `APP_INITIALIZED` → `APP_READY`。

---

## ② 逐问答复

### 1. 设置 UI 挂载契约（最重要）

#### 1.1 `renderExtensionTemplate` / `renderExtensionTemplateAsync` 完整实现

`[ST-SRC] public/scripts/extensions.js:125-139`：

```js
export function renderExtensionTemplate(extensionName, templateId, templateData = {}, sanitize = true, localize = true) {
    return renderTemplate(`scripts/extensions/${extensionName}/${templateId}.html`, templateData, sanitize, localize, true);
}

export function renderExtensionTemplateAsync(extensionName, templateId, templateData = {}, sanitize = true, localize = true) {
    return renderTemplateAsync(`scripts/extensions/${extensionName}/${templateId}.html`, templateData, sanitize, localize, true);
}
```

**结论（逐条）**：

- **只返回 HTML 字符串**，不查找容器、不 `append`、不包裹任何外壳。挂载完全由扩展 JS 自己完成。
- 模板路径 = `scripts/extensions/${extensionName}/${templateId}.html`，**没有前导 `/`**；最后一个参数 `fullPath = true` 让它按字面路径取用。
- `templateId` 可以带子目录，例如 `renderExtensionTemplateAsync('expressions', 'templates/upload-expression', …)`（`extensions/expressions/index.js:1976`）。
- `extensionName` 用**短名**（如 `regex`、`caption`、`stable-diffusion`），不带 `third-party/`。
- 渲染管线：`[ST-SRC] public/scripts/templates.js:60-89`（异步）/ `102-131`（同步）：

```js
const pathToTemplate = fullPath ? templateId : `/scripts/templates/${templateId}.html`;
const template = await fetchTemplateAsync(pathToTemplate);   // XHR + Handlebars.compile + Map 缓存
let result = template(templateData);
if (sanitize) { result = DOMPurify.sanitize(result); }
if (localize) { result = applyLocale(result); }
return result;
```

- 因此 `settings.html` 只是**默认约定**（大多数内置扩展用它），不是硬编码。

#### 1.2 `index.html` 5773-5830：两个设置容器与整体布局

`[ST-SRC] public/index.html:5750-5832`（截取）：

```html
<div id="extensions-settings-button" class="drawer">
  <div class="drawer-toggle">
    <div class="drawer-icon fa-solid fa-cubes fa-fw closedIcon" title="Extensions"></div>
  </div>
  <div id="rm_extensions_block" class="drawer-content closedDrawer">
    <div class="extensions_block flex-container">
      <div class="alignitemscenter flex-container wide100p">
        <h3 class="margin0 flex1">Extensions</h3>
        <label for="extensions_notify_updates" class="checkbox_label flexNoGap">…</label>
        <div id="extensions_details" class="menu_button_icon menu_button"><i class="fa-solid fa-cubes"></i><span>Manage extensions</span></div>
        <div id="third_party_extension_button" …><span>Install extension</span></div>
      </div>
      <div id="extensions_settings" class="flex1 wide50p">
        <div id="assets_container" class="extension_container"></div>
        <div id="typing_indicator_container" class="extension_container"></div>
        <div id="expressions_container" class="extension_container"></div>
        <!-- …共 16 个硬编码容器… -->
      </div>
      <div id="extensions_settings2" class="flex1 wide50p">
        <div id="websearch_container" class="extension_container"></div>
        <div id="qr_container" class="extension_container"></div>
        <div id="regex_container" class="extension_container"></div>
        <!-- …共 16 个硬编码容器… -->
      </div>
      <hr class="wide100p margin0">
      <!-- Extras API 连接区 -->
    </div>
  </div>
</div>
```

**容器层级**：

```
#extensions-settings-button.drawer
└─ #rm_extensions_block.drawer-content           ← 宽度 = var(--sheldWidth) = 50vw
   └─ .extensions_block.flex-container          ← display:flex; gap:5px; flex-wrap:wrap
      ├─ #extensions_settings.flex1.wide50p      ← display:flex; flex-direction:column
      │  └─ <div id="xxx_container" class="extension_container">   ← display:contents
      └─ #extensions_settings2.flex1.wide50p     ← 同上
```

**CSS 事实**：

| 类 / 选择器 | 定义 | 含义 |
|---|---|---|
| `.extensions_block`（即 `.flex-container`） | `[ST-SRC] public/css/st-tailwind.css:268-272` | `display:flex; gap:5px; flex-wrap:wrap`（默认横向排列） |
| `.wide50p` | `st-tailwind.css:461-463` | `width: 50%` |
| `.flex1` | `st-tailwind.css:375-377` | `flex: 1`（= `1 1 0%`，flex-basis 覆盖 width，两者等分） |
| `#extensions_settings, #extensions_settings2` | `[ST-SRC] public/css/extensions-panel.css:139-143` | `display:flex; flex-direction:column`（保证设置项按 DOM 顺序竖排） |
| `.extension_container` | `extensions-panel.css:146-148` | **`display: contents`** —— 容器自身不生成盒子，内部设置项直接成为父列的 flex item |
| `.drawer-content` | `[ST-SRC] public/style.css:5555-5563` | `min-width:450px; width:var(--sheldWidth); overflow-y:hidden` |
| `--sheldWidth` | `style.css:92` | `50vw` |
| `#extensions_settings(2)` 移动端 | `[ST-SRC] public/css/mobile-styles.css:180-184` | `width:100% !important; min-width:100% !important`（两栏堆叠） |
| 设置项标题样式 | `style.css:5403-5413`、`5443-5447` | `#extensions_settings .inline-drawer-toggle.inline-drawer-header` 有渐变底 + 圆角 + 边框（`standoutHeader` 效果） |
| `.inline-drawer-header` / `.inline-drawer-content` | `style.css:5535-5545` | header 横向布局；content 默认 `display:none`（折叠） |

**布局结论**：设置面板在**独占的 Extensions 抽屉**里，抽屉宽 `50vw`；内部两栏各约 **25vw**（`50%` × `50vw`，再减去 gap/padding）。这就是 ST 设置项「窄」的根因——是设计，不是渲染错误。`display:contents` 让每个 `*_container` 只是逻辑分组，不产生额外盒模型，从而保证两栏内设置项顺序稳定。

#### 1.3 扩展如何把自己的设置 DOM 注进去

**宿主不注入。** `extensions.js` 里没有任何 `append` 到 `#extensions_settings*` 的代码（全文件搜索仅 `sanitizeSelector` 用于生成 `<name>-css` / `<name>-js` 的 id）。每个扩展在自己的 JS 里显式 `append`。

真实例子：

- **regex**：`[ST-SRC] public/scripts/extensions/regex/index.js:1728-1729`
  ```js
  const settingsHtml = $(await renderExtensionTemplateAsync('regex', 'dropdown'));
  $('#regex_container').append(settingsHtml);
  ```
- **quick-reply**：`[ST-SRC] public/scripts/extensions/quick-reply/index.js:177-178`
  ```js
  manager = new SettingsUi(settings);
  document.querySelector('#qr_container').append(await manager.render());
  ```
- **memory**：`[ST-SRC] public/scripts/extensions/memory/index.js:1068-1069`
  ```js
  const settingsHtml = await renderExtensionTemplateAsync('memory', 'settings', { defaultSettings });
  $('#summarize_container').append(settingsHtml);
  ```
- 其它同构：`vectors/index.js:1742-1743`、`expressions/index.js:2275-2276`、`caption/index.js:592-593`、`tts/index.js:1536-1537`、`stable-diffusion/index.js:5803-5804`、`assets/index.js:593`、`translate/index.js:711-715`。

**容器 ID 怎么算？——宿主不算。**

- `getNameSelector(name)`（`extensions.js:289-292`）只做 `CSS.escape(nameWithoutPrefix)`，用于列表 item 的 `data-name` 属性，**与设置容器无关**：
  ```js
  function getNameSelector(name, { prefix = 'third-party' } = {}) {
      const nameWithoutPrefix = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
      return CSS.escape(nameWithoutPrefix);
  }
  ```
- `#regex_container`、`#qr_container` 等 ID 是 `index.html` 里**硬编码**的内置扩展专用容器，不是 `<extensionName>_container` 动态生成。
- 第三方扩展没有预置容器，通行做法是自行 `append` 到 `#extensions_settings` 或 `#extensions_settings2`（两者是设置菜单的左右两栏）。外部示例原文：*"extension_settings and extensions_settings2 are the left and right columns of the settings menu. You can append to either one"* —— [SillyTavern Extension Example](https://gitea.knockturnmc.com/Crystal/SillyBubble/commit/71d47c0a23338aac61aee3767a6c6b70a6a2c325)。
- 另一个挂载面是聊天输入框旁的 wand 菜单 `#extensionsMenu`：`[ST-SRC] public/scripts/templates/wandMenu.html:1-17`，同样是硬编码的 `<name>_wand_container` + `.extension_container`，由 `addExtensionsButtonAndMenu()` 在 `document.body.append(extensionsMenuHTML)`（`extensions.js:688-693`）注入。

#### 1.4 配置项持久化

**三者关系**：

- `extension_settings` 是 `extensions.js:141-226` 导出的**单例普通对象**（内含 `apiUrl`、`regex`、`quickReply`、`vectors`、`gallery` 等键）。
- `getContext().extensionSettings` 是**同一对象引用**：`[ST-SRC] public/scripts/st-context.js:73` 导入、`:201` 暴露 `extensionSettings: extension_settings`。
- `saveSettingsDebounced()` 是 `script.js` 导出的防抖保存，把整份 settings（含 `extension_settings`）POST 回服务端。

证据：

- 保存载荷：`[ST-SRC] public/script.js:8085` → `extension_settings: extension_settings,`
- 装载：`extensions.js:1784-1786` → `Object.assign(extension_settings, settings.extension_settings);`
- 事件关闭开关也写在这里：`extension_settings.disabledExtensions`（`extensions.js:475/492`）。

**扩展读写设置的标准写法**（gallery 是最干净的范例）：

`[ST-SRC] public/scripts/extensions/gallery/index.js:78-94`：

```js
function initSettings() {
    let shouldSave = false;
    const context = SillyTavern.getContext();
    if (!context.extensionSettings.gallery) {
        context.extensionSettings.gallery = structuredClone(defaultSettings);
        shouldSave = true;
    }
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(context.extensionSettings.gallery, key)) {
            context.extensionSettings.gallery[key] = structuredClone(defaultSettings[key]);
            shouldSave = true;
        }
    }
    if (shouldSave) {
        context.saveSettingsDebounced();
    }
}
```

内置扩展也直接 import 单例：`regex/index.js:1713-1719` 先兜底 `extension_settings.regex` / `regex_presets`，改动后 `saveSettingsDebounced()`（如 `:187`、`:445`、`:1274`）。

**命名空间惯例**：ST 官方示例用 `extension_settings[extensionName]`（`const extensionSettings = extension_settings[extensionName];`）；内置扩展则用 `extension_settings.<短名>`（`regex` / `quickReply` / `vectors` / `caption` / `translate`…）。两种都靠"键名约定"隔离，宿主不做强制。

---

### 2. 生命周期

#### 2.1 `loadExtensionSettings`（`extensions.js:1783-1817`）

```js
export async function loadExtensionSettings(settings, versionChanged, enableAutoUpdate) {
    if (settings.extension_settings) {
        Object.assign(extension_settings, settings.extension_settings);
    }
    $('#extensions_url').val(extension_settings.apiUrl);
    $('#extensions_api_key').val(extension_settings.apiKey);
    $('#extensions_autoconnect').prop('checked', extension_settings.autoConnect);
    $('#extensions_notify_updates').prop('checked', extension_settings.notifyUpdates);

    // Activate offline extensions
    await eventSource.emit(event_types.EXTENSIONS_FIRST_LOAD);
    const extensions = await discoverExtensions();
    extensionNames = extensions.map(x => x.name);
    extensionTypes = Object.fromEntries(extensions.map(x => [x.name, x.type]));
    manifests = await getManifests(extensionNames);

    const namesWithoutManifest = extensionNames.filter(name => !Object.hasOwn(manifests, name));
    if (namesWithoutManifest.length) {
        console.warn('Ignoring extensions without a loadable manifest.json:', namesWithoutManifest);
        extensionNames = extensionNames.filter(name => Object.hasOwn(manifests, name));
        namesWithoutManifest.forEach(name => delete extensionTypes[name]);
    }

    if (versionChanged && enableAutoUpdate) {
        await autoUpdateExtensions(false);
    }

    await activateExtensions();
    if (extension_settings.autoConnect && extension_settings.apiUrl) {
        connectToApi(extension_settings.apiUrl);
    }
}
```

#### 2.2 `discoverExtensions`（`extensions.js:298-312`）

```js
async function discoverExtensions() {
    try {
        const response = await fetch('/api/extensions/discover');
        if (response.ok) {
            const extensions = await response.json();
            return extensions;
        } else {
            return [];
        }
    } catch (err) {
        console.error(err);
        return [];
    }
}
```

返回 `[{name, type}]`，`type ∈ {global, local, system}`（`getExtensionType` 用法见 `extensions.js:249-252`、`331-332`）。

#### 2.3 `getManifests`（`extensions.js:537-562`）

```js
async function getManifests(names) {
    const obj = {};
    const promises = [];
    for (const name of names) {
        const promise = new Promise((resolve, reject) => {
            fetch(`/scripts/extensions/${name}/manifest.json`).then(async response => {
                if (response.ok) {
                    const json = await response.json();
                    obj[name] = json;
                    resolve();
                } else {
                    reject();
                }
            }).catch(err => {
                reject();
                console.log('Could not load manifest.json for ' + name, err);
            });
        });
        promises.push(promise);
    }
    await Promise.allSettled(promises);
    return obj;
}
```

容错：**不做任何字段默认值填充**；取不到的扩展直接不进 `manifests`，随后在 `1802-1807` 被丢弃。

#### 2.4 `activateExtensions`（`extensions.js:568-666`，核心 568-646）

```js
async function activateExtensions() {
    extensionLoadErrors.clear();
    const clientVersion = CLIENT_VERSION.split(':')[1];
    const extensions = Object.entries(manifests).sort((a, b) => sortManifestsByOrder(a[1], b[1]));
    const extensionNames = extensions.map(x => x[0]);
    const promises = [];

    for (let entry of extensions) {
        const name = entry[0];
        const manifest = entry[1];
        const extrasRequirements = manifest.requires;
        const extensionDependencies = manifest.dependencies;
        const minClientVersion = manifest.minimum_client_version;
        const displayName = manifest.display_name || name;

        if (activeExtensions.has(name)) { continue; }
        let meetsClientMinimumVersion = true;
        if (minClientVersion !== undefined) {
            meetsClientMinimumVersion = versionCompare(clientVersion, minClientVersion);
        }
        // requires：undefined/null/非数组 → 放行；数组 → isSubsetOf(modules, requires)
        // dependencies：undefined/非数组 → 放行；数组 → 必须全部存在且未禁用
        const isDisabled = extension_settings.disabledExtensions.includes(name);

        if (meetsModuleRequirements && meetsExtensionDeps && meetsClientMinimumVersion && !isDisabled) {
            try {
                const promise = addExtensionLocale(name, manifest).finally(() =>
                    Promise.all([addExtensionScript(name, manifest), addExtensionStyle(name, manifest)]),
                );
                await promise
                    .then(() => {
                        activeExtensions.add(name);
                        return callExtensionHook(name, 'activate');
                    })
                    .catch(err => {
                        console.log('Could not activate extension', name, err);
                        extensionLoadErrors.add(t`Extension "${displayName}" failed to load: ${err}`);
                    });
                promises.push(promise);
            } catch (error) {
                console.error('Could not activate extension', name, error);
            }
        } else if (!meetsModuleRequirements && !isDisabled) { /* 记错误 */ }
        else if (!meetsExtensionDeps && !isDisabled) { /* 区分 missing / disabled */ }
        else if (!meetsClientMinimumVersion && !isDisabled) { /* 记错误 */ }
    }
    await Promise.allSettled(promises);
    $('#extensions_details').toggleClass('warning', extensionLoadErrors.size > 0);
}
```

要点：

- **顺序执行**：`await promise` 在 `for` 循环体内，扩展按 `loading_order` 依次激活（不是并行）。
- 加载顺序 = locale → (JS + CSS 并行) → `activate` 钩子。
- 失败只记录到 `extensionLoadErrors`，在 Manage extensions 弹窗顶部显示（`extensions.js:1136`、`1105-1120`）。

#### 2.5 `callExtensionHook`（`extensions.js:406-466`）

```js
async function callExtensionHook(name, hookName) {
    const manifest = manifests[name];
    if (!manifest) { /* debug + return */ }
    if (!manifest.hooks || typeof manifest.hooks !== 'object') { return; }
    if (!Object.hasOwn(manifest.hooks, hookName)) { return; }
    const hookFunctionName = manifest.hooks[hookName];
    if (typeof hookFunctionName !== 'string' || !hookFunctionName) { /* warn + return */ }
    if (!manifest.js) { /* warn + return */ }

    const url = `/scripts/extensions/${name}/${manifest.js}`;
    try {
        const module = await import(url);
        if (typeof module[hookFunctionName] !== 'function') { /* warn + return */ }
        const hookCallResult = module[hookFunctionName]();
        const HOOK_TIMEOUT = 5000;
        const result = await Promise.race([
            (hookCallResult instanceof Promise ? hookCallResult : Promise.resolve(hookCallResult)).then(() => HOOK_RESULT.OK),
            delay(HOOK_TIMEOUT).then(() => HOOK_RESULT.TIMEOUT),
        ]);
        // 超时只 warn，不抛
    } catch (error) {
        console.error(`callExtensionHook: Error calling hook "${hookName}" for extension "${name}":`, error);
    }
}
```

- **钩子名 = 函数名**，宿主动态 `import()` 入口模块后取导出函数调用；无参数；可返回 Promise；**5 秒超时**（超时仅告警）。
- 钩子函数不接收 `getContext()`，需要自己取。

**`manifest.hooks` 支持的钩子名**（JSDoc 明确列出，`extensions.js:385`、`:403`）：

| 钩子 | 调用点 | 时机 |
|---|---|---|
| `install` | `extensions.js:1771` | 安装成功后（`installExtension` 内，`loadExtensionSettings` 之后） |
| `update` | `extensions.js:1388-1389` | 更新成功且非最新时 |
| `delete` | `extensions.js:1568` | 删除时 |
| `clean` | `extensions.js:1448`、`1565` | 清理数据 / 删除时顺带清理 |
| `enable` | `extensions.js:474` | 启用时（先钩子后改 `disabledExtensions`） |
| `disable` | `extensions.js:491` | 禁用时 |
| `activate` | `extensions.js:637` | 每次加载并激活时（内置扩展 `manifest.json` 普遍用它指向 `init`） |

内置 manifest 示例：`[ST-SRC] public/scripts/extensions/regex/manifest.json:11-13`、`quick-reply/manifest.json:11-13` 都是 `"hooks": { "activate": "init" }`。

#### 2.6 `loading_order` 排序规则

`extensions.js:49-50`：

```js
const sortManifestsByOrder = (a, b) => parseInt(a.loading_order) - parseInt(b.loading_order) || String(a.display_name).localeCompare(String(b.display_name));
const sortManifestsByName = (a, b) => String(a.display_name).localeCompare(String(b.display_name)) || parseInt(a.loading_order) - parseInt(b.loading_order);
```

- 激活顺序用 `sortManifestsByOrder`：`loading_order` 数值升序；缺失/非法 → `parseInt` 得 `NaN`，`NaN - NaN` 为 `NaN`（falsy）→ 退回 `display_name` 字典序。
- 管理弹窗默认也用 loading order（`showExtensionsDetails` `extensions.js:1166-1169`），可切换为按名称（存在 `accountStorage`）。
- `generate_interceptor` 也按 `sortManifestsByOrder` 排序（`extensions.js:2033`）。

#### 2.7 `requires` / `dependencies` / `minimum_client_version` 校验

`extensions.js:578-624`：

- `requires`：`undefined`/`null` → 放行；数组 → `isSubsetOf(modules, requires)`，`modules` 来自 Extras API（`extensions.js:34`）；非数组 → warn 但放行。
- `dependencies`：`undefined` → 放行；数组 → 必须全部在 `extensionNames` 中，且**任何一个被禁用即整体失败**；非数组 → warn 但放行。
- `minimum_client_version`：`undefined` → 放行；否则 `versionCompare(clientVersion, minClientVersion)`。
- 三者任一不满足 → 不加载，错误写入 `extensionLoadErrors`。

#### 2.8 事件发射时机表

| 事件常量（`events.js`） | 值 | 发射点 | 时机 |
|---|---|---|---|
| `SETTINGS_LOADED_BEFORE` | `settings_loaded_before` | `script.js:7940` | settings 解析后、各模块装载前（可改写 settings） |
| `SETTINGS_LOADED_AFTER` | `settings_loaded_after` | `script.js:7982` | 各模块装载后 |
| `EXTENSIONS_FIRST_LOAD` | `extensions_first_load` | `extensions.js:1794` | `discoverExtensions` **之前**；扩展尚未加载 |
| `EXTENSION_SETTINGS_LOADED` | `extension_settings_loaded` | `script.js:8025`；`extensions.js:1767` | 前者：`loadExtensionSettings` 后；后者：安装后（带 `response`） |
| `SETTINGS_LOADED` | `settings_loaded` | `script.js:8047` | `settingsReady = true` 后 |
| `APP_INITIALIZED` | `app_initialized` | `script.js:787` | 核心初始化完成 |
| `APP_READY` | `app_ready` | `script.js:790` | loader 隐藏、视口修正后 |

事件常量定义：`[ST-SRC] public/scripts/events.js:27-34`；`eventSource` 是单一 `EventEmitter` 实例（`events.js:113`）。

---

### 3. `getContext()` 完整字段表

来源：`[ST-SRC] public/scripts/st-context.js:115-309`（全文 311 行，`getContext()` 每次调用**新建一个普通对象**）。

> 类型写法：`fn` = 函数，`obj` = 对象，`arr` = 数组，`str` = 字符串，`num` = 数字，`bool` = 布尔，`cls` = 类/构造器。
> 注意：原始值字段（`name1`/`name2`/`characterId`/`maxContext` 等）是**调用时快照**；`chat`/`characters`/`groups`/`tags` 等是**共享引用**。扩展需要新值时应重新 `getContext()`。

| 字段 | 类型 | 来源模块 | 用途 |
|---|---|---|---|
| `accountStorage` | obj | `scripts/util/AccountStorage.js` | 浏览器端账户级键值存储 |
| `chat` | arr | `script.js` | 当前聊天消息数组（ST 消息对象） |
| `characters` | arr | `script.js` | 角色卡片数组 |
| `groups` | arr | `scripts/group-chats.js` | 群组列表 |
| `name1` | str | `script.js` | 用户 persona 名（快照） |
| `name2` | str | `script.js` | 当前角色名（快照） |
| `characterId` | num | `script.js` (`this_chid`) | 当前角色索引 |
| `groupId` | num/str | `scripts/group-chats.js` (`selected_group`) | 当前群组 id |
| `chatId` | str | 计算（`groups` / `characters[this_chid].chat`） | 当前聊天 id |
| `getCurrentChatId` | fn | `script.js` | 取当前聊天 id |
| `getRequestHeaders` | fn | `script.js` | 生成带 CSRF/鉴权的 fetch headers |
| `reloadCurrentChat` | fn | `script.js` | 重载当前聊天 |
| `renameChat` | fn | `script.js` | 重命名聊天 |
| `saveSettingsDebounced` | fn | `script.js` | 防抖保存整份 settings（含 `extensionSettings`） |
| `onlineStatus` | str | `script.js` (`online_status`) | 连接状态文本 |
| `maxContext` | num | `script.js` (`max_context`) | 当前上下文上限 |
| `chatMetadata` | obj | `script.js` (`chat_metadata`) | 当前聊天元数据 |
| `saveMetadataDebounced` | fn | `scripts/extensions.js` | 防抖保存聊天元数据（带角色/群组变更保护） |
| `streamingProcessor` | obj | `script.js` | 流式输出处理器 |
| `eventSource` | obj | `scripts/events.js` | 全局事件总线（`on/once/off/emit`） |
| `eventTypes` | obj | `scripts/events.js` | 事件名字符串常量表 |
| `addOneMessage` | fn | `script.js` | 追加一条消息 |
| `deleteLastMessage` | fn | `script.js` | 删除最后一条 |
| `deleteMessage` | fn | `script.js` | 删除指定消息 |
| `generate` | fn | `script.js` (`Generate`) | 发起生成（核心生成入口） |
| `sendStreamingRequest` | fn | `script.js` | 流式请求 |
| `sendGenerationRequest` | fn | `script.js` | 非流式生成请求 |
| `stopGeneration` | fn | `script.js` | 停止生成 |
| `tokenizers` | obj | `scripts/tokenizers.js` | 分词器集合 |
| `getTextTokens` | fn | `scripts/tokenizers.js` | 同步计数 |
| `getTokenCount` | fn | `scripts/tokenizers.js` | **已弃用**，用 `getTokenCountAsync` |
| `getTokenCountAsync` | fn | `scripts/tokenizers.js` | 异步计数 |
| `extensionPrompts` | obj | `script.js` (`extension_prompts`) | 扩展提示词槽位状态 |
| `setExtensionPrompt` | fn | `script.js` | 设置扩展提示词 |
| `updateChatMetadata` | fn | `script.js` | 合并写聊天元数据 |
| `saveChat` | fn | `script.js` (`saveChatConditional`) | 条件保存聊天 |
| `openCharacterChat` | fn | `script.js` | 打开角色聊天 |
| `openGroupChat` | fn | `scripts/group-chats.js` | 打开群组聊天 |
| `saveMetadata` | fn | `script.js` | 立即保存元数据 |
| `sendSystemMessage` | fn | `script.js` | 发系统消息 |
| `activateSendButtons` / `deactivateSendButtons` | fn | `script.js` | 发送按钮启用/禁用 |
| `saveReply` | fn | `script.js` | 保存回复 |
| `substituteParams` / `substituteParamsExtended` | fn | `script.js` | 宏/参数替换 |
| `SlashCommandParser` / `SlashCommand` / `SlashCommandArgument` / `SlashCommandNamedArgument` / `SlashCommandEnumValue` / `ARGUMENT_TYPE` | cls/obj | `scripts/slash-commands/*` | 斜杠命令注册工具 |
| `executeSlashCommandsWithOptions` | fn | `scripts/slash-commands.js` | 执行命令（带选项） |
| `registerSlashCommand` | fn | `scripts/slash-commands.js` | **已弃用** |
| `executeSlashCommands` | fn | `scripts/slash-commands.js` | **已弃用** |
| `timestampToMoment` | fn | `scripts/utils.js` | 时间戳 → moment |
| `registerHelper` | fn | `scripts/st-context.js` | **已弃用**（Handlebars 不再支持），空实现 |
| `registerMacro` / `unregisterMacro` | fn | `scripts/macros.js` (`MacrosParser`) | **已弃用**，改用 `macros.registry` |
| `registerFunctionTool` / `unregisterFunctionTool` / `isToolCallingSupported` / `canPerformToolCalls` | fn | `scripts/tool-calling.js` (`ToolManager`) | 工具调用注册与能力查询 |
| `ToolManager` | cls | `scripts/tool-calling.js` | 工具管理器 |
| `registerDebugFunction` | fn | `scripts/power-user.js` | 注册调试函数 |
| `renderExtensionTemplate` | fn | `scripts/extensions.js` | **已弃用**，用 Async 版 |
| `renderExtensionTemplateAsync` | fn | `scripts/extensions.js` | 渲染扩展模板为 HTML 字符串 |
| `registerDataBankScraper` | fn | `scripts/scrapers.js` | 注册数据银行抓取器 |
| `callPopup` | fn | `scripts/popup.js` | **已弃用** |
| `callGenericPopup` | fn | `scripts/popup.js` | 通用弹窗 |
| `showLoader` / `hideLoader` | fn | `scripts/loader.js` | **已弃用**，用 `loader.show/hide` |
| `mainApi` | str | `script.js` (`main_api`) | 当前主 API 名 |
| `extensionSettings` | obj | `scripts/extensions.js` (`extension_settings`) | **扩展设置单例（与 `extension_settings` 同引用）** |
| `ModuleWorkerWrapper` | cls | `scripts/util/SimpleMutex.js` | `SimpleMutex` 别名 |
| `getTokenizerModel` | fn | `scripts/tokenizers.js` | 取分词模型名 |
| `generateQuietPrompt` | fn | `script.js` | 静默生成 |
| `generateRaw` / `generateRawData` | fn | `script.js` | 原始生成 |
| `writeExtensionField` / `writeExtensionFieldBulk` | fn | `scripts/extensions.js` | 写角色卡 `data.extensions` 字段 |
| `getThumbnailUrl` | fn | `script.js` | 取缩略图 URL |
| `selectCharacterById` | fn | `script.js` | 按 id 选角色 |
| `messageFormatting` | str | `script.js` | 消息格式化模板 |
| `shouldSendOnEnter` | bool | `scripts/RossAscends-mods.js` | 回车发送开关 |
| `isMobile` | bool | `scripts/RossAscends-mods.js` | 是否移动端 |
| `t` / `translate` | fn | `scripts/i18n.js` | 翻译 |
| `getCurrentLocale` / `addLocaleData` | fn | `scripts/i18n.js` | 语言环境 |
| `tags` | arr | `scripts/tags.js` | 标签列表 |
| `tagMap` | obj | `scripts/tags.js` (`tag_map`) | 标签映射 |
| `menuType` | str | `script.js` (`menu_type`) | 当前菜单类型 |
| `createCharacterData` | fn | `script.js` (`create_save`) | 创建角色数据结构 |
| `event_types` | obj | `scripts/events.js` | **旧 snake-case 兼容别名**（= `eventTypes`） |
| `Popup` / `POPUP_TYPE` / `POPUP_RESULT` | cls/obj | `scripts/popup.js` | 弹窗 API |
| `chatCompletionSettings` | obj | `scripts/openai.js` (`oai_settings`) | Chat Completion 设置 |
| `textCompletionSettings` | obj | `scripts/textgen-settings.js` | Text Completion 设置 |
| `powerUserSettings` | obj | `scripts/power-user.js` (`power_user`) | 高级用户设置 |
| `getCharacters` / `getOneCharacter` / `getCharacterCardFields` / `getCharacterSource` | fn | `script.js` | 角色读取 |
| `importFromExternalUrl` | fn | `scripts/utils.js` | 从 URL 导入 |
| `importTags` | fn | `scripts/tags.js` | 导入标签 |
| `uuidv4` | fn | `scripts/utils.js` | 生成 uuid |
| `humanizedDateTime` | fn | `scripts/RossAscends-mods.js` | 可读时间 |
| `updateMessageBlock` / `appendMediaToMessage` / `ensureMessageMediaIsArray` / `getMediaDisplay` / `getMediaIndex` | fn | `script.js` | 消息媒体处理 |
| `scrollChatToBottom` / `scrollOnMediaLoad` | fn | `script.js` | 滚动控制 |
| `macros` | obj | `scripts/macros/macro-system.js` | 宏系统注册表 |
| `messageFormatter` | cls | `scripts/message-formatter.js` (`MessageFormatter`) | 消息格式化器 |
| `loader` | obj | `scripts/action-loader.js` | 加载指示器 |
| `swipe` | obj | `script.js` | `{left,right,to,show,hide,refresh,isAllowed,state}` 滑动 API |
| `variables` | obj | `scripts/variables.js` | `{local,global}.{get,set,del,add,inc,dec,has}` |
| `loadWorldInfo` / `saveWorldInfo` / `reloadWorldInfoEditor` / `updateWorldInfoList` / `convertCharacterBook` / `getWorldInfoPrompt` / `getWorldInfoNames` | fn | `scripts/world-info.js` | 世界书读写 |
| `CONNECT_API_MAP` | obj | `script.js` | API 连接映射常量 |
| `getTextGenServer` | fn | `scripts/textgen-settings.js` | 取 TextGen 服务器 |
| `extractMessageFromData` | fn | `script.js` | 从响应数据提取消息 |
| `getPresetManager` | fn | `scripts/preset-manager.js` | 预设管理器 |
| `getChatCompletionModel` | fn | `scripts/openai.js` | 取当前模型 |
| `printMessages` / `clearChat` | fn | `script.js` | 重绘 / 清空聊天 |
| `ChatCompletionService` / `TextCompletionService` | cls | `scripts/custom-request.js` | 自定义请求服务 |
| `ConnectionManagerRequestService` | cls | `scripts/extensions/shared.js` | 连接管理服务 |
| `updateReasoningUI` / `parseReasoningFromString` / `getReasoningTemplateByName` | fn | `scripts/reasoning.js` | 推理（思考）UI |
| `unshallowCharacter` / `unshallowGroupMembers` | fn | `script.js` | 浅拷贝还原 |
| `getExtensionManifest` | fn | `scripts/extensions.js` | 取 manifest 深拷贝（可短名） |
| `openThirdPartyExtensionMenu` | fn | `scripts/extensions.js` | 打开第三方安装菜单 |
| `symbols.ignore` | str | `scripts/constants.js` (`IGNORE_SYMBOL`) | 忽略符号常量 |
| `constants.unset` | str | `scripts/extensions.js` (`UNSET_VALUE`) | 删除字段哨兵值 |

**特别标注（任务点名的字段）**：

- `chat`、`characters`、`name1`、`name2`：`st-context.js:118-122`，来自 `script.js`。
- `eventSource`、`eventTypes`：`:138-139`。
- `extensionSettings`：`:201`，与 `extensions.js` 的 `extension_settings` 是**同一对象**。
- `power_user`：**不在 context 上**，只有 :229 的 `powerUserSettings`（camelCase）。
- `saveSettingsDebounced`：`:132`。
- `generate`：`:143`（= `Generate`）。
- `getRequestHeaders`：`:129`。
- `messageFormatting`：`:211`（字符串模板，不是函数）。
- **`getRegexedString` 不在 `getContext()` 中**。它导出在 `[ST-SRC] public/scripts/extensions/regex/engine.js:334`：
  `export function getRegexedString(rawString, placement, { characterOverride, isMarkdown, isPrompt, isEdit, depth } = {})`。
  扩展需要自己 `import { getRegexedString } from '../extensions/regex/engine.js'`（或对应相对路径）。

#### `window.SillyTavern` 全局与 `getContext()` 的关系

`[ST-SRC] public/script.js:293-296`：

```js
// API OBJECT FOR EXTERNAL WIRING
globalThis.SillyTavern = {
    libs,
    getContext,
};
```

- **不是同一对象**。`window.SillyTavern` 只是一个命名空间，只有两个键：
  - `getContext`：调用后返回上表的 context 对象（每次新建）。
  - `libs`：`[ST-SRC] public/lib.js:84-110` 的默认导出，含 `lodash / Fuse / DOMPurify / hljs / localforage / Handlebars / css / Bowser / DiffMatchPatch / Readability / isProbablyReaderable / SVGInject / showdown / moment / seedrandom / Popper / droll / morphdom / slideToggle / chalk / yaml / chevrotain / gzipSync / gzip / sha256`。
- **只在全局上、不在 context 上的字段**：`libs`。
- 反过来，context 上所有字段都不在 `window.SillyTavern` 上；扩展必须 `SillyTavern.getContext().xxx`。
- RPNow 的 shim 把大量字段直接挂在全局（见 ④），这是 RPNow 的兼容增强，**不是 ST 行为**。

---

### 4. manifest 契约

#### 4.1 被 `extensions.js` 实际读取的字段

| 字段 | 读取点 | 用途 | 缺字段容错 |
|---|---|---|---|
| `display_name` | `extensions.js:581`、`917`、`1949/1954/1966`、`2000/2005/2009` | 列表显示名、错误信息 | `manifest.display_name \|\| name`（581）；`generateExtensionElement` 直接取（917，可能 undefined） |
| `js` | `429`、`434`、`814`、`819` | 入口模块 URL | 缺失 → `addExtensionScript` 直接 `Promise.resolve()`（814-816） |
| `css` | `782`、`787` | 样式表 URL | 缺失 → `Promise.resolve()`（782-784） |
| `hooks` | `391-394`、`414-422` | 生命周期钩子函数名映射 | 非对象 → 视为无钩子（391-393 / 414-416）；值非字符串 → warn 跳过（424-427） |
| `requires` | `578`、`595-601`、`986` | Extras 模块依赖 | `undefined` 放行；非数组 warn 但放行（600） |
| `optional` | `972-983` | 可选模块展示 | 非数组 → 该分支不执行（`Array.isArray` 判断） |
| `dependencies` | `579`、`608-623` | 扩展间依赖 | `undefined` 放行；非数组 warn 但放行（622） |
| `minimum_client_version` | `580`、`588-590` | 最低客户端版本 | `undefined` → 放行（588） |
| `loading_order` | `49-50`、`571` | 激活/排序 | `parseInt(undefined)=NaN` → 退回名称排序 |
| `version` | `918` | 列表版本号 | `manifest.version \|\| ''` |
| `auto_update` | `1958`、`1989`、`2008` | 自动更新 |  falsy → 不自动更新 |
| `generate_interceptor` | `2033-2037` | 生成拦截器（**全局函数名**） | falsy → 跳过；从 `globalThis[interceptorKey]` 取函数 |

`generate_interceptor` 的调用方式（`extensions.js:2033-2037`）：

```js
for (const manifest of Object.values(manifests).filter(x => x.generate_interceptor).sort((a, b) => sortManifestsByOrder(a, b))) {
    const interceptorKey = manifest.generate_interceptor;
    if (typeof globalThis[interceptorKey] === 'function') {
        await globalThis[interceptorKey](chat, contextSize, abort, type);
    }
}
```

#### 4.2 **未被读取**的常见字段

- `author`：`extensions.js` 从不读。列表里的作者来自仓库 URL 反推：`extensions.js:1898-1907` 用 `getAuthorFromUrl(origin)`（`:2283-2300`，只解析 github.com 的 owner）。`generateExtensionElement` 里创建的 `authorSpan`（`:963-970`）默认为**空**，仅由更新检查填充。
- `homePage`：未读取。
- `description`：未读取（仅安装接口返回值里用作 toast 文案，`extensions.js:1764`）。

#### 4.3 内置 manifest 形态（说明 `hooks.activate` 是通用约定）

`[ST-SRC] public/scripts/extensions/regex/manifest.json:1-14`：

```json
{
    "display_name": "Regex",
    "loading_order": 1,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "kingbri",
    "version": "1.0.0",
    "homePage": "https://github.com/SillyTavern/SillyTavern",
    "hooks": { "activate": "init" }
}
```

`quick-reply/manifest.json` 同构（`loading_order: 12`）。

---

## ③ 设置 UI 契约专章

### 3.1 容器层级（ST）

```
Extensions 抽屉（独占表面，非插件列表）
#extensions-settings-button.drawer
└─ #rm_extensions_block.drawer-content          width: var(--sheldWidth) = 50vw, min-width: 450px
   └─ .extensions_block.flex-container         display:flex; gap:5px; flex-wrap:wrap
      ├─ #extensions_settings.flex1.wide50p     display:flex; flex-direction:column   ≈ 25vw
      │  └─ .extension_container#<name>_container  display:contents（不生成盒子）
      │     └─ 扩展 append 的 .inline-drawer 设置块
      └─ #extensions_settings2.flex1.wide50p    同上
```

另一个表面：`#extensionsMenu`（wand 菜单，硬编码 `<name>_wand_container`，`wandMenu.html:1-17`）。

### 3.2 宽度 / 布局 CSS（根因分析）

| 层级 | 规则 | 结果 |
|---|---|---|
| `.drawer-content` | `width: var(--sheldWidth)`；`--sheldWidth: 50vw`（`style.css:92`） | 设置面板总宽 = 半屏 |
| `.extensions_block` | `flex-container`：`display:flex; gap:5px; flex-wrap:wrap` | 两栏横向排列 |
| `#extensions_settings(2)` | `flex:1` + `width:50%` + `flex-direction:column` | 各占约 50%，即约 **25vw** |
| `.extension_container` | `display:contents` | 容器不占空间，设置项直接排入列 |
| 移动端 | `width:100% !important` | 两栏堆叠成整宽 |

**「设置项被裁剪/挤压」的 ST 对应根因**：ST 把设置项放进半屏抽屉的 **50% 列**（约 25vw）。它靠 `display:contents` + `flex-direction:column` 保证列内不换行、不挤压；真正的约束是抽屉宽度本身。窄屏下 ST 的解法是移动端 `width:100%` 堆叠。

### 3.3 持久化 API（ST）

- 单例：`extension_settings`（`extensions.js:141-226`）。
- 上下文：`getContext().extensionSettings`（同一引用，`st-context.js:201`）。
- 保存：`getContext().saveSettingsDebounced()` → `script.js` 的 `saveSettings` → payload `extension_settings`（`script.js:8085`）。
- 读取：`loadExtensionSettings` 里 `Object.assign(extension_settings, settings.extension_settings)`（`extensions.js:1784-1786`）。
- 扩展侧标准写法见 1.4（gallery `initSettings`）。

### 3.4 明确回答：「设置项是不是渲染在已安装插件列表 item 内部？」

**不是。ST 源码中两者是两个完全分离的表面。**

- **已安装插件列表**（Manage extensions 弹窗，`.extensions_info`）的 item 由 `generateExtensionElement` 生成（`extensions.js:890-1055`）：只包含
  `toggle`（`:927-944`）→ `icon`（`:946-950`）→ `textBlock`（名称/作者/版本/模块缺失提示，`:952-1008`）→ `actionsDiv`（update / clean / branch / move / delete 按钮，`:1010-1052`）。
  **没有任何设置项、没有 `PluginSettings`、没有内联表单。**
- **设置面板**在另一个抽屉 `#rm_extensions_block` 里，由扩展 JS 自行 `append`（`index.html:5773-5808` + 各扩展 `init()`）。
- 列表 item 的 `extension_text_block` 还做了 `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`（`extensions-panel.css:154-158`）——它本来就不打算承载表单。

### 3.5 对比 RPNow 现状

| 维度 | ST | RPNow |
|---|---|---|
| 第三方扩展设置 DOM 挂载点 | 扩展自己 `append` 到 `#extensions_settings` / `#extensions_settings2`（半屏抽屉的左右两栏） | 扩展挂到全局 `#extensions_settings`：`src/core/plugins/st-host-runtime.ts:654-661` 在 `main` 末尾新建 `div#extensions_settings`，`display:flex;flex-direction:column;gap:12px` |
| 该节点的可见性 | 在抽屉里，有宽度约束（50vw/25vw）和样式 | `main` 是 `overflow-hidden`（`src/components/layout/AppShell.tsx:166`），且不是 flex 容器 → 该 div 落在页面内容之后、被裁掉，等于「隐形 div」 |
| 原生配置 UI | 无通用 schema 表单；扩展自己画 | `src/components/plugins/PluginSettings.tsx:35-131` 依据 `manifest.config` JSON-Schema 渲染 |
| 原生配置位置 | — | `src/pages/PluginsPage.tsx:271-350`：`<li>` 卡片内，设置面板 `mt-2` 放在 `.flex` 行**下方**（注释 `:336-341` 说明曾被 `min-w-0 flex-1` 挤压而移到全宽） |
| 设置持久化 | 全局 `extension_settings` + `saveSettingsDebounced` | 每插件 localStorage：`rpnow:st:<pluginId>`（`src/core/plugins/st-bridge.ts:207-220`），`getContext().extensionSettings` 返回该桶（`:233-292`） |
| manifest `hooks` | 读取并调用 7 个钩子 | `parseRpnx` 映射 manifest 时丢弃 `hooks`（`src/core/plugins/rpnx.ts:222-235`）→ `st-bridge` 永远调不到 `activate` |

**RPNow 的两个具体问题**：

1. **ST 扩展的设置 UI 无处可见**：`#extensions_settings` 被挂到 `main` 末尾，而 `main` 是 `overflow-hidden` 的固定高度块，扩展 append 的 DOM 落在裁剪区外；且它不属于任何设置页面/抽屉，用户没有入口。
2. **两套设置机制没有汇合**：原生 `PluginSettings` 在插件列表 `li` 内（`PluginsPage.tsx:342-349`），ST 扩展设置在页面底部的隐形 div。两者位置、持久化、交互完全独立。

---

## ④ 对 RPNow 的具体改造建议

> 只给建议，不改代码。

### 4.1 容器该放哪

- **不要再把 `#extensions_settings` 挂在 `main` 末尾**。`main` 是 `overflow-hidden` 的路由容器（`AppShell.tsx:166`），任何 append 到它的兄弟节点都会被裁掉。
- 为 ST 扩展设置建立**独占表面**，二选一：
  1. **每插件设置面板**（推荐）：在插件列表 item 展开区或插件详情抽屉里，为每个 ST 扩展提供 `<div id="<pluginId>_container" class="extension_container">`，扩展 `append` 到该容器。这样与原生 `PluginSettings` 同处一个面板。
  2. **全局设置抽屉**：仿 ST 做 `#rp_extensions_settings` / `#rp_extensions_settings2` 两栏，放在独立路由/抽屉里，宽度用视口百分比而非 `main` 的固定高度。
- 容器必须**由宿主在扩展激活前就存在**（ST 是静态写在 `index.html`），否则扩展 `init()` 时 `document.querySelector` 返回 null。当前 `st-host-runtime.ts:654-661` 是「有就复用、没有就建」，但建立时机在 `installHostGlobals()`（激活时），需要确保目标父节点此时已挂载。

### 4.2 宽度怎么保证

- 设置面板容器用**块级全宽**：`width:100%`，不要继承 `flex` 行的 `min-w-0 flex-1` 压缩。
- 若保留在列表 `li` 内：把设置面板放在 `.flex` 行**外**（现在 `PluginsPage.tsx:342-349` 已经这样做了），并给 `li` 加 `flex-col` 或让面板 `w-full`；避免 `overflow-hidden` 祖先。
- 借鉴 ST 的两个手段：
  - `.extension_container { display: contents }` —— 让容器不生成盒子，设置项直接参与父布局，避免嵌套挤压；
  - 移动端堆叠（`width:100% !important`），不要在两栏里塞表单。
- 给设置面板设定明确最大宽度（例如 `max-w-3xl`）并允许内部换行，长 input/select 才不会溢出。

### 4.3 两套设置机制如何收敛

- **统一持久化命名空间**：保留 ST 的「单例对象 + 键名约定」语义，但按 RPNow 的插件 id 命名。当前 `st-bridge.ts:207-220` 的 `rpnow:st:<pluginId>` 桶已经隔离，问题是 `getContext().extensionSettings` 返回的是**整桶**，而 ST 扩展习惯写 `extension_settings[<extensionName>]`。
  - 建议：让 `getContext().extensionSettings` 返回**该插件命名空间对象**（等价于 ST 的 `extension_settings[extensionName]`），或提供一个全局 `extensionSettings` 并在 shim 里把 `[<pluginId>]` 指过去；同时保留 `saveSettingsDebounced` 真正写回（现在 `persistSettings` 已做，但键名不同）。
- **统一设置面板**：不论原生 `config` schema 还是 ST 扩展自绘 DOM，都进同一个「插件设置」表面。宿主只负责：容器、持久化、保存按钮/自动保存；扩展负责自己的 DOM。
- **原生 `config` 与 ST `extensionSettings` 的分工**：`config` 面向 RPNow 原生插件（无 JS 设置 UI 的场景），`extensionSettings` 面向 ST 扩展。不要互相覆盖同一个键。

### 4.4 顺手要修的兼容性缺口

- **`manifest.hooks`**：`parseRpnx` 保留 `hooks` 字段并传给 `st-bridge`，在激活时调用 `activate`（对应 `init`），启用/禁用时调用 `enable`/`disable`。这是已确认的 bug，修复后内置/第三方 ST 扩展的初始化才会真正执行。
- **事件时机**：RPNow 的 shim 有 `eventTypes` 与 `eventSource`，但未按 ST 时序发射。建议至少按序补：`SETTINGS_LOADED_BEFORE` → `SETTINGS_LOADED_AFTER` → `EXTENSIONS_FIRST_LOAD` → （激活）→ `EXTENSION_SETTINGS_LOADED` → `SETTINGS_LOADED` → `APP_INITIALIZED` → `APP_READY`。注意 ST 的 `EXTENSIONS_FIRST_LOAD` 是在扩展加载**之前**发射的，别照抄成之后。
- **`getContext()` 字段缺口**：RPNow 已覆盖 `chat/characters/name1/name2/eventSource/eventTypes/extensionSettings/power_user/saveSettingsDebounced/getRequestHeaders/generate/messageFormatting`，但 `getRegexedString`、`renderExtensionTemplate(Async)`、`writeExtensionField`、`getExtensionManifest` 等常被引用的字段仍缺；大量内置扩展模板依赖 `renderExtensionTemplateAsync` + `$('#xxx_container')`，这直接决定 4.1 的容器策略能否落地。
- **`window.SillyTavern` 形态**：ST 只有 `{ libs, getContext }`；RPNow 把 `eventSource/eventTypes/extensionSettings/saveSettingsDebounced/...` 直接挂全局（`st-bridge.ts:295-312`）。这是无害的超集，但若要严格兼容旧扩展，保持即可；不要因此让扩展误以为 context 上也有这些字段。

---

## 附：主要引用索引

- `public/scripts/extensions.js`：125-139、141-226、289-292、298-312、388-396、406-466、473-499、508-562、568-666、688-723、781-877、890-1055、1063-1074、1105-1120、1125-1327、1357-1395、1446-1455、1561-1600、1698-1775、1783-1817、1898-1907、2024-2049、2070-2120、2283-2324
- `public/scripts/st-context.js`：1-113、115-309
- `public/scripts/templates.js`：60-89、102-131
- `public/scripts/events.js`：3-113
- `public/script.js`：293-296、694-790、7913-8048、8069-8094、11101-11106、12591
- `public/index.html`：5750-5832
- `public/css/extensions-panel.css`：139-152、154-158
- `public/css/st-tailwind.css`：268-272、375-377、461-463
- `public/style.css`：92、1144-1171、2931-2933、5403-5413、5443-5447、5479-5485、5535-5545、5555-5563
- `public/css/mobile-styles.css`：180-184
- `public/scripts/templates/wandMenu.html`：1-17
- `public/scripts/extensions/regex/index.js`：1713-1729；`regex/engine.js`：334；`regex/manifest.json`：1-14；`regex/dropdown.html`：1-9
- `public/scripts/extensions/quick-reply/index.js`：172-178；`quick-reply/manifest.json`：1-14
- `public/scripts/extensions/gallery/index.js`：70-103
- `public/scripts/extensions/memory/index.js`：1068-1069
- `public/scripts/extensions/vectors/index.js`：1742-1743
- `public/scripts/extensions/expressions/index.js`：2275-2276
- `public/scripts/extensions/caption/index.js`：592-593
- `public/scripts/extensions/tts/index.js`：1536-1537
- `public/scripts/extensions/stable-diffusion/index.js`：5803-5804
- `public/scripts/extensions/assets/index.js`：593
- `public/scripts/extensions/translate/index.js`：711-715
- RPNow：`src/pages/PluginsPage.tsx:271-350`、`src/components/plugins/PluginSettings.tsx:35-131`、`src/core/plugins/st-host-runtime.ts:654-661`、`src/core/plugins/st-bridge.ts:133-150,206-220,233-292,295-312`、`src/core/plugins/rpnx.ts:222-235`、`src/components/layout/AppShell.tsx:166`
