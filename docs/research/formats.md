# RPNow — Data-Interchange Formats Reference

**Status:** research / implementation-ready reference
**Date:** 2026-11-15
**Scope:** Everything RPNow needs to *import* (and partially *export*) besides the already-documented Character Card V2/V3 core.

## How to read this document

Every non-obvious claim carries one of these tags:

| Tag | Meaning |
|---|---|
| **[ST-SRC]** | Verified by reading the cloned SillyTavern source at `D:\RPNow\_ref\SillyTavern` (release branch, `package.json` version **1.19.0**, HEAD `06bde93`, 2026-09-14). File + line given. |
| **[SPEC]** | Quoted/paraphrased from an official specification document (URL given). |
| **[WEB]** | Secondary source (blog, npm readme, doc site). Treat as weaker. |
| **[ST-DOC]** | SillyTavern's official documentation site (docs.sillytavern.app). |
| ⚠️ **uncertain** | Inferred, or only single-sourced, or version drift is likely. |

> **Note on version drift:** the clone is **1.19.0**, *not* v1.14 as the brief assumed. Several things changed between 1.14 and 1.19 (macro engine rewrite, V3 card support, CharX/BYAF importers, `sample` → textgen preset split). Where 1.14 behaviour is known to differ it is called out explicitly.

---
---

# Part 0 — Already-established baseline (do not re-derive)

Restated only so this document is self-contained. All **[ST-SRC]**.

- **Card V1**: the six fields at top level, no `spec` key: `name, description, personality, scenario, first_mes, mes_example`.
- **Card V2**: `spec: "chara_card_v2"`, `spec_version: "2.0"`, `data: {name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings[], tags[], creator, character_version, extensions{}, character_book?}`.
- **Card V3**: `spec: "chara_card_v3"`, `spec_version: "3.0"`; adds `data.group_only_greetings[]`, `data.assets[]`, `data.creation_date`, `data.modification_date`, `data.creator_notes_multilingual`.
- **PNG embedding**: base64(UTF-8 JSON) in PNG `tEXt` chunk keyword `chara` (V2) and `ccv3` (V3), inserted before `IEND`; readers prefer `ccv3`.

Two corrections/additions to the baseline that matter for import, both **[ST-SRC]** in `src/character-card-parser.js`:

1. `write()` removes any pre-existing `chara`/`ccv3` `tEXt` chunks, then splices `chara` at `chunks.length - 1` (i.e. before `IEND`) and *attempts* to splice `ccv3` after it. The file header comment claims "ccv3 is not supported" — **the comment is stale, the code does write `ccv3`**. Read order is `ccv3` → `chara` → throw `No PNG metadata.`.
2. The V3 chunk that ST writes is the V2 object with `spec`/`spec_version` overwritten (`src/character-card-parser.js:32-40`). So a ST-authored PNG usually carries a **V3 chunk whose `data.assets` / `group_only_greetings` are absent**. An importer must tolerate that (treat missing `assets` as `[{type:'icon', uri:'ccdefault:', name:'main', ext:'png'}]` per spec, and missing `group_only_greetings` as `[]`).

---

# Part 1 — Character card formats RPNow must import

## 1.0 Format detection: the decision tree RPNow should implement

There is no magic-number-free way to detect a card format; the container is decided first, then the shape. This tree is the union of what SillyTavern's import endpoint does **[ST-SRC]** (`src/endpoints/characters.js:1560-1599`, `formatImportFunctions` keyed on the *uploaded file extension / declared `file_type`*), RisuAI's importer **[WEB]** (`src/ts/characterCards.ts`, via jsDelivr), and the CCv3 spec **[SPEC]**.

