# 预设 `extensions` 命名空间盘点：官方通道、调用点与 Meowssiah 全字段清单

> 本文件是「先深挖真实源码与真实预设、再改造 RPNow」阶段的子代理产出（`preset-inventory2`）。
> 来源标记：
> - `[ST-SRC]` = `D:\RPNow\_ref\SillyTavern`，**SillyTavern 1.19.0**，`package.json:118`，release 分支 commit `06bde939fb1e9c4c8d8641d810f0a916b5bce127`（2026-09-14）。
> - `[PRESET]` = `C:\Users\shuang\Downloads\Meowssiah-2.1.6.json`（660700 B）。
> - `[TH-PKG]` = `D:\RPNow\tavern-helper-real.zip` → `JS-Slash-Runner-main`（酒馆助手 4.12.1）。
>
> **度量口径（本文所有数字均为真实解析结果）**：
> - 对象/数组：`Buffer.byteLength(JSON.stringify(v), 'utf8')` 记作 `B`，`JSON.stringify(v).length` 记作 `c`。
> - 字符串：原始 UTF-8 字节数 / 原始字符数（不做 JSON 转义）。
> - 文件：`fs.statSync().size` = 660700 B；`readFileSync(...,'utf8').length` = 617962 c。
> - 解析方式：`JSON.parse(fs.readFileSync(path,'utf8'))`（剥离 BOM），脚本在 `%TEMP%\pi-*.cjs`。
>
> ⚠️ 与主证据文档 [`st-plugin-preset-coupling.md`](st-plugin-preset-coupling.md) §2.1 的数字差异说明：该文档的 `SPreset(178180)`、`regex_scripts(55620)`、`tavern_helper(195938)` 与本文两种口径都不一致（本文实测 `SPreset` 174840B/162811c、`regex_scripts` 52433B/51160c、`tavern_helper` 183352B/177893c）。本文数字可用上表口径复现，主文档数字应视为**未标注口径的早期测量**，以本文为准。

---

## ① 官方通道：`readPresetExtensionField` / `writePresetExtensionField`

### 1.1 读：`readPresetExtensionField({ name, path })`

**[ST-SRC]** `public/scripts/preset-manager.js:846-873`：

```js
/**
 * Reads a preset extension field from the preset.
 * @param {object} options
 * @param {string} [options.name] Name of the preset. If not provided, uses the currently selected preset name.
 * @param {string} options.path Path to the preset extension field, e.g. 'myextension.data'. If empty, reads the entire extensions object.
 * @return {any} The value of the preset extension field, or null if not found.
 */
readPresetExtensionField({ name, path }) {                       // :853
    const { settings } = this.getPresetList();                   // :854
    const selectedName = this.getSelectedPresetName();           // :855
    const presetName = name || selectedName;                     // :856

    // Read from settings if the selected preset is the same as the provided name
    if (settings && selectedName === presetName) {              // :859
        const settingsExtensions = ensurePlainObject(settings.extensions || {}); // :860
        return path ? lodash.get(settingsExtensions, path, null) : settingsExtensions; // :861
    }

    // Otherwise, read from the preset by name
    const preset = this.getCompletionPresetByName(presetName);   // :865
    if (!preset) {                                               // :866
        return null;                                             // :867
    }

    const presetExtensions = ensurePlainObject(preset.extensions || {}); // :870
    const value = path ? lodash.get(presetExtensions, path, null) : presetExtensions; // :871
    return value;                                                // :872
}
```

逐条回答任务问题：

**(1) `settings.extensions` 与 `preset.extensions` 的区别 —— 为什么选中预设时优先读 settings？**

`getPresetList()` 返回的第三个值 `settings` 是**该 API 的运行时设置对象**，不是预设文件：

**[ST-SRC]** `preset-manager.js:531-588`（节选）：

```js
case 'openai':            presets = openai_settings;      preset_names = openai_setting_names;   settings = oai_settings;            break; // :558-562
case 'novel':             presets = novelai_settings;     preset_names = novelai_setting_names;  settings = nai_settings;            break; // :548-552
case 'textgenerationwebui': presets = textgenerationwebui_presets; ...                              settings = textgen_settings;        break; // :553-557
case 'kobold':            presets = koboldai_settings;    ...                                      settings = kai_settings;            break; // :542-547
case 'context':           presets = context_presets;      ...                                      settings = power_user.context;       break; // :563-567
case 'instruct':          ...                                                                              settings = power_user.instruct;     break; // :568-572
case 'sysprompt':         ...                                                                              settings = power_user.sysprompt;    break; // :573-577
case 'reasoning':         ...                                                                              settings = power_user.reasoning;    break; // :578-582
```

切换预设时，ST 把整个 `preset.extensions` **拷进运行时对象**：

- **[ST-SRC]** `public/scripts/openai.js:5051-5055`
  ```js
  // Extensions don't need UI updates and shouldn't fallback to current settings
  if (key === 'extensions') {
      oai_settings.extensions = preset.extensions || {};
      continue;
  }
  ```
- **[ST-SRC]** `public/scripts/kai-settings.js:136-138`：`if (name === 'extensions') { kai_settings.extensions = preset.extensions || {}; continue; }`
- **[ST-SRC]** `public/scripts/nai-settings.js:211`：`nai_settings.extensions = preset.extensions || {};`
- **[ST-SRC]** `public/scripts/textgen-settings.js:1200-1203`：`if ('extensions' === setting) { value = value || {}; textgenerationwebui_settings.extensions = value; return; }`

所以：

| | `settings.extensions` | `preset.extensions` |
|---|---|---|
| 是什么 | 当前 API 的运行时设置对象里的 `extensions`（`oai_settings` / `kai_settings` / `nai_settings` / `textgenerationwebui_settings` / `power_user.*`） | 预设数组里那一个预设对象自带的 `extensions`（文件态） |
| 生命周期 | 切预设时被 `preset.extensions` 覆盖；运行中可被任意扩展改写 | 只在 `savePreset` 时落盘 |
| 谁会只改它 | 不走官方通道的扩展（例：TH 直接 `_.set(oai_settings,'extensions.regex_scripts',…)`，`[TH-PKG] src/function/tavern_regex.ts:303-305`） | 只有 `savePreset` / `writePresetExtensionField` |

