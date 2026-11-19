/**
 * Selective export (P10 / O07, RP-Hub parity).
 *
 * RP-Hub exports through one "选择导出项目" multi-select sheet: pick which
 * lorebook entries / regex scripts / presets / UI templates leave the app,
 * everything else stays behind. These are the pure builders behind the
 * `ExportSelectionModal`; the modal only collects ids, the callers download.
 */

import type { RPCard } from '../types/card.js';
import type { RPLorebook } from '../types/lorebook.js';
import type { RPUITemplate } from '../uitemplate/types.js';
import type { RPRegexScript } from '../types/card.js';

/** Item id for the i-th lorebook entry of a card, as shown in the modal. */
export function loreItemId(index: number): string {
  return `lore-${index}`;
}

/** Item id for one regex script, as shown in the modal. */
export function regexItemId(script: RPRegexScript): string {
  return `regex-${script.id}`;
}

/**
 * Clone a card keeping only the selected lorebook entries and regex scripts.
 * Everything else (name, description, first message, avatar…) exports whole —
 * selection only ever *removes* entries, never edits the card.
 */
export function selectiveCard(card: RPCard, loreIds: string[], regexIds: string[]): RPCard {
  const clone: RPCard = structuredClone(card);
  const keepLore = new Set(loreIds);
  const keepRegex = new Set(regexIds);
  if (clone.data.character_book) {
    clone.data.character_book = {
      ...clone.data.character_book,
      entries: clone.data.character_book.entries.filter((_, i) => keepLore.has(loreItemId(i))),
    };
    if (!clone.data.character_book.entries.length) delete clone.data.character_book;
  }
  const scripts = (clone.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? [];
  if (scripts.length) {
    const kept = scripts.filter((s) => keepRegex.has(regexItemId(s)));
    clone.data.extensions = { ...clone.data.extensions, regex_scripts: kept };
    if (!kept.length) {
      const { regex_scripts: _dropped, ...rest } = clone.data.extensions as Record<string, unknown>;
      void _dropped;
      clone.data.extensions = rest;
    }
  }
  return clone;
}

/** One lorebook as RP-Hub's `{name, entries:[…]}` export document. */
export function lorebookExportDoc(book: RPLorebook): Record<string, unknown> {
  return { name: book.name, description: book.description ?? '', entries: book.entries };
}

/** UI templates as RP-Hub's `{type, templates:[…]}` export document. */
export function uiTemplatesExportDoc(templates: RPUITemplate[]): Record<string, unknown> {
  return {
    type: 'ui-template',
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      scope: t.scope,
      scopeId: t.scopeId,
      order: t.order,
      placement: t.placement,
      htmlTemplate: t.htmlTemplate,
      initialVariableState: t.initialVariableState,
      variableState: t.variableState,
      variableSchema: t.variableSchema,
    })),
  };
}

/** Regex scripts as a plain export array (RP-Hub's `toRegexExportEntry` shape). */
export function regexScriptsExportDoc(scripts: RPRegexScript[]): Array<Record<string, unknown>> {
  return scripts.map((s) => ({
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    ...(s.trimStrings ? { trimStrings: s.trimStrings } : {}),
    placement: s.placement,
    disabled: s.disabled,
    markdownOnly: s.markdownOnly,
    promptOnly: s.promptOnly,
    ...(s.runOnEdit !== undefined ? { runOnEdit: s.runOnEdit } : {}),
    ...(s.substituteRegex !== undefined ? { substituteRegex: s.substituteRegex } : {}),
    minDepth: s.minDepth ?? null,
    maxDepth: s.maxDepth ?? null,
  }));
}
