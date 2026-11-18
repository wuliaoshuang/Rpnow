/**
 * Sandboxed UI-template card.
 *
 * The template HTML is rendered with the current variable state and loaded into
 * an iframe. The sandbox is deliberately permissive about forms/popups (RP-Hub
 * does the same) but the document is a throwaway `srcdoc` with no access to the
 * parent origin's storage, because `allow-same-origin` is required for the
 * self-resizing script to read the document height.
 *
 * Elements carrying `data-slash="…"` turn a click into a user message — the
 * "卡片交互" bridge.
 */

import * as React from 'react';
import type { RPUITemplate } from '@/core/uitemplate/types.js';
import { renderTemplate } from '@/core/uitemplate/engine.js';

const RESET_CSS = `
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:transparent;
    color:var(--rp-fg,#e8e6ea);
    font:14px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  }
  button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
  [data-slash]{cursor:pointer}
`;

/** Injected into every template document: auto-height + slash bridge. */
const BRIDGE_SCRIPT = `
(function () {
  function post(type, payload) {
    try { parent.postMessage(Object.assign({ __rpnowTemplate: true }, payload), '*'); } catch (e) {}
  }
  function resize() {
    var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    post('height', { height: h });
  }
  document.addEventListener('click', function (event) {
    var el = event.target.closest && event.target.closest('[data-slash]');
    if (!el) return;
    post('slash', { text: el.getAttribute('data-slash') || el.textContent || '' });
  });
  window.addEventListener('load', resize);
  if (document.readyState === 'complete') resize();
  setTimeout(resize, 0);
  try { new ResizeObserver(resize).observe(document.body); } catch (e) {}
})();
`;

export function buildTemplateDocument(template: RPUITemplate, state: Record<string, unknown>): string {
  const body = renderTemplate(template.htmlTemplate, state);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${RESET_CSS}</style><script>${BRIDGE_SCRIPT}<\/script></head><body>${body}</body></html>`;
}

export function TemplateCard({
  template,
  state,
  onSlash,
}: {
  template: RPUITemplate;
  state: Record<string, unknown>;
  onSlash?: (text: string) => void;
}) {
  const ref = React.useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = React.useState(120);
  const doc = React.useMemo(() => buildTemplateDocument(template, state), [template.htmlTemplate, state]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __rpnowTemplate?: boolean; type?: string; height?: number; text?: string };
      if (!data?.__rpnowTemplate) return;
      if (data.type === 'height' && typeof data.height === 'number') {
        setHeight(Math.max(40, Math.min(data.height, 600)));
      }
      if (data.type === 'slash' && typeof data.text === 'string' && data.text.trim() && onSlash) {
        onSlash(data.text.trim());
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSlash]);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]">
      <iframe
        ref={ref}
        title={template.name}
        srcDoc={doc}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-same-origin allow-downloads"
        style={{ width: '100%', height, border: 0, display: 'block' }}
      />
    </div>
  );
}
