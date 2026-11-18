/** 尝试多条路径获取真实酒馆助手发布包。 */
import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const results = [];

async function tryUrl(label, url) {
  try {
    const resp = await page.request.get(url, { timeout: 25000 });
    const status = resp.status();
    const body = await resp.body();
    results.push({ label, url: url.slice(0, 90), status, bytes: body.length });
    if (status === 200 && body.length > 1000) {
      writeFileSync('tavern-helper-real.zip', body);
      results.push({ saved: 'tavern-helper-real.zip', bytes: body.length });
      return true;
    }
  } catch (e) {
    results.push({ label, url: url.slice(0, 90), error: String(e.message).slice(0, 120) });
  }
  return false;
}

// 直连 GitHub API / codeload
await tryUrl('api-search', 'https://api.github.com/search/repositories?q=JS-Slash-Runner+in:name&per_page=5');
await tryUrl('codeload-main', 'https://codeload.github.com/KAKAA/JS-Slash-Runner/zip/refs/heads/main');
await tryUrl('release-latest', 'https://api.github.com/repos/KAKAA/JS-Slash-Runner/releases/latest');

// 常见镜像
await tryUrl('ghproxy', 'https://ghproxy.net/https://github.com/KAKAA/JS-Slash-Runner/archive/refs/heads/main.zip');
await tryUrl('gh-proxy', 'https://gh-proxy.com/https://github.com/KAKAA/JS-Slash-Runner/archive/refs/heads/main.zip');
await tryUrl('ghfast', 'https://ghfast.top/https://github.com/KAKAA/JS-Slash-Runner/archive/refs/heads/main.zip');

console.log(JSON.stringify(results, null, 1));
console.log('saved?', existsSync('tavern-helper-real.zip'));
await browser.close();
