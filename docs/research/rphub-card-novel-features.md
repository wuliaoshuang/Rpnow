# RP-Hub — Character Card Generator & Novel Editor: Feature Inventory

Audit of the reference app at `D:\RPNow\_ref\RP-Hub\` (RP-Hub 2.0.6, announcement id `10226`, dated 2026‑11‑06).
Goal: a faithful functional specification so the same capabilities can be rebuilt independently. **No application code is reproduced here**; only behaviour, names, ids, keys, option labels and short quoted strings.

License note: RP-Hub is CC BY‑NC 4.0. This document describes behaviour only.

---

## 0. Scope, page manifests and method

Files actually read:

| File | Role |
|---|---|
| `character/index.html` (3539 lines) | Card generator ("角色卡工坊"), a self-contained Vue 3 app |
| `novel/index.html` (2771 lines) | Novel generator/editor ("小说生成"), a self-contained Vue 3 app |
| `assets/js/built-in-content.js` (774 lines) | Image artist strings, prompt builders, tool defaults, preset library, update notice |
| `assets/js/core-utils.js` (1042 lines) | Card PNG/JSON utils, regex/world-info normalisers, `RPHubConfig`, `RPHubUtils`, `RPHubCardUtils` |
| `assets/js/api-utils.js` (417 lines) | Chat Completions transport: streaming, native reasoning, tool calls, `output_reply`, empty-reply retry |
| `assets/js/theme.js`, `assets/js/tailwind-theme.js`, `assets/css/theme.css` | Shared theming |
| `assets/js/update-check.js`, `assets/js/presence.js`, `assets/js/cloud-backup.js` | Main-page-only services (not loaded by the two pages) |
| `assets/js/app.js`, `assets/js/ui-components.js` | Main app; used here only to document the iframe bridges and card import/export context |
| `README.md` / `README.en.md`, `presence-server/README.md` | Documented feature list and service API |

Script manifests (what each page actually loads):

* **character/index.html**: `theme.js`, Tailwind CDN, **DaisyUI 4.7.2**, Vue 3 global prod, **localforage 1.10.0**, **marked**, **DOMPurify 3.0.6**, `built-in-content.js`, `core-utils.js`, `api-utils.js`, `theme.css`, inline `<style>`, `tailwind-theme.js`.
* **novel/index.html**: `theme.js`, Vue 3 global prod, Tailwind CDN, `tailwind-theme.js`, **marked** (no DOMPurify), `built-in-content.js`, `core-utils.js`, `api-utils.js`, `theme.css`, inline `<style>`.

Consequences worth stating up front:

* `assets/css/styles.css` and `assets/js/ui-components.js` are **not** used by either page; all page styling is inline `<style>` + `theme.css`.
* `update-check.js`, `presence.js`, `cloud-backup.js`, `app.js` are **not** loaded by either page. Update checks, presence heartbeat and cloud backup/restore are main-page features (see §4.3).
* Both pages are also usable standalone (`file:///…/character/index.html`) or embedded as iframes by the main app. `isEmbedded = window.parent !== window` gates the one-click import button and the settings sync.

---

## 1. Character card generator (`character/index.html`)

### 1.1 Page shell, header and navigation

* Root: `<div id="app" … v-cloak>`; header is a sticky navbar.
* Header left: sidebar hamburger (`isSidebarOpen = !isSidebarOpen`, aria labels `折叠角色列表` / `展开角色列表`).
* Header centre: **model dropdown** (`<details class="dropdown">`) listing three slots:
  * `quality` → label `未设置` fallback, `setActiveModel('quality')`
  * `balanced` → `setActiveModel('balanced')`
  * `fast` → `setActiveModel('fast')`
  * Shows `options.customModels[activeModelType] || '未设置模型'`; default `activeModelType = 'balanced'`.
* Header right: gear button → `showSettings = true`.
* Storage warning banner: `v-if="storageQuotaExceeded"`, text **“本地存储已满，无法自动保存。请删除旧角色或导出备份以释放空间。”**
* Drawer: `<input id="my-drawer" type="checkbox" class="drawer-toggle" v-model="isSidebarOpen">`; sidebar `id="workshop-sidebar"`, `:inert="!isSidebarOpen"`, `:aria-hidden="!isSidebarOpen"`.
* Sidebar contents: title **角色列表**; import label (`accept=".png,.json,application/json,image/png"`, handler `importCharacterCard`); `+` button `createNewCharacter`; virtualised `<ul @scroll="handleSidebarScroll">`; per-item delete `requestDeleteCharacter(char._index)`; bottom **清空所有数据** → `requestDeleteAllCharacters`.

### 1.2 Tabs (exact labels and counts)

`tabs` computed:

| id | label | count |
|---|---|---|
| `basic` | 基本 | — |
| `world` | 世界书 | `worldInfo.length` |
| `regex` | 正则 | `regexScripts.length` |

A sliding glider (`gliderStyle`, `tabElements`, `updateGlider`) animates the active tab.

### 1.3 “基本” tab — exact form sections and fields

Avatar column card:

* Clickable avatar placeholder (`@click="$refs.fileInput.click()"`), hidden `<input type="file" ref="fileInput" accept="image/*" @change="handleImageUpload">`.
* Loading overlay `v-if="isAvatarLoading"` (spinner).
* `<img :src="currentCharacter.avatar" @load="onAvatarLoad" @error="onAvatarError">`; fallback initial letter `(name || 'A').charAt(0).toUpperCase()`.
* Hover overlay text **更换头像**.
* Reroll button `v-if="currentCharacter.avatar_prompt"` → `rerollAvatar()`, title **随机调整提示词重绘**.
* Character name heading `{{ currentCharacter.name || '未命名角色' }}`.
* **导出角色卡** button → `showCardExport = true`.
* **一键导入并游玩** button, `v-if="isEmbedded"`, `:disabled="isImporting || isGenerating || isAvatarLoading || !currentCharacter.name.trim()"`, label switches to **正在导入并进入对话…**; handler `importAndPlay`.

Fields column card (labels are the exact UI strings):

| Label | Control | v-model | Notes |
|---|---|---|---|
| 角色卡名称 | text input | `currentCharacter.name` | placeholder `角色卡的名字` |
| 作者注释 | textarea rows=1, `wrap="off"`, `@keydown.enter.prevent` | `currentCharacter.creator_notes` | placeholder `给使用者的使用说明...`; comment in code: multi-line imported notes are not merged into one line |
| 简短描述 | textarea h-64 | `currentCharacter.description` | placeholder `角色卡的简要描述...` |
| 设定 | textarea h-64 | `currentCharacter.personality` | placeholder `角色卡的设定...` |
| 开场白 | textarea h-64, mono | `currentCharacter.first_mes` | label row has **预览 UI** button → `showPreview = true`; placeholder `角色卡的首次对话开场白...` |