**结论**：优先读 `settings.extensions` 是为了让「运行时真实生效的那份」赢过「文件里的旧那份」，避免扩展读到过期数据。副作用是：只要选中同名预设，就**完全读不到** `preset.extensions`（`:859` 的 `continue` 语义是 `return`）。

**(2) `path` 是否支持任意点号嵌套？** 是。`lodash.get(settingsExtensions, path, null)`（`:861`）/ `lodash.get(presetExtensions, path, null)`（`:871`）—— lodash `get` 的路径语法，支持 `a.b.c`、`a[0].b` 等任意深度。`path` 为空串时是 falsy → 返回**整个 extensions 对象**（`:861/:871` 的三元）。

**(3) 找不到返回什么？** `null`，不抛异常。`path` 不存在 → `lodash.get` 的第三参默认值 `null`；预设名不存在 → `getCompletionPresetByName` 返回 `undefined`（`preset-manager.js:757-779`，且会 `console.error('Preset ${name} not found')`），`if (!preset) return null`（`:866-868`）。

**(4) `name` 参数如何切换预设？** `presetName = name || selectedName`（`:856`）：

| 调用方式 | 走哪条分支 |
|---|---|
| `readPresetExtensionField({path:'x'})` | `presetName = getSelectedPresetName()`；若与 `settings` 匹配 → 读 `settings.extensions`；否则读该名预设文件 |
| `readPresetExtensionField({name:'A', path:'x'})`，A == 当前选中 | 读 `settings.extensions`（运行时份） |
| `readPresetExtensionField({name:'A', path:'x'})`，A != 当前选中 | 走 `getCompletionPresetByName('A')` 读**文件态** `preset.extensions` |
| `name` 指向不存在的预设 | 返回 `null`（若在 settings 分支则仍读 settings） |

`getSelectedPresetName()` 的实现是读 DOM：**[ST-SRC]** `preset-manager.js:399-405`
```js
getSelectedPresetName() {
    return $(this.select).find('option:selected').text();
}
```
`getCompletionPresetByName` 兼容两种 `preset_names` 形态（数组型 / `{name:index}` 型）：**[ST-SRC]** `preset-manager.js:757-779`。

**(5) 扩展是否能写回？** 能，见 1.2。

**(6) 取值前的清洗**：`ensurePlainObject`（**[ST-SRC]** `public/scripts/utils.js:141-147`）——非对象 / `null` / 数组一律降级为 `{}`：
```js
export function ensurePlainObject(obj) {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return {};
    }
    return obj;
}
```

### 1.2 写：`writePresetExtensionField({ name, path, value })`

**[ST-SRC]** `preset-manager.js:875-908`：

```js
async writePresetExtensionField({ name, path, value }) {        // :883
    const { settings } = this.getPresetList();                   // :884
    const selectedName = this.getSelectedPresetName();           // :885
    const presetName = name || selectedName;                     // :886

    // Write to settings if the selected preset is the same as the provided name
    if (settings && selectedName === presetName) {              // :889
        settings.extensions = ensurePlainObject(settings.extensions || {}); // :891
        path ? lodash.set(settings.extensions, path, value) : (settings.extensions = value); // :892
        await saveSettings();                                    // :893
    }                                                            // ← 注意没有 else

    // Also update the preset by name
    const preset = this.getCompletionPresetByName(presetName);   // :897
    if (!preset) {                                               // :898
        return;                                                  // :899
    }
    preset.extensions = ensurePlainObject(preset.extensions || {}); // :903
    path ? lodash.set(preset.extensions, path, value) : (preset.extensions = value); // :904
    await this.savePreset(presetName, preset, { skipUpdate: true }); // :907
}
```

要点：

- **双写，不是二选一**：选中同名预设时，先写 `settings.extensions` 并 `saveSettings()`，然后**继续**写 `preset.extensions` 并 `savePreset(..., {skipUpdate:true})`（`:889-907` 之间没有 `else`）。这保证内存态与文件态同步。
- 非选中预设：只写文件态。
- 预设不存在：`settings` 份已写，随后 `return`（`:898-900`）——**非对称**，调用方需自行处理。
- `path` 为空串 → 整体替换 `extensions`。
- 官方用例：重命名预设时整块搬运（**[ST-SRC]** `preset-manager.js:1069-1072`）
  ```js
  await eventSource.emit(event_types.PRESET_RENAMED_BEFORE, { apiId, oldName, newName });
  const extensions = presetManager.readPresetExtensionField({ name: oldName, path: '' });
  await presetManager.renamePreset(newName);
  await presetManager.writePresetExtensionField({ name: newName, path: '', value: extensions });
  ```

### 1.3 这条通道的「公开性」

- `getPresetManager` 暴露在 `getContext()` 里：**[ST-SRC]** `public/scripts/st-context.js:288`（`getPresetManager,`；同文件 `:201` 暴露 `extensionSettings: extension_settings`，`:227` 暴露 `chatCompletionSettings: oai_settings`）。
- ST 自带的 regex 扩展就是走模块导入：**[ST-SRC]** `extensions/regex/engine.js:3` `import { getPresetManager } from '../../preset-manager.js';`；`extensions/regex/index.js:14` 同。
- 第三方扩展可用同样方式 `import`（同一 origin 的 ES 模块），或走 `getContext().getPresetManager()`。
- ⚠️ **TH 并不调用 `readPresetExtensionField`**：它用 `preset_manager.getPresetList()` / `getSelectedPreset()` / `getSelectedPresetName()` / `getAllPresets()` / `savePreset()` + 直接 `_.get/set(preset, 'extensions.…')`（详见 ②）。所以 RPNow 的通用能力必须**同时**提供 manager API 与 lodash 路径读写，只实现 `readPresetExtensionField` 不够。

---

## ② 调用点表：谁在读写预设 `extensions`

全仓 grep（`_ref/SillyTavern`，含 `src/` 与 `public/`）：`readPresetExtensionField|writePresetExtensionField|preset_allowed_regex|presetExtensions` → **19 处命中**，其中真正的业务调用点如下（`extension_settings` 是另一个东西，不在本表）。

