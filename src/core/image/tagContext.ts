/**
 * Prompt injection for the image tag converter.
 *
 * The tag converter rewrites a scene description into image tags. On its own
 * it only sees the description text, so it cannot know what the world's
 * people and places look like. This builds the same injection the chat
 * itself uses — but only the world book and the preset. The 正文 (the
 * description) is the user's own input and is sent as the user message, so
 * it is never part of the injected context.
 *
 *   - 世界书： entries activated by scanning the description for keywords
 *     (the same lorebook engine the chat uses, with the description as the
 *     scan text instead of the chat history). A fresh activation each time,
 *     so only entries the description actually mentions are included.
 *   - 预设： the preset's enabled system-prompt entries, macros resolved.
 */

import { activate, entriesToString } from '../lorebook/engine.js';
import { substituteMacros, type MacroContext } from '../prompt/macros.js';
import { fromCardEntry, type RPLorebook } from '../types/lorebook.js';
import type { RPCard } from '../types/card.js';
import type { RPChat, RPAppSettings } from '../types/chat.js';
import type { RPCompletionPreset } from '../types/preset.js';

/** Convert a card's embedded book to a lorebook object (character scope). */
function cardBookToLorebook(card: RPCard): RPLorebook | null {
  const book = card.data.character_book;
  if (!book?.entries?.length) return null;
  return {
    id: `cardbook:${card.id}`,
    name: book.name || `${card.data.name}角色书`,
    description: book.description,
    entries: book.entries.map((e, i) => fromCardEntry(e, i)),
    scanDepth: book.scan_depth ?? null,
    tokenBudget: book.token_budget ?? null,
    recursiveScanning: book.recursive_scanning ?? true,
    source: 'character',
    cardId: card.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Build the world-book + preset injection for a tag conversion.
 *
 * Returns '' when there is nothing to inject (no preset, no books, or no
 * entry matches the description). The caller prepends the result to the tag
 * conversion system prompt.
 */
export function buildTagInjection(input: {
  card: RPCard;
  chat: RPChat;
  preset: RPCompletionPreset | undefined;
  lorebooks: RPLorebook[];
  settings: RPAppSettings;
  personaName?: string;
  description: string;
}): string {
  const macroCtx: MacroContext = {
    char: input.card.data.name,
    user: input.personaName ?? 'User',
    charIfNotGroup: input.card.data.name,
    description: input.card.data.description,
    personality: input.card.data.personality,
    scenario: input.card.data.scenario,
    persona: undefined,
    getvar: (k) => String(input.chat.variables[k] ?? ''),
    setvar: (k, v) => {
      input.chat.variables[k] = v;
    },
  };

  const parts: string[] = [];

  // --- preset: enabled system-prompt entries, macros resolved. Marker
  // entries are injection points, not content, so they are skipped.
  if (input.preset) {
    const systemTexts = (input.preset.prompts ?? [])
      .filter(
        (p) =>
          p.role === 'system' &&
          p.system_prompt &&
          p.enabled !== false &&
          !p.marker &&
          p.content?.trim(),
      )
      .map((p) => substituteMacros(p.content!, macroCtx).trim())
      .filter(Boolean);
    if (systemTexts.length) parts.push(`[预设]\n${systemTexts.join('\n')}`);
  }

  // --- world book: entries activated by the description.
  const books: RPLorebook[] = [];
  if (input.chat.useCardLorebook) {
    const cb = cardBookToLorebook(input.card);
    if (cb) books.push(cb);
  }
  for (const id of input.chat.lorebookIds) {
    const b = input.lorebooks.find((x) => x.id === id);
    if (b) books.push(b);
  }
  if (books.length && input.description.trim()) {
    const result = activate({
      books,
      messages: [{ role: 'user', content: input.description }],
      defaults: input.settings.lorebook,
      cardFields: {
        description: input.card.data.description,
        personality: input.card.data.personality,
        scenario: input.card.data.scenario,
        creatorNotes: input.card.data.creator_notes,
      },
      macros: (text) => substituteMacros(text, macroCtx),
    });
    const wi = entriesToString(result.activated);
    if (wi) parts.push(`[世界书]\n${wi}`);
  }

  return parts.join('\n\n');
}