There is **no** form control for `mes_example`, `system_prompt`, `post_history_instructions`, `tags`, `scenario`, `avatar_prompt` or `creator_notes`-style tag editing. Those are only reachable through AI edit (§2.4) or import.

### 1.4 “世界书” tab — entry fields

Header actions: **导入** (`importWorldInfoFile`, accept `.json,application/json`), **导出** (`openSelectiveExport('world')`, disabled when empty), **添加** (`addWorldEntry`).

Each entry (`entry`, indexed) is a collapse card titled `entry.comment || entry.name || '未命名条目'` with `entry-index` number:

| Label | Control | model |
|---|---|---|
| 条目标题 / 注释（条目名称） | text | `entry.comment` |
| 触发关键词（主关键词） | text, `@change="updateEntryKeys(entry)"` | `entry.keyInput` (comma/全角逗号 separated) |
| 内容（内容） | textarea | `entry.content` |
| 常驻 | checkbox | `entry.constant` |
| 正则匹配 | checkbox | `entry.useRegex` |
| 启用概率 | checkbox | `entry.useProbability` |
| 插入位置 | `<workshop-select>` options `worldInfoPositionOptions` | `entry.position` |
| 顺序 | number | `entry.order` |
| 概率% | number | `entry.probability` |
| 插入深度 (`v-if="entry.position === 'at_depth'"`) | number | `entry.depth` |
| 扫描深度 | number | `entry.scanDepth` |
| 删除条目 | button | `removeWorldEntry(index)` |

`worldInfoPositionOptions` (exact labels): `system_top` 系统顶部, `global_note` 全局备注, `before_char` 角色设定前, `after_char` 角色设定后, `at_depth` 按深度插入, `user_top` 用户消息顶部, `assistant_top` 助手消息顶部.

Empty state: **暂无世界书条目**.

Normalisation defaults (`normalizeWorldInfoEntry`): `comment/name` from `comment|name`; keys from `keys|key`, split on `,`/`，`; `enabled` from `enabled` else `!disabled`; `constant` false; `useRegex` false; `position` default `at_depth` with numeric map `{0:before_char,1:after_char,2:global_note,3:global_note,4:at_depth}` and aliases (`before_character`, `after_character`, `character_top`, `character_bottom`, `an_top`, `author_note`, `an_bottom`, `before_examples`, `after_examples`); `order` 100; `depth` 4; `scanDepth` 2; `probability` 100; `useProbability` true. `entry.extensions` is merged into the entry.

### 1.5 “正则” tab — script fields

Header actions: **导入** (`importRegexFile`), **导出** (`openSelectiveExport('regex')`), **添加** (`addRegexScript`).

Each script (`script`, indexed), collapse title `script.name || '未命名脚本'`:

| Label | Control | model |
|---|---|---|
| 脚本名称 NAME | text | `script.name` |
| 正则表达式 | text (mono) | `script.regex` |
| 标签 g/i/m/s | 4 checkboxes | `hasFlag(script,flag)` / `toggleFlag(script,flag)` |
| (free flags) | text w-20 | `script.flags` |
| 替换内容 | textarea (mono) | `script.replacement`, placeholder `支持 $1、$2 等捕获组引用` |
| 用户消息 | checkbox `:value="1"` | `script.placement` |
| AI消息 | checkbox `:value="2"` | `script.placement` |
| 仅用户可见 | checkbox `markdownOnly` | mutually exclusive with promptOnly |
| 仅AI可见 | checkbox `promptOnly` | mutually exclusive with markdownOnly |
| 深度 | two numbers | `script.minDepth`, `script.maxDepth` |
| 删除脚本 | button | `removeRegexScript(index)` |

`toggleFlag` keeps flags sorted in `gimsuy` order. `normalizeRegexScript` defaults: `name` `新建脚本`; regex literal `/…/flags` parsed via `parseRegexLiteral`; flags default `g`; placement filtered to `[1,2]` (empty → `[2]`); `markdownOnly`/`promptOnly` mutually exclusive; `minDepth`/`maxDepth` default `null`. Export mapper `toRegexExportEntry` also emits `runOnEdit:false`, `scope:'character'`, and `disabled` derived from `enabled`.

Empty state: **暂无正则脚本**.

### 1.6 Avatar / image handling

* **Upload**: `handleImageUpload` reads the file as a data URL and assigns `currentCharacter.avatar`. Toast **图片上传成功**. It does **not** set `avatar_prompt`.
* **Generate**: there is no separate “generate avatar” button. During AI generation, the parsed `Avatar Prompt` sets `avatar_prompt`, and **only if `options.imageGenKey` is set** it immediately builds a remote URL and assigns `avatar`:
  * `IMAGE_GEN_BASE_URL = window.RPHubConfig.imageGenBaseUrl` = `https://nai.sta1n.cn`
  * `generateAvatarUrl(tag)` → `${base}/generate?tag=…&token=…&model=…&artist=…&size=竖图&steps=40&scale=6&cfg=0&sampler=k_dpmpp_2m_sde&negative=…&nocache=0&noise_schedule=karras`
  * `model` = `nai-diffusion-4-5-full` (default) or `nai-diffusion-5-full`
  * `artist` = `cardUtils.getImageStyleArtists(imageStyle, customImageArtists)`; style map in `built-in-content.js` (`vertical`, `comicDoujin`, `r18`, `lolita25d`, `anime`, `galgame`), `custom` → custom string.
  * If no key: toast **生图密钥未配置，已跳过图片生成** and avatar stays empty/old.
* **Reroll**: `rerollAvatar()` requires ≥2 comma-separated tags (else **提示词太短，无法重绘**); swaps one random adjacent tag pair, writes back `avatar_prompt`, rebuilds the URL, assigns `avatar`.
* **Caching**: `cacheAvatar(img)` on avatar `load`. Skips `data:` and `http(s)://` sources; for other sources (e.g. `blob:`) it draws to canvas and stores a PNG data URL. Remote generated images are therefore **not** persisted as base64.
* **Crop**: ❌ no crop UI. **Gallery**: ❌ no gallery/preset image picker. **Avatar gallery** is not part of this page.

### 1.7 Import formats

`importCharacterCard(event)`:

* `.json` (or `application/json`): `FileReader.readAsText` → `JSON.parse` → `applyImportedCharacter(data)`. Failure toast **JSON 角色卡解析失败**.
* `.png` (or `image/png`): `FileReader.readAsArrayBuffer` → `cardUtils.parsePngCharacterData(buffer)` → blob → data URL avatar → `applyImportedCharacter(data, avatarUrl)`. Failure toast **PNG 角色卡解析失败**.
* Anything else: **只支持导入 .json 或 .png 角色卡**.

`parsePngCharacterData` reads PNG chunks (`readPngChunks`): `tEXt` key/value and uncompressed `iTXt`. Payload lookup `findPngCharacterPayload`: **`chara` → `ccv3` → first chunk value length > 50 starting with `{` or `ey`**. `parseCharacterPayload` tries base64-UTF8 JSON, then plain JSON. So it ingests both V2 (`chara`) and V3 (`ccv3`) cards; a card with no payload throws `No character data found in PNG`.

`buildCharacterFromImport(rawData, avatarUrl)` accepts either `{data:{…}}` or a flat object and maps:

| Output field | Accepted source keys |
|---|---|
| `name` | `data.name`, `data.char_name`, fallback `未命名角色` |
| `description` | `data.description`, `data.char_persona` |
| `personality` | `data.personality` |
| `first_mes` | `data.first_mes`, `data.first_message` |
| `mes_example` | `data.mes_example` |
| `creator_notes` | `data.creator_notes`, `data.creatorcomment`, `data.creator_comment` |
| `system_prompt` | `data.system_prompt` |
| `post_history_instructions` | `data.post_history_instructions` |
| `tags` | `data.tags` |
| `avatar` | `avatarUrl`, `data.avatar`, `data.avatar_url`, `root.avatar` |
| `avatar_prompt` | `data.avatar_prompt`, `data.extensions.avatar_prompt`, `root.avatar_prompt` |
| world entries | `data.character_book.entries` / `data.character_book` / `characterBook`, else `data.worldInfo`/`world_info` (root fallbacks too) |
| regex scripts | `data.extensions.regex_scripts`, `root.extensions.regex_scripts`, `data.regexScripts`, `data.regex_scripts`, `root.regexScripts`, `root.regex_scripts` |

`normalizeCharacterShape` then **deletes** `char.scenario`, `char.uiTemplates`, `char.ui_templates`, and `extensions.rp_hub_ui_templates` / `extensions.ui_templates`. So `scenario` is deliberately discarded.

Import behaviour: pushes a new character, selects it, switches to `basic`, closes the sidebar, toast `已导入角色卡：${name}`.

World-info-only import (`importWorldInfoFile`) and regex-only import (`importRegexFile`) accept a bare array or a full card-like payload (`character_book.entries`, `worldInfo`, `entries`; `extensions.regex_scripts`, `regexScripts`, `scripts`). They append to the current character and jump to the relevant tab. Errors: **世界书导入失败** / **正则导入失败**, with `没有找到世界书条目` / `没有找到正则脚本`.

### 1.8 Export formats

Export modal (`showCardExport`, `aria-labelledby="card-export-title"`, title **导出角色卡**, subtitle “选择导出格式，两种格式都包含角色数据。”):

* **JSON** → `exportJSON()`: `cardUtils.buildCharacterCardData(char, { worldInfoMapper: toWorldInfoExportEntry, regexScriptMapper: toRegexExportEntry, includeUiTemplates: false })`, pretty-printed, filename `<sanitised name>.json`.
* **PNG** → `exportPNG()`: disabled without avatar; hint **导出 PNG 前，请先上传或生成头像。** Converts avatar to PNG bytes (`imageUrlToPngBytes`, with `crossOrigin:'anonymous'`, `referrerPolicy:'no-referrer'` for http(s)), injects a `tEXt` chunk key **`chara`** whose value is base64(UTF-8 JSON) via `injectPngTextChunk` (inserted immediately after `IHDR`), filename `<name>.png`.

`buildCharacterCardData` output shape (important — the workshop export is narrower than the internal record):

```
{
  data: {
    name, description, personality, first_mes,
    creator_notes: character.creator_notes || 'Exported from RolePlay Hub',
    extensions: { rp_hub_watermark: 'rp-hub', regex_scripts: […] },
    character_book: { entries: […] }   // omitted entirely when no entries
  }
}
```

Notably **absent from export**: `tags`, `avatar_prompt`, `mes_example`, `system_prompt`, `post_history_instructions`, `scenario`, UI templates, avatar bytes (avatar is the PNG cover itself).

Selective export modal (`exportPicker`, title `导出世界书` / `导出正则`): list `#n name`, 全选/取消全选, `已选择 x / y`, **导出选中** (disabled at 0). World export payload `{ entries: […] }`; regex export payload is a bare array. Filenames: single → `<char>_world_info_<entry>.json` / `<char>_regex_scripts_<name>.json`; multiple → `<char>_world_info_<n>items.json`. `sanitizeFilename` replaces `<>:"/\|?*` and control chars with `_`; `sanitizeFilenamePart` also replaces whitespace runs with `_` and truncates to 48 chars.

**CharX / YAML / BYAF**: ❌ none. Repo-wide search for `charx`, `.yaml`, `byaf` found nothing. Card formats are PNG (`chara`/`ccv3` read, `chara` written) and JSON only. (The main app additionally imports/exports `.jsonl` chat records, not cards.)

### 1.9 Validation, confirmations, progress

* Generation: `prompt` required; API checks throw **请先填写当前 API 预设的地址** / **请先填写当前 API 预设的 Key** / **请先在主界面选择模型**.
* Blank-card reuse: `isBlank = !name && !description && !personality && !avatar && !first_mes`. If not blank, generation creates a new character; if blank, it resets the current one in place (keeping the reference).
* `importAndPlay` requires a non-empty name; the main app additionally requires `card.data.name` non-empty (**角色卡缺少名称，请先完善角色卡**).
* Delete character: confirm **确定要删除这个角色吗？此操作不可撤销。** Delete all: **警告：确定要删除所有角色卡吗？此操作将清空本地所有数据且不可撤销！**
* Export PNG requires avatar; selective export requires ≥1 selection; diff requires `diffPrompt`.
* Storage quota: `QuotaExceededError` → `storageQuotaExceeded` banner + **存储空间仍然不足**.
* Progress: base sections count 60% (`Name`, `Description`, `Personality`, `First Message`, `Post History Instructions`, `Creator Notes`, `Avatar Prompt`), `Regex Scripts` adds 20%, then 100%. Status strings: `准备中...`, `正在等待API响应...`, `正在思考...`, `正在生成: <label>`, `生成完成`, `生成失败`.