### 2.1 ST 核心侧

| 调用者 | `[ST-SRC]` 位置 | path / 字段 | 用途 | trust gate |
|---|---|---|---|---|
| regex 引擎 `getScriptsByType(SCRIPT_TYPES.PRESET)` | `extensions/regex/engine.js:121-128`（读取在 `:126`） | `regex_scripts` | 取预设自带的正则脚本 | **有**：`:122` `allowedOnly && !extension_settings?.preset_allowed_regex?.[getCurrentPresetAPI()]?.includes(getCurrentPresetName())` → 直接返回 `[]` |
| regex 引擎 `saveScriptsByType(..., PRESET)` | `extensions/regex/engine.js:150-153`（写在 `:152`） | `regex_scripts` | 保存预设正则 | 无 |
| regex 扩展 `onMainApiChanged` | `extensions/regex/index.js:1685` | `regex_scripts` | 切换 API 后判断预设正则是否需要重载聊天 | 无（只统计非 disabled 数量） |
| regex 扩展 `checkPresetEmbeddedRegexScripts` | `extensions/regex/index.js:1650-1677` | —（内部经 `getScriptsByType(PRESET)`） | 首次遇到带正则的预设时弹窗询问 | **有**（`:1656-1665` → `allowPresetScripts` + `reloadCurrentChat`） |
| regex 扩展 `purgePresetEmbeddedRegexScripts` | `extensions/regex/index.js:1598-1604` | — | 删除预设时撤销允许 | 有（调 `disallowPresetScripts`） |
| regex 扩展 `onPresetRenamed` | `extensions/regex/index.js:1696-1708` | — | 重命名时把允许名单从旧名迁到新名 | 有（`disallow` + `allow`） |
| regex 扩展 `isPresetScriptsAllowed` | `extensions/regex/engine.js:215-220` | `preset_allowed_regex[apiId]` | 判断某预设的正则是否被允许 | 就是 gate 本身 |
| regex 扩展 `allowPresetScripts` / `disallowPresetScripts` | `extensions/regex/engine.js:228-239` / `:247-259` | `preset_allowed_regex` | 允许/撤销 | gate 读写 |
| 扩展设置默认容器 | `extensions.js:182-185` | `preset_allowed_regex: {}`（另有 `character_allowed_regex: []`） | 声明 gate 的持久化位置（`extension_settings`，随 `saveSettingsDebounced` 落盘） | — |
| 预设重命名 UI | `preset-manager.js:1069-1072` | `''`（整块 extensions） | 搬运 `extensions` 到新预设名 | 无 |
| 预设变更事件 | `extensions/regex/index.js:2152` `eventSource.on(event_types.PRESET_CHANGED, checkPresetEmbeddedRegexScripts)` | — | 切预设触发 gate 检查 | — |
| 执行期 gate | `extensions/regex/engine.js:346` `getRegexScripts({ allowedOnly: true })` | — | 真正跑正则时再过滤一次 | **有** |

gate 的 UI 文案 **[ST-SRC]** `extensions/regex/presetEmbeddedScripts.html:1-5`：
```html
<h3 data-i18n="This preset has embedded regex script(s).">This preset has embedded regex script(s).</h3>
<h3 data-i18n="Would you like to allow using them?">Would you like to allow using them?</h3>
<div class="m-b-1" data-i18n="If you want to do it later, select 'Regex' from the extensions menu.">…</div>
```

**ST 核心结论**：整个 ST 仓库中，预设 `extensions` 的**唯一**消费者是 regex 扩展，且只读 `regex_scripts` 这一个 key。`SPreset`、`tavern_helper`、`SPresetSettings` 在 ST 核心 **0 命中**。

### 2.2 TH（酒馆助手）侧 —— 不走官方通道

| 调用者 | `[TH-PKG]` 位置 | 访问方式 | 用途 |
|---|---|---|---|
| `get_tavern_regexes_without_clone` | `src/function/tavern_regex.ts:126-130` | `option.name === 'in_use' ? oai_settings : getCompletionPresetByName(option.name)` → `preset?.extensions?.regex_scripts ?? []` | 读预设正则（直读，无 gate） |
| `set_tavern_regexes` | `src/function/tavern_regex.ts:298-311` | `_.set(oai_settings,'extensions.regex_scripts',converted)` + `saveSettingsDebounced()`；或 `_.set(data,'extensions.regex_scripts',converted)` + `preset_manager.savePreset(name,data,{skipUpdate:true})` | 写回预设正则（内存份 + 文件份） |
| `usePresetSettingsStore.getSettings` | `src/store/settings/preset.ts:8-16` | `_.get(preset_manager.getPresetList().presets[Number(id)], 'extensions.tavern_helper', {})` | 读预设的 TH 脚本树 |
| `saveSettingsToMemoryDebounced` | `src/store/settings/preset.ts:18-23` | `_.set(oai_settings,'extensions.tavern_helper',settings)` | 选中时同步到内存 |
| `saveSettingsToFile` | `src/store/settings/preset.ts:25-35` | `_.set(preset,'extensions.tavern_helper',settings)` + `preset_manager.savePreset(...,{skipUpdate:true})` | 落盘 |
| 导出前清理 | `src/store/settings/preset.ts:60-72` | `_.get(preset,'extensions.tavern_helper.scripts',[])` | 按 `export_with.data/button` 剥离 |
| 角色卡同名通道 | `src/function/character.ts:42-49, 74-86, 338-340` | `data.extensions.tavern_helper`（旧数组格式 `Object.fromEntries` 兼容） | 角色卡也带 TH 脚本树 |
| manager 入口 | `src/util/tavern.ts:20,31` | `import { getPresetManager } from '@sillytavern/scripts/preset-manager'`；`export const preset_manager = getPresetManager('openai')` | 拿到 manager |
| 常量 | `src/type/settings.ts:3` | `export const setting_field = 'tavern_helper'` | 命名空间名 |
| CHANGELOG 佐证 | `CHANGELOG.md:1221` | 「现在预设也可以绑定酒馆助手脚本了…及 SPreset 等可以绑定在预设上方便导入的脚本」 | 官方说明预设可绑 TH 脚本 |

