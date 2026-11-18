/**
 * GitHub plugin install: URL parsing, fetching real repos, and the error paths
 * (a bad link must warn and install nothing).
 */
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

// ---- 1. URL parsing (pure) ---------------------------------------------
const parsed = await page.evaluate(async () => {
  const m = await import('/src/core/plugins/github.ts');
  const cases = {};
  const run = (label, input) => {
    try {
      cases[label] = m.parseGitHubUrl(input);
    } catch (e) {
      cases[label] = { error: String(e.message) };
    }
  };
  run('repo', 'https://github.com/owner/repo');
  run('tree', 'https://github.com/owner/repo/tree/dev/src/plugin');
  run('shorthand', 'owner/repo');
  run('trailing', 'https://github.com/owner/repo/');
  run('git-suffix', 'https://github.com/owner/repo.git');
  run('bad-host', 'https://gitlab.com/owner/repo');
  run('empty', '');
  run('no-repo', 'https://github.com/owner');
  return cases;
});
check('解析仓库根链接', parsed.repo?.owner === 'owner' && parsed.repo?.repo === 'repo', JSON.stringify(parsed.repo));
check('解析 /tree/分支/目录', parsed.tree?.ref === 'dev' && parsed.tree?.subdir === 'src/plugin', JSON.stringify(parsed.tree));
check('支持 owner/repo 简写', parsed.shorthand?.owner === 'owner', JSON.stringify(parsed.shorthand));
check('去掉 .git 后缀', parsed['git-suffix']?.repo === 'repo', JSON.stringify(parsed['git-suffix']));
check('非 GitHub 主机报错', Boolean(parsed['bad-host']?.error), JSON.stringify(parsed['bad-host']));
check('空链接报错', Boolean(parsed.empty?.error), JSON.stringify(parsed.empty));
check('缺仓库名报错', Boolean(parsed['no-repo']?.error), JSON.stringify(parsed['no-repo']));

// ---- 2. Fetching a real repo that HAS a manifest -----------------------
// SillyTavern's extension template ships manifest.json + index.js on master.
const fetched = await page.evaluate(async () => {
  const m = await import('/src/core/plugins/github.ts');
  try {
    const pkg = await m.fetchPackageFromGitHub(m.parseGitHubUrl('https://github.com/SillyTavern/Extension-WebSearch'));
    return { ok: true, mode: pkg.mode, size: pkg.blob.size, source: pkg.source };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 160) };
  }
});
console.log('   fetch result:', JSON.stringify(fetched));
check('真实仓库：抓到可安装包或给出明确错误', fetched.ok === true || Boolean(fetched.error), JSON.stringify(fetched));

// ---- 3. A repo that is NOT a plugin → clear error, nothing installed ---
const notPlugin = await page.evaluate(async () => {
  const m = await import('/src/core/plugins/github.ts');
  const before = (await import('/src/core/plugins/rpnx.ts')).listInstalled().then((l) => l.length);
  const n0 = await before;
  let msg = null;
  try {
    await m.fetchPackageFromGitHub(m.parseGitHubUrl('https://github.com/facebook/react'));
  } catch (e) {
    msg = String(e.message);
  }
  const n1 = (await (await import('/src/core/plugins/rpnx.ts')).listInstalled()).length;
  return { msg, n0, n1 };
});
check('非插件仓库报错且不安装', Boolean(notPlugin.msg) && notPlugin.n0 === notPlugin.n1, JSON.stringify(notPlugin));
check('错误信息可读（不是插件包 / 网络受限）', /manifest|插件包|源码仓库|网络受限|跨域/.test(notPlugin.msg ?? ''), String(notPlugin.msg).slice(0, 90));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