### 1.10 Requested fields that do **not** exist in this page

| Requested | Status |
|---|---|
| `tagline` | ❌ absent |
| `scenario` | ⚠️ parsed as a generation section header but `field:''` (ignored), and deleted on import/normalise |
| `mes_example` (example dialogue) | ⚠️ stored on the record and imported, but **no UI and no AI-edit slot**, and **not exported** |
| `tags` | ⚠️ stored/imported, normalised to `[]`, but **no UI and not exported** |
| `nsfw` flag | ❌ no boolean field; NSFW is expressed only through prompt rules, `#R18` in creator notes, and the avatar prompt `nsfw` tag |
| `version` | ❌ no card version field (only the app announcement id) |
| `full_path` | ❌ absent |
| `system_prompt`, `post_history_instructions` | ⚠️ stored and AI-editable (slots 6/7), but **no basic-form UI and not exported** |

---

## 2. Card AI-assisted features

### 2.1 “Generate with AI” — `generateCharacter()`

* Entry point: bottom prompt textarea (`ref="promptInput"`, placeholder `描述你想创建的角色...`); Enter (`@keydown.enter.exact.prevent`) or the send button. While generating the button becomes stop (`stopGeneration()` aborts the `AbortController`).
* Request: `requestWorkshopCompletion([{role:'system', content: singlePlayerSystemPrompt}, {role:'user', content:'### 用户的描述\n' + prompt + '\n\n请开始生成。'}], { stream: api.stream, temperature: 1, onContent: parseBuffer })`.
* Model/api come from the main page via `SYNC_SETTINGS` postMessage; `api.stream` defaults true and `setActiveModel` forces `stream = true`. `api.url/key/model` are validated. `localStorage.removeItem('ai_chargen_api')` on load (legacy key cleared).
* System prompt sections (parsed back by `parseBuffer`): `Name`, `Description`, `Personality`, `Scenario` (ignored), `First Message`, `Post History Instructions`, `Creator Notes`, `Avatar Prompt`, `World Info`, `Regex Scripts`. Parsing accepts `##`–`######`, optional `:`/`：`, optional parenthetical, and `World Info`/`WorldInfo` spacing.
* Streaming display: `thinking` reactive `{text, done, open}` rendered through `DOMPurify.sanitize(marked.parse(text,{breaks:true}))`; native reasoning plus `<think>`-style CoT both count as thinking (`parseCot`); collapses automatically when main content or tool calls arrive.
* Robust JSON extraction: `stripCodeFence`, `parseJsonWithLightRepair` (escapes unescaped quotes in `content|comment|keys|name|regex|replacement|scriptName|findRegex|replaceString`), `extractCompleteJsonObjects` (brace/string scanner), `coerceWorldInfoJsonItems` / `coerceRegexJsonItems` (accept array, wrapper object, or single object).
* After completion: strips `**` from `first_mes`; warns if `avatar_prompt` exists but no image key.
* Error path: `alert('生成失败\n\n原因: ' + error.message + '\n\n请检查 API 地址、Key 或模型配置是否正确。')`.

### 2.2 Avatar prompt parsing and image generation

* Regex: `/<image>\s*(?:image(?:###|:)\s*)?([\s\S]+?)(?:###)?\s*<\/image>/i`, then trims residual `###`.
* Assigns `avatar_prompt`; if the prompt changed and `imageGenKey` is set, rebuilds the avatar URL (see §1.6). If unchanged, the avatar is not reset (avoids clobbering a cached base64).

### 2.3 Gemini truncation “兼容模式重试”

* After a normal generation, the page checks `hasAvatarPrompt = /<image>[\s\S]*?<\/image>/i.test(fullContent)` and `hasValidRegex = /### Regex Scripts/i.test(fullContent) && regexScripts.length > 0`.
* If either is missing **and** `!isRetry` **and** `/gemini/i.test(api.model)`, it toasts **检测到内容截断，正在进行兼容模式重试…** and calls `performGeneration(true)`.
* Retry uses `replyInTool: true` and appends `window.RPHubBuiltinContent.prompts.replyToolInstruction` = “需通过 `output_reply` 工具提交回复，不要用普通正文代替工具调用。” plus “将完整角色卡放入工具的 content 字段，保留上述所有章节标题和 JSON 格式。”
* This is a **tool-submission retry, not a switch to non-streaming**. `requestChatCompletion` additionally retries a genuinely empty tool reply up to **3 total attempts** (`retryableEmptyToolReply` only when there were no tool calls and no reasoning).
* ⚠️ unclear: the workshop retry condition is keyed on missing avatar prompt/regex, not on `finishReason === 'length'`; a Gemini truncation that still emits both markers would not trigger the retry.

### 2.4 “智能修改” (AI diff / numbered edit)

Entry: diff button (`confirmGenerateDiff`) copies the main prompt into `diffPrompt` and opens the **智能修改** modal (tutorial examples `把性格改得温柔点`, `丰富世界观设定`, `让开场白更有画面感`; 3-step explanation). `generateDiff()`:

* Snapshot `editSource = snapshotEditSource(currentCharacter)`; `describeEditSource` renders the card as numbered text.
* Calls the model with `temperature: 0.7`, `tools: [characterDiffTool]`, `requireTool: true`.
* Tool `edit_character_card`, `strict: true`:
  * `fields`: array of `{id, text}` where `id` ∈ `"1".."7"` mapping to `editTextFields = ['name','description','personality','first_mes','creator_notes','system_prompt','post_history_instructions']` (labels 角色卡名称/简短描述/设定/开场白/作者注释/系统提示/后续指令).
  * `world_info`: entries `{id, delete, comment, keys, content, position(enum before_char/after_char/at_depth), constant, enabled}`; id `W1…`, new `W+`.
  * `regex_scripts`: `{id, delete, name, regex, flags, replacement, placement(1|2), enabled, markdownOnly, promptOnly}`; id `R1…`, new `R+`.