**TH 结论**：TH 把 `extensions.tavern_helper` 当作**自己的预设设置存储**（与 ST 的 `extension_settings.tavern_helper` 全局设置、`chat_metadata.tavern_helper` 聊天设置并列，见 `src/store/settings/{global,chat,character,preset}.ts`），并且**直读 `preset.extensions.regex_scripts`**。它从不调用 `readPresetExtensionField`。

---

## ③ Meowssiah `extensions` 全量字段清单

### 3.1 顶层结构 `[PRESET]`

文件 660700 B，顶层 **47** 个键。与本主题相关的三个：

| 键 | 类型 | 大小 | 说明 |
|---|---|---|---|
| `prompts` | array | 219633B / 195672c，**56 条** | 提示词条目；其中 `SPresetSettings`、`version_info` 是数据通道 |
| `prompt_order` | array | 4276B / 4276c，**2 条**（`character_id` 100000 / 100001） | 100001 的 `order` 有 54 项；100000 的 `order` 有 2 项，且带一个**第三方命名空间 `xiaobai_ext`** |
| `extensions` | object | 410879B / 392102c，**4 个键** | 见 3.2 |

其余 **44** 个顶层键是生成参数（`temperature`、`top_p`、`openai_max_context`、`prompts` 相关开关、`function_calling`、`reasoning_effort` 等），其中 `tool_reasoning_mode`、`verbosity`、`inline_image_quality` 等与工具/推理绑定，本次不展开。

### 3.2 `extensions` 四个键

| JSON 路径 | 类型 | 大小 | 内容摘要（前 200-400 字符，逐字） | 判定 | 推测消费方 |
|---|---|---|---|---|---|
| `extensions.SPreset` | object | **174840B / 162811c**，10 字段 | `{"ChatSquash":{"enabled":false,"conditional_enabled":false,"conditional_tag":"<\|merge\|>"…` | 混合：配置数据 + **插件脚本**（见 3.3） | SPreset 扩展（预设内无源码；ST 核心 0 命中） |
| `extensions.extensions` | object | 194B / 178c | `{"presetdetailnfo":{"uniqueValue":"33293996-0048-4662-87c6-892591071deb","timestamp":"2025-10-15T04:58:12.865Z","nameGroup":"小猫之神_3.7 Full","linkAddress":"","updateNote":"初始版本"}}` | **纯数据**（元信息） | 未知（疑似预设作者/发布工具）；键名 `presetdetailnfo` 拼写如此 |
| `extensions.regex_scripts` | array | **52433B / 51160c**，**8 条** | `[{"id":"1d78fce4-…","scriptName":"思维链标签转义","findRegex":"/<(?<tag>(?!\\/?(?:think_nya\|report_nya)~?>)…` | **纯数据**（ST 标准正则格式） | **ST 核心 regex 扩展**（`engine.js:126`）+ **TH**（`tavern_regex.ts:129`） |
| `extensions.tavern_helper` | object | **183352B / 177893c**，2 字段 | `{"scripts":[…2 条…],"variables":{}}` | **插件脚本**（内嵌运行时） | **TH**（`store/settings/preset.ts`、`function/character.ts`） |

### 3.3 `extensions.SPreset` 10 个字段

| 字段 | 大小（对象=紧凑JSON；字符串=原始） | 类型 | 内容摘要 | 判定 | 推测消费方 |
|---|---|---|---|---|---|
| `ChatSquash` | 774B / 774c，22 键 | object | `{"enabled":false,"conditional_enabled":false,"conditional_tag":"<\|merge\|>","separate_chat_history":false,"parse_clewd":false,"user_role_system":false,"role":"system","enable_stop_string":false,"stop_string":"[\"<end>\", \"<ctrl\", \"<thought>\"]","user_prefix":"<<<\|catgodml\|wiEnd:inline>>>\n<<<\|catgodml\|msgStart:user>>>"…}` | **纯数据**（含 `<<<\|catgodml\|…>>>` 宏 DSL） | SPreset 扩展 |
| `RegexBinding` | 52062B / 50799c；`regexes` 52050B / 50787c，**7 条** | object | `{"regexes":[{"id":"1d78fce4-…","scriptName":"思维链标签转义","findRegex":"/<(?<tag>(?!\\/?(?:think_nya\|report_nya)~?>)[^<>]+)>…","replaceString":"&lt;&#8203;$<tag>&gt;"…}` | **纯数据**（与 `extensions.regex_scripts` 重复携带，见 3.5） | SPreset 扩展（私有载体） |
| `MacroNest` | 5B / 5c | boolean | `false` | 纯数据 | SPreset 扩展 |
| `ToolBindings` | 1082B / 1026c，1 个条目 | object | `{"3df19ba7-b44d-4d46-b17a-de514d86e5d5":{"enabled":true,"code":"return {\n    name: \"soliumbra_reply\", \"description\": \"SoliUmbra replies ALL the things with this tool.\", \"parameters\": {… \"think_nya\": {…}},\n    action: async (args) => { return JSON.stringify({ ok: true }); },\n    stealth: false,\n};","valid":true,"uuid":"edde2e99-…","resolvedName":"soliumbra_reply","editorMode":"form","form":{…}}}` | **依赖宿主 API**（声明式工具 + `action` 函数；工具名 `soliumbra_reply`，参数 `think_nya`） | 宿主的工具/函数调用系统（`function_calling`）+ SPreset 扩展；同一 UUID 对应 `prompts` 里 `identifier=3df19ba7-…` 名称「【别关】」的条目 |
| `MessageInjections` | 2B / 2c | object | `{}` | 纯数据（空） | SPreset 扩展 |
| `OutputPreprocessing` | 4015B / 3753c | object | `{"enabled":true,"script":"({ buffer, final, state = {} }) => {\n  console.log(buffer)\n  if (true) {\n    return { output: buffer, hold: '', state: { ...state, accepted: true } };\n  }\n  return { output: buffer, hold: '', state: { ...state, rejected: true } };\n}","consumeToolCalls":true,"toolCallFormatter":{"enabled":true,"script":"({ calls, defaultText }) => {…}"}}` | **插件脚本**：`script` 271B/271c（透传 + state 标记）；`toolCallFormatter.script` 3462B/3200c（把工具调用包装成 `<think_nya>`/`<game>`/`<options>`/`<summary>`/`<comment>` 标签，含半截 JSON 兜底解析） | SPreset 扩展（流式输出预处理） |
| `FixedPresetName` | 0B / 0c | string | `""` | 纯数据 | SPreset 扩展 |
| `ForcedPostProcessing` | 26B / 26c | object | `{"enabled":true,"mode":""}` | 纯数据 | SPreset 扩展 |
| `FinalRequestProcessing` | 116612B / 106164c；`script` **112948B / 102500c** | object | `{"enabled":true,"script":"async ({ request }) => {\n  const marker = '<run_tool_replacement>';\n  const messages = request.messages;\n  if (!Array.isArray(messages)) return request;\n…"}` | **插件脚本**，**重度依赖宿主 API**（见下） | SPreset 扩展（请求前处理） |
| `LogUpload` | 74B / 74c | object | `{"enabled":true,"url":"https://catgod.soliumbra.com/upload_debug_session"}` | **依赖外部网络** | SPreset 扩展 / 作者的服务端 |

