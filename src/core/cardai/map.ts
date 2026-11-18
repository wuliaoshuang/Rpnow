/**
 * Turn parsed AI sections into an RPNow card.
 *
 * Field mapping follows the workshop conventions: `scenario` is discarded on
 * import (RPNow keeps it, since the prompt builder supports it), the world-info
 * array becomes `character_book.entries`, and regex scripts land in
 * `extensions.regex_scripts`.
 */

import type { RPCard } from '../types/card.js';
import type { RPLorebookEntry } from '../types/lorebook.js';
import { newEntry, resolvePosition, toCardEntry } from '../types/lorebook.js';
import { WI_POSITION } from '../types/card.js';
import type { CardGenSections } from './generate.js';
import { coerceRegexScripts, coerceWorldInfo, cleanFirstMessage } from './generate.js';
import { uid } from '../../lib/utils.js';

/** Clamp/normalise a world-info position to RPNow's 0–7 range. */
export function normalizePosition(value: unknown): number {
  return resolvePosition(value) ?? WI_POSITION.atDepth;
}

/** Build `character_book.entries` from generated world-info. */
export function entriesFromGen(value: unknown): RPLorebookEntry[] {
  return coerceWorldInfo(value).map((raw, index) =>
    newEntry({
      comment: String(raw.comment ?? raw.name ?? `条目 ${index + 1}`),
      content: String(raw.content ?? ''),
      enabled: raw.enabled !== false,
      position: normalizePosition(raw.position),
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : (index + 1) * 10,
      depth: Number.isFinite(Number(raw.depth)) ? Number(raw.depth) : 4,
      keys: Array.isArray(raw.keys) ? raw.keys.map(String) : [],
      constant: raw.constant === true,
      useRegex: raw.useRegex === true,
      probability: Number.isFinite(Number(raw.probability)) ? Number(raw.probability) : 100,
    }),
  );
}

/** Build `extensions.regex_scripts` from generated regex entries. */
export function regexFromGen(value: unknown): Array<Record<string, unknown>> {
  return coerceRegexScripts(value).map((raw) => ({
    scriptName: String(raw.scriptName ?? raw.name ?? '未命名'),
    findRegex: String(raw.findRegex ?? raw.find_regex ?? ''),
    replaceString: String(raw.replaceString ?? raw.replace_string ?? ''),
    placement: Number(raw.placement) === 2 ? 2 : 1,
    markdownOnly: raw.markdownOnly === true,
    promptOnly: raw.promptOnly === true,
    minDepth: Number.isFinite(Number(raw.minDepth)) ? Number(raw.minDepth) : 0,
    maxDepth: Number.isFinite(Number(raw.maxDepth)) ? Number(raw.maxDepth) : 0,
    enabled: raw.enabled !== false,
    ...(raw.flags !== undefined ? { flags: String(raw.flags) } : {}),
  }));
}

/** Assemble an `RPCard` from the parsed sections. */
export function cardFromSections(sections: CardGenSections, nameFallback = '未命名角色'): RPCard {
  const now = Date.now();
  const entries = entriesFromGen(sections.worldInfo);
  const regex = regexFromGen(sections.regexScripts);
  return {
    id: uid('card'),
    spec: 'v2',
    specVersion: '2.0',
    createdAt: now,
    updatedAt: now,
    data: {
      name: sections.name.trim() || nameFallback,
      description: sections.description.trim(),
      personality: sections.personality.trim(),
      scenario: sections.scenario.trim(),
      first_mes: cleanFirstMessage(sections.firstMessage),
      mes_example: '',
      creator_notes: sections.creatorNotes.trim(),
      system_prompt: sections.postHistoryInstructions.trim(),
      post_history_instructions: sections.postHistoryInstructions.trim(),
      tags: [],
      extensions: {
        ...(sections.avatarPrompt.trim() ? { avatar_prompt: sections.avatarPrompt.trim() } : {}),
        ...(regex.length ? { regex_scripts: regex } : {}),
      },
      // Card-embedded lorebook lives on `data`, matching the V2/V3 spec and the
      // importer, which reads `data.character_book`.
      ...(entries.length
        ? { character_book: { name: '世界书', entries: entries.map((e, i) => toCardEntry(e, i)) } }
        : {}),
    },
  };
}
