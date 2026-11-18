/**
 * UI template engine.
 *
 * A UI template is an HTML fragment driven by a JSON variable state, rendered
 * into a sandboxed iframe. The syntax is deliberately a small Handlebars-like
 * subset:
 *
 *   {{ user.name }}                 — escaped interpolation
 *   {{#each items as item}}…{{/each}}
 *   {{#each items as item}}{{@index}}. {{item}}{{/each}}
 *   {{else}}                        — empty-list fallback inside #each
 *
 * Paths support `a.b`, `a['b']`, `$root`, `this`, `../`, and the loop locals
 * `@index`, `@number`, `@first`, `@last`, `@key`. Every interpolated value is
 * HTML-escaped — the state is data, never markup.
 *
 * Max nesting depth is 50 so a malformed template cannot blow the stack.
 */

export const MAX_NESTING = 50;

export interface RenderOptions {
  /** Extra CSS injected into the sandbox document. */
  css?: string;
  /** Called for values that cannot be resolved; defaults to empty string. */
  onMissing?: (path: string) => string;
}

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`=]/g, (c) => ESCAPE[c] ?? c);
}

/** Resolve a dotted path against a scope chain. */
export function resolvePath(
  path: string,
  scopes: Array<Record<string, unknown>>,
): { found: boolean; value: unknown } {
  const raw = path.trim();
  if (!raw) return { found: false, value: undefined };
  const root = scopes[0];

  if (raw === 'this') {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] !== undefined) return { found: true, value: scopes[i] };
    }
    return { found: false, value: undefined };
  }

  if (raw === '$root') {
    return { found: root !== undefined, value: root };
  }

  // `../` climbs one scope per segment; `$root.foo` always starts at the root.
  let scopeOffset = 0;
  let rest = raw;
  if (rest === '$root' || rest.startsWith('$root.')) {
    return resolveSegments(rest === '$root' ? [] : parseSegments(rest.slice(6)), root);
  }
  while (rest === '..' || rest.startsWith('../')) {
    scopeOffset += 1;
    rest = rest === '..' ? '' : rest.slice(3);
  }

  const segments = parseSegments(rest);
  if (!segments.length && scopeOffset === 0) return { found: false, value: undefined };

  const baseIndex = scopes.length - 1 - scopeOffset;
  if (baseIndex < 0) return { found: false, value: undefined };

  // Loop locals (`@index`, …) belong to the current iteration and must not be
  // looked up in an outer scope; ordinary keys fall back to outer scopes so a
  // partial item does not blank out values from the surrounding state.
  const localOnly = segments[0]?.startsWith('@') ?? false;
  for (let depth = baseIndex; depth >= 0; depth--) {
    const res = resolveSegments(segments, scopes[depth]);
    if (res.found) return res;
    if (localOnly) break;
  }
  return { found: false, value: undefined };
}

function resolveSegments(segments: string[], base: unknown): { found: boolean; value: unknown } {
  let current = base;
  for (const seg of segments) {
    if (seg === '') continue;
    if (seg.startsWith('@')) {
      if (current === null || typeof current !== 'object') return { found: false, value: undefined };
      const local = (current as Record<string, unknown>)[seg];
      if (local === undefined) return { found: false, value: undefined };
      current = local;
      continue;
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return { found: current !== undefined, value: current };
}

/** Split `a.b['c d']` into segments, ignoring whitespace. */
function parseSegments(path: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of path) {
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '.') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    if (ch === '[') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    if (ch === ']') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

interface EachBlock {
  type: 'each';
  path: string;
  alias: string;
  body: Node[];
  elseBody: Node[];
}

type Node = { type: 'text'; text: string } | { type: 'interp'; path: string } | EachBlock;

/** Parse a template into nodes. */
export function parseTemplate(template: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ block: EachBlock; body: Node[]; elseBody: Node[]; inElse: boolean }> = [];
  let buffer = '';

  const currentBody = () => {
    const top = stack[stack.length - 1];
    if (!top) return root;
    return top.inElse ? top.elseBody : top.body;
  };
  const flushText = () => {
    if (buffer) {
      currentBody().push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{{', i);
    if (open < 0) {
      buffer += template.slice(i);
      break;
    }
    buffer += template.slice(i, open);
    const close = template.indexOf('}}', open + 2);
    if (close < 0) {
      buffer += template.slice(open);
      break;
    }
    const expr = template.slice(open + 2, close).trim();

    if (expr.startsWith('#each')) {
      flushText();
      const match = /^#each\s+(.+?)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(expr);
      if (!match) {
        // Malformed block: treat literally so the user sees the mistake.
        buffer += template.slice(open, close + 2);
      } else {
        const block: EachBlock = { type: 'each', path: match[1], alias: match[2], body: [], elseBody: [] };
        currentBody().push(block);
        stack.push({ block, body: block.body, elseBody: block.elseBody, inElse: false });
      }
    } else if (expr === 'else') {
      flushText();
      const top = stack[stack.length - 1];
      if (top) top.inElse = true;
      else buffer += template.slice(open, close + 2);
    } else if (expr === '/each') {
      flushText();
      stack.pop();
      if (stack.length === 0 && !buffer) {
        // unmatched closing tag: ignore
      }
    } else {
      flushText();
      currentBody().push({ type: 'interp', path: expr });
    }
    i = close + 2;
  }
  flushText();
  return root;
}

/** Render a parsed template against a scope stack (root first). */
export function renderNodes(
  nodes: Node[],
  scopes: Array<Record<string, unknown>>,
  options: RenderOptions = {},
  depth = 0,
): string {
  if (depth > MAX_NESTING) return '';
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.text;
      continue;
    }
    if (node.type === 'interp') {
      const { found, value } = resolvePath(node.path, scopes);
      if (!found) {
        out += options.onMissing?.(node.path) ?? '';
      } else if (Array.isArray(value)) {
        out += escapeHtml(value.join(', '));
      } else {
        out += escapeHtml(value);
      }
      continue;
    }
    // #each
    const { found, value } = resolvePath(node.path, scopes);
    const list = found && Array.isArray(value) ? value : [];
    if (!list.length) {
      out += renderNodes(node.elseBody, scopes, options, depth + 1);
      continue;
    }
    list.forEach((item, index) => {
      const outer = scopes[scopes.length - 1];
      const itemScope: Record<string, unknown> = {
        ...(typeof item === 'object' && item ? (item as Record<string, unknown>) : {}),
        [node.alias]: item,
        '@index': index,
        '@number': index + 1,
        '@first': index === 0,
        '@last': index === list.length - 1,
        '@key': index,
      };
      // The loop scope shadows the outer one, but the outer scope stays
      // reachable through `../` because it is still on the stack.
      const nextScopes = [...scopes.slice(0, -1), { ...outer }, itemScope];
      out += renderNodes(node.body, nextScopes, options, depth + 1);
    });
  }
  return out;
}

/** Convenience: parse + render in one call. */
export function renderTemplate(template: string, state: unknown, options: RenderOptions = {}): string {
  return renderNodes(parseTemplate(template), [state as Record<string, unknown>], options);
}

// ------------------------------------------------------------- model updates

export interface TemplateUpdate {
  id: string;
  variables: Record<string, unknown>;
}

export const UPDATE_RE = /<ui_template_updates>([\s\S]*?)<\/ui_template_updates>/gi;

/** Extract and parse the `<ui_template_updates>` block from a reply. */
export function parseUpdates(text: string): TemplateUpdate[] | null {
  const matches = [...text.matchAll(UPDATE_RE)];
  if (!matches.length) return null;
  const out: TemplateUpdate[] = [];
  for (const match of matches) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const id = String(obj.id ?? '');
      if (!id) continue;
      out.push({ id, variables: (obj.variables ?? {}) as Record<string, unknown> });
    }
  }
  return out.length ? out : null;
}

/** Remove update blocks from a reply before it is stored/rendered. */
export function stripUpdateBlocks(text: string): string {
  return text.replace(UPDATE_RE, '').trim();
}

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a proposed variable state against a template's schema.
 *
 * The schema is the `variableSchema` map RP-Hub uses: `{path: type}`, where
 * type is one of string | number | boolean | array | object. Fields present in
 * the initial state are always allowed; new keys must be declared in the schema.
 */
export function validateVariables(
  variables: Record<string, unknown>,
  initial: Record<string, unknown>,
  schema: Record<string, string> = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    const known = key in initial || key in schema;
    if (!known) {
      errors.push({ path: key, message: `未声明的变量：${key}` });
      continue;
    }
    const expected = schema[key];
    if (!expected) continue;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (actual !== expected) {
      errors.push({ path: key, message: `${key} 应为 ${expected}，实际是 ${actual}` });
    }
  }
  return errors;
}

/** Diff two variable states, for the change log. */
export function diffVariables(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    const a = from[key];
    const b = to[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}