`FinalRequestProcessing.script` 实际引用到的宿主面（逐行扫描，行号为脚本内行号）：

| 宿主 API | 脚本内证据（节选） |
|---|---|
| `SillyTavern.getContext()` | `:35` `if (cur?.SillyTavern) return cur;`；`:48` `return hostWin?.SillyTavern?.getContext?.() || null;` |
| `hostWin.localStorage` | `:62` `hostWin?.localStorage?.getItem('CatGod_Oracle_State') \|\| 'null'` |
| `hostWin.CatGodOracle` | `:66` `hostWin?.CatGodOracle?.state` |
| `ctx.extensionSettings` | `:334` `if (type === 'global') return ctx?.extensionSettings?.variables?.global \|\| {};`；`:552` `const ext = ctx?.extensionSettings \|\| {};` |
| `ctx.eventSource` | `:1241` `if (ctx?.eventSource && !hostWin.__catgodWiHookV2Bound) {` |
| `hostWin.YAML` / `hostWin.EjsTemplate` / `hostWin.TavernHelper` / `hostWin.AutoCardUpdaterAPI` | `:271`、`:438`、`:289`、`:1447` |
| `CustomEvent` 外发 | `:2951-2954` `hostWin.__catgodFinalSentPayload = finalPayload; hostWin.dispatchEvent(new hostWin.CustomEvent('catgod-oracle:final-request', { detail: finalPayload }));` |

关键词计数（脚本内）：`request` 23、`tool` 32、`messages` 11、`SillyTavern` 4、`getContext` 1、`generate` 1、`localStorage` 1、`fetch` 0、`XMLHttpRequest` 0、`postMessage` 0。

### 3.4 `extensions.tavern_helper` 结构

| 路径 | 大小 | 内容 |
|---|---|---|
| `scripts` | 183325B / 177866c，**2 条** | 见下 |
| `variables` | 2B / 2c | `{}`（空） |

`scripts[0]`（共 9930B / 8978c）：

| 字段 | 值 |
|---|---|
| `type` / `enabled` | `"script"` / `true` |
| `name` / `id` | `SPreset` / `f0801c1a-3b0f-4e1c-82b6-f0f8990fbde6` |
| `content` | 701B / 701c，逐字：`function injectScript(iframe, id, url) { … parent.appendChild(script); }` + `$(() => { SillyTavern.extensionSettings.regexBinding_scriptId = getScriptId(); injectScript(window.frameElement, getScriptId(), 'https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js'); });` |
| `info` | 8626B / 7674c，HTML 文档，标题 `SillyTavern 预设绑定正则 · 功能介绍` |
| `button` / `data` / `export_with` | `{"enabled":false,"buttons":[]}` / `{}` / `{"data":true,"button":true}` |

`scripts[1]`（共 173392B / 168885c）：

| 字段 | 值 |
|---|---|
| `type` / `enabled` | `"script"` / `true` |
| `name` / `id` | `菜单` / `3ee2a1fe-2cbb-4058-b3a0-5700867597d2` |
| `content` | **169589B / 165086c**，头注释逐字：「小猫之神 · 神域控制台 (Cat Oracle Console)…可以放在酒馆正则 / 前端渲染的 iframe 里，也可以直接在顶层运行。加载器会找到挂着 SillyTavern 的顶层窗口，把真正的运行时注入成那里的 `<script>`，所以就算当前 iframe 随消息重绘被销毁，菜单也照常工作；重复加载只保留一个实例。」 |
| `info` | 0B |
| `button` | `{"enabled":true,"buttons":[]}` |
| `export_with` | `{"data":true,"button":true}` |

**消费方（已用真包确认）**：`[TH-PKG] src/store/settings/preset.ts:9/20/33/61`、`src/function/character.ts:42-49/78-86/338-340`、`src/type/settings.ts:3`。

### 3.5 正则三载体逐条对比

三个载体：

- **A** = `extensions.SPreset.RegexBinding.regexes`，**7 条**（52050B）
- **B** = `extensions.regex_scripts`，**8 条**（52433B）
- **C** = `prompts[SPresetSettings].content` → `RegexBinding.regexes`，**6 条**（51749B）