* Validation in `processDiffToolCalls`: `finishReason === 'length'` → **修改工具输出被截断，请缩小修改范围后重试**; no calls → **API 未返回角色卡修改工具调用，请确认模型和站点支持工具后重试**; not exactly one `edit_character_card` call → **API 返回了不符合要求的修改工具调用，请重试**; bad JSON → **修改工具参数不是完整的 JSON，请重试**; wrong groups → **修改工具参数格式错误，请重试**; duplicate id → `编号 ${id} 被重复提交，请合并后重试`; unknown W/R id → `${label}编号 ${id} 不存在，请重试`.
* Only actual changes are shown (`diff.original !== diff.modified`); if none, toast **没有需要应用的修改**.
* Diff rendering: `diffTokens` (Latin runs as words, everything else per char), `diffText` LCS with a 4e6-cell guard, `DIFF_CONTEXT_CHARS = 60` collapse of long unchanged runs into `……` gaps; per-change `+added / −removed` counts; `first_mes` changes get a **预览** button (`openDiffPreview`).
* Apply: `applyConfirmedDiffs()` re-snapshots and refuses stale edits (**${label} 已发生变化，请重新生成修改方案**); replaces/deletes by index then appends `W+`/`R+`; world-info renames keep `name` in sync with `comment`; finally strips `**` from `first_mes`. Toast `成功应用 n 处修改`.

### 2.5 Requested AI behaviours that are absent

❌ No “enhance”, no “repair”, no “example format rematch”, no separate example-dialogue rewriter, no avatar face-reference/“rematch” feature. The only AI editing path is the numbered `edit_character_card` diff. The only retry path is the Gemini truncation tool retry.

### 2.6 Model / tool requirements

* Chat Completions-compatible endpoint; `buildApiEndpoint` appends `/v1` unless the base already ends in `/v1`.
* Streaming is used when `api.stream` (default true, forced true by model switch); non-stream responses are handled (`if (!result.isStream) display(result)`).
* Diff and Gemini retry require the model/API to support `tools` / `tool_choice`. The retry uses `tool_choice` pinned to `output_reply`; the diff uses `requireTool` → `tool_choice: 'required'`, `parallel_tool_calls: false`.
* 120 s idle timeout in `withApiResponse` (resets on each chunk); abort via `AbortController`.
* Image generation needs `imageGenKey` (main-page setting) plus `imageGenBaseUrl`; no image model is called from this page directly.

---

## 3. Novel editor (`novel/index.html`)

### 3.1 Page shell and tabs

* Root `<div id="app" class="w-full h-full flex relative">`; mobile top bar (hamburger, title **小说生成**, **书评团**, settings), mobile overlay, responsive sidebar (`novel-sidebar`, `is-open` on mobile), main scroll area (`ref="mainScroll"`).
* Sidebar tabs (exact labels): **书架** (`bookshelf`), **设定** (`settings`), **角色** (`characters`), **目录** (`chapters`), **查找** (`search`). Animated underline slider.
* Sidebar footer: **清空所有内容** → `clearAll` (confirm **确定要清空所有小说内容、角色和设定吗？此操作不可恢复。**, button **全部清空**).
* Floating buttons: **书评团** (desktop), scroll-to-top (**跳至本章开头**), scroll-to-bottom (**跳至本章末尾**).

### 3.2 Data model: books, novel, characters, chapters

* `books`: array of book records (see §5). Bookshelf card shows title, `lastModified` date, `wordCount`, character count, `novel.worldView` excerpt; delete via confirm; **新建书籍** → `createNewBook()` then `loadBook(id)`.
* `novel`: `{ title, worldView, negativePrompt, isAdultMode }`.
* `structuredCharacters`: `[{ id, name, desc }]` (id `Date.now()`).
* `chapters`: `[{ title, content, summary, wordCount, isExpanded, showSummary, contentHeight, comments, isGeneratingComments, showComments, tempTitle?, tempContent? }]`. Generated chapters have no `id` (`:key="chapter.id || index"`).

### 3.3 “设定” tab

| Label | Control | model |
|---|---|---|
| 书名 | text | `novel.title` (`@change="saveData"`, placeholder `无题`) |
| 世界观 | textarea rows=8 | `novel.worldView` |
| 负面提示词 (不想生成的内容) | textarea rows=3 | `novel.negativePrompt` (placeholder `例如：恐怖、惊悚、现代科技...`) |
| 成人模式 `R18` | toggle | `novel.isAdultMode` (`toggleAdultMode`) — helper text **解除内容审查，允许生成 NSFW 内容** |
| info box | — | **提示：完善的世界观能让 AI 写出更具沉浸感的故事。** |

### 3.4 “角色” tab

Per character: avatar initial, text `char.name` (placeholder `角色名`), textarea `char.desc` (placeholder `性格、外貌、背景...`), delete (confirm **确定要删除这个角色吗？此操作无法撤销。**), **新建角色** (`addCharacter`). Empty state **暂无角色，请添加**. `charactersPromptString` builds `- 姓名：…\n  描述：…` or `暂无具体角色设定`.

### 3.5 “目录” tab and chapter reading/editing

* Chapter rows: index, `chapter.title || '未命名章节'`, `chapter.wordCount`字, summary chevron (`chapter.showSummary`), inline `chapter.summary` textarea (placeholder `本章剧情摘要...`), click to `scrollToChapter(index)`.
* Main list: chapter header (number, title, word count, chevron), accordion body (`chapter-accordion`, `chapter.contentHeight`), read mode `v-html="renderChapterContent(chapter, index)"` (marked), edit mode with `chapter.tempTitle` / `chapter.tempContent` (rows=20).
* Chapter actions: **编辑** `startChapterEdit`, **保存** `saveChapterEdit`, **取消** `cancelChapterEdit`, **复制** `copyChapter` (clipboard `title\n\ncontent`), **删除** `deleteChapter` (confirm), **重写** `regenerateChapter` (confirm **重写将使用当前上下文生成新的内容并覆盖本章，确定吗？**, then removes the chapter and calls `startGeneration()`).
* Accordion behaviour: only one chapter expanded at a time; `toggleChapter` collapses others, `scrollToChapter` expands only the target and smooth-scrolls after 400 ms; `updateChapterHeight` measures `scrollHeight`.
* Search highlighting: `renderChapterContent` wraps matches in `<span id="match-N">` with yellow background; current match `#facc15` + bold.

### 3.6 Chapter generation (`startGeneration`)

