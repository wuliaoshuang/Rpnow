/**
 * UI slot registry.
 *
 * Every renderable surface is a *slot*. A slot has built-in fallbacks supplied
 * by core plugins; a plugin that registers into a slot with `order` below the
 * fallback's replaces it. Removing the replacement restores the fallback.
 *
 * This is the UI half of "everything is a plugin": a theme plugin can replace
 * the chat view, a plugin can add a button to the composer, a plugin can replace
 * the whole card grid — without core knowing they exist.
 */

import * as React from 'react';

export type SlotComponent = React.ComponentType<Record<string, unknown>>;

export interface SlotEntry {
  id: string;
  slot: string;
  component: SlotComponent;
  order: number;
  /** Plugin that owns this entry (undefined for core). */
  owner?: string;
}

/** Names of all slots the shell renders. */
export const SLOT = {
  /** Full app shell (sidebar/nav + outlet). Replacing this re-skins everything. */
  APP_SHELL: 'app.shell',
  /** Primary navigation. */
  NAV: 'app.nav',
  /** Top bar. */
  TOPBAR: 'app.topbar',
  /** One message bubble. */
  MESSAGE: 'chat.message',
  /** The composer (input area). */
  COMPOSER: 'chat.composer',
  /** Right-hand side panel in the chat view. */
  CHAT_SIDEBAR: 'chat.sidebar',
  /** Card tile in the library grid. */
  CARD_TILE: 'cards.tile',
  /** Card editor body. */
  CARD_EDITOR: 'cards.editor',
  /** Lorebook entry row. */
  LORE_ENTRY: 'lore.entry',
  /** Settings page body. */
  SETTINGS: 'settings.body',
  /** Extra actions rendered into the message toolbar. */
  MESSAGE_ACTIONS: 'chat.message.actions',
  /** Global overlays (toasts, dialogs). */
  OVERLAY: 'app.overlay',
} as const;

export type SlotName = (typeof SLOT)[keyof typeof SLOT];

const entries = new Map<string, SlotEntry[]>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of [...listeners]) fn();
}

/**
 * Register a component into a slot.
 *
 * `order` decides precedence: the entry with the **lowest** order wins as the
 * slot's primary component. Fallbacks use order 100; anything lower replaces
 * them. Components at order >= 100 that are not the primary are rendered as
 * *additional* surfaces where the slot supports it (e.g. message actions).
 */
export function registerSlot(
  slot: string,
  component: SlotComponent,
  opts: { order?: number; owner?: string; id?: string } = {},
): () => void {
  const entry: SlotEntry = {
    id: opts.id ?? `${slot}:${Math.random().toString(36).slice(2, 8)}`,
    slot,
    component,
    order: opts.order ?? 100,
    owner: opts.owner,
  };
  const list = entries.get(slot) ?? [];
  list.push(entry);
  list.sort((a, b) => a.order - b.order);
  entries.set(slot, list);
  notify();
  return () => {
    const cur = entries.get(slot) ?? [];
    const idx = cur.findIndex((e) => e.id === entry.id);
    if (idx !== -1) cur.splice(idx, 1);
    notify();
  };
}

/** All entries for a slot, in precedence order. */
export function slotEntries(slot: string): SlotEntry[] {
  return entries.get(slot) ?? [];
}

/** The component that should render for this slot (lowest order), if any. */
export function primarySlot(slot: string): SlotComponent | undefined {
  return slotEntries(slot)[0]?.component;
}

export function subscribeSlots(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Remove every entry owned by a plugin (called when it deactivates). */
export function removeSlotsByOwner(owner: string): void {
  let changed = false;
  for (const [slot, list] of entries) {
    const next = list.filter((e) => e.owner !== owner);
    if (next.length !== list.length) {
      changed = true;
      if (next.length) entries.set(slot, next);
      else entries.delete(slot);
    }
  }
  if (changed) notify();
}

/** Snapshot of slot names with counts, for the plugin inspector. */
export function slotSummary(): Array<{ slot: string; count: number; owners: string[] }> {
  return [...entries.entries()].map(([slot, list]) => ({
    slot,
    count: list.length,
    owners: list.map((e) => e.owner ?? 'core'),
  }));
}

/**
 * Render helper: resolves a slot to its primary component, falling back to a
 * provided default. Used by the shell so pages never import concrete UI.
 */
export function useSlot(slot: string): SlotComponent | undefined {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeSlots(force), []);
  return primarySlot(slot);
}

/** Renders every entry in a slot in order (for additive slots). */
export function useSlots(slot: string): SlotEntry[] {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribeSlots(force), []);
  return slotEntries(slot);
}

/** Props handed to every slot component; providers may ignore them. */
export interface SlotOutletProps {
  /** Renders every contributor, in precedence order (additive use). */
  all?: boolean;
  /** Extra props forwarded to each component. */
  componentProps?: Record<string, unknown>;
}

/**
 * Renders a slot at an arbitrary place in the tree.
 *
 * This is what makes "a plugin may inject UI anywhere" true: drop
 * `<SlotOutlet slot={SLOT.X} />` into any component and every plugin registered
 * for that slot appears there — additively when `all` is set, otherwise the
 * single highest-precedence component.
 */
export function SlotOutlet({ slot, all = true, componentProps }: SlotOutletProps & { slot: string }) {
  const entries = useSlots(slot);
  if (!entries.length) return null;
  const list = all ? entries : entries.slice(0, 1);
  return React.createElement(
    React.Fragment,
    null,
    ...list.map((entry) => React.createElement(entry.component, { key: entry.id, ...componentProps })),
  );
}