| # | id | scriptName | placement | markdownOnly | promptOnly | minDepth | maxDepth | runOnEdit | disabled | trimStrings | findRegex(B) | replaceString(B) | 在 A(7) | 在 C(6) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | `1d78fce4-3e3c-4d8f-b9dc-f26555be0a6d` | 思维链标签转义 | `[2]` | true | false | null | null | true | false | `[]`（0） | 132 | 21 | ✅ | ✅ |
| 1 | `bdae9a30-78dc-4241-a9a1-4b02f561a571` | 思维链折叠 2.5 by To: mato | `[2]` | true | false | null | null | true | false | 1 条（3B，内容为 3 个反引号） | 98 | 10577 | ✅ | ✅ |
| 2 | `5f2f5e89-90cb-424c-868d-bf1c4036260c` | 背景剧情喵 | `[2]` | true | false | null | null | true | false | `[]`（0） | 39 | 55 | ✅ | ✅ |
| 3 | `1eefb207-caf1-4c93-a5ee-bad981180bda` | 思考 | `[2]` | true | false | null | null | true | false | `[]`（0） | 45 | 50 | ✅ | ✅ |
| 4 | `b97ad5d8-5673-461c-a6bd-807f8efe6949` | 思维链对AI隐藏 | `[2]` | false | true | 1 | null | true | false | `[]`（0） | 98 | 0 | ✅ | ✅ |
| 5 | `f354ff7a-88a2-47cf-a07a-0c7f212fb1b5` | 前端综合面板 | `[2]` | true | false | null | null | true | false | `[]`（0） | 284 | 37273 | ✅ | ✅ |
| 6 | `fc8efc04-8e0b-42e1-a439-9cc04137966d` | 修剪多余思考 | `[2]` | true | true | null | null | true | false | `[]`（0） | 27 | 0 | ✅ | ❌ |
| 7 | `1c7de08e-90f5-4b98-b104-003aa6b6ed69` | 修剪小总结 | `[2]` | false | true | 24 | null | true | false | `[]`（0） | 73 | 25 | ❌ | ❌ |

差异与重复携带关系（实测）：

- **A 的前 7 条与 B 的前 7 条逐字节相同**（对每个 id 做 `JSON.stringify(a) === JSON.stringify(b)` → 7/7 `true`）。B 只是**在末尾多出第 8 条**「修剪小总结」。
- **C 是 A 的前 6 条**（缺第 6 条「修剪多余思考」），顺序一致，条目内容逐字节相同。
- 三份是**不同时间点的快照**：C(6) ⊂ A(7) ⊂ B(8)。B 与 A 的差异量 = 第 8 条 25B 的 `replaceString` + 结构开销；A 与 C 的差异量 = 第 7 条整条。
- 全部 8 条 `placement` 都是 `[2]`（AI_OUTPUT）；`runOnEdit` 全 `true`、`disabled` 全 `false`、`substituteRegex` 全 `0`。
- 显示层（`markdownOnly:true` 且非 `promptOnly`）= 第 0/1/2/3/5 条，共 **5 条**；若按 RPNow 现有 `extractPresetDisplayRegexes()` 的口径（只留 `markdownOnly`，含 `promptOnly` 者也留）= 第 0/1/2/3/5/6 条，共 **6 条** —— 与主文档 §第 42 轮「6 条正则提取成功」一致。
- ⚠️ 第 4 条「思维链对AI隐藏」是 `promptOnly:true`，**只改模型看到的 prompt，不改显示**；第 6 条同时 `markdownOnly` + `promptOnly`（ST 真值表里这是**死组合**，见 `docs/research/formats.md` §4.5）。

---

## ④ `SPresetSettings` prompt 解析

### 4.1 基本信息

| 项 | 值 |
|---|---|
| `prompts` 数组中的位置 | 第 46 条（0 基），`identifier === "SPresetSettings"`，`name === "SPreset配置"` |
| prompt 对象大小 | 183192B / 171171c |
| `content` 大小 | **176054B / 164037c** |
| `content` 是否 JSON | **是**，`JSON.parse` 成功 |
| `role` / `system_prompt` / `enabled` / `marker` | `system` / `false` / **`false`** / `false` |
| `injection_position` / `injection_depth` / `injection_order` | 0 / 4 / 100 |
| `forbid_overrides` / `readOnly` / `injection_trigger` | `false` / `false` / `[]` |
| **是否在 `prompt_order` 里** | **否**（`prompt_order` 覆盖的 54 个 identifier 里没有它） |

`content` 开头逐字：
```json
{
  "ChatSquash": {
    "enabled": false,
    "conditional_enabled": false,
    "conditional_tag": "<|merge|>",
    "separate_chat_history": false,
    "parse_clewd": false,
    "user_role_system": false,
    "role": "system",
    "enable_stop_string": false,
    "stop_string": "[\"<end>\", \"<ctrl\", \"<thought>\"]",
    "user_prefix": "<<<|catgodml|wiEnd:inline>>>\n<<<|catgodml|msgStart:user>>>",
    ...
```

### 4.2 顶层键与结构

解析后的顶层键与 `extensions.SPreset` **完全同名同序**，10 个：

`["ChatSquash","RegexBinding","MacroNest","ToolBindings","MessageInjections","OutputPreprocessing","FixedPresetName","ForcedPostProcessing","FinalRequestProcessing","LogUpload"]`

逐键与 `extensions.SPreset` 做 `JSON.stringify` 深度比较：

| 键 | settings 里是否存在 | 深度相等 | ext 大小 | settings 大小 |
|---|---|---|---|---|
| `ChatSquash` | 是 | ✅ | 774B | 774B |
| `RegexBinding` | 是 | ❌ | 52062B | **51761B** |
| `MacroNest` | 是 | ✅ | 5B | 5B |
| `ToolBindings` | 是 | ✅ | 1082B | 1082B |
| `MessageInjections` | 是 | ✅ | 2B | 2B |
| `OutputPreprocessing` | 是 | ✅ | 4015B | 4015B |
| `FixedPresetName` | 是 | ✅ | 0B | 0B |
| `ForcedPostProcessing` | 是 | ✅ | 26B | 26B |
| `FinalRequestProcessing` | 是 | ✅ | 116612B | 116612B |
| `LogUpload` | 是 | ✅ | 74B | 74B |

**唯一差异是 `RegexBinding`：C 有 6 条，ext 有 7 条**（C 缺 `fc8efc04 修剪多余思考`）。

### 4.3 是不是同一份数据？为什么要双份携带？

- **是同一份数据的两个快照**，不是两种格式：10 个键名一致，9 个键逐字节相同，`RegexBinding` 只差 1 条正则。
- 双份携带的原因（基于实测的推断，标注为推断）：
  1. `extensions.SPreset` 是**扩展设置的正式位置**，会被 ST 切预设时拷进 `settings.extensions`，扩展可在运行时读写、可用 `readPresetExtensionField({path:'SPreset.xxx'})` 取。
  2. `prompts[SPresetSettings].content` 是**预设文件里的冗余副本**：它跟着 `prompts` 数组一起被导出/导入/备份，即使扩展设置通道失效（旧版本 ST、其它工具、只导 `prompts` 的管线），作者/工具仍能拿到一份配置。
  3. 它**不是提示词**：`enabled:false`、`marker:false`、不在 `prompt_order` 里 —— 平台不注入它，它只是借 `prompts` 数组当数据容器。