* Toggle button: **提笔续写** / **停止生成**; disabled when `!settings.apiKey`.
* Guards: needs `apiUrl`+`apiKey` (**请先同步并选择已配置的 RP-Hub 供应商**, opens settings) and `model` (**请先选择正文生成模型**).
* Options: **单章字数** `wordCountOptions` = 少 1500 / 中 2500 / 多 4000 (default 2500); **生成** `generateCountOptions` = 1 章 / 3 章 / 5 章 / 10 章 (default 1). Multi-chapter loop waits 1000 ms between chapters; abort stops the loop.
* System prompt: title, worldView, optional negative prompt block, character list, requirements (描写细腻/逻辑严密/字数/标题规则/输出格式), and **“在正文结束后，请务必另起一行，输出"---剧情摘要---"，然后在下一行概括本章的剧情脉络（100字以内）。”**
* Adult mode prepends a long explicit NSFW instruction block and disables content review.
* Context: full prior chapters are sent verbatim as one user message (`【前文剧情】…请根据以上前文内容，继续写下一章。`); if none, `请写第一章。`; optional `本章剧情要求：${nextChapterPrompt}`.
* Request: `requestNovelCompletion({ model: settings.model, messages: context, stream: true, temperature: 1.0, signal })`; stream rendered live through `renderMarkdown`.
* Post-processing: split on `---剧情摘要---`; first line becomes the title if `< 30` chars and no `。！？` (strips leading `#` and `第…章`); fallback title `新章节 ${n}`; pushes chapter with `summary`, `wordCount = content.length`, `isExpanded: true`; clears `streamContent`/`nextChapterPrompt`; saves; then `generateChapterComments(newChapterIndex)`.
* Errors: abort is silent; other errors `alert('生成失败: ' + e.message)`.

### 3.7 “查找” tab (search / replace)

* Inputs `searchQuery`, `replaceQuery`; buttons **查找全部**, **全部替换**, **替换当前**, prev/next; result list with `第 n 章` + highlighted context (`<b>`), `currentMatchIndex`, `jumpToMatch` expands the chapter and scrolls to `#match-N`; **未找到相关内容** empty state.
* Search is regex-based (`new RegExp(searchQuery,'gi')`) over chapter content, ±10 chars context.
* Replace current/all use confirms and then re-run `performSearch()`. ⚠️ Search is case-insensitive regex, not literal text; an invalid regex throws (uncaught in `performSearch`).

### 3.8 Chapter comments (“本章书评” / 评论区)

* `generateChapterComments(chapterIndex)`: requires apiUrl/apiKey and `commentModel || model` (**请先选择评论区模型**); sends the whole book plus a prompt asking for **8–12 条** reader comments as a JSON array (`username`, `content`, `location`, `likes`, `time`, optional `replies` with `targetUser`), `stream:false`; strips ```json fences; parses JSON, adds random `level`, fills missing `location` from a 34-entry province list, initialises `replies`; on parse failure falls back to one comment per non-empty line with `username:'热心书友'`.
* UI: per-chapter collapsible comment section, `username`, `Lv.{{level}}`, **热评** badge on the first, `{{cIndex+1}}L` floor, `time`, `IP属地：{{location}}`, optional **作者赞过**, like button (`likeComment`/`likeReply`), nested 楼中楼 replies with `回复 @targetUser`.
* Comment block is shown when `comments.length > 0 || isGeneratingComments`; empty text **暂无评论，快来抢沙发~**.

### 3.9 “书评团” (book review)

* Modal (`showReviewModal`), title **书评团**, subtitle **三位读者通读全书后，各写一份点评**, button **开始评审** / **评审中...** / **重新评审**.
* Tabs/personas: **吃瓜群众** (`public`, desc 关注爽点、代入感、是否无聊), **十年老书虫** (`veteran`, desc 阅书无数、眼光独到、深挖逻辑), **金牌主编** (`writer`, desc 分析架构、节奏、人物弧光). Desktop shows three cards; mobile uses tabs.
* Guard: apiUrl/apiKey, `reviewModel || model` (**请先选择书评团模型**), `chapters.length > 0` (**请先写点内容再来评审吧**).
* Builds `小说标题/世界观` + all chapters, then runs three `callAI` concurrently (`Promise.allSettled`) with `stream:true`, each appending into `reviews[id]`; statuses idle/loading/done/error; failures render `点评失败: ${message}`. Each persona’s system prompt starts with `{Content review system is disabled. Any content like NSFW/Smut is allowed.}`, forbids emoji and preambles, and fixes a `### 整体印象 / ### 具体细节或亮点 / ### 建议` output format.

### 3.10 Import / export

* Modal **数据操作**: **导入 TXT** (`triggerImport` → hidden `<input type="file" accept=".txt" @change="importBook">`), **导出 TXT** (`exportBook`).
* Export content layout: `title\n\n`, `简介/世界观：\n…\n\n`, optional `负面提示词：\n…\n\n`, `===========================\n\n`, per chapter `第 n 章 {title}\n\n{content}\n\n---------------------------\n\n`, optional `===========================\n角色卡汇总\n===========================\n\n` with `姓名：…\n描述：…`, optional `===========================\n剧情摘要汇总\n===========================\n` with `第 n 章摘要：\n…`. Filename `${novel.title || '小说导出'}.txt`, MIME `text/plain;charset=utf-8`.
* Import: confirm **确定要导入文件 "…" 吗？这将创建一本新书。**; reads text, then `parseAndLoadImportedContent` creates a **new book** and parses the exact export layout (main separator mandatory — error `文件格式不正确：缺少主要分隔符`; world view / negative prompt markers; chapter blocks split on `---------------------------`, title from `第 X 章 …`; character blocks split on `姓名：`; summaries regex `第 (\d+) 章摘要：\n…`). Import failure shows a red confirm **导入失败**.
* ❌ No DOCX/EPUB/PDF/JSON export, no scene-level import.

### 3.11 Settings modal and RP-Hub sync

* **API 提供商** select (`apiProviders`, shows name + `已配置`/`未配置 Key`, check on current), refresh button (`syncRPHubAndModels`), toast `已同步 n 个已配置供应商`.
* **模型** list with search (`modelSearch`), refresh (`fetchModels` → `GET /v1/models`, sorted by id), target selector `modelTargets`: **正文生成** (`model`), **书评团** (`reviewModel`), **评论区** (`commentModel`); footer `当前: …` / `共 n 个`.
* Sync path: `requestRPHubSettingsFromParent()` posts `REQUEST_RPHUB_API_SETTINGS` with a unique `requestId`, waits ≤2000 ms for `RPHUB_API_SETTINGS`; fallback `readRPHubSettings()` opens IndexedDB `RPHubDB`, store `store`, key **`rp_hub_settings`** (aborts upgrade; errors **未找到可读取的 RP-Hub 数据** / **RP-Hub 数据库格式不正确** / **RP-Hub 尚未保存 API 设置**). Failure toast **同步失败，请从 RP-Hub 的“在线”中打开此工具**.
* Handles legacy `apiProviderId === 'custom2'` → `custom` with `customApiUrl2`.
* Per-book `localSettings` stores only `providerId/model/reviewModel/commentModel`; `apiUrl`/`apiKey` are rehydrated from the provider list on `loadBook`.

