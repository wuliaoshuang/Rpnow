/**
 * UI template types.
 *
 * A template pairs an HTML fragment with a JSON variable state. The model can
 * update the state (main-model mode via `<ui_template_updates>`), and the HTML is
 * rendered into a sandboxed iframe. Templates are either scoped to one
 * character or global, and render above or below the assistant message.
 */

export type TemplateScope = 'character' | 'global';
export type TemplatePlacement = 'top' | 'bottom';

export interface TemplateChange {
  id: string;
  time: number;
  source: 'main' | 'sub' | 'manual';
  model?: string;
  turn?: number;
  changes: Record<string, { from: unknown; to: unknown }>;
}

export interface RPUITemplate {
  id: string;
  name: string;
  enabled: boolean;
  scope: TemplateScope;
  /** Scope id: a character id, or `global`. */
  scopeId: string;
  order: number;
  placement: TemplatePlacement;
  htmlTemplate: string;
  /** Baseline state; also the whitelist of allowed keys. */
  initialVariableState: Record<string, unknown>;
  variableState: Record<string, unknown>;
  /** Declared types for keys the model may add. */
  variableSchema: Record<string, string>;
  changeLog: TemplateChange[];
}

export const MAX_CHANGE_LOG = 50;

export function createTemplate(partial: Partial<RPUITemplate> & { name: string }): RPUITemplate {
  return {
    id: partial.id ?? `tpl_${Math.random().toString(36).slice(2)}`,
    name: partial.name,
    enabled: partial.enabled ?? true,
    scope: partial.scope ?? 'character',
    scopeId: partial.scopeId ?? 'global',
    order: partial.order ?? 0,
    placement: partial.placement ?? 'bottom',
    htmlTemplate: partial.htmlTemplate ?? '<div class="rp-tpl">{{name}}</div>',
    initialVariableState: partial.initialVariableState ?? {},
    variableState: partial.variableState ?? partial.initialVariableState ?? {},
    variableSchema: partial.variableSchema ?? {},
    changeLog: partial.changeLog ?? [],
  };
}
