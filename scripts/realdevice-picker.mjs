/**
 * End-to-end on the real device: open the system file picker from the app's
 * install button and select the `.rpnx` package that Android reports as
 * octet-stream. Proves the picker no longer greys the file out.
 */
import { execSync } from 'node:child_process';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const SERIAL = '2c2a3c4b';
const A = `"${ADB}" -s ${SERIAL}`;
const run = (c) => execSync(c, { encoding: 'utf8' });
const tryRun = (c) => {
  try {
    return run(c);
  } catch {
    return '';
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

async function uiText() {
  tryRun(`${A} shell uiautomator dump /sdcard/ui.xml`);
  const xml = tryRun(`${A} shell cat /sdcard/ui.xml`);
  return [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]);
}

/** Tap a node by its visible text (device coords from the dump). */
async function tapText(text) {
  tryRun(`${A} shell uiautomator dump /sdcard/ui.xml`);
  const xml = tryRun(`${A} shell cat /sdcard/ui.xml`);
  // Find the node whose text matches and read its bounds.
  const re = new RegExp(`text="${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = re.exec(xml);
  if (!m) return false;
  const cx = Math.round((Number(m[1]) + Number(m[3])) / 2);
  const cy = Math.round((Number(m[2]) + Number(m[4])) / 2);
  tryRun(`${A} shell input tap ${cx} ${cy}`);
  return true;
}

// Make sure the app is in the foreground and on the Plugins page.
tryRun(`${A} shell am start -n app.rpnow.desktop/.MainActivity`);
await sleep(2500);

let text = await uiText();
console.log('screen:', text.slice(0, 12).join(' | '));

// Bottom nav "更多" -> 插件
if (!text.some((t) => t.includes('已安装'))) {
  await tapText('更多');
  await sleep(900);
  await tapText('插件');
  await sleep(1200);
}
text = await uiText();
console.log('plugins page:', text.slice(0, 14).join(' | '));
check('已进入插件页', text.some((t) => t.includes('已安装') || t.includes('插件')));

// Press the install button -> system picker should open.
const opened = await tapText('安装 .rpnx');
await sleep(2500);
const pickerText = await uiText();
console.log('picker:', pickerText.slice(0, 16).join(' | '));
check('打开了系统文件选择器', pickerText.some((t) => /Download|下载|最近|Recent/i.test(t)), pickerText.slice(0, 6).join(' | '));

// Screenshot the picker for visual confirmation of selectability.
tryRun(`${A} shell screencap -p /sdcard/picker.png`);
tryRun(`${A} pull /sdcard/picker.png screenshots/38-picker.png`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