```
1. Read first 8 bytes.
   ├─ 89 50 4E 47 0D 0A 1A 0A  → PNG  → find tEXt chunks (also zTXt/iTXt in the wild ⚠️)
   │                                    prefer keyword `ccv3`, else `chara`; base64-decode; JSON-parse
   │                                    then continue at step 3 with that object
   ├─ 50 4B 03 04 (PK\x03\x04)  → ZIP  → probe entries:
   │     has `card.json` at root            → CHARX      (§1.2)
   │     has `manifest.json` at root        → BYAF       (§1.3)
   │     has `*.risum` / `module.risum`     → Risu module inside a charx ⚠️uncertain
   │     else                                → reject "unknown archive"
   └─ otherwise                  → try UTF-8 text:
         ├─ starts with `{` or `[`          → JSON (§1.4 classifier)
         ├─ parses as YAML mapping          → YAML card (§1.7)
         └─ else                            → plain-text card sheet (§1.8) or reject
3. JSON classifier (order matters; stop at first hit):
   a. obj.spec === 'chara_card_v3'                                → Card V3
   b. obj.spec === 'chara_card_v2'                                → Card V2
   c. obj.spec === 'lorebook_v3'                                  → Lorebook-only (warn, not a card)
   d. obj.spec?.startsWith('chara_card_')                         → forward-compat: treat as Card V3, warn  ⚠️
   e. obj.data?.name && obj.data?.first_mes !== undefined         → "V2-shaped without spec" (common in
                                                                    the wild; ST's readFromV2 accepts it)  ⚠️uncertain
   f. obj.char_name || (obj.name && obj.char_persona)             → Pygmalion char_name format (§1.5)
   g. obj.name && (obj.description !== undefined)                 → Card V1 / TavernAI V1 (§1.6)
   h. obj.identifier && obj.members?                              → Agnai "character" (§1.4a)
   i. obj.character?.name && obj.user?.name                       → JanitorAI export (§1.4d)  ⚠️uncertain
   j. obj.name && obj.persona && obj.loreItems                    → BYAF character.json (bare) (§1.3)
   k. obj.first_mes === undefined && obj.description && obj.name  → heuristics; ask the user
```

**Rule of thumb from the ST server** **[ST-SRC]** `characters.js:889-956`: ST's JSON importer is exactly three branches —
`spec !== undefined` → spec card; else `name !== undefined` → V1; else `char_name !== undefined` → Pygmalion/gradio. Anything else silently returns `''` (import fails). RPNow should do better and add explicit vendor branches (§1.4).

> ⚠️ **Extension is not authoritative.** Users rename `.json` files containing V3 cards, and `.png` files that are actually JPEGs exist in the wild (ST reads card PNGs via `readCharacterData()` which is PNG-only, `characters.js:181`). Prefer sniffing bytes; use the extension only as a tiebreaker/UX label.

---

## 1.2 CharX (`.charx`)

### Spec

**[SPEC]** https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md (§ *CHARX*):

- CHARX **is a ZIP**. It **MUST** contain `card.json` **at the root**, whose JSON **MUST** be a CharacterCardV3 object.
- Asset URIs inside the card are `embeded://path/to/asset.png` — **one `d`, spelled `embeded`** — "case sensitive, and separated by `/`". The spec explicitly notes it is *not* `embedded://`.
- Recommended storage layout by `{type}` and media class:

| Asset kind | Recommended path |
|---|---|
| image (png, avif, …) | `assets/{type}/images/` |
| audio (mp3, …) | `assets/{type}/audio/` |
| video (mp4, webm) | `assets/{type}/video/` |
| Live2D model | `assets/{type}/l2d/` |
| 3D model (mmd, obj) | `assets/{type}/3d/` |
| AI model (safetensors, ckpt, onnx) | `assets/{type}/ai/` |
| font (otf, ttf) | `assets/{type}/fonts/` |
| code (lua, js) | `assets/{type}/code/` |
| other | `assets/{type}/other/` |

- `{type}` ∈ `icon | background | emotion | user_icon | other`, plus app-specific types. The spec says **app-added types SHOULD start with `x_`**; RisuAI in practice emits `x-risu-asset` (hyphen) ⚠️ **[WEB]** — accept both `x_` and `x-`.
- "Application specific data can be stored as **a JSON file in root** of the zip file. frontends MAY use this file…". **The filename is not fixed by the spec** ⚠️uncertain. RisuAI writes `module.risum` (binary, see below) and `x_meta/{name}.json` per-asset ⚠️ **[WEB]**.
- Archive filenames **SHOULD** be ASCII-only; archive **SHOULD NOT** be encrypted.

### What SillyTavern actually accepts **[ST-SRC]** `src/charx.js`

ST is *more permissive* than the spec in four places — RPNow should match ST, because the wild is full of RisuAI exports:

1. **Three embedded-URI prefixes** (`charx.js:10`):
   ```js
   // 'embeded://' is intentional - RisuAI exports use this misspelling
   const CHARX_EMBEDDED_URI_PREFIXES = ['embeded://', 'embedded://', '__asset:'];
   ```
   Comparison is case-insensitive (`lower.startsWith(prefix)`). `__asset:{n}` is the **PNG** asset-reference form (§1.1 of the CCv3 spec allows PNG `chara-ext-asset_:{path}` tEXt chunks addressed as `__asset:{path}`); inside a `.charx` RisuAI repurposes it as a 1-based index. ST normalises via `normalizeZipEntryPath(rawPath)` — ⚠️ path traversal must be rejected by RPNow (`..`, absolute paths, backslashes).
2. **Self-extracting / prefixed ZIPs** (`charx.js:16-30`): ST scans for the first `PK\x03\x04` signature and slices the buffer from there. An importer should do the same, otherwise `.charx` files appended to a JPEG or with a stub header fail.
3. **`card.spec` is required but not validated to be v3** — ST only checks `card.spec === undefined` → throw `Invalid CharX card file: missing spec field` (`charx.js:76-78`). So a *V2* `card.json` inside a `.charx` is accepted.
4. **Asset extension resolution** (`charx.js:166-170,188`): `ext` = `asset.ext` (lowercased, dot-stripped) **or** the ZIP-path extension, whichever exists. Supported image extensions: `png, jpg, jpeg, webp, gif, apng, avif, bmp, jfif`.

### ST's asset mapping **[ST-SRC]** `charx.js:202-278`

| Asset `type` | ST storage bucket | Notes |
|---|---|---|
| `icon` | avatar PNG itself | Prefers the entry with `name === 'main'` (case-insensitive), else the first `icon` with an image ext. |
| `user_icon` | **skipped** | Not imported at all. |
| `emotion`, `expression` | `characters/{Name}/` (sprite folder) | Filename base is `name` sanitised to `[a-z0-9]` joined with **hyphens** — "so ST's expression label extraction works (sprites.js splits on dash or dot)". |
| `background` | `characters/{Name}/backgrounds/` | Base name joined with `_`. |
| everything else w/ image ext | `user/images/{Name}/` (gallery) | Base name joined with `_`. |
| non-image ext (audio/video/lua/…) | **dropped** | `if (!CHARX_IMAGE_EXTENSIONS.has(ext)) return acc;` |

Duplicate base names: existing file with the same base name (any extension) is **deleted first** for sprites and backgrounds.

### What RisuAI writes **[WEB]** `src/ts/characterCards.ts`, `createBaseV3()` / export branch

Worth knowing because "CharX" ≈ "RisuAI card bundle" in practice:

- `card.json` = full V3 object; `module.risum` = Risu module (triggers + regex + lorebook), **and the export deletes `card.data.extensions.risuai.triggerscript` and `.customScripts` first** — they live in the module instead.
- Assets: `RisuAI` writes real files at `assets/{bucket}/{itype}/{name}.{ext}` with `embeded://` + a companion `x_meta/{name}.json` holding the source PNG's `tEXt` chunks (or `{"type": "PNG"}`).
- `ccAssets`, `additionalAssets` (→ `type: 'x-risu-asset'`), and `emotionImages` (→ `type: 'emotion'`, plus an automatic `{type:'icon', uri:'ccdefault:', name:'main', ext:'png'}`) are the three asset sources.
- RisuAI *validates on import*: `if (card.spec !== 'chara_card_v3') { alertError(noData); return }`.

### Risu `.risum` modules (and `.risup` / `.risupreset` presets)

- **[WEB]** RisuAI's `readModule(Buffer)` reads `.risum`. The object shape (`RisuModule`) is `{ name, description, id, trigger[], regex[], lorebook[] }`; `exportModuleLegacy` writes it.
- Encoding: ⚠️**uncertain** — Risu module files are documented as compressed/serialised rather than plain JSON. I could not obtain the exact framing from an authoritative source in this session (DeepWiki returned 429, GitHub raw returned 503). **Do not rely on `.risum` parsing for v1.** A `.risum` is *not* a character card; treat it as "lore + regex + trigger" and skip it with a warning.
- `.risup` / `.risupreset` are RisuAI *presets*, not cards. **[WEB]** RisuRealm API exposes `preset-risu-v1` and `preset-st-chat` download formats, i.e. Risu presets and ST presets are treated as distinct sibling formats. The internal JSON shape is designed to be edited/imported; ⚠️ the field list was not verified in this session.

### RPNow implementation notes for CharX

- Must reject zip-slip entries and zip bombs: cap total uncompressed size, cap entry count, cap single-asset size, reject `..`/absolute paths, reject symlinks.
- Must **not** execute `assets/{type}/code/*.lua|*.js`. Risu uses Lua for its status-bar/view-screen scripting; RPNow's sandbox (§6) does not run card code.
- Must handle `.charx` with only `card.json` (no assets) — very common.
- `data.assets` may be `undefined`: default per spec to `[{type:'icon', uri:'ccdefault:', name:'main', ext:'png'}]`.

---

## 1.3 BYAF (`.byaf`) — Backyard AI "Backyard Archive Format"

### Spec **[SPEC]** https://github.com/backyardai/byaf (readme via npm mirror https://www.npmjs.com/package/byaf/v/0.0.0-pre.2)

> "A `.byaf` file is a ZIP archive containing:"

```
archive.byaf/
├── manifest.json           # Archive manifest
├── characters/             # Character definitions
│   └── character1/         # Character directory
│       ├── character.json  # Character manifest
│       └── images/         # Character images
│           └── ...
└── scenarios/              # Scenario definitions
    └── scenario1.json      # Scenario data
```

Three Zod-defined schemas:

| Schema | Contents |
|---|---|
| `byaf-manifest.schema.json` | character-file references (**currently limited to one character**), scenario-file references (**one or more**), optional author info |
| `byaf-character.schema.json` | identification (`id`, `name`, `displayName`), Persona, timestamps (`createdAt`, `updatedAt`), lore items (key-value pairs), image references |
| `byaf-scenario.schema.json` | narrative description, message history (AI + human messages), example messages, first messages, model settings (temperature, topK, topP, …), model formatting instructions, prompt-template support |

The readme says "`BYAF` v1 spec is nearing finalization". Also documented: the legacy PNG path stored character data in **EXIF** (via `exiftool-vendored`), not `tEXt`, with internal versions V1–V4. ⚠️ RPNow can ignore the legacy EXIF path unless field reports demand it — it is marked deprecated by its own authors.

> **Status note (important for triage):** Backyard AI **shut down**; the vendor asked users to download an archive by 2026-11-04 (per https://teasa.ai/en/help/bring-backyard-ai-characters, [WEB]). Interpretation: BYAF imports will arrive *once* as a migration wave, not as an ongoing stream. Prioritise accordingly — implement a permissive importer, don't polish it.

### Exact fields SillyTavern reads **[ST-SRC]** `src/byaf.js`

ST's parser is the de-facto reference implementation. Field-by-field (`byaf.js:248-272`, `getCharacterCard`):

| BYAF source path | → Card V2 `data.` field |
|---|---|
| `character.name \|\| character.displayName` | `name` |
| `character.persona` | `description` (after macro rewrite) |
| *(none)* | `personality` = `''` |
| `scenarios[0].narrative` | `scenario` |
| `scenarios[0].firstMessages[0].text` | `first_mes` |
| `scenarios[0].exampleMessages[].text` | `mes_example` — each block prefixed `"<START>\n"`, joined with `\n`, `trimEnd()` |
| `manifest.author.backyardURL` | `creator_notes` ("to preserve the link to the author") |
| `scenarios[0].formattingInstructions` | `system_prompt` |
| *(none)* | `post_history_instructions` = `''` |
| `scenarios[1..].firstMessages[0].text` | `alternate_greetings` — **de-duplicated via `Set`, and any greeting equal to scenario[0]'s first message is skipped** |
| `character.loreItems[]` | `character_book` |
| `character.isNSFW ? ['nsfw'] : []` | `tags` |
| `manifest.author.name` | `creator` |
| *(none)* | `character_version` = `''` |
| `character.displayName` | `extensions.display_name` (ST-specific, unused by ST UI) |
| — | top-level `create_date` = now (non-standard) |

`loreItems` → `character_book` mapping (`byaf.js:95-120`): each item becomes
`{ keys: item.key.split(',').map(trim).filter(Boolean), content: item.value, extensions: {}, enabled: true, insertion_order: index }`. Note `extensions` is `{}` — **no ST position/depth fields**, so all BYAF lore lands at `position: "after_char"` by ST's defaulting.

**Macro rewrite** (`byaf.js:30-36`) — critical, Backyard uses different placeholders:

```js
.replace(/#{user}:/gi, '{{user}}:')
.replace(/#{character}:/gi, '{{char}}:')
.replace(/{character}(?!})/gi, '{{char}}')   // single-brace
.replace(/{user}(?!})/gi, '{{user}}')
```

RPNow must run the same rewrite on *every* text field, not just examples (ST applies it in `formatExampleMessages`, `formatAlternateGreetings`, `convertCharacterBook`, `getCharacterCard`).

### Scenario handling **[ST-SRC]** `byaf.js:332-432`

- `scenario.messages[]`: elements have `type: 'human' | 'ai'`, `text`, `createdAt`; **AI messages have `outputs: [{text, activeTimestamp}]`** — i.e. swipes.
- ST's interleave heuristic: if `humanCount === aiCount`, ST interleaves them in pairs (this fixes files mangled by an earlier ST version). Otherwise it keeps file order.
- ST **creates one chat file per scenario** on import, pre-populated with the first message and any messages, using `scenario.title || card.name` as the filename. RPNow likely wants to import *only* scenario[0] and stash the rest as alternate greetings + a warning. ⚠️ Product decision.
- `scenario.backgroundImage` → background; `chatBackgrounds` de-duplicated by byte comparison.
- Model settings are preserved under `chat_metadata.byaf_model_settings` (`model, temperature, topK, topP, minP, minPEnabled, repeatPenalty, repeatLastN, by_prompt_template, grammar`) — RPNow maps to its own sampling struct.

### ST validation errors to mirror

`Invalid BYAF manifest` (manifest is not a plain object), `Invalid BYAF file: missing characters array`, `Invalid BYAF file: characters array is empty`, `Invalid BYAF file: missing character path`, `Invalid BYAF file: character is not a valid JSON`. (error catalogue: https://errors.standardbeagle.com/SillyTavern/SillyTavern/invalid-byaf-manifest/, [WEB])

---

## 1.4 JSON card families

### 1.4a RisuAI JSON (`json-v2` / `json-v3` downloads)

RisuRealm serves `png-v2, json-v2, png-v3, json-v3, charx-v3` for characters (**[SPEC]** https://realm.risuai.net/help/api). `json-v3` = a plain CCv3 object → RPNow's V3 path already handles it.

Risu's own extensions live under `data.extensions.risuai` and `data.extensions.depth_prompt` (**[WEB]** `characterCards.ts`, `createBaseV3`). Notable keys RPNow should *preserve but ignore*:

```
extensions.risuai = {
  bias, viewScreen, customScripts[], utilityBot, sdData, backgroundHTML, license,
  triggerscript[], additionalText, virtualscript(DEPRECATED for security), largePortrait,
  lorePlus, inlayViewScreen, newGenData, vits{}, lowLevelAccess,
  defaultVariables, prebuiltAsset* , toggles, moduleNamespace, hideChatIcon, onboarding
}
extensions.depth_prompt = { depth, prompt }     // same shape ST uses
```

Risu writes `character_book.entries[]` with the CCv3 `LorebookEntry` shape **plus** `mode` and `folder`; per-entry `extensions` carries `risu_case_sensitive`, `risu_activationPercent`, `risu_loreCache`. `character_book.extensions` carries `risu_fullWordMatching`; `scan_depth / token_budget / recursive_scanning` map from Risu's `loreSettings`.
Risu's own lore editor field is `lore.key` (comma-separated) and `lore.selective ? lore.secondkey` — same comma convention as ST.

**Risu `.risup` presets** are a separate format (§2.6 ⚠️).

### 1.4b Agnai / Agnaistic

- Agnai's *native* character JSON is **not** a CC card. **[WEB]** (converter notes at https://charactercardconverter.com/tools/any-to-agnai/) — the mapping table is 1:1 for `name, description (persona), personality, scenario, greeting (first message), example_dialogue`, and legacy `<USER>`/`<BOT>` are rewritten to `{{user}}`/`{{char}}`.
- **Agnai has no lorebook field on the character**; RPNow should, when given an Agnai character, expect lore to be absent (and expect "World Info:" prose spliced into the scenario by third-party converters — do not try to re-parse that).
- Agnai **does** export cards in the CC ecosystem: the portability survey lists Agnai as exporting "V3, some fidelity loss" (**[WEB]** https://pocketanimus.com/guides/ai-character-card-portability/).
- ⚠️ **uncertain**: I did not obtain Agnai's own schema file (`safety@agnai` `types.ts`) in this session. Detection heuristic used above (`identifier` + `members`) is from memory of the schema and must be verified before shipping. **Low priority** — most Agnai content reaching RPNow will be a V2/V3 card anyway.

### 1.4c Character.AI (CAI) exports

- There is **no official CAI export file format**. "CAI export" in the ecosystem means a community converter's output, usually a **plain-text or JSON sheet** with `name`, `greeting`/`first_message`, `description`/`definition`, `example_dialogue`, `persona`/`user_persona` — sometimes the ChatGPT-paste format.
- **[WEB]** Community converters exist (e.g. "CharacterAI to SillyTavern", charactercardconverter.com). Their outputs are V2 JSON.
- **Recommendation:** do not build a CAI-specific parser. Support the *plain-text import* path (§1.8) with label aliases, and treat CAI as "plain text with these labels". ⚠️ If field data shows a specific CLI/community tool's JSON, add a targeted branch then.

### 1.4d JanitorAI

- JanitorAI's creator UI has: name, greeting, personality, scenario, example dialogue, custom/system prompt. Its **public API** (`https://janitorai.com/…`) returns characters as JSON with the bot fields nested under `character` and the user config under `user` ⚠️**uncertain** — I could not fetch a live payload in this session (no authenticated access).
- JanitorAI creators distribute cards as **PNG (V2)** via the community "Janitor Export" tooling, which is the realistic import route.
- **Recommendation:** treat as Card V2 PNG. Add only a *display-name/tag* note if a `janitor`‐namespaced key shows up under `data.extensions`. Low priority, no dedicated parser.

### 1.4e Chub / Venus

- **Chub** (`chub.ai`) serves cards through `POST https://api.chub.ai/api/characters/download` with body `{format: "tavern", fullPath, version: "main"}`, returning **a PNG** (**[WEB]** — this exact call is in RisuAI's `characterURLImport()`; ST's Chub extension does the same via `/api/characters/chub/search` + `download` ⚠️). Format values in the wild: `'tavern'` (PNG V2) and `'json'`.
- ST records provenance in `data.extensions.chub = { full_path }` **[ST-SRC]** `public/scripts/char-data.js:82` — "Non-standard extensions added by external tools: `pygmalion_id`, `github_repo`, `source_url`, `chub: {full_path}`, `risuai: {source[]}`, `sd_character_prompt`".
- **Venus** is Chub's newer API (`api.chub.ai` → Venus), same card payloads.
- **Recommendation:** no dedicated parser; consume PNG/JSON from `download`. Store `extensions.chub.full_path` for attribution/provenance.

### 1.4f Pygmalion `char_name` format (a.k.a. "gradio JSON")

**[ST-SRC]** `src/endpoints/characters.js:929-956`, detected by `jsonData.char_name !== undefined`:

| Pygmalion field | → Card V2 |
|---|---|
| `char_name` | `name` |
| `char_persona` | `description` |
| `char_greeting` | `first_mes` |
| `example_dialogue` | `mes_example` |
| `world_scenario` | `scenario` |
| `creatorcomment ?? creator_notes` | `creator_notes` |
| `talkativeness ?? 0.5` | `extensions.talkativeness` |
| `creator`, `tags` | passthrough |

`personality` and `scenario`(if `world_scenario` missing) are set to `''`/omitted. ST's `char` object also does `chat: jsonData.name + ' - ' + humanizedDateTime()` — a **bug** (uses `jsonData.name`, which is `undefined` here); replicate the *intent* (`char_name`) not the bug.

Also present in the wild: `example_dialogue` blocks delimited by `<START>`; ST does not re-normalise them, so RPNow should prepend `<START>\n` if missing (same rule as `parseMesExamples`, see §3.9).

### 1.4g TavernAI V1

- Exactly the six V1 fields plus ST's informal extras. Three detection signals:
  1. `spec` absent, `name` + `first_mes` present.
  2. ST's V1 branch also reads `creatorcomment` and writes it to `creator_notes` **[ST-SRC]** `characters.js:913`.
  3. `talkativeness` is often a **string** (`"0.5"`) — **[WEB]** RisuAI's `OldTavernChar` type literally declares `talkativeness: "0.5"`. Coerce with `Number()`.
- Some TavernAI-era files are **`.json` with a `data` wrapper but no `spec`**; ST's `readFromV2` handles that by trusting `data.*` and warning on mismatch with the top-level V1 mirror **[ST-SRC]** `characters.js:504-557`. Field mapping used by ST (`fieldMappings`): `name→name`, `description→description`, `personality→personality`, `scenario→scenario`, `first_mes→first_mes`, `mes_example→mes_example`, `talkativeness→extensions.talkativeness`(default 0.5), `fav→extensions.fav`(default false), `tags→tags`.
- **Important:** on import ST keeps BOTH the mirror (top-level V1 fields) and `data.*` in the file, and when they disagree it trusts `data` and logs `has Spec v2 data mismatch with Spec v1 for field: …`. RPNow should do the same and surface a soft warning in the import preview.

---

## 1.7 YAML cards

**[ST-SRC]** `src/endpoints/characters.js:731-755` — the entire feature, parsed with the `yaml` npm package:

```yaml
name: Seraphina          # required
context: |               # → data.description
  ...
greeting: |              # → data.first_mes
  ...
```

Only **three** keys are read: `name`, `context`, `greeting`. Everything else (`personality`, `mes_example`, `scenario`, `creator_notes`, `tags`) is hard-set to empty. ST accepts `.yaml` and `.yml` (same function, `formatImportFunctions`).

**RPNow should exceed ST here** (cheap win, no compatibility risk):

| YAML key | alias(es) to accept | → Card V2 |
|---|---|---|
| `name` | `char_name`, `character_name`, `display_name` | `data.name` |
| `description` | `context`, `persona`, `char_persona`, `definition` | `data.description` |
| `personality` | `traits` | `data.personality` |
| `scenario` | `world_scenario`, `setting` | `data.scenario` |
| `greeting` | `first_mes`, `first_message`, `char_greeting`, `opening` | `data.first_mes` |
| `examples` | `mes_example`, `example_dialogue`, `dialogue_examples` | `data.mes_example` |
| `alternate_greetings` | `alternateGreetings` | `data.alternate_greetings[]` |
| `system_prompt` | `system`, `main_prompt` | `data.system_prompt` |
| `post_history_instructions` | `post_history`, `jailbreak`, `ujb` | `data.post_history_instructions` |
| `creator_notes` | `notes`, `creatorcomment`, `comment` | `data.creator_notes` |
| `tags` | `categories` | `data.tags[]` (split on comma if string) |
| `creator` | `author` | `data.creator` |
| `version` | `character_version` | `data.character_version` |
| `lore` / `lorebook` / `world_info` | — | `data.character_book` ⚠️ shape not standardised; accept `[{keys, content}]` or `{entries: […]}` |

Rules: **do not** reuse `context` for both name and description (ST's `context` = description); multi-line values via `|`/`>`; if the top-level object has a `spec:` key it is a JSON-shaped card, not a YAML card. YAML alias/`&anchor` bombs: cap resolved node count ⚠️ (a real DoS vector — the `yaml` package does not do this by default; use its `maxAliasCount` option).

---

## 1.8 Plain-text "character sheet" import

No standard exists; ST has **none** (a `.txt` upload is rejected). RPNow's value-add is a *heuristic, preview-first* sheet parser:

**Accepted shapes**

1. **Labeled blocks** — a line matching `^(Name|Character|Name:)\s*[:：]\s*(.+)$` etc., followed by free text until the next recognised label. Recognise the label table from §1.7 (both English and common non-English labels are worth adding ⚠️).
2. **`<START>`-delimited dialogue** — treat as `mes_example`.
3. **Markdown headings** — `# Name`, `## Description`, `## Personality`, `## Scenario`, `## First Message`, `## Example Dialogue`, `## Lore`/`## World`.
4. **Bracketed/marked prose** — e.g. `[NAME] … [DESCRIPTION] …`.

**Always preview** the extracted mapping for user confirmation; never silently commit. Keep the raw text in `data.extensions.rpnow.raw_text` so nothing is lost. If fewer than two recognised fields are found, fall back to: whole text → `description`, filename (minus extension) → `name`.

---

## 1.9 Cards: field-mapping summary table

| Format | Detect | name | description | personality | scenario | first_mes | mes_example | lorebook | media |
|---|---|---|---|---|---|---|---|---|---|
| V3 JSON/PNG | `spec==='chara_card_v3'` | `data.name` | `data.description` | `data.personality` | `data.scenario` | `data.first_mes` | `data.mes_example` | `data.character_book` | `data.assets` |
| V2 JSON/PNG | `spec==='chara_card_v2'` | `data.name` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | PNG itself |
| V1 | no spec + `name` | `name` | `description` | `personality` | `scenario` | `first_mes` | `mes_example` | — | PNG itself |
| CharX | ZIP + `card.json` | as V3 | | | | | | | `data.assets` + zip |
| BYAF | ZIP + `manifest.json` | `character.name` | `character.persona`* | — | `scenarios[0].narrative`* | `scenarios[0].firstMessages[0].text`* | `exampleMessages[]`* | `loreItems[]` | `images[]`, `backgroundImage` |
| Pygmalion | `char_name` | `char_name` | `char_persona` | — | `world_scenario` | `char_greeting` | `example_dialogue` | — | — |
| YAML | `.yml`/`.yaml` | `name` | `context` | — | — | `greeting` | — | ⚠️ | — |
| Agnai native | `identifier`+`members` ⚠️ | `name` | `persona.description` ⚠️ | `personality` ⚠️ | `scenario` | `greeting` | `sampleChat` ⚠️ | none | — |
| Plain text | fallback | heuristics | | | | | | | — |

`*` = after the Backyard macro rewrite.

---
---

# Part 2 — Chat completion & text completion preset formats

## 2.1 The eight preset families, and where ST stores them

**[ST-SRC]** `src/endpoints/presets.js:16-38` (`getPresetSettingsByAPI`) is the authoritative list. Folder name → the `apiId` string used by the preset manager:

| `apiId` | Folder under `data/<user>/` | Ext | Kind |
|---|---|---|---|
| `openai` | `openAI_Settings/` | `.json` | **Chat Completion preset** (Prompt Manager) |
| `textgenerationwebui` | `textGen_Settings/` | `.json` | **Text Completion preset** (samplers) |
| `kobold`, `koboldhorde` | `koboldAI_Settings/` | `.json` | Kobold sampler preset |
| `novel` | `novelAI_Settings/` | `.json` | NovelAI sampler preset |
| `instruct` | `instruct/` | `.json` | **Instruct template** |
| `context` | `context/` | `.json` | **Context template** (story string) |
| `sysprompt` | `sysprompt/` | `.json` | System prompt preset |
| `reasoning` | `reasoning/` | `.json` | **Reasoning template** |

Shipped defaults live under `default/content/presets/<family>/` and are registered in `default/content/index.json` with types `openai_preset`, `textgen_preset`, `kobold_preset`, `novel_preset`, `instruct`, `context`, `sysprompt`, `reasoning` **[ST-SRC]** (verified by scanning `index.json`: 1 openai, 6 textgen, 6 kobold, 24 novel, 38 instruct, 34 context, 13 sysprompt, 5 reasoning).

**All eight families are plain JSON files.** There is no wrapper, no `spec` field, and no version field. The only self-identifying content is the shape (§2.7).

Encoding/serialisation: `writeFileAtomicSync(path, JSON.stringify(preset, null, 4), 'utf-8')` **[ST-SRC]** `presets.js:56`. 4-space indent, no BOM, UTF-8. RPNow should write the same for round-trip cleanliness (diff-friendly imports/exports).

---

## 2.2 SillyTavern Chat Completion (OpenAI) preset

Read in full: `D:\RPNow\_ref\SillyTavern\default\content\presets\openai\Default.json` (245 lines). The complete field list, grouped:

### 2.2.1 Model & connection

| Field | Default (shipped) | Notes |
|---|---|---|
| `chat_completion_source` | `"openai"` | Provider id. ST's enum covers `openai, claude, windowai, openrouter, ai21, makersuite/vertexai, mistralai, custom, cohere, perplexity, groq, 01ai, nanogpt, deepseek, xai, aimlapi, pollinations, electronhub, moonshot, fireworks, cometapi, azure_openai, zai, chutes, minimax, …` ⚠️ list drifts fast |
| `openai_model` | `"gpt-5.6-terra"` | model id for the OpenAI source |
| `claude_model`, `openrouter_model`, `ai21_model`, `mistralai_model`, `chutes_model`, `minimax_model`, `electronhub_model`, `custom_model`, `google_model`, `vertexai_model` | various | one `*_model` per provider |
| `openrouter_use_fallback`, `openrouter_group_models`, `openrouter_sort_models`, `chutes_sort_models`, `electronhub_sort_models`, `electronhub_group_models` | `false`/`"alphabetically"` | UI-only ordering flags |
| `minimax_endpoint` | `"global"` | |
| `custom_url`, `custom_include_body`, `custom_exclude_body`, `custom_include_headers` | `""` | raw JSON strings merged into the request ⚠️ secrets can leak here |
| `reverse_proxy`, `proxy_password` | `""` | |
| `show_external_models`, `bypass_status_check`, `max_context_unlocked` | `false` | |

### 2.2.2 Samplers

`temperature` 1, `frequency_penalty` 0, `presence_penalty` 0, `top_p` 1, `top_k` 0, `top_a` 0, `min_p` 0, `repetition_penalty` 1, `seed` -1, `n` 1.

### 2.2.3 Context & length

`openai_max_context` 4095, `openai_max_tokens` 300.

### 2.2.4 Behaviour flags

`names_behavior` `0`, `stream_openai` `true`, `use_sysprompt` `false`, `squash_system_messages` `false`, `media_inlining` `true`, `continue_prefill` `false`, `continue_postfix` `" "`, `assistant_prefill` `""`, `assistant_impersonation` `""`.

### 2.2.5 The "utility prompts" (strings, macro-capable)

| Field | Default text |
|---|---|
| `impersonation_prompt` | `[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]` |
| `new_chat_prompt` | `[Start a new Chat]` |
| `new_group_chat_prompt` | `[Start a new group chat. Group members: {{group}}]` |
| `new_example_chat_prompt` | `[Example Chat]` |
| `continue_nudge_prompt` | `[Continue your last message without repeating its original content.]` |
| `group_nudge_prompt` | `[Write the next reply only as {{char}}.]` |
| `send_if_empty` | `""` |
| `bias_preset_selected` | `"Default (none)"` |
| `wi_format` | `"{0}"` — **`{0}` is replaced by the world-info block** |
| `scenario_format` | `"{{scenario}}"` — if non-empty, the scenario is rendered through this template |
| `personality_format` | `"{{personality}}"` — same for personality |

**[ST-SRC]** `openai.js:1368-1371` shows the exact application: `scenario=="" ? raw : substituteParams(scenario_format)`, and same for `personality_format`, `group_nudge_prompt`, `impersonation_prompt`.

### 2.2.6 `prompts[]` — the Prompt Manager entries

Each element is a `Prompt` **[ST-SRC]** `PromptManager.js:80-200`:

```jsonc
{
  "identifier": "main",          // REQUIRED, unique. Stable key used by prompt_order.
  "name": "Main Prompt",         // display only, never sent
  "content": "Write {{char}}'s next reply …",  // macro-capable
  "role": "system",              // "system" | "user" | "assistant"
  "system_prompt": true,         // true for built-ins; blocks overriding by the character
  "marker": false,               // true = placeholder; content is runtime-generated & not editable
  "injection_position": 0,       // 0 = RELATIVE (drag order), 1 = ABSOLUTE (in-chat by depth)
  "injection_depth": 4,          // only when injection_position === 1
  "injection_order": 100,        // tie-break among same depth+role; LOWER = earlier in prompt
  "forbid_overrides": false,     // character cannot override this prompt (protected entries)
  "extension": false,            // injected by an extension, not the user
  "injection_trigger": []        // generation types this prompt applies to; [] = all
}
```

Enum values, **[ST-SRC]**:

```js
// PromptManager.js:37-40
export const INJECTION_POSITION = { RELATIVE: 0, ABSOLUTE: 1 };
// PromptManager.js:31-32
const DEFAULT_DEPTH = 4;
const DEFAULT_ORDER = 100;
```

Depth semantics **[ST-DOC]**-derived + **[ST-SRC]** `openai.js` `populationInjectionPrompts`:

```
injection_depth = 0 → inserted AFTER the newest message (end of chat)  ⚠️ counter-intuitive
injection_depth = 1 → inserted BEFORE the newest message
injection_depth = N → inserted before the N-th message from the end
if N > message count → placed most-early (lowest priority)
```

`injection_trigger` values **[ST-DOC]**: `"normal"`, `"continue"`, `"impersonate"`, `"swipe"`, `"regenerate"`, `"quiet"`. **Empty array = all types** (not "none") — a classic misread.

The 12 built-in identifiers and their types **[ST-SRC]** `PromptManager.js:2001-2085` (`chatCompletionDefaultPrompts`):

| identifier | name | `system_prompt` | `marker` | default role |
|---|---|---|---|---|
| `main` | Main Prompt | true | false | system |
| `nsfw` | Auxiliary Prompt | true | false | system |
| `dialogueExamples` | Chat Examples | true | **true** | — |
| `jailbreak` | Post-History Instructions | true | false | system |
| `chatHistory` | Chat History | true | **true** | — |
| `worldInfoAfter` | World Info (after) | true | **true** | — |
| `worldInfoBefore` | World Info (before) | true | **true** | — |
| `enhanceDefinitions` | Enhance Definitions | true | false | system |
| `charDescription` | Char Description | true | **true** | — |
| `charPersonality` | Char Personality | true | **true** | — |
| `scenario` | Scenario | true | **true** | — |
| `personaDescription` | Persona Description | true | **true** | — |

⚠️ **Note the naming trap**: `jailbreak` *is* Post-History Instructions; `nsfw` *is* the Auxiliary Prompt. Do not rename on import.

### 2.2.7 `prompt_order[]` — and what `character_id` 100000 vs 100001 means

```jsonc
"prompt_order": [
  { "character_id": 100000, "order": [ {"identifier":"main","enabled":true}, … ] },
  { "character_id": 100001, "order": [ … ] }
]
```

**Definition [ST-SRC]:**

```js
// PromptManager.js:334-337 (base class default)
promptOrder: { strategy: 'global', dummyId: 100000 },
// openai.js:696-699 (Chat Completion overrides it)
promptOrder: { strategy: 'global', dummyId: 100001 },
```

and lookup is **exact string match on `character.id`**:

```js
// PromptManager.js:1207-1209
getPromptOrderForCharacter(character) {
    return !character ? [] : (this.serviceSettings.prompt_order.find(list => String(list.character_id) === String(character.id))?.order ?? []);
}
```

- `strategy: 'global'` means **there is no per-character list**; the "character" used for lookup is the synthetic dummy `{ id: dummyId }`.
- **`100001`** = the **Chat Completion** Prompt Manager's global bucket (openai.js).
- **`100000`** = the base/`PromptManager` default dummy id — i.e. the global bucket for *any other* PromptManager instance (e.g. the NanoGPT/novel or other managers built on the base class) ⚠️uncertain for non-`openai` managers since 1.19 refactors.
- Practically, **for `.json` files in `openAI_Settings/`: `100001` is the one that applies.** `100000` is present in the shipped file as a legacy/duplicate order list (note: in `Default.json`, `100000` lacks `personaDescription`, `100001` includes it — confirming they are separate buckets).
- Numbers ≥ 100000 are reserved sentinels; real character ids are small integers (the character's index). When a user "restores default order", ST writes back to the dummy id.

**Import rule for RPNow:** read `prompt_order` → find the entry with `character_id === 100001`; if absent, fall back to `100000`; if both absent, use the first entry; if `prompt_order` is empty/missing, materialise the default order (below). Keep any extra per-character buckets in `extensions` so they round-trip.

Default order (shipped `Default.json`, `character_id: 100001`):

```
main → worldInfoBefore → personaDescription → charDescription → charPersonality →
scenario → enhanceDefinitions(disabled) → nsfw → worldInfoAfter →
dialogueExamples → chatHistory → jailbreak
```

### 2.2.8 Repair rules ST applies on load **[ST-SRC]** `PromptManager.js:1006-1057`

RPNow must replicate these or imported presets will break:

1. `prompts ??= []`, `prompt_order ??= []`.
2. If `prompt_order` has no entry for the dummy id → `addPromptOrderForCharacter(dummy, promptManagerDefaultPromptOrder)`.
3. If `prompts.length === 0` → replace with `chatCompletionDefaultPrompts.prompts`.
4. Else `checkForMissingPrompts`: **any missing built-in identifier is appended from `chatCompletionDefaultPrompts`** (log: `Missing system prompt: X. Added default.`).
5. Any prompt without an `identifier` gets a UUIDv4.
6. Orphaned order entries (identifier not in `prompts`) are **spliced out**.
7. Legacy migration (`PromptManager.js:45-75`): if `main_prompt` / `nsfw_prompt` / `jailbreak_prompt` exist at top level, copy into `main` / `nsfw` / `jailbreak` and delete the legacy keys.

---

## 2.3 SillyTavern Text Completion preset

Read: `default/content/presets/textgen/Default.json`. ~66 scalar fields, plus arrays. Grouping:

| Group | Fields (shipped default in parens) |
|---|---|
| core samplers | `temp` (1), `top_p` (0.95), `top_k` (0), `top_a` (0), `min_p` (0.01), `typ_p`→`typical_p` (1), `tfs` (1), `epsilon_cutoff` (0), `eta_cutoff` (0), `skew` (0) |
| penalties | `rep_pen` (1.1), `rep_pen_range` (0), `rep_pen_decay` (0), `rep_pen_slope` (1), `no_repeat_ngram_size` (0), `penalty_alpha` (0), `freq_pen` (0), `presence_pen` (0), `encoder_rep_pen` (1) |
| DRY | `dry_allowed_length` (2), `dry_multiplier` (0), `dry_base` (1.75), `dry_sequence_breakers` (`"[\"\\n\", \":\", \"\\\"\", \"*\"]"` — **a JSON string, not an array**), `dry_penalty_last_n` (0) |
| XTC | `xtc_threshold` (0.1), `xtc_probability` (0) |
| dynatemp | `dynatemp` (false), `min_temp` (0), `max_temp` (2), `dynatemp_exponent` (1), `temperature_last` (true) |
| smoothing | `smoothing_factor` (0), `smoothing_curve` (1) |
| beams / length | `num_beams` (1), `length_penalty` (1), `min_length` (0), `early_stopping` (false), `do_sample` (true) |
| tokeniser / specials | `add_bos_token` (true), `ban_eos_token` (false), `ignore_eos_token` (false), `skip_special_tokens` (true), `spaces_between_special_tokens` (true) |
| mirostat | `mirostat_mode` (0), `mirostat_tau` (5), `mirostat_eta` (0.1) |
| constrained gen | `guidance_scale` (1), `negative_prompt` (""), `grammar_string` (""), `json_schema` (null), `json_schema_allow_empty` (false), `banned_tokens` (""), `logit_bias` ([]) |
| sampler ordering | `sampler_order` (`[6,0,1,3,4,2,5]` — **koboldcpp order ints**), `samplers` (`["penalties","dry","top_n_sigma","top_k","typ_p","tfs_z","typical_p","xtc","top_p","min_p","temperature"]` — **llama.cpp names**), `samplers_priorities` (kebab-ish names), `sampler_priority` (snake_case names), `nsigma` (0), `min_keep` (0), `rep_pen_size` (0), `speculative_ngram` (false) ⚠️ — **four parallel sampler-order lists exist for different backends**; do not "unify" them on import, preserve verbatim. |
| misc | `dry_sequence_breakers` string form above |

⚠️ **Version note:** in ST 1.14 this file was `default/content/presets/samplers/*.json` named `Default.json`, `Deterministic.json`, … and the family was often called "samplers"; in 1.19 the folder is `textgen/` and the `apiId` is `textgenerationwebui`. Accept both paths.

---

## 2.4 SillyTavern Context template

Read: `default/content/presets/context/Default.json`, `OldDefault.json`, `Story.json`, `ChatML.json`, `Llama 2 Chat.json`.

Complete field list (all present in every shipped context preset):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `story_string` | string | see below | **Handlebars** template assembled from card/persona/世界书 blocks |
| `example_separator` | string | `***` | replaces the `<START>` marker between example blocks (text-completion only) |
| `chat_start` | string | `***` | inserted after the story string, before the first message |
| `use_stop_strings` | bool | `false` | adds `example_separator`/`chat_start` to stop strings |
| `names_as_stop_strings` | bool | `true` | adds `{{user}}`/`{{char}}` names to stop strings |
| `story_string_position` | int | `0` | enum `extension_prompt_types`: `-1 NONE, 0 IN_PROMPT, 1 IN_CHAT, 2 BEFORE_PROMPT` **[ST-SRC]** `script.js:484-489` |
| `story_string_depth` | int | `1` | only relevant when position is `IN_CHAT` |
| `story_string_role` | int | `0` | `extension_prompt_roles`: `0 SYSTEM, 1 USER, 2 ASSISTANT` **[ST-SRC]** `script.js:494-498` |
| `always_force_name2` | bool | `true` | ⚠️ present in shipped files but **not in `power_user.context`'s typed defaults** in `power-user.js:247-257` — legacy field, preserve and ignore |
| `trim_sentences` | bool | `false` | |
| `single_line` | bool | `false` | |
| `name` | string | preset name | RPNow should treat as `title` |

**`story_string` handlebars variables** — the *exact* set ST exposes (`Default.json`, and `OldDefault.json` for a decorated variant):

```
{{anchorBefore}}  {{system}}  {{wiBefore}}  {{description}}  {{personality}}
{{scenario}}      {{wiAfter}} {{persona}}   {{anchorAfter}}   {{trim}}  {{char}} {{user}}
```

Canonical `Default.json` story string (verbatim, escaped for markdown):

```
{{#if anchorBefore}}{{anchorBefore}}\n{{/if}}{{#if system}}{{system}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{personality}}\n{{/if}}{{#if scenario}}{{scenario}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}{{#if anchorAfter}}{{anchorAfter}}\n{{/if}}{{trim}}
```

`OldDefault.json` shows the "decorated" style builders use:

```
{{#if personality}}{{char}}'s personality: {{personality}}\n{{/if}}
{{#if scenario}}Circumstances and context of the dialogue: {{scenario}}\n{{/if}}
example_separator: "This is how {{char}} should talk"
chat_start: "\nThen the roleplay chat between {{user}} and {{char}} begins.\n"
```

**Implementation warning:** `story_string` is **Handlebars, not the ST macro engine**. ST registers two helpers before compiling **[ST-SRC]** `macros.js:21-25`:

```js
Handlebars.registerHelper('trim', () => '{{trim}}');   // leaves the literal marker for later macro pass
Handlebars.registerHelper('helperMissing', function () {
    const macroName = arguments[arguments.length - 1].name;
    return substituteParams(`{{${macroName}}}`);       // unknown handlebars var → falls through to macro engine
});
```

and it compiles "with no HTML escaping" **[ST-SRC]** `power-user.js:2244`. RPNow must use a real Handlebars implementation (or an equivalent) with `noEscape: true`, `#if` truthiness = Handlebars truthiness, plus a `helperMissing` equivalent that delegates to the macro engine (§3). A naive regex substitution will corrupt real templates.

⚠️ `story_string_position`/`depth`/`role` are meaningless for Chat Completion — but ST persists them in the *context* preset regardless. Preserve on round-trip.

---

## 2.5 SillyTavern Instruct template

Read: `default/content/presets/instruct/ChatML.json`, `Llama 2 Chat.json`, `simple-proxy-for-tavern.json`, `Alpaca-Single-Turn.json`.

Complete field list, with type and semantics (semantics cross-checked against `instruct-mode.js:387-457` `formatInstructModeChat` and `:478-502` `formatInstructModeStoryString`):

| Field | Type | Example (ChatML) | Applied to | Notes |
|---|---|---|---|---|
| `input_sequence` | string | `<|im_start|>user` | user turns **prefix** | narrative/system turns use `system_sequence` when `system_same_as_user === false` |
| `input_suffix` | string | `<|im_end|>\n` | user turns **suffix** | |
| `first_input_sequence` | string | `""` | first user turn prefix | falls back to `input_sequence` |
| `last_input_sequence` | string | `""` | last (current) user turn prefix | falls back to `input_sequence` |
| `output_sequence` | string | `<|im_start|>assistant` | character turns prefix | |
| `output_suffix` | string | `<|im_end|>\n` | character turns suffix | |
| `first_output_sequence` | string | `""` | first character turn prefix | falls back to `output_sequence`; `Alpaca-Single-Turn` uses `<START OF CHAT>` |
| `last_output_sequence` | string | `""` | **the generation prompt** prefix | falls back to `output_sequence` |
| `system_sequence` | string | `<|im_start|>system` | narrator/system turns prefix | |
| `system_suffix` | string | `<|im_end|>\n` | system suffix | |
| `last_system_sequence` | string | `""` | quiet-generation system prefix | |
| `system_same_as_user` | bool | `false` | — | if `true`, system turns reuse `input_sequence`/`input_suffix` (Llama 2 sets `true`) |
| `stop_sequence` | string | `<|im_end|>` | generation stop | |
| `wrap` | bool | `true` | — | when `true`, prefix and text are joined with `"\n"`; if `suffix === '' && wrap` then `suffix = "\n"` |
| `macro` | bool | `true` | — | whether `substituteParams()` runs over the sequences (and `{{name}}` is replaced) |
| `names_behavior` | string | `"force"` | — | `"none" \| "force" \| "always"` **[ST-SRC]** `instruct-mode.js:17-21` |
| `activation_regex` | string | `""` | — | regex matched against the model name to auto-activate this template |
| `skip_examples` | bool | `false` | — | |
| `sequences_as_stop_strings` | bool | `true` | — | |
| `user_alignment_message` | string | `""` | — | inserted when the backend requires user-first turns (Llama 2 has a real sentence here) |
| `story_string_prefix` | string | `<|im_start|>system` | wraps the **story string** | only applied when `story_string_position !== IN_CHAT` |
| `story_string_suffix` | string | `<|im_end|>\n` | wraps the story string | |
| `name` | string | `"ChatML"` | — | preset name |

**Instruct-specific macro `{{name}}`** — replaced with the *speaking message's* name (or `"System"`), after `substituteParams()` **[ST-SRC]** `instruct-mode.js:438-444`. `simple-proxy-for-tavern.json` is the canonical user (`#### {{name}}:`).

**Assembly rule, verbatim logic** (`formatInstructModeChat`, simplified):

```
prefix = (user ? input_sequence : output_sequence)  [with FIRST/LAST overrides]
suffix = (user ? input_suffix   : output_suffix)
if (macro) { prefix = substituteParams(prefix); prefix = prefix.replace(/\{\{name\}\}/gi, name||'System'); same for suffix }
if (!suffix && wrap) suffix = '\n'
separator = wrap ? '\n' : ''
includeNames = names_behavior === 'always' || (names_behavior === 'force' && group/multi-speaker)
out = [prefix, (includeNames && name ? `${name}: ${mes}` : mes) + suffix].filter(Boolean).join(separator)
```

`{{user}}`/`{{char}}` inside sequences resolve through the normal macro engine with `name1Override`/`name2Override` set to the current user/char.

Legacy/derived aliases to accept on import ⚠️: `separator_sequence` (deprecated → `output_suffix`), `system_sequence_suffix` (some third-party templates), `names` (`"never"|"always"|"groups_and_personas"` from old docs → map `never→none`, `always→always`, `groups_and_personas→force`).

---

## 2.6 SillyTavern Reasoning template

Read all five: `default/content/presets/reasoning/{Blank,DeepSeek,Think XML,OpenAI Harmony,Gemma 4}.json`.

**The shipped format has exactly four string fields:**

```json
{ "name": "DeepSeek", "prefix": "<think>\n", "suffix": "\n</think>", "separator": "\n\n" }
```

| Preset | prefix | suffix | separator |
|---|---|---|---|
| Blank | `""` | `""` | `""` |
| DeepSeek | `"<think>\n"` | `"\n</think>"` | `"\n\n"` |
| Think XML | `"<think>"` | `"</think>"` | `"\n"` |
| OpenAI Harmony | `"<\|start\|>assistant<\|channel\|>analysis<\|message\|>"` | `"<\|start\|>assistant<\|channel\|>final<\|message\|>"` | `""` |
| Gemma 4 | (`<|channel>thought` style) | | |

**⚠️ `suffix_parsed` does not exist in ST 1.19.** Grepping the whole `public/` tree for `suffix_parsed` / `prefix_parsed` returns **zero** hits. The four-field shape above is the reality. If an older briefing mentioned `prefix_parsed`/`suffix_parsed`, those were mid-1.14 development names and were removed ⚠️uncertain exactly which release.

**Semantics [ST-SRC]** `reasoning.js`:

- Formatting (`PromptReasoning.getReasoningFromMessage`-adjacent, `:759-784`): output = `prefix + reasoningText + suffix + separator + content`.
- Parsing (`:1464-1470`): requires **both** `prefix` and `suffix`; regex built as
  ```js
  new RegExp(`${strict ? '^\\s*?' : ''}${escapeRegex(prefix)}(.*?)${escapeRegex(suffix)}`, 's')
  ```
  → i.e. `prefix … suffix`, lazy, dot-all; with `strict` anchoring to the start after optional whitespace.
- Stream state machine (`:483-520`): if the target `startsWith(prefix)` → enter reasoning mode; the first `suffix` encountered ends the reasoning block and everything after is normal content.
- All three strings pass through `substituteParams()` at use time, so **macros are allowed in reasoning templates**.

**RPNow field mapping:** `prefix → reasoning.prefix`, `suffix → reasoning.suffix`, `separator → reasoning.separator`, `name → title`. Store in `extensions` immediately-adjacent UI-only flags ST keeps in `power_user.reasoning` but not in the preset file: `auto_parse`, `add_to_prompts`, `auto_expand`, `show_hidden`, `max_additions` **[ST-SRC]** `power-user.js:274-284`.

### 2.6b Risu `.risup` preset (⚠️ low confidence)

`.risup` / `.risupreset` are RisuAI presets. **[WEB]** Risu Realtime API calls them `preset-risu-v1` and offers a separate `preset-st-chat` format, implying two distinct JSON schemas. I could not retrieve Risu's preset type definitions in this session (raw.githubusercontent 503, DeepWiki 429). **Recommendation: v1 does not import `.risup`.** Detect by extension, show "RisuAI presets not yet supported", and keep the file. Do not guess at field names.

### 2.6c System prompt preset (for completeness)

`default/content/presets/sysprompt/*.json`: `{ "name": string, "content": string, "post_history": string }` (verified in 13 files, e.g. `Blank.json`). Trivial to support — 3 fields, same shape as the card's `system_prompt`/`post_history_instructions` pair.

### 2.6d Kobold / NovelAI sampler presets

`kobold/Neutral.json` shape: `{temp, rep_pen, rep_pen_range, top_p, min_p, top_a, top_k, typical, tfs, rep_pen_slope, sampler_order[7], mirostat, mirostat_tau, mirostat_eta, use_default_badwordsids, grammar}`. Novel presets are per-model (`Erato-*`, `Clio-*`, `Kayra-*`) — ⚠️ low priority, RPNow won't target those backends.

---

## 2.7 Detecting preset type from a JSON file's shape — the "import any preset" algorithm

Because every family is a bare JSON object, detection is purely structural. **Run these tests in this exact order** — each is chosen so that no valid preset of another family can trigger it.

```
score = {}

# --- Chat Completion (OpenAI) preset -------------------------------------
if Array.isArray(o.prompts) && o.prompts.every(p => p && typeof p === 'object'):
    score['openai'] += 100
if Array.isArray(o.prompt_order):
    score['openai'] += 60
if 'chat_completion_source' in o:
    score['openai'] += 50
if 'openai_model' in o or 'claude_model' in o or 'openrouter_model' in o:
    score['openai'] += 40
if 'openai_max_context' in o and 'openai_max_tokens' in o:
    score['openai'] += 30
if 'wi_format' in o or 'scenario_format' in o or 'personality_format' in o:
    score['openai'] += 20
if 'prompts' in o and o.prompts.some(p => 'identifier' in p):
    score['openai'] += 40          # the single strongest signal

# --- Text Completion (samplers) preset -----------------------------------
if 'sampler_order' in o:
    score['textgen'] += 80         # also true for kobold presets → disambiguate below
if 'rep_pen' in o and 'rep_pen_range' in o:
    score['textgen'] += 40
if 'dry_multiplier' in o or 'dry_sequence_breakers' in o:
    score['textgen'] += 50         # DRY is unique to modern textgen
if 'temperature_last' in o or 'xtc_probability' in o or 'dynatemp' in o:
    score['textgen'] += 40
if 'grammar_string' in o and 'json_schema' in o:
    score['textgen'] += 30         # kobold uses 'grammar', textgen uses 'grammar_string'
if 'samplers' in o or 'samplers_priorities' in o or 'sampler_priority' in o:
    score['textgen'] += 30

# --- Context template ----------------------------------------------------
if typeof o.story_string === 'string':
    score['context'] += 100        # unique, unambiguous
if 'example_separator' in o or 'chat_start' in o:
    score['context'] += 60
if 'story_string_position' in o or 'story_string_depth' in o or 'story_string_role' in o:
    score['context'] += 40
if 'always_force_name2' in o:
    score['context'] += 30

# --- Instruct template ---------------------------------------------------
if 'input_sequence' in o and 'output_sequence' in o:
    score['instruct'] += 100       # unique pair
if 'story_string_prefix' in o or 'story_string_suffix' in o:
    score['instruct'] += 40
if 'names_behavior' in o or 'input_suffix' in o or 'output_suffix' in o:
    score['instruct'] += 30
if 'wrap' in o or 'activation_regex' in o or 'skip_examples' in o:
    score['instruct'] += 20

# --- Reasoning template --------------------------------------------------
if 'prefix' in o and 'suffix' in o and 'separator' in o:
    score['reasoning'] += 100      # tiny 4-field shape; require all three
if Object.keys(o).length <= 6 and 'prefix' in o:
    score['reasoning'] += 30

# --- System prompt -------------------------------------------------------
if typeof o.content === 'string' and 'post_history' in o:
    score['sysprompt'] += 100
if typeof o.content === 'string' and Object.keys(o).length <= 4:
    score['sysprompt'] += 20

# --- Kobold vs textgen (both have sampler_order) -------------------------
if score.get('textgen') and 'dry_multiplier' not in o and 'typical' in o and 'mirostat' in o:
    score['kobold'] += 80          # kobold uses scalar 'mirostat' 0..2 and 'typical'
if score.get('textgen') and 'use_default_badwordsids' in o:
    score['kobold'] += 80
```

**Disambiguation notes (these are the real-world traps):**

| Collision | Resolution |
|---|---|
| `instruct` vs `context` | `context` almost always carries `story_string`; `instruct` almost always carries `story_string_prefix`. Check `story_string` first. |
| `instruct` vs `sysprompt` | `sysprompt` has no `input_sequence`; `content` + `post_history` is unique to sysprompt. |
| `reasoning` vs `sysprompt` | `separator` + no `content` → reasoning. `content` → sysprompt. |
| `textgen` vs `kobold` | `sampler_order` is in both. `dry_multiplier`, `xtc_probability`, `dynatemp`, `json_schema`, `grammar_string`, `samplers` are **textgen-only**; `typical` (scalar) and `use_default_badwordsids`/`grammar` are **kobold-only**. |
| `textgen` vs `novel` | Novel presets are much larger and carry `order`/`repetition_penalty_frequency` etc. ⚠️ not verified in this session. |
| `openai` vs everything | `prompts[]` + `prompt_order[]` never co-occur in another family. |

**Additional structural hints worth using:**

- **Filename**: ST export writes `<PresetName>.json` (`preset-manager.js:1098`); third-party packs often keep the folder name (`openai/`, `instruct/`, `context/`, `reasoning/`, `sysprompt/`, `textgen/`). Use as a *tiebreak only*.
- **Field-count priors**: `reasoning` ≤ 6 keys; `sysprompt` ≤ 4 keys; `context` ≈ 12 keys; `instruct` ≈ 25 keys; `openai` ≈ 45–60 keys; `textgen` ≈ 66 keys.
- **Multi-preset bundles**: RisuRisu / community packs sometimes ship a `.json` array or `{presets: [...]}`; if the top-level is an **array**, classify each element and offer multi-import ⚠️uncertain (no official ST format does this).
- **Ambiguity handling**: if the top score is < 100 or two families are within 30 points, **ask the user which kind it is** and show the raw key list. Never guess silently — applying a context template as an instruct template silently wrecks prompts.

**Then validate per family** (reject-with-reason rather than crash):

| Family | Hard requirements after classification |
|---|---|
| openai | `prompts` array of objects; each has a unique non-empty `identifier`; `role` ∈ {system,user,assistant}; `injection_position` ∈ {0,1}; `injection_depth` ≥ 0; `injection_order` number |
| textgen | all numeric fields coerce via `Number()`; `dry_sequence_breakers` stays a **string**; sampler arrays preserved verbatim |
| context | `story_string` must compile under Handlebars; unknown handlebars identifiers must be tolerated (they fall through to macros) |
| instruct | at least one of `input_sequence`/`output_sequence` non-empty, else the template cannot produce anything |
| reasoning | non-empty `prefix` **and** `suffix`, else ST itself refuses to use it (`reasoning.js:1015-1016, 1464-1465`) |
| sysprompt | `content` string |

---
---

# Part 3 — Macro / substitution system

Two engines coexist in ST 1.19 **[ST-SRC]**:

- **Legacy** (`public/scripts/macros.js`, `evaluateMacros()`), used when `power_user.experimental_macro_engine === false`.
- **New "Experimental Macro Engine"** (`public/scripts/macros/engine/*` + `definitions/*`), **enabled by default** in 1.19 (`power-user.js:302` → `experimental_macro_engine: true`).

The new engine is a Chevrotain-based lexer/parser/CST-walker with a registry, type checking, scoping, nesting and flags. RPNow **should implement the new engine's semantics** (that is what cards are written against today) while keeping the legacy regex behaviours as fallbacks for the odd macro that only the legacy engine handled.

## 3.1 Syntax rules (new engine)

**[ST-SRC]** `MacroLexer.js`, **[ST-DOC]** https://docs.sillytavern.app/usage/core-concepts/macros/

- Delimiters `{{` … `}}`; **names are case-insensitive** (`{{User}}` = `{{user}}`).
- Identifier pattern: `/^[a-zA-Z][\w-_]*$/` (`MacroLexer.js:17`).
- Argument separators: `::` (canonical multi-arg), `:` (legacy single), space (single-arg form; `{{getvar myvar}}`), and `=` (assignment form used by variable shorthands).
- Whitespace anywhere between name/separators/args is ignored: `{{ setvar :: k :: v }}` ≡ `{{setvar::k::v}}`.
- **Nesting**: inner macros resolve first — `{{getvar::{{char}}_mood}}` → `{{getvar::Alice_mood}}`.
- **Escaping**: `\{\{notAMacro\}\}` renders literal `{{notAMacro}}` **[ST-DOC]**.
- **Variable shorthands**: `{{.localVar}}` and `{{$globalVar}}`, with operators `=`, `++`, `--`, `+=`, `-=`, `||`, `??`, `||=`, `??=`, `==`, `!=`, `>`, `>=`, `<`, `<=`. Ordinary identifier naming rules, last char may not be `_`/`-` (`MacroLexer.js:20-24`).
- **Scoped macros**: any macro with ≥1 arg can take its last arg as scoped body `{{macro arg}} body {{/macro}}`; closing tag uses the `/` flag. Scoped content is **auto-trimmed and de-dented** unless the `#` flag is used.
- **Macro flags** (`MacroFlags.js`): `/` closing block — **implemented**; `#` preserve whitespace — **implemented**; `!` immediate, `?` delayed, `~` re-evaluate, `>` filter — **parsed but NOT implemented** in v1 (documented as such in `MacroFlagDefinitions`, `implemented: false`).
- Legacy angle-bracket forms are rewritten **before** the macro pass (§3.8).

## 3.2 Names & participants
**[ST-SRC]** `definitions/env-macros.js`

| Macro | Returns | Notes |
|---|---|---|
| `{{char}}` | character name | overridden per-message via `name2Override` |
| `{{user}}` | persona/user name | `name1Override` |
| `{{group}}` | comma-separated group member names (**including muted**) — or the char name in a solo chat | alias of `{{charIfNotGroup}}` |
| `{{charIfNotGroup}}` | **alias of `group`** | ⚠️ **correction to common belief**: in the *new* engine `charIfNotGroup` is a *hidden alias of `group`*, so in a solo chat it yields the char name (matching the docs' "character name in solo chats"). The legacy engine also mapped both to `env.group`. **Do not implement "empty in groups".** |
| `{{groupNotMuted}}` | group members excluding muted | |
| `{{notChar}}` | all participants except the current speaker | |

## 3.3 Character card & persona
**[ST-SRC]** `env-macros.js`

| Macro | Alias(es) | Returns |
|---|---|---|
| `{{description}}` | `{{charDescription}}` | `data.description` |
| `{{personality}}` | `{{charPersonality}}` | `data.personality` |
| `{{scenario}}` | `{{charScenario}}` | `data.scenario` |
| `{{persona}}` | — | user persona description |
| `{{mesExamplesRaw}}` | — | raw `data.mes_example` |
| `{{mesExamples}}` | — | examples **formatted for instruct** when instruct is on and API ≠ chat-completion; else `parseMesExamples()` joined |
| `{{charPrompt}}` | — | `data.system_prompt` |
| `{{charInstruction}}` | — | `data.post_history_instructions` |
| `{{charDepthPrompt}}` | — | `data.extensions.depth_prompt.prompt` |
| `{{charCreatorNotes}}` | `{{creatorNotes}}` | `data.creator_notes` |
| `{{charFirstMessage}}` | `{{greeting}}` | greeting at index; `0` = first message, `1..` = `alternate_greetings[i-1]` |
| `{{charVersion}}` | `{{version}}`(hidden), `{{char_version}}`(hidden) | `data.character_version` |
| `{{original}}` | — | the *global* prompt this field would otherwise have replaced (only meaningful inside `system_prompt`/`post_history_instructions`) **[SPEC]** V2 spec mandates this |

⚠️ `{{mesExamples}}` differs subtly between engines but both go through `parseMesExamples` — see §3.9.

## 3.4 Chat state
**[ST-SRC]** `definitions/chat-macros.js`

| Macro | Semantics |
|---|---|
| `{{lastMessage}}` | text of the last message (skipping a message currently being swiped) |
| `{{lastMessageId}}` | **index** of that message, `''` if chat empty |
| `{{lastUserMessage}}` | last non-system `is_user` message |
| `{{lastCharMessage}}` | last non-system non-user message |
| `{{firstIncludedMessageId}}` | `chat_metadata.lastInContextMessageId` |
| `{{firstDisplayedMessageId}}` | `mesid` of the first `#chat .mes` element (UI-dependent) |
| `{{lastSwipeId}}` | **1-based count** of swipes on the last message (i.e. `swipes.length`) |
| `{{currentSwipeId}}` | **1-based** `swipe_id + 1` |
| `{{allChatRange}}` | `"0-{len-1}"`, or `''` when empty |

"Currently being swiped" = `message.swipes && message.swipe_id >= message.swipes.length`.

## 3.5 Time & date
**[ST-SRC]** `definitions/time-macros.js` — all via `moment()`

| Macro | Format / behaviour |
|---|---|
| `{{time}}` | `moment().format('LT')` — locale time, e.g. `2:31 PM` |
| `{{time::UTC+2}}` / `{{time::UTC-7}}` | matches `/^UTC([+-]\d+)$/`, else falls back to `LT`; uses `utc().utcOffset(n)` |
| legacy `{{time_UTC+2}}` | same, via `/({{time_UTC([-+]\d+)}})/` in the legacy engine only |
| `{{date}}` | `'LL'` — locale long date |
| `{{weekday}}` | `'dddd'` |
| `{{isotime}}` | `'HH:mm'` |
| `{{isodate}}` | `'YYYY-MM-DD'` |
| `{{datetimeformat::YYYY-MM-DD HH:mm:ss}}` | `moment().format(arg)` — full moment format surface |
| `{{idleDuration}}` / `{{idle_duration}}`(hidden alias) | `moment.duration(now - lastUserMessage.send_date).humanize()`, `'just now'` if unavailable |
| `{{timeDiff::left::right}}` | `moment.duration(moment(left).diff(moment(right))).humanize(true)` — order-insensitive, returns "in 3 hours"/"3 hours ago" |

⚠️ RPNow must pick a locale strategy: ST inherits the browser's moment locale. Document that `{{time}}`/`{{date}}` are **locale-dependent** and default to `en` if overriding is not desired.

## 3.6 Random, dice, and deterministic pick

**[ST-SRC]** `definitions/core-macros.js:303-422`

| Macro | Semantics |
|---|---|
| `{{roll::1d20}}`, `{{roll 1d6}}`, `{{roll::6}}`, `{{roll::3d6+4}}`, `{{roll:1d20}}` | validate with `droll.validate(formula)`; **if the arg is all digits, it is treated as `1d{N}`**; result = `String(result.total)`. Invalid formula → `''` + warning. |
| `{{random::a::b::c}}`, `{{random a,b}}`, `{{random:a::b::c}}` | **re-rolls on every macro resolution**. Legacy list splitting: if the single arg contains `::` split on `::`, else split on `,` after protecting `\,`; items are `.trim()`ed. RNG = `seedrandom('added entropy.', {entropy:true})` → `Math.floor(rng()*list.length)`. |
| `{{pick::a::b::c}}` | **stable** random choice. Seed = `getStringHash([chatIdHash, contentHash, globalOffset, chat_metadata.pick_reroll_seed].filter(nonNull).join('-'))`, then `seedrandom(String(seed))`. `contentHash` = hash of the **entire original input string**; `globalOffset` = the macro's absolute offset in that string, so two identical `{{pick}}`s at different positions give different results. `/reroll-pick` sets `pick_reroll_seed`. |

`getStringHash` is ST's own 32-bit hash (⚠️ RPNow must reimplement it *identically* if cross-app `pick` stability matters; otherwise document that pick values are app-local).

## 3.7 Variables

**[ST-SRC]** `definitions/variable-macros.js` (new engine) + `public/scripts/variables.js:238-260` (legacy regexes)

| Local | Global | Behaviour |
|---|---|---|
| `{{getvar::name}}` | `{{getglobalvar::name}}` | current value (string|number) |
| `{{setvar::name::value}}` | `{{setglobalvar::name::value}}` | set, returns `''`. Legacy regex: `{{setvar::([^:]+)::([^}]*)}}` — **name cannot contain `:`** |
| `{{addvar::name::value}}` | `{{addglobalvar::name::value}}` | numeric add, or string append if either is non-numeric |
| `{{incvar::name}}` | `{{incglobalvar::name}}` | +1, returns new value |
| `{{decvar::name}}` | `{{decglobalvar::name}}` | −1, returns new value |
| `{{hasvar::name}}` (`varexists`) | `{{hasglobalvar::name}}` (`globalvarexists`) | `"true"`/`"false"` |
| `{{deletevar::name}}` (`flushvar`) | `{{deleteglobalvar::name}}` (`flushglobalvar`) | remove, returns `''` |
| `{{setvarkey::name::key::value}}` (`setvarindex`) | `{{setglobalvarkey::…}}` | set object key / array index |
| `{{getvarkey::name::key}}` (`getvarindex`) | `{{getglobalvarkey::…}}` | read key/index |

Shorthand equivalents: `.var` ⇔ local, `$var` ⇔ global (§3.1). Scope: local = per-chat `chat_metadata.variables`; global = per-user.

⚠️ **Security-relevant**: `{{setvar}}` and friends are *side-effecting macros*. A card can write chat variables through its `first_mes` or `post_history_instructions`. RPNow must run macros in a sandbox where variable writes are bound to the chat, and must not let a card touch RPNow settings. Consider a "trusted card" gate, like ST's regex-script gate (§4.2).

## 3.8 Utility, prompt, and state macros

| Macro | Semantics / default |
|---|---|
| `{{newline}}` / `{{newline::N}}` | `'\n'.repeat(N ?? 1)` **[ST-SRC]** `core-macros.js:50-65` |
| `{{space}}` / `{{space::N}}` | `' '.repeat(N ?? 1)` |
| `{{noop}}` | `''` |
| `{{trim}}` | standalone form: marker → the legacy regex `/(?:\r?\n)*{{trim}}(?:\r?\n)*/gi` strips surrounding newlines in post-processing; **scoped** form `{{trim}}…{{/trim}}` returns the content, auto-trimmed |
| `{{// …}}` (alias `{{comment}}`) | `''`; legacy regex `/\{\{\/\/([\s\S]*?)\}\}/gm`; multi-line via `{{//}} … {{///}}` |
| `{{reverse::text}}` | `Array.from(x).reverse().join('')` (**code-point aware**, not UTF-16-unit) |
| `{{input}}` | current value of the send textarea (`''` when not in UI) |
| `{{banned::word}}` | adds to the Text Completion ban list, returns `''`; legacy form `{{banned "word"}}` strips quotes |
| `{{outlet::Name}}` | returns the world-info **outlet** block whose `outlet_name === Name`; `''` if none. Cannot be used inside a WI entry **[ST-DOC]** |
| `{{maxPrompt}}`/`{{maxPromptTokens}}` | context − response tokens |
| `{{maxContext}}`/`{{maxContextTokens}}` | max context |
| `{{maxResponse}}`/`{{maxResponseTokens}}` | max response tokens |
| `{{model}}` | active model id for the selected API |
| `{{isMobile}}` | `"true"`/`"false"` |
| `{{lastGenerationType}}` | `normal`,`swipe`,`continue`,`impersonate`,`quiet`, `regenerate`…; `''` after chat switch |
| `{{hasExtension::name}}` | `"true"`/`"false"` — ST extension presence. **RPNow: always return `"false"`** unless an RPNow equivalent exists. |
| `{{authorsNote}}`, `{{charAuthorsNote}}`, `{{defaultAuthorsNote}}` | Author's Note contents |
| `{{systemPrompt}}`, `{{defaultSystemPrompt}}` | resolved system prompt (char override wins if `prefer_character_prompt`) |
| `{{instructStoryStringPrefix}}`, `{{instructStoryStringSuffix}}`, `{{instructUserPrefix}}`/`{{instructInput}}`, `{{instructUserSuffix}}`, `{{instructAssistantPrefix}}`/`{{instructOutput}}`, `{{instructAssistantSuffix}}`/`{{instructSeparator}}`, `{{instructSystemPrefix}}`, `{{instructSystemSuffix}}`, `{{instructStop}}`, `{{instructUserFiller}}`, `{{instructSystemInstructionPrefix}}`, `{{instructFirstAssistantPrefix}}`/`{{instructFirstOutputPrefix}}`, `{{instructLastAssistantPrefix}}`/`{{instructLastOutputPrefix}}`, `{{instructFirstUserPrefix}}`/`{{instructFirstInput}}`, `{{instructLastUserPrefix}}`/`{{instructLastInput}}` | all `''` when instruct mode is disabled **[ST-SRC]** `instruct-macros.js` |
| `{{exampleSeparator}}`/`{{chatSeparator}}`, `{{chatStart}}` | context-template separators |
| `{{reasoningPrefix}}`, `{{reasoningSuffix}}`, `{{reasoningSeparator}}` | reasoning template strings |
| `{{name}}` | **instruct sequences only** — speaking entity's name, else `"System"` |
| `{{summary}}` | latest summary from the Summarize extension |
| `{{timesIndex}}` | STscript `/times` loop counter (not a general macro) |

## 3.9 Example-block parsing (`<START>`)

**[ST-SRC]** `script.js:3501-3515`:

```js
parseMesExamples(examplesStr, isInstruct) {
  if (!examplesStr || examplesStr === '<START>') return [];
  if (!examplesStr.startsWith('<START>')) examplesStr = '<START>\n' + examplesStr.trim();
  const exampleSeparator = power_user.context.example_separator
      ? `${substituteParams(power_user.context.example_separator)}\n` : '';
  const blockHeading = (main_api === 'openai' || isInstruct) ? '<START>\n' : exampleSeparator;
  return examplesStr.split(/<START>/gi).slice(1).map(b => `${blockHeading}${b.trim()}\n`);
}
```

So: the first block always gets a `\n` inserted if the string didn't start with `<START>`; each block is trimmed and terminated with `\n`; the heading is `<START>` for chat-completion, else `example_separator + '\n'`. Cards use `{{char}}:` / `{{user}}:` prefixes inside blocks; those are plain macro substitutions.

## 3.10 Resolution order (legacy engine, for reference)

**[ST-SRC]** `macros.js:evaluateMacros` — the pipeline is `[...preEnvMacros, ...envMacros, ...postEnvMacros]`, applied as sequential `String.prototype.replace` passes:

1. **pre-env**: `<USER> <BOT> <CHAR> <CHARIFNOTGROUP> <GROUP>` → names; dice roll; instruct macros; variable macros; `{{newline}}`; `{{trim}}`; `{{noop}}`; `{{input}}`.
2. **env** (custom `MacrosParser` registrations + the built-in env object): one regex per key, `{key}` escaped.
3. **post-env**: `maxPrompt*`, `lastMessage*`, `*SwipeId`, `allChatRange`, `reverse:`, `{{//…}}`, time family, `{{time_UTC±n}}`, `{{outlet::}}`, `timeDiff`, `banned`, `random`, `pick`.

⚠️ Because it is sequential `replace`, **double substitution is possible** (a value that itself contains `{{user}}` gets expanded). The new engine fixes this with proper scoping — another reason to implement the new engine's semantics.

## 3.11 RPNow implementation recommendations

1. Tokenise with a real parser (same grammar as `MacroLexer.js`); do **not** build a pile of regexes.
2. Implement *all* of §3.2–§3.8; unknown macros → **leave the literal `{{x}}` untouched** and surface a lint warning in the card/preset editor (ST's `helperMissing` does this for story strings).
3. Implement `{{if}}`/`{{else}}`/`{{/if}}`, scoped macros, flags `/` and `#`, and variable shorthands.
4. Macro resolution must be **pure w.r.t. the prompt** except for variables: cache a resolved snapshot per turn so previews == what is sent.
5. `{{pick}}` determinism requires ST's `getStringHash`; either port it bit-exactly or document divergence.
6. Locale: allow overriding moment locale; document `{{time}}`/`{{date}}` as locale-sensitive.

---
---

# Part 4 — Regex scripts inside cards

## 4.1 The data shape

**[ST-SRC]** `public/scripts/char-data.js:88-102` (`RegexScriptData`) + the editor's write path `extensions/regex/index.js:848-868`:

```jsonc
{
  "id": "uuid-v4",                     // assigned by the editor; importers may omit
  "scriptName": "Strip OOC",
  "findRegex": "/\\[OOC:.*?\\]/gis",   // MUST include slashes + flags
  "replaceString": "",
  "trimStrings": ["..."],              // optional; newline-separated in the UI, array in JSON
  "placement": [2, 5],                 // see enum below  (note: ARRAY)
  "disabled": false,
  "markdownOnly": false,
  "promptOnly": false,
  "runOnEdit": false,
  "substituteRegex": 0,                // 0 NONE | 1 RAW | 2 ESCAPED
  "minDepth": null,                    // null = no lower bound
  "maxDepth": null                     // null = no upper bound
}
```

Where it lives in a card: **`data.extensions.regex_scripts`** — an **array** **[ST-SRC]** `extensions/regex/engine.js:114-120`:

```js
const scopedScripts = characters[this_chid]?.data?.extensions?.regex_scripts;
return Array.isArray(scopedScripts) ? scopedScripts : [];
```

Same array shape is reused for global scripts (`extension_settings.regex`) and for per-preset scripts (`presetManager.readPresetExtensionField({path:'regex_scripts'})`), i.e. **presets** may also carry `regex_scripts`.

## 4.2 The trust gate (do not skip this)

**[ST-SRC]** `extensions/regex/engine.js:108-187`, `index.js:1955-2030`:

- Scoped (card) scripts **are disabled by default**. They run only if the character's avatar is listed in `extension_settings.character_allowed_regex`.
- The UI exposes a per-character toggle `#regex_scoped_toggle`; enabling prompts `Should this character be allowed to run custom regex scripts?`.
- Preset scripts have the same gate: `extension_settings.preset_allowed_regex[apiId].includes(presetName)`.
- Ordering: `SCRIPT_TYPES = { GLOBAL: 0, SCOPED: 1, PRESET: 2 }` but execution is `Object.values(SCRIPT_TYPES).flatMap(...)` → numeric key order → **0, 1, 2** = global → scoped → preset.

**RPNow must have the same model**: card-supplied regex is *powerful* (it rewrites what the model sees, and can be used for prompt injection), so it must be opt-in per card, with a visible banner and a "review the rules" list.

## 4.3 `findRegex` parsing — "must include `/flags`"

**[ST-SRC]** `public/scripts/utils.js:1387-1402`:

```js
export function regexFromString(input) {
    try {
        var m = input.match(/(\/?)(.+)\1([a-z]*)/i);
        if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) {
            return RegExp(input);           // invalid/duplicate flags → treat whole input as pattern
        }
        return new RegExp(m[2], m[3]);
    } catch { return; }                     // → null → script silently skipped
}
```

Consequences RPNow must replicate exactly:

| Input | Result |
|---|---|
| `/foo/gi` | pattern `foo`, flags `gi` |
| `/a\\/b/g` | **breaks**: `(.+)` is greedy, so `\1` backtracks to the last `/` — the trailing `g` lands in group 2 `a\\/b`, group 3 empty ⚠️ trade-off identical to ST |
| `foo` (no slashes) | pattern `foo`, flags `''` |
| `/foo/x` | source is `new RegExp('foo', 'x')` — `x` is not in JS's valid flag set `dgimsuvy`, so the constructor **throws**, the `catch` returns `undefined`, the script is **skipped silently**. Flags outside ST's allowed set therefore kill the script. |
| flags `gg` | duplicates rejected by the lookahead → whole string compiled as a pattern |

So: **the canonical format is `/pattern/flags`**, single literal slashes, no escaping of the delimiters, flags from the set `[gmixXsuUAJ]` minus duplicates. An importer should:
- accept a bare pattern (no slashes) and treat it as `no flags`;
- accept `flags` outside that set by passing them to `RegExp` directly (more forgiving than ST) but **warn**;
- never throw — a bad regex becomes a disabled script with an error shown, not a failed card import.

## 4.4 `placement` enum

**[ST-SRC]** `extensions/regex/engine.js:281-292`:

```js
export const regex_placement = {
    MD_DISPLAY: 0,      // @deprecated - do not use
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    // 4 - sendAs (legacy)
    WORLD_INFO: 5,
    REASONING: 6,
};
```

`placement` is an **array** of these ints. A script runs when `script.placement.includes(currentPlacement)`. Mapping of the current context → placement **[ST-SRC]** `script.js:1833-1848`:

```
isReasoning            → REASONING (6)
isUser                 → USER_INPUT (1)
message.extra.type === 'narrator' → SLASH_COMMAND (3)
otherwise              → AI_OUTPUT (2)
```

World-info content is processed with `WORLD_INFO (5)` when the WI is rendered into the prompt.

## 4.5 `markdownOnly` / `promptOnly` / `substituteRegex`

**[ST-SRC]** `engine.js:347-378` (exact truth table):

```js
if ((script.markdownOnly && isMarkdown) ||
    (script.promptOnly && isPrompt) ||
    (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)) {  → run
```

| `markdownOnly` | `promptOnly` | Effect |
|---|---|---|
| `false` | `false` | **default: applies to the stored text** — it is applied *only* when neither flag is set and the input is neither markdown nor prompt, i.e. to the chat-history source. (In `messageFormatting` the call passes `isMarkdown: true`, so a default script does *not* re-run there.) |
| `true` | `false` | display only: applied when rendering Markdown (`isMarkdown === true`) |
| `false` | `true` | prompt only: applied when building the outgoing prompt (`isPrompt === true`) |
| `true` | `true` | ⚠️ **本行原结论有误，已更正**：判据是 `(markdownOnly && isMarkdown) \|\| (promptOnly && isPrompt) \|\| (...)`（`engine.js:347-355`），因此双标记时只要 `isMarkdown` 或 `isPrompt` 任一为真就会执行，**并非死组合**。真实调用中两者互斥，故效果是「两个通道都会应用」。复核见 `regex-engine.test.ts`。 |

Additional gates:

- `if (isEdit && !script.runOnEdit) return;` — scripts don't apply when the user edits a message unless `runOnEdit`.
- `minDepth` / `maxDepth` compare against the message's **depth from the end**, counting only non-system messages:
  ```js
  depth = usableMessages.length - indexOf(messageId) - 1
  if (minDepth != null && minDepth >= -1 && depth < minDepth) skip
  if (maxDepth != null && maxDepth >= 0 && depth > maxDepth) skip
  ```
- `disabled: true` → skip.
- `substituteRegex`: `0` = use `findRegex` literally; `1` = run `substituteParamsExtended(findRegex)` (macros expanded **raw** into the pattern); `2` = run the same but with every regex metacharacter in the substituted value **escaped** (`sanitizeRegexMacro`, `engine.js:304-324` → `\n \r \t \v \f \0` and `\.^$*+?{}[]\\/|()` all escaped). ⚠️ `2` is the sane choice and should be RPNow's default for new scripts.

## 4.6 `replaceString`: `{{match}}` and `$n`

**[ST-SRC]** `engine.js:419-445`:

```js
newString = rawString.replace(findRegex, function (match) {
    const args = [...arguments];
    const replaceString = regexScript.replaceString.replace(/{{match}}/gi, '$0');   // step 1
    const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
        if (num)              match = args[Number(num)];
        else if (groupName)   match = args[args.length-1]?.[groupName];
        if (!match) return '';
        return filterString(match, regexScript.trimStrings);                         // step 2
    });
    return substituteParams(replaceWithGroups);                                      // step 3
});
```

Order of operations — **get this right**:

1. `{{match}}` (case-insensitive) is rewritten to `$0` **before** replacement. So `{{match}}` and `$0` are equivalent; `{{match}}` is the just-more-readable, macro-flavoured alias.
2. `$1`, `$2`, … (numeric) and `$<name>` (named groups) are then expanded **manually** — each expanded value has `trimStrings` removed via `replaceAll` (`filterString`, `engine.js:457-465`; trim strings themselves are macro-substituted first with `name2Override = characterOverride`).
3. The **whole resulting string** is then run through `substituteParams()` once — so macros in `replaceString` (e.g. `{{char}}`, `{{getvar::x}}`) are expanded.
4. **`$&`, `` $` ``, `$'`, `$$` are NOT special** in ST's manual expansion — they only accidentally work if the pattern happens to match; the editor's highlighter (`index.js:881-905`) does treat `$$`, `$&`, `` $` ``, `$'` as back-references for preview purposes, so behaviour and preview **disagree** ⚠️. RPNow should decide: either support the full JS replacement vocabulary (and document divergence from ST) or match ST exactly. **Recommendation: match ST exactly** for imported scripts, and support the full set only for RPNow-authored scripts with an explicit flag.
5. If a referenced group didn't participate, ST returns `''` (`if (!match) return ''`) — note this also swallows a legitimate empty-string group, same result.

## 4.7 Security notes

- Regex scripts are **not** code execution, but `findRegex` with catastrophic backtracking is a **ReDoS** vector (`(a+)+$` on a long message). RPNow must run regex with a size cap and ideally a watchdog/timeout, and cap `findRegex` length.
- `substituteRegex: 1` lets a card inject macros into the pattern — including `{{getvar}}`, which is harmless, but also lets a card read chat state into a pattern. Keep `2` as default.
- Card-supplied `replaceString` can insert HTML; it goes through the normal render path (and thus §6 sanitisation), so it is covered.

---
---

# Part 5 — Writing tools survey (UX reference)

Purpose: know which fields/steps competing tools expose, and which UX patterns are table-stakes.

## 5.1 Table

| Tool | Type | Card formats | Fields / steps exposed | Notable UX patterns |
|---|---|---|---|---|
| **SillyTavern** character editor **[ST-DOC]** `docs.sillytavern.app/usage/characters/`, `…/characterdesign/` | in-app editor | PNG (reads `ccv3`→`chara`), JSON in/out, CharX, BYAF, YAML | Name (**only required field**), Avatar, Description, Personality, Scenario, First Message, Alternate Greetings, Examples (`<START>` blocks), Prompt Overrides (Main Prompt, Post-History), Creator's Metadata (creator, version, creator's notes, tags-to-embed), Character's Note (`@Depth` + Role), Talkativeness (group-chat activation %), `Advanced Definitions` collapsible section, **Token Count** (red when >½ of model context), World Info linking, "Card lore import" | token counter with warning colour; `<START>`-block example editor with macro autocomplete; greeting collections; per-field "Expand" fullscreen editor; macro autocomplete on `{{`; drag-to-reorder Prompt Manager with token weight bar; import previews + mismatch warnings |
| **RisuAI** **[WEB]** | in-app | CharX, PNG (V2/V3 + `chara-ext-asset_`), JSON V2/V3, `.risum` modules, `.risup` presets | everything V3, plus emotion/expression sprite sets, `additionalAssets`, view screens (HTML/Lua), triggers, Lua scripts, lorebook with folders+modes, `bias`, `lowLevelAccess`, `defaultVariables`, onboarding | "recipe"/scriptable cards, live preview of the phone-like chat UI, module toggle switches, per-character asset manager, in-app "module store" (RisuRealm) |
| **Chub / Venus** | web gallery + creator | PNG V2 out; JSON; CharX for some | name, tagline, avatar, description, personality, scenario, first message, example dialogue, lorebook, tags, nsfw flag, visibility, version history, `full_path` | marketplace framing (trending/new/tags), per-card **versioning**, fork/remix, inline token estimate, tag autocomplete from a controlled vocabulary, browse-before-import |
| **JanitorAI** | web + creator | PNG V2 via community exporters | avatar, name, tagline, greeting (multi-greeting swipes), personality, scenario, example dialogue, custom/system prompt, tags | swipeable greetings in creator, "definition" preview panel, per-bot "persona" overrides, direct in-site chat with the draft |
| **Agnaistic (Agnai)** | web app | own JSON (V3 export), lorebooks as separate "Worlds" | name, avatar, persona (description), personality, scenario, greeting, `sampleChat`, `scenario`, `systemPrompt`, `postHistoryInstructions`, character book (as a separate World), `voice`/TTS, objectives | **separate library tabs for Characters / People (personas) / Worlds / Scenarios / Presets**, so shared lore is first-class; "import from card" with an explicit field-by-field preview |
| **Tavern Helper** (酒馆助手, JS-Slash-Runner) **[WEB]** | ST extension | n/a (consumes cards; adds in-card JS runtime) | renders **message-level HTML/status bars**, registers card-provided scripts in a `ScriptTree`, "Wand" menu, worldbook bridge | turns cards into mini-apps; strongly implies RPNow needs a **sandboxed rendering model** if it ever allows card UI |
| **"CardMak"** (`zeozeozeo.github.io/cardmak`) **[WEB]** | single-page web tool | V2 JSON export + import | Name, avatar, Description, Personality, Scenario, First Message, Example Dialogue, System Prompt, Post-History Instructions, Creator Notes, **Alternate Greetings (add/remove)**, **Character Book** (Book Name, Book Description, Scan Depth, Token Budget, Recursive Scanning, per-entry editor) | one-page form, JSON in/out toggle, "Import Card" to round-trip |
| **LoreWeaver card editor** **[WEB]** | web app | opens SillyTavern/Chub/RisuAI cards; writes portable | per-field **"who reads this"** explainer (Name→`{{char}}` everywhere, Description→every reply, Personality→short summary…), lorebook editor | inline documentation *inside* the form; "write a card that opens anywhere" interoperability framing |
| **Ginger** (`DominaeDev/Ginger`) **[WEB]** | standalone editor | `.png`, `.charx`, `.json`, `.yaml` | "recipes" (150+ building blocks that expand into text), multi-character cards, name/pronoun placeholder handling, A/B baking of recipes | **template/recipe system** that compiles to editable text — approachable for beginners, detachable for experts |
| **KoboldAI** (client + "Lite") | local frontend | its own `.json`/`.kaisettings`; imports ST-era cards | name, description, memory, authors note, world info, sampler presets | world-info editor with key highlighting; sampler "presets" named after vibes (Neutral / Universal-Creative…) — ST still ships those names |
| **CharacterCardGenerator / FeithNoir "Card Creator"** **[WEB]** | simple web tools | PNG/JSON V2 | name, race, gender, description, likes, dislikes, image, theme colours | one-screen, gamified/visual, local storage autosave |

## 5.2 Shared UX patterns → what RPNow should ship

Ranked by how universally they appear:

| Pattern | Where seen | RPNow recommendation |
|---|---|---|
| **Only `name` is required; everything else optional** | ST docs state it explicitly | Match. Allow save-as-draft with just a name. |
| **Live token counter with a warning threshold** | ST (red at >½ context), Chub, CardMak | Show 3 numbers: **permanent tokens** (name+description+personality+scenario), **lorebook tokens** (max activated), **greeting tokens**. Recolour at ½ context. |
| **Greeting swipes / alternate greetings editor** | ST, CardMak, Janitor, LoreWeaver | First-class: "Greetings" list with add/reorder/duplicate, each with its own preview and its own token count. Support V3 `group_only_greetings` as a separate list. |
| **Lorebook editor with per-entry enable/regex/position** | ST, Chub, CardMak (scan depth/token budget/recursive), RisuAI (folders/modes), Agnai (as separate World) | Table + inline expand. Show `keys → secondary_keys`, `constant`, `position/depth/role`, `probability`, insertion order drag. |
| **Tag autocomplete + tag chips** | Chub, Janitor, ST (tags-to-embed) | Suggest from a controlled vocabulary plus local corpus; never free-text-only. |
| **AI-assisted generation** | Ginger "recipes", ST "Enhance Definitions" prompt, Janitor "generate", community "card wizard" tools | Optional: an LLM step that fills gaps in `description`/`personality`/`scenario` and proposes `alternate_greetings`/lore entries — **always diff-previewed**, never silently applied. |
| **Live chat preview alongside the editor** | Janitor, RisuAI, LoreWeaver | Two-pane: editor left, running chat preview right, sharing the real prompt assembler. |
| **`<START>`-delimited example dialogue editor** | ST, CardMak | Rich editor that auto-inserts `<START>`, highlights `{{char}}:`/`{{user}}:` speakers, counts blocks. |
| **Import → field-by-field mapping preview** | Agnai (explicit), Teasa (reports where each part went), ST (warnings) | **Confirmation screen** listing every detected field and its target, plus a "keep unknown data" note. This is the single most requested interop feature. |
| **"Advanced" section collapsed by default** | ST (`Advanced Definitions`), Janitor | Keep the basic 6 fields visible; overrides/depth-note/regex behind a disclosure. |
| **Macro autocomplete on `{{`** | ST (new in 1.19), TavernWeaver tooling | Cheap, high value: a fuzzy list with argument hints + description popovers. |
| **Card versioning / remix lineage** | Chub (version history, forks) | Store `data.character_version`, `data.source[]` (V3) and an RPNow-local lineage id. |
| **Explicit security consent for card-supplied scripts** | ST (regex trust gate) | Required — see §6. |

---
---

# Part 6 — HTML rendering in chats: what ST does and what RPNow must do

## 6.1 The rendering pipeline (Chat Completion and Text Completion alike)

**[ST-SRC]** `public/script.js:1780-1971` — `messageFormatting(mes, ch_name, isSystem, isUser, messageId, sanitizerOverrides, isReasoning)`. Documented stage list (from the function's own JSDoc `:1770-1786`):

```
 1. name/`{{original}}` substitution (message 0 only, via substituteParams)
 2. prompt-bias stripping
 3. BEFORE_REGEX extension hooks
 4. regex scripts for the message's placement   (getRegexedString, isMarkdown: true)
 5. AFTER_REGEX extension hooks
 6. fixMarkdown()                              (if power_user.auto_fix_generated_markdown)
 7. encode_tags                                (if enabled → escape < and >)
    + reasoning prefix/suffix escaping, + quote wrapping in <q>, + \[begin|end]{align*} → $$
 8. Showdown Markdown → HTML
 9. AFTER_MARKDOWN extension hooks
10. name-prefix stripping (`allow_name2_display` off ⇒ strip leading "Name:")
11. DOMPurify sanitisation
```

**Showdown configuration [ST-SRC]** (`script.js:521-539`) — reproduce these options exactly for visual parity:

```js
new showdown.Converter({
    emoji: true,
    literalMidWordUnderscores: true,
    parseImgDimensions: true,
    tables: true,
    underline: true,
    simpleLineBreaks: true,
    strikethrough: true,
    disableForced4SpacesIndentedSublists: true,
    extensions: [markdownUnderscoreExt(), markdownExclusionExt()],
});
```

- `simpleLineBreaks: true` is why roleplay prose renders with newlines as `<br>`.
- `literalMidWordUnderscores: true` is why `snake_case` survives.
- `markdownExclusionExt()` (from `showdown-exclusion.js`) honours `power_user.markdown_escape_strings`: a line **starting** with any listed token (e.g. `***`, `---`) gets a `\u0000` prefix so Showdown leaves it literal, then it is restored — this is how dinkuses stay unformatted.
- `markdownUnderscoreExt()` — custom extension for `_underscores_` (from the same `script.js` import set).

## 6.2 DOMPurify configuration

**[ST-SRC]** `script.js:1957-1968`:

```js
const config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
    MESSAGE_SANITIZE: true,          // custom flag, honoured by ST's own hooks
    ADD_TAGS: ['custom-style'],      // ← the only tag explicitly allowed on top of DOMPurify defaults
    ...sanitizerOverrides,
};
mes = encodeStyleTags(mes);          // <style>…</style>  →  <custom-style>encodeURIComponent(…)</custom-style>
mes = DOMPurify.sanitize(mes, config);
mes = decodeStyleTags(mes, { prefix: '.mes_text ' });
```

There is **no custom `ALLOWED_TAGS` / `ALLOWED_ATTR` list**. ST relies on **DOMPurify's own default allow-list** plus a small vocabulary of ST-specific hooks. The three hooks, `addDOMPurifyHooks()` **[ST-SRC]** `chats.js:1901-2033`:

1. **`afterSanitizeAttributes`** — force every link target to `_blank` and add `rel="noopener"`:
   ```js
   if ('target' in node) { node.setAttribute('target','_blank'); node.setAttribute('rel','noopener'); }
   ```
2. **`uponSanitizeAttribute`** — **class namespacing**, this is the key isolation mechanism:
   ```js
   if (!config.MESSAGE_SANITIZE) return;
   const permittedNodeTypes = ['BUTTON','DIV'];
   if (config.MESSAGE_ALLOW_SYSTEM_UI && node.classList.contains('menu_button') && permittedNodeTypes.includes(node.nodeName)) return;
   switch (data.attrName) {
     case 'class': {
       data.attrValue = data.attrValue.split(' ').map(v => {
         if (v.startsWith('fa-') || v.startsWith('note-') || v === 'monospace') return v;  // allow-listed prefixes
         return 'custom-' + v;                                                            // everything else prefixed
       }).join(' ');
     }
   }
   ```
   → a card writing `class="mes_text"` gets `class="custom-mes_text"`, so **card CSS cannot target host UI classes**. FontAwesome icon classes (`fa-*`) and `note-*` (NovelAI notes) survive.
3. **`uponSanitizeElement`** — two jobs:
   - **`<br>` insertion inside unknown elements**: for `HTMLUnknownElement`, trim innerHTML and replace every `\n` in text nodes with `<br>` (skipping anything inside `<pre>`). This is how custom tags like `<char_thought>` render multi-line prose.
   - **external media blocking** when `isExternalMediaAllowed()` is false: for `AUDIO, VIDEO, SOURCE, TRACK, EMBED, OBJECT, IMG`, remove the node if `src`/`data`/any `srcset` entry is an external URL (`indexOf('://') > 0 || startsWith('//')` and not same-origin).

`isExternalMediaAllowed()` **[ST-SRC]** `chats.js:852-866` resolves per-entity: `power_user.external_media_allowed_overrides` / `external_media_forbidden_overrides` (per character/group), else `!power_user.forbid_external_media`. **Default `forbid_external_media: true`** (`power-user.js:336`) — i.e. **remote images are blocked by default**.

`MESSAGE_ALLOW_SYSTEM_UI` is only set when `message.extra?.uses_system_ui` is true (**[ST-SRC]** `script.js:2524-2534`) — i.e. ST messages that need real `menu_button` styling opt in per message.

## 6.3 `<style>` handling — the `custom-style` dance

**[ST-SRC]** `chats.js:536-626`:

- `encodeStyleTags(text)`: `<style>(.+?)</style>` (dotall, case-insensitive, multiline) → `<custom-style>${encodeURIComponent(match)}</custom-style>`. **Credit: "© https://github.com/kwaroran/risuAI"** — this trick comes from RisuAI.
- After sanitisation, `decodeStyleTags(text, {prefix})`:
  - Parses the CSS with the `css` package (a real parser, not regex).
  - **Drops `@import` rules** (`ruleSet.rules.filter(r => r.type !== 'import')`).
  - **Prefixes every class selector** with the prefix (`'.mes_text '` for messages, `'#creator_notes_spoiler '` for creator notes) and renames `.foo` → `.custom-foo` (unless already `custom-*`), recursing into `:has/:not/:where/:is/:matches/:any`.
  - If external media is not allowed, strips any declaration whose value contains `://`.
  - On parse failure returns the literal string `CSS ERROR: <error>` into the message.
- Creator notes get *stricter* treatment via `formatCreatorNotes()` (`chats.js:684-703`): the prefix is `#creator_notes_spoiler ` and there is a per-character **"allow global styles"** preference (`StylesPreference`, account-storage key `AllowGlobalStyles-${avatarId}`) that, when enabled, leaves selectors unprefixed.

## 6.4 The ` ```html ` fenced-preview behaviour

**⚠️ Important negative finding:** in **ST 1.19** there is **no special handling of a ```` ```html ```` fence** in the message renderer. I grepped `public/` for `data-raw-html`, `iframe`, and `language-html` in the render paths:

- `iframe` appears only in `data-maid.js` (a data-cleanup preview) and a vendored gallery library.
- The only HTML-fence-adjacent behaviour is that fenced code blocks become `<pre><code class="language-…">` via Showdown, and inline/code content gets whitespace-preserved (`script.js:1937-1946`).

So: **ST does not sandbox card HTML in an iframe, and does not "preview" html fences.** Card-provided `<div>`/`<span>`/`<style>` markdown renders *inline in the page DOM*, constrained only by DOMPurify + class namespacing + the `custom-style` prefixing. Anything that looks like a sandboxed HTML preview in the ST ecosystem comes from **extensions** (Tavern Helper is the canonical one; it runs card scripts in `about:srcdoc` iframes ⚠️ [WEB] https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner-Doc@main/src/guide/关于酒馆助手/介绍.md), not from core.

If RPNow documents or implements an "html fence preview", it is an **RPNow-original feature**, not ST parity. ⚠️ Flag this to the product owner: earlier assumptions about ` ```html ` preview semantics being ST behaviour are not supported by the 1.19 source.

## 6.5 Security model — what must be sanitised, and the iframe question

### Threat model (card-controlled content is untrusted)

| Vector | ST's mitigation | RPNow requirement |
|---|---|---|
| `<script>`, event handlers (`onerror`, `onclick`) | DOMPurify default allow-list (strips both) | Same; never `ADD_ATTR: ['onClick']`-style escapes |
| `javascript:` / `data:` URLs in `href`/`src` | DOMPurify default (strips `javascript:`; `data:` on `img` depends on config ⚠️) | Explicitly deny `javascript:`, `vbscript:`, and `data:` except `data:image/{png,jpeg,webp,gif}` on `img` |
| Remote media / tracking pixels | blocked by default via `uponSanitizeElement` (`forbid_external_media: true`) | Same default; per-card override with a visible badge |
| CSS exfil / layout takeover | class namespacing (`custom-*`), selector prefixing to the message container, `@import` removal, `://` declaration stripping | **Stronger**: render card `<style>` inside a constructed-stylesheet scope or Shadow DOM; never allow `body`, `html`, `:root`, `#chat` selectors |
| `@import`, `url()` to remote | ✅ ST removes `@import` and `://`-containing declarations when media is blocked | Same, plus allow-list schemes for `url()` |
| Host-UI class spoofing (`class="menu_button"`) | ✅ `custom-` prefixing | Same |
| Prompt injection via rendered text | out of scope (text) but *macro* substitution is in scope: `{{getvar}}`/`{{setvar}}` are card-writable | variable writes scoped to the chat; no path to app settings |
| Card-supplied **code** (Risu Lua, Tavern Helper JS, CharX `assets/*/code/*`) | ST: none in core; extensions opt in | **RPNow must not execute card code at all in v1** |
| ReDoS from regex scripts | none | cap pattern length; run with a timeout/step budget |
| Zip-slip / zip-bomb in `.charx`/`.byaf` | ST uses `normalizeZipEntryPath` + `extractFileFromZipBuffer` ⚠️ (bomb limits not verified) | explicit size/entry caps, reject `..` absolute and symlink entries |

### Iframe sandboxing — recommendation

ST does **not** use iframes for card HTML. That is not a model to copy: ST's inline-DOM with `custom-` prefixing has repeatedly been the target of community CSS/HTML attacks, and the whole "Tavern Helper" ecosystem demonstrates the demand for real in-chat UI.

**RPNow recommendation (defensible, and strictly stronger than ST):**

1. **Default path — inline, sanitised, namespaced.** DOMPurify with an explicit allow-list (don't rely on defaults) + the three ST hooks (link hardening, class namespacing, external-media blocking, `<br>` in unknown elements), plus resolved relative URLs only.
2. **Opt-in "rich card" path — sandboxed iframe.** For cards that need interactive/HTML UI:
   ```html
   <iframe sandbox="allow-scripts"        <!-- note: NO allow-same-origin -->
           referrerpolicy="no-referrer"
           csp="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:">
   ```
   - `srcdoc` only, never `src` to a remote origin.
   - **Never combine `allow-scripts` with `allow-same-origin`** (that combo defeats the sandbox).
   - Communicate via `postMessage` with an explicit, versioned, allow-listed message schema; validate `event.origin === 'null'` and a nonce handshake.
   - Provide a tiny RPNow bridge API (e.g. `rpnow.getVar/setVar/sendMessage`) that is the *only* capability — no DOM access to the parent, no network.
   - Render the iframe with a fixed height or a ResizeObserver-driven handshake; strip scrollbars.
3. **Style isolation regardless of path**: scope card CSS to a per-message container. `custom-` prefixing alone is not isolation (a card can write `.custom-mes_text ~ .foo`); prefer `@scope` / Shadow DOM where the target Electron/browser baseline allows it.
4. **Trust UI everywhere**: a badge on any card that ships regex scripts, styles, or rich HTML; a per-card settings page listing exactly what it does; a global kill switch. Mirror ST's `character_allowed_regex` gate semantics.
5. **Sanitise on *render*, not on *storage*.** Keep the raw text in the chat file (that is the source of truth and what gets sent to the model); sanitisation is a display concern. ST does exactly this (`mes` stays raw; `display_text` is optional).

### `encode_tags` interaction

`power_user.encode_tags` (default **false**, `power-user.js:301`) escapes `<`/`>` in generated text before Markdown — with a negative-lookbehind variant that preserves the `>` of a blockquote at line start (`script.js:1875-1879`). When **false** (default), ST instead protects attribute quotes inside tags by swapping `"` → `\uFFFE` before Markdown and restoring after (`script.js:1892-1931`), so `"\""`-quoted dialogue (wrapped in `<q>`) doesn't fight tag parsing. RPNow must replicate this dance or inline HTML attributes in messages will render as literal quotes.

---
---

# Appendix A — Quick reference: enums RPNow needs

```ts
// World Info positions (already-established, restated for the importer)
enum STWorldInfoPosition { BeforeChar=0, AfterChar=1, ANTop=2, ANBottom=3, AtDepth=4,
                           EMTop=5, EMBottom=6, Outlet=7 }

// selectiveLogic
enum SelectiveLogic { AND_ANY=0, NOT_ALL=1, NOT_ANY=2, AND_ALL=3 }

// Regex script placement  [ST-SRC] extensions/regex/engine.js:281-292
enum RegexPlacement { MD_DISPLAY_DEPRECATED=0, USER_INPUT=1, AI_OUTPUT=2, SLASH_COMMAND=3,
                      /*4 deprecated sendAs*/, WORLD_INFO=5, REASONING=6 }

// substituteRegex  [ST-SRC] engine.js:298-302
enum SubstituteFindRegex { NONE=0, RAW=1, ESCAPED=2 }

// Prompt injection position  [ST-SRC] PromptManager.js:37-40
enum InjectionPosition { RELATIVE=0, ABSOLUTE=1 }

// Extension prompt types / roles  [ST-SRC] script.js:484-498
enum ExtensionPromptType { NONE=-1, IN_PROMPT=0, IN_CHAT=1, BEFORE_PROMPT=2 }
enum ExtensionPromptRole { SYSTEM=0, USER=1, ASSISTANT=2 }

// names_behavior  [ST-SRC] instruct-mode.js:17-21
// 'none' | 'force' | 'always'

// PromptManager dummy character ids  [ST-SRC]
const PM_DUMMY_ID_BASE       = 100000; // base PromptManager
const PM_DUMMY_ID_CHAT_COMPL = 100001; // Chat Completion (openai) preset
```

# Appendix B — Primary sources

| Ref | URL | Used for |
|---|---|---|
| CCv3 spec | https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md | V3 fields, CHARX, `embeded://`, asset types, decorators, `chara-ext-asset_` |
| CCv2 spec | https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md | V1/V2 fields, `{{original}}`, extensions contract |
| BYAF | https://github.com/backyardai/byaf · https://www.npmjs.com/package/byaf/v/0.0.0-pre.2 | archive layout, 3 schemas, legacy EXIF PNG |
| RisuRealm API | https://realm.risuai.net/help/api | download formats (`png-v2`,`json-v2`,`json-v3`,`charx-v3`,`preset-risu-v1`,`preset-st-chat`) |
| RisuAI source | https://cdn.jsdelivr.net/gh/kwaroran/Risuai@main/src/ts/characterCards.ts | CharX import/export, `risuai` extension namespace, off-spec detection |
| ST docs — macros | https://docs.sillytavern.app/usage/core-concepts/macros/ | macro syntax, flags, shorthands, full macro index |
| ST docs — characters | https://docs.sillytavern.app/usage/characters/ | fields, token counter |
| ST docs — character design | https://docs.sillytavern.app/usage/core-concepts/characterdesign/ | field semantics, `<START>`, permanent tokens |
| ST community preset guide | https://cdn.jsdelivr.net/gh/LiarMTTT/TavernWeave@main/skills/consult-tavernweave-library/references/st-guides/A4_提示词与预设.md | cross-check of prompt-manager fields/depth semantics |
| Backyard shutdown notice | https://teasa.ai/en/help/bring-backyard-ai-characters | BYAF migration urgency |
| ST error catalogue | https://errors.standardbeagle.com/SillyTavern/SillyTavern/invalid-byaf-manifest/ | BYAF validation messages |
| Tavern Helper docs | https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner-Doc@main/src/guide/关于酒馆助手/介绍.md | card-provided JS in `about:srcdoc` iframes |
| Local clone | `D:\RPNow\_ref\SillyTavern` (v1.19.0, `06bde93`) | all `[ST-SRC]` claims |

# Appendix C — Open questions / follow-ups

1. ⚠️ **`.risum` binary framing** — unresolved (sources blocked). Needs a fresh fetch of `kwaroran/Risuai` `src/ts/process/modules.ts`.
2. ⚠️ **`.risup` preset JSON schema** — unresolved; do not ship an importer until verified.
3. ⚠️ **Agnai character schema** (`identifier`/`members`) — heuristic only; verify against `safety@agnai` types.
4. ⚠️ **JanitorAI JSON payload** — unverified; assume PNG V2 is the real route.
5. ⚠️ **`{{charIfNotGroup}}`** — the new engine makes it an alias of `{{group}}`; docs say "empty in groups". Divergence needs a decision: match source (`group`) or match docs.
6. ⚠️ **`$&`/`` $` ``/`$'`/`$$` in `replaceString`** — ST's engine does not honour them but its editor preview does. Decide and document.
7. ⚠️ **`textgen` vs `novel` sampler preset disambiguation** — "novel" presets not inspected.
8. ⚠️ **` ```html ` fence preview** — confirmed *absent* from ST 1.19 core; clarify whether RPNow wants this as an original feature.
9. **PNG `zTXt`/`iTXt` chunks**: ST reads only `tEXt`. Some third-party tools write `zTXt`. Supporting `zTXt` is a cheap robustness win ⚠️(untested against real files here).