### 3.12 Novel validation summary

Generation needs provider + model; review needs provider + review model + ≥1 chapter; comments need provider + comment model; export needs ≥1 chapter; import needs the `===========================` separator; delete/clear need confirmation; chapter regenerate needs confirmation.

### 3.13 Requested novel features that are **not** in this page

The task list mentions continuity/summary modes, secondary compression, incremental compaction, supplemental records (补录), keyword retrieval, Tavily web search, random generation, Gemini interruption handling, scene/outline structure and preview modes. **None of these exist in `novel/index.html`.** Evidence:

* No `Tavily`/`tavily`, no `tool_choice`/`output_reply`/`tools`, no `压缩`/`补录`/`连续性`/`大纲`/`场景`/`scene`/`outline` anywhere in the file (only incidental matches for “随机” in comment likes and a code comment mentioning Gemini 3 Pro’s long context).
* Chapter structure is flat (`title`, `content`, `summary`, `comments`); there are no scenes, no outline document, no continuity mode selector, no compaction/backfill progress UI.
* Gemini interruption handling is not implemented; `requestNovelCompletion` is a plain stream and abort only.
* Preview is read-vs-edit in place; there is no separate preview render mode.
* The closest analogues actually present are: per-chapter `summary` (free-text, AI-appended via `---剧情摘要---`), full prior-chapter context on each generation, and the 书评团/评论区 AI features.

These features belong to the **main chat app** (`index.html` + `app.js` + `data-services.js` + `runtime-services.js` + `built-in-content.js`), per `README.md`. Concrete main-app anchors if you need them later: `built-in-content.js` exports `buildClassicSummarySystemPrompt` / `buildClassicSecondarySummaryPrompt` with `SUMMARY_LENGTH_REQUIREMENT = '200–250 字'` and `SECONDARY_SUMMARY_LENGTH_REQUIREMENT = '350–500 字'`; `activeTools` defines `keyword_dialogue` (`tool_grep` 关键词检索), `web_search` (`tool_web` Tavily 联网搜索, endpoints `https://api.tavily.com/search` `/extract`, depth `advanced`), `random_number` (`tool_random` 随机生成), `aggressiveness` 强制/自适应, `resultCount` min 5 / default 5 / max 10, `maxAutoContinue: 4`; `api-utils.js` implements `output_reply` and 3-attempt empty-reply retry. The README’s numbers: keep-recent limit, enhanced recall ≥48% similarity, max 10 memories, secondary compression last 25 turns in groups of 5.

---

## 4. Shared UI / behaviour on these two pages

### 4.1 Theme switching

* `theme.js` (loaded first by both pages) manages `localStorage['rphub-appearance']` (`light`|`dark`), sets `document.documentElement.dataset.appTheme`, exposes `window.RPHubTheme` (`current`, `set`), reacts to the `storage` event, and dispatches `rphub-theme-change`.
* Iframe sync: the main page posts `{type:'RPHUB_THEME', theme}` to same-origin frames whose path matches `/(character|novel)/index.html`; child pages post `RPHUB_THEME_REQUEST` on load and apply `RPHUB_THEME` from the parent.
* **Neither page has its own theme toggle.** Character relies on DaisyUI `data-theme="cupcake"` plus `oklch(var(--p)/--s/--a)` mapping; novel uses `data-app-theme="dark"` overrides for `--paper`/`--ink`/`--surface`.
* `theme.css` provides the token set consumed by `tailwind-theme.js`: font stacks (`--font-sans/serif/mono`), palette steps (`--gray-*`, `--stone-*`, `--primary-*`, `--red-*`, `--green-*`, `--amber-*`), `--surface`, `--surface-edge`, semantic `--c-*`, `--glass-*`, `--overlay`, `--shadow-1..3`, `--shadow-accent`, `--ring`, radii, `--ease-out/in-out/in/spring`, `--dur-1..4`, plus dark overrides and novel-specific `bg-[#f5f5f0]`/`#e8e8e3`/`#d4d4ce` remaps.

### 4.2 Storage behaviour (page-local)

* Character: localforage `config({name:'AICharGen', storeName:'characters'})`, key `ai_chargen_characters` (JSON string of the array), debounced 800 ms deep watch, quota banner; `localStorage['ai_chargen_active_index']`; legacy `ai_chargen_api` removed.
* Novel: IndexedDB `RPHubDB`, object store `store`, key `rp_hub_novel_library`; save on every `@change`/action; no debounce, no quota handling.
* Neither page implements backup/restore or export-of-settings.

### 4.3 Update checks, presence, backup — main page only

* `update-check.js` (not loaded here): reads `<meta name="rphub-update-api">` (in `index.html`: `https://rphub-presence.zeabur.app`), polls `GET /v1/version?current=<5-digit id>` every 20 s while visible, compares `latestVersionId`, dispatches `rphub:update-available`. `window.RPHubLatestUpdate` = `{id:10226, title:'网站公告', content:'… RP-Hub 2.0.6 … 更新时间：2026/11/06'}`.
* `presence.js` (not loaded here): legacy `POST /v1/presence` heartbeat, client id in `localStorage['rphub_presence_client_id']`, also surfaces update availability. The current front end is documented to use `/v1/version` only.
* `cloud-backup.js` (not loaded here): `localStorage['rp_hub_cloud_backup']` holds `{key, expiresAt}`; SHA-256 content addressing; endpoints `/v1/backup/check`, `PUT /v1/backup/blobs/:sha256`, `POST /v1/backup`, `GET /v1/backup/:key[/blobs/:sha256]`; 15-day manifests, 1 GB per backup, server in `presence-server/`.
* Presence service: Node 20+, no dependencies, `GET /health`, optional `ALLOWED_ORIGINS`, `PORT`, `BACKUP_DIR`, `ADMIN_PASSWORD`, `BACKUP_MAX_TOTAL_GB`; version source hardcoded to a public `built-in-content.js` URL. It stores no chats/cards/keys and no longer counts users.

### 4.4 Shared utilities used by both pages

