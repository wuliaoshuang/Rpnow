/**
 * Adapter between the card-embedded book shape and RPNow's editable entry shape.
 *
 * `core/types/lorebook.ts` owns the conversions; this module re-exports them
 * under names the components import, and keeps the editor's imports stable when
 * the underlying modules move.
 */

export { fromCardEntry, toCardEntry, newEntry } from '../types/lorebook.js';
export type { RPCharacterBook, RPCharacterBookEntry } from '../types/card.js';
