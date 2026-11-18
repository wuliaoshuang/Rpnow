/**
 * Verifies the documented plugin API actually works end to end:
 *   - ctx.mountSlot puts a component on screen at the named location
 *   - ctx.injectCss scopes selectors and CANNOT restyle the app shell
 *   - ctx.React / ctx.SLOT are present
 *   - dispose removes slots and styles
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const zip = new JSZip();
zip.file(
  'manifest.json',
  JSON.stringify({
    id: 'com.test.docs',
    name: '文档示例插件',
    version: '1.0.0',
    apiVersion: 2,
    author: 'test',
  }),
);
zip.file(
  'plugin.js',
  `export function apply(ctx) {
  const React = ctx.React;
  window.__apiProbe = {
    hasReact: Boolean(React && React.createElement),
    hasSlot: Boolean(ctx.SLOT && ctx.SLOT.COMPOSER),
    slotNames: Object.keys(ctx.SLOT || {}).length,
    hasMount: typeof ctx.mountSlot === 'function',
    hasInject: typeof ctx.injectCss === 'function',
  };

  // A deliberately hostile stylesheet: this is what used to break the app.
  ctx.injectCss(\`
    body { padding: 17px !important; margin: 3px !important; }
    .docs-badge {
      display: inline-block; padding: 4px 10px; border-radius: 999px;
      background: var(--rp-accent); color: var(--rp-accent-fg); font-size: 11px;
    }
  \`);

  ctx.mountSlot('chat.composer', function DocsBadge() {
    return React.createElement('div', { className: 'docs-badge', id: 'docs-badge' }, '插件已挂载');
  }, { order: 50 });
}`,
);
const ZIP = 'test-docs-plugin.rpnx';
writeFileSync(ZIP, await zip.generateAsync({ type: 'nodebuffer' }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'dp', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '文档测', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatdp', title: '文档测', cardId: 'dp', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('chatdp');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- install through the real parser + loader --------------------------
const installed = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/test-docs-plugin.rpnx');
  const parsed = await mod.parseRpnx(await res.blob());
  try { await mod.install(parsed, true); } catch (e) { return { installError: String(e.message).slice(0, 300) }; }
  const { reloadInstalledPlugins } = await import('/src/boot.ts');
  await reloadInstalledPlugins();
  await new Promise((r) => setTimeout(r, 400));
  const list = await mod.listInstalled();
  const rec = list.find((r) => r.manifest.id === 'com.test.docs');
  return { installed: Boolean(rec), enabled: rec?.enabled, probe: window.__apiProbe ?? null };
});
if (installed.installError) console.log('   INSTALL ERROR:', installed.installError);
check('插件已安装并启用', installed.installed === true && installed.enabled !== false, JSON.stringify(installed));
check('ctx.React 可用', installed.probe?.hasReact === true, JSON.stringify(installed.probe));
check('ctx.SLOT 可用', installed.probe?.hasSlot === true && installed.probe.slotNames >= 10, JSON.stringify(installed.probe));
check('ctx.mountSlot / ctx.injectCss 存在', installed.probe?.hasMount && installed.probe?.hasInject, '');

// ---- the slot actually renders into the composer area ------------------
await page.waitForTimeout(600);
const slot = await page.evaluate(() => {
  const badge = document.getElementById('docs-badge');
  if (!badge) return { rendered: false };
  const r = badge.getBoundingClientRect();
  return { rendered: true, width: Math.round(r.width), cls: badge.className };
});
check('mountSlot 组件渲染到聊天输入区', slot.rendered === true && slot.width > 0, JSON.stringify(slot));

// ---- THE KEY ASSERTION: hostile CSS must not touch the app shell ------
const shell = await page.evaluate(() => {
  const bodyStyle = getComputedStyle(document.body);
  const htmlStyle = getComputedStyle(document.documentElement);
  return {
    bodyPadding: bodyStyle.padding,
    bodyMargin: bodyStyle.margin,
    htmlPadding: htmlStyle.padding,
  };
});
check('插件的 body{padding:17px} 未生效', shell.bodyPadding === '0px', shell.bodyPadding);
check('插件的 body{margin:3px} 未生效', shell.bodyMargin === '0px', shell.bodyMargin);
check('html padding 仍为 0', shell.htmlPadding === '0px', shell.htmlPadding);

// The scoped rule should still exist, just narrowed.
const scoped = await page.evaluate(() => {
  const tag = document.querySelector('style[rpnow-plugin-style="com.test.docs"]');
  return tag ? tag.textContent : null;
});
check('样式被注入且带作用域', Boolean(scoped) && scoped.includes('data-rp-scope'), scoped ? scoped.slice(0, 80) : 'missing');
check('样式进入低优先级 @layer', Boolean(scoped) && /@layer rp-plugin-/.test(scoped), '');
check('插件自己的类名仍可用（.docs-badge）', Boolean(scoped) && scoped.includes('.docs-badge'), '');

// ---- dispose removes slot + styles -----------------------------------
const afterDispose = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  await mod.setEnabled('com.test.docs', false);
  const { reloadInstalledPlugins } = await import('/src/boot.ts');
  await reloadInstalledPlugins();
  await new Promise((r) => setTimeout(r, 500));
  return {
    badge: Boolean(document.getElementById('docs-badge')),
    style: Boolean(document.querySelector('style[rpnow-plugin-style="com.test.docs"]')),
  };
});
check('停用后组件被移除', afterDispose.badge === false, String(afterDispose.badge));
check('停用后样式被移除', afterDispose.style === false, String(afterDispose.style));

// cleanup
await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  await mod.uninstall('com.test.docs');
});
try {
  unlinkSync(ZIP);
} catch {
  /* ignore */
}
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