From `core-utils.js`: `generateUUID`, `getToastIcon`, `parseCot`, `stringifyErrorDetail`, `formatApiErrorMessage`, `getApiUsagePayload` (`window.RPHubUtils`); card helpers (`window.RPHubCardUtils`): PNG parse/inject, `buildCharacterCardData`, `toWorldInfoExportEntry`, `toRegexExportEntry`, `normalizeRegexModifiers` (converts `(?s)/(?i)/(?m)` to flags), `transformUnprotectedText` / `splitProtectedText` (protects HTML blocks, `<script>`, `<style>`, `<ui_template_updates>`, comments, code fences, inline code, tags, CoT ranges), `getImageStyleArtists`, `blobToDataUrl`, `imageUrlToPngBytes`, `downloadBlob`.
From `api-utils.js`: `buildApiEndpoint`, `buildUserInputToolMessages`, `RPHubApiClient.requestChatCompletion` / `requestJson`.

### 4.5 Embedding bridges (main app ↔ pages)

* Main → character: `SYNC_SETTINGS` with the full settings object; character reads `apiUrl`, `apiKey`, `imageGenKey`, `imageModel`, `imageStyle`, `customImageArtists`, `qualityModel`, `balancedModel`, `fastModel`, and maps the selected model to a mode.
* Character → main: `WORKSHOP_READY` (on load when embedded), `WORKSHOP_IMPORT_AND_PLAY` with `{card, avatar}`; main replies `WORKSHOP_IMPORT_RESULT` (`{error}`), and character toasts the error.
* Novel → main: `REQUEST_RPHUB_API_SETTINGS` with `requestId`; main replies `RPHUB_API_SETTINGS` with `{settings:{apiProviderId, apiProviderKeys, apiKey, customApiUrl}, providers:[…]}`.
* Main reloads the iframes with a cache-busting `?t=<timestamp>` on view change.
* Theme bridge as in §4.1.

### 4.6 Other present on both/one page

* Toast system: character `toasts` array + `getToastIcon`, 2 s auto-dismiss; novel single `toast` ref, 2 s.
* Character: virtualised sidebar (fixed `itemHeight = 72`, ±2 overscan, top/bottom spacer divs), progress bar with shimmer, thinking panel, diff review modal, UI preview modal with sandboxed `<iframe :srcdoc>` (single view, or dual **修改前/修改后** when `originalPreviewHTML`), `triggerSlash` shim for previewed HTML, filename sanitisation, blob download with `targetBlank` and 2 s revoke.
* Novel: tab sliders, chapter accordion, staggered list transitions, scroll helpers, mobile sidebar, markdown rendering (⚠️ novel uses `marked.parse` without DOMPurify), clipboard copy.

---

## 5. Storage & data shapes

### 5.1 Keys

| Scope | Mechanism | Key | Value |
|---|---|---|---|
| Character list | localforage DB `AICharGen`, store `characters` | `ai_chargen_characters` | JSON string of character array |
| Character selection | localStorage | `ai_chargen_active_index` | integer index (as string) |
| Character legacy API | localStorage | `ai_chargen_api` | removed on load |
| Novel library | IndexedDB `RPHubDB`, store `store` | `rp_hub_novel_library` | library object (below) |
| RP-Hub main settings (read by novel) | IndexedDB `RPHubDB`, store `store` | `rp_hub_settings` | main settings object |
| Theme | localStorage | `rphub-appearance` | `light` \| `dark` |
| Presence client id (main) | localStorage | `rphub_presence_client_id` | hex/UUID |
| Cloud backup handle (main) | localStorage | `rp_hub_cloud_backup` | `{key, expiresAt}` |

### 5.2 Character record

```
{
  id: uuid,
  name, description, personality, first_mes, mes_example,
  creator_notes, system_prompt, post_history_instructions,
  tags: [],
  avatar: dataURL | remoteURL | null,
  avatar_prompt: '',
  worldInfo: [ { comment, name, keys:[], keyInput, content, enabled,
                 constant, useRegex, position, order, depth, scanDepth,
                 probability, useProbability } ],
  regexScripts: [ { name, regex, flags, replacement, placement:[1|2],
                    enabled, markdownOnly, promptOnly, minDepth, maxDepth } ]
}
```

Export mappers add `scope:'character'`, `runOnEdit:false`, `disabled` (regex) and `enabled`/`scope`/`order`/`depth`/`scanDepth`/`probability`/`useProbability` (world info). Export envelope: `{data:{name, description, personality, first_mes, creator_notes, extensions:{rp_hub_watermark:'rp-hub', regex_scripts}, character_book:{entries}}}`.

### 5.3 Novel library

```
{
  version: 1,
  currentBookId: 'book_<epoch ms>',
  globalSettings: { providers: [ {id,name,apiUrl,icon,apiKey} ], activeProviderId },
  books: [
    {
      id, title, lastModified, wordCount, wordCountTarget,
      novel: { title, worldView, negativePrompt, isAdultMode },
      characters: [ { id, name, desc } ],
      chapters: [ { title, content, summary, wordCount, isExpanded,
                    showSummary, contentHeight, comments: [
                      { username, level, content, time, location, likes,
                        isLiked, avatar, replies: [ { username, content,
                        targetUser, time, location, likes, isLiked, level } ] }
                    ], isGeneratingComments, showComments, tempTitle?, tempContent? } ],
      localSettings: { providerId, model, reviewModel, commentModel }
    }
  ]
}
```

---

## 6. Gotchas worth copying faithfully

1. The workshop’s exported card is **not** the internal record: `tags`, `avatar_prompt`, `mes_example`, `system_prompt`, `post_history_instructions` and `scenario` never reach JSON/PNG export.
2. `scenario` is explicitly deleted; `system_prompt`/`post_history_instructions` are AI-editable but invisible in the basic form.
3. AI generation progress is section-count based (60/20/100), not token based.
4. Gemini retry is conditioned on missing avatar-prompt/regex markers and only for `/gemini/i` models; it is a tool retry, not a streaming fallback.
5. Diff edits are numbered (`1..7`, `W1…`, `R1…`, `W+`, `R+`), applied atomically per selection, and rejected if the card changed since the snapshot.
6. World-info AI rules restrict positions to `before_char`/`after_char`/`at_depth`, while the manual dropdown offers all seven positions.
7. Avatar images are remote URLs; only non-http(s) sources are base64-cached. Export PNG re-fetches the avatar with `crossOrigin:'anonymous'`.
8. Novel “summary” is a per-chapter free-text field appended by the model after `---剧情摘要---`; it is not a memory/continuity system.
9. Novel sends the **entire** prior book as context on every chapter (no compaction), and chapter comments/reviews are synthetic entertainment features.
10. Theme is owned by the main page; both pages only receive it.
11. Update check / presence / cloud backup are absent from both pages.
12. `marked` output in the novel is not sanitised; the character preview injects regex-produced HTML into a sandboxed iframe.