- ⚠️ 实践含义：RPNow 若只读一处会漏数据（本例差 1 条正则）；两处都读必须**去重**（按 `id`），并明确以哪份为准（建议 `extensions.SPreset` 优先，因为它与运行时 `settings.extensions` 同步）。

### 4.4 `prompts` 里的命名标记与私有 DSL

**（a）ST 核心 marker（`marker:true`，8 个）**：`worldInfoBefore`、`personaDescription`、`charDescription`、`charPersonality`、`scenario`、`worldInfoAfter`、`dialogueExamples`、`chatHistory`。这些是 ST 占位符，`content` 为空，由 ST 在构建 prompt 时填充。

**（b）预设私有命名标记（非 UUID）**：

| identifier | name | 备注 |
|---|---|---|
| `catgod-deepthink-steps-base` | 🧠大思考步骤（可改） | 在 `prompt_order[0]`（`character_id:100000`），`enabled:true` |
| `catgod-macro-tutorial-doc` | 📖自定义宏教程（魔改可看） | 在 `prompt_order[0]`，`enabled:false` |
| `main` / `nsfw` / `jailbreak` / `enhanceDefinitions` | 免责声明 / 上下文构造-衔接 / 继续游戏 / 召唤术 | ST 也认这些名字（`[TH-PKG] src/function/preset.ts:56-71` 把它们列为 `PresetPrompt.id` 的字面量联合），但本预设用它们装自定义内容 |
| `version_info` | 【勿删】版本信息 | `enabled:false`，**不在 `prompt_order`**；`content` 是 JSON `{"version":"3.0-Preview-01","id":301}` → 数据通道 |
| `SPresetSettings` | SPreset配置 | 见 §4 |

其余 **40 个** `identifier` 是 UUID（如 `9c015364-…`、`3df19ba7-…`）；非 UUID 共 **16 个** = 8 个 ST marker + 2 个 `catgod-*` + `main`/`nsfw`/`jailbreak`/`enhanceDefinitions` + `version_info` + `SPresetSettings`。56 条中 `enabled:false` 有 **18** 条，`readOnly:true` 有 **8** 条，`forbid_overrides:true` 有 **2** 条，`injection_trigger` 全部为 `[]`。

**（c）预设私有布尔标记 `spreset_hidden:true`（11 个）**：
`enhanceDefinitions`、`personaDescription`、`scenario`、`nsfw`、`dialogueExamples`、`3df19ba7-b44d-4d46-b17a-de514d86e5d5`（【别关】）、`jailbreak`、`a00fb1fe-9907-4709-b230-43ae0d236529`、`7a077e05-2616-4b58-b725-53c80ecf4931`（别关）、`ab29af7b-4f0e-402f-8236-80b15800e554`（char）、`34aca678-07d4-4aeb-96ca-37f78617c525`（/char）。
其中 `personaDescription` / `scenario` / `dialogueExamples` 同时是 ST 核心 marker —— 即**预设在自己的条目上打了「对 UI 隐藏」的私有标记**，ST 核心不解释它。

**（d）`<<<|catgodml|…>>>` 私有 DSL**：

| 出现位置 | 出现次数 | 不同 token 数 |
|---|---|---|
| `prompts[].content` | **54** | **52** |
| `extensions.SPreset`（8 处都在 `ChatSquash` 的 `user_prefix/user_suffix/char_prefix/char_suffix`） | 8 | 6 |
| `extensions.tavern_helper.scripts[1].content` | 8（全部在**该运行时自己的解析器字符串与注释**里，如 `MARKER_SOURCE`、`ENABLE_SOURCE`、`DIRECTIVE_SOURCE`） | — |
| `extensions.regex_scripts` | 0 | 0 |

token 类型（52 种，逐字举例）：
- 结构标记：`wiStart:before|after|inline`、`wiEnd:before|after|inline`、`msgStart:user|model`、`msgEnd:user|model`、`historyStart`、`historyEnd`
- 菜单/单选：`menu:<分组>:<名称>`、`radio:<分组>:<名称>`（如 `radio:主文风选择:📝s喵特调一（电影运镜）`）
- 思考步骤注册：`registerThinkingStep:<顺序值>:<标题>`、`registerThinkingStep:<顺序值>:小标题:思考要求`
- 指令：`enableMenu`、`deepthink`、`setLastMessage:{{lastUserMessage}}`、`registerPart:字段名:字段提示词`

**判定**：这是**预设私有 DSL**，由 `tavern_helper.scripts[1]`（神域控制台）解释执行；ST 核心与 TH 主体**均不解释**（TH 只提供 `getContext()` 等宿主能力）。平台方若丢弃这些标记，预设的菜单/思考步骤/世界书钩子会静默失效。

**（e）另一个第三方命名空间：`prompt_order[0].xiaobai_ext`**（636B / 636c）：

```json
{"regexBindings": null,
 "scheduledTasks": [{"id":"103deef9-…","name":"SPreset",
   "commands":"<<taskjs>>\nfunction injectScript(iframe, id, url) {…}\n\ninjectScript(window.frameElement, \"spreset_inject\", 'https://starowo.github.io/regex_bind/inject.js');\n<</taskjs>>\n/echo SPreset Loaded",
   "interval":3,"floorType":"all","triggerTiming":"plugin_init","disabled":false,
   "buttonActivated":false,"createdAt":"2025-10-18T07:37:40.651Z","importedAt":"2025-11-01T03:42:52.270Z","x":{}}]}
```

它不在 `extensions` 里，而在 `prompt_order` 的条目上；`xiaobai` 这个词在整份预设里**只出现这一次**（消费方代码不在预设内）→ 消费方**未知**（小bai 类扩展）。它同样携带「外链注入」型脚本，安全边界与 `tavern_helper.scripts[0]` 相同。

---

## ⑤ 依赖矩阵与结论

### 5.1 「预设 extensions 命名空间 = 分布式应用清单」

