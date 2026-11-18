# RPNow Architecture

> Status: implemented (v0.1). This document explains *why* the code is shaped the way it is.

## 1. The one idea

**Everything is a plugin.** Not "features are extensible" — the UI, the agent loop,
the theme, the renderer, the LLM transports, the image generators, the world-book
engine are all plugins registered on one kernel. There is no privileged core code
path that plugins cannot replace, because RPNow's own default behaviour ships *as*
plugins.

This is borrowed from DeepSeek Harness: a Cordis-style **service registry** where
each capability is a named service (`llm`, `agentLoop`, `theme`, …), plugins declare
`uses` dependencies, and swapping a provider cascades a reload through its dependents
only.

```
src/core/plugin/
  kernel-types.ts   manifest + context contract (no deps, testable)
  registry.ts       service registry, dep resolution, reload cascade, override stack
  slots.ts          UI slot registry (React)
```

### Why a registry instead of an event bus alone

Events can't answer "who currently provides `llm`". A registry can. That is what makes
**hot-swap** possible: install a theme → it `provide`s `theme` → the previous theme
pops onto an override stack → dependents re-activate → uninstall restores the old one.

### Manifest shape

```ts
{
  id: 'rpnow.theme.paper-ink',
  version: '1.0.0',
  apiVersion: 1,
  host: 'ui',                  // 'host' = kernel, 'ui' = React surfaces
  provides: ['theme'],          // replaces whatever held 'theme'
  uses: ['settings'],           // activated only when these exist
  priority: 100,
  tags: ['theme']
}
```

## 2. Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  UI shell (React)                                                │
│  Chat · Cards · Lorebook · Presets · Models · Plugins · Settings  │
│  every surface resolves through slot registry → replaceable       │
└───────────────┬──────────────────────────────────────────────────┘
                │ zustand stores + kernel services
┌───────────────▼──────────────────────────────────────────────────┐
│  Kernel services (plugins)                                       │
│  prompt · worldbook · macros · cards · presets · regex · persona   │
│  llm (transports) · image (generators) · agentLoop · storage       │
└──────────────────────────────────────────────────────────────────┘
```

## 3. The prompt pipeline (the part that must be right)

Cards, presets and world books are three different objects that all land in one
message array. The mapping:

| Concept | Role |
|---|---|
| **Preset** (Chat Completion preset) | The *skeleton*: which blocks, in what order, and each block's default text. Order comes from `prompt_order` keyed by dummy id **100001**. |
| **Character card** | The *content*: `description`, `personality`, `scenario`, `mes_example` feed the matching blocks. Optionally overrides `main` (`data.system_prompt`) and `jailbreak` (`data.post_history_instructions`). |
| **World book** | *Insertions* at named positions (`before_char`, `after_char`, `@depth`, `AN top/bottom`, `EM top/bottom`, `outlet`). Never "another block" — it's an overlay on the skeleton. |
| **Persona** | A block only some presets include (`personaDescription`). |

Consequences that are easy to get wrong and are handled in code:

1. **`{{original}}`** — when a card's `system_prompt` overrides the preset's `main`,
   the preset's main text becomes `{{original}}` *inside* the card text. Implemented in
   `buildPrompt()`.
2. **Card lorebook vs user lorebook** — the card's `character_book` is converted into
   the same `RPLorebook` shape and **merged before** user books, so character-scoped
   lore wins on collision. One engine, one code path.
3. **Position double-track** — `entry.position` (string, only before/after) and
   `entry.extensions.position` (number 0–7). We read the *number* and write *both*.
4. **`atDepth`** entries are inserted `depth` positions from the *end* of the final
   message array, not appended.
5. **Order-group fallback** — `100001` → `100000` → first group → materialise a default.

## 4. Streaming

`llm` plugins expose one streaming primitive:

```ts
for await (const ev of llm.stream(request)) {
  // ev: {type:'text', delta} | {type:'reasoning', delta} | {type:'tool_call', ...} | {type:'usage'} | {type:'done'}
}
```

The agent loop consumes it; renderers never see raw SSE. Because `agentLoop` is a
service too, a plugin can replace the loop entirely (e.g. a self-editing
"director" loop that summarises, then writes).

## 5. Rendering (HTML is first-class)

Roleplay cards output HTML/CSS heavily — status bars, chat bubbles, styled
`<StatusPlaceHolderImpl/>`. The renderer therefore:

1. runs card **regex scripts** (`placement: 2` = AI output, `markdownOnly`),
2. encodes `<style>` into a safe carrier before Markdown,
3. renders Markdown (GFM, single-newline breaks),
4. sanitises with DOMPurify: default allow-list, `custom-style` carrier, link
   `target=_blank rel=noopener`, and **class namespacing** so card CSS can't grab
   host classes,
5. re-emits `<style>` scoped to the message container (selectors prefixed),
6. optionally renders in a sandboxed iframe for untrusted cards.

Card-supplied **JavaScript is never executed** (Risu Lua / Tavern Helper scripts are
detected and surfaced, not run).

## 6. Data & persistence

- Browser-first (IndexedDB via `idb-keyval` for blobs, `localStorage` for settings).
- Every collection lives behind a `storage` service, so a desktop (Tauri/Capacitor)
  adapter can swap in without touching feature code.
- Cards keep their original document (`RPCard.source`) so re-export is lossless.

## 7. Multi-target

React + Vite produces one web bundle that is wrapped by Capacitor (Android/iOS) and
Tauri (desktop). Layout is responsive with a mobile-first bottom nav and a desktop
sidebar; both are slot-driven so a theme plugin can override either.

## 8. Provider & image policy

All providers are plugins (or data-driven `OpenAICompatibleProvider` instances).
Because **NovelAI and several image APIs have no CORS headers**, RPNow ships a
generic, allow-listed proxy plugin plus a per-provider `requiresProxy` flag, and the
UI tells the user exactly which providers need it.

## 9. `.rpnx` plugin format

A `.rpnx` is a ZIP:

```
manifest.json     PluginManifest
plugin.js         ESM module exporting { manifest, apply }
assets/           icons, themes, css
README.md
```

Install → stored in IndexedDB → loaded via `import(blobUrl)` inside a guarded
sandbox → registered on the kernel. A plugin can read app data (cards, chats,
presets, world books) through the context API, contribute world books/presets that
affect chats, and replace UI slots or entire themes.

## 10. Deliberate omissions

- **No remote fonts.** A local-first app must render correctly offline and must
  not phone a CDN on first paint, so typography uses a system stack
  (`system-ui` / PingFang SC / Microsoft YaHei) with a serif variant for the
  reading themes. A theme plugin may add a bundled font via its `assets/`.
- **No analytics, no telemetry, no network calls except the user's own endpoints.**
- **No card-supplied JavaScript execution.** Cards are data, never code.