| 字段 | 谁读 | 需要宿主 API 才能跑？ | 含插件脚本？ | 平台方必须做什么 |
|---|---|---|---|---|
| `extensions.regex_scripts` | **ST 核心**（regex 扩展，唯一官方消费者）、**TH** | 否（数据） | 否 | 跑 ST 正则引擎（placement/真值表/depth/trim/substituteRegex），并带 trust gate |
| `extensions.SPreset.RegexBinding.regexes` | SPreset 扩展（私有载体） | 否 | 否 | **原样透传 + 与 `regex_scripts` 按 id 去重**，不得白名单丢弃 |
| `extensions.SPreset.ChatSquash` / `MacroNest` / `MessageInjections` / `FixedPresetName` / `ForcedPostProcessing` | SPreset 扩展 | 否 | 否 | 透传（含 `<<<|catgodml|…>>>` 宏） |
| `extensions.SPreset.ToolBindings` | 宿主工具系统 + SPreset 扩展 | **是**（工具注册/调用） | 否（声明 + `action` 函数） | 提供工具注册与调用面（`function_calling`） |
| `extensions.SPreset.OutputPreprocessing` | SPreset 扩展 | **是**（流式输出缓冲） | **是**（2 段 JS） | 提供流式输出钩子与沙箱 |
| `extensions.SPreset.FinalRequestProcessing` | SPreset 扩展 | **是**（`getContext`/`extensionSettings`/`eventSource`/`localStorage`/`YAML`/`EjsTemplate`/`TavernHelper`/`CustomEvent`） | **是**（1 段 112KB JS） | 提供请求前钩子 + 上述宿主面 |
| `extensions.SPreset.LogUpload` | SPreset 扩展 | **是**（外部 HTTP） | 否 | 默认阻断外链（安全边界） |
| `extensions.tavern_helper.scripts` | **TH** | **是**（DOM/全局/设置） | **是**（2 段，共 165KB） | 提供脚本执行环境与 TH 契约（`#extensions_settings`、`SillyTavern` 全局、事件） |
| `extensions.tavern_helper.variables` | TH | 否 | 否 | 透传 |
| `extensions.extensions.presetdetailnfo` | 未知（作者/发布工具） | 否 | 否 | 透传 |
| `prompt_order[].xiaobai_ext` | 未知（第三方扩展） | 是（外链注入） | 是 | 透传 + 外链默认阻断 |
| `prompts[SPresetSettings].content` | SPreset 扩展（推断） | 否 | 否（是配置数据） | 作为**数据通道**保留，不作为提示词注入 |
| `prompts[].spreset_hidden` / `catgod-*` identifier / `<<<|catgodml|…>>>` | SPreset 扩展 + 内嵌运行时 | 否 | 否（DSL 标记） | 不解释、不丢弃、不注入；原样保留 |

### 5.2 明确回答：插件要拿到哪些预设上下文，才算通用能力完备？

按优先级：

1. **预设对象与 extensions 全文**：`preset_manager.getPresetList()` / `getSelectedPreset()` / `getSelectedPresetName()` / `getAllPresets()` / `getCompletionPresetByName()` / `savePreset()`，以及 `readPresetExtensionField({name, path})`（lodash 任意点号路径，空 `path` 取整块，找不到返回 `null`）。**必须同时支持直读 `preset.extensions.*`**，因为 TH 就是这么干的。
2. **运行时份 `settings.extensions`**：即 `getContext().chatCompletionSettings.extensions`（openai）等。写回与第三方直写都发生在这里，只读文件态会读到旧数据。
3. **命名空间不可白名单**：`regex_scripts` 只是 ST 核心唯一显式消费的一个 key；`tavern_helper`（TH）、`SPreset`（第三方扩展）、`extensions.extensions`、`xiaobai_ext` 都要能取到。通用能力 = 「任意 key 可读写 + 已知 key 有语义」。
4. **trust gate 是平台能力**：`preset_allowed_regex[apiId]` / `character_allowed_regex`，默认关闭、首次询问、可撤销、重命名迁移。没有它，预设正则会静默重写模型输入（prompt injection）。
5. **`prompts` / `prompt_order` 作为数据通道**：`identifier` 私有标记、`spreset_hidden`、`marker`、`enabled:false` 的条目、以及 `content` 是 JSON 的条目（`SPresetSettings` / `version_info`）都要保留；平台**不把它们当普通提示词注入**，但**不能丢弃**。
6. **宿主 API 面**：`getContext()` 全字段、`extensionSettings`、`eventSource`、`localStorage`、`window.top`/iframe 通信、`#send_textarea`/`#send_but`、`generate()`、YAML/EJS/TavernHelper 等。内嵌脚本（165KB 运行时、112KB 请求前处理）依赖这些才能运行。
7. **安全边界**：预设可携带外链脚本（本例 2 条：`jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js`、`starowo.github.io/regex_bind/inject.js`）与外部上传端点（`catgod.soliumbra.com`）。平台应默认阻断、显式放行、并记录为已知限制。

### 5.3 一句话结论

预设不是「prompt 顺序 + 几个参数」，而是一个**把配置、声明式工具、两段大型 JS 运行时和正则脚本全部塞进 `extensions`（以及 `prompts`/`prompt_order` 的私有字段）的分布式应用包**。ST 官方只定义并使用了其中一条通道（`readPresetExtensionField` + `regex_scripts` + trust gate），TH 走的是另一条（`preset_manager` 直读 + `tavern_helper`），SPreset 走的是第三条（私有命名空间 + `SPresetSettings` 冗余快照 + `catgodml` DSL）。RPNow 要做的不是兼容某个预设，而是把**这三条通道都做成通用能力**。

---

## 附：复现方式

解析脚本位于 `%TEMP%\pi-a.cjs` … `%TEMP%\pi-o.cjs`（一次性研究脚本，非项目代码）。核心度量代码：

```js
const fs = require('fs');
const raw = fs.readFileSync('C:\\Users\\shuang\\Downloads\\Meowssiah-2.1.6.json', 'utf8');
const j = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
const bytes = (x) => Buffer.byteLength(typeof x === 'string' ? x : JSON.stringify(x), 'utf8');
```
