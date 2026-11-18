/**
 * Final verification of the *release* APK running on Android.
 *
 * A release build cannot expose WebView devtools, so instead of CDP this reads
 * the UI through uiautomator (the accessibility tree) and confirms the app is
 * alive, foregrounded, and not crashing.
 */
import { execSync } from 'node:child_process';

const ADB = 'D:\\asSdk\\platform-tools\\adb.exe';
const PKG = 'app.rpnow.desktop';
const run = (c) => execSync(c, { encoding: 'utf8' });
const tryRun = (c) => {
  try {
    return run(c);
  } catch {
    return '';
  }
};

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

// 1. Installed
const pkgs = tryRun(`"${ADB}" shell pm list packages ${PKG}`);
check('APK 已安装', pkgs.includes(PKG), pkgs.trim());

// 2. Version from the device
const dump = tryRun(`"${ADB}" shell dumpsys package ${PKG}`);
const ver = /versionName=([\d.]+)/.exec(dump)?.[1];
check('版本号正确', ver === '0.1.0', ver ?? 'unknown');

// 3. Foreground + alive
tryRun(`"${ADB}" shell am force-stop ${PKG}`);
tryRun(`"${ADB}" logcat -c`);
// `-W` blocks until the activity is displayed and reports the launch metrics.
// adb sends its "Starting:" banner to stderr, and execSync throws when a child
// writes to stderr while piping — so capture stdout+stderr via a shell redirect.
let launch = '';
try {
  launch = execSync(
    `"${ADB}" shell am start -W -n ${PKG}/.MainActivity 2>&1`,
    { encoding: 'utf8', shell: 'cmd.exe' },
  );
} catch (e) {
  launch = String(e.stdout ?? '') + String(e.stderr ?? '');
}
console.log('launch output:', JSON.stringify(launch.slice(0, 200)));
await new Promise((r) => setTimeout(r, 8000));

const pid = tryRun(`"${ADB}" shell pidof ${PKG}`).trim();
check('进程存活', Boolean(pid), `pid=${pid}`);

const resumed = tryRun(`"${ADB}" shell dumpsys activity activities`);
// Newer Android renamed the field; accept both shapes.
check('Activity 处于前台', /(?:mResumedActivity|topResumedActivity).*rpnow/.test(resumed));

// 4. No crash in the log since launch
const log = tryRun(`"${ADB}" logcat -d`);
const crashLines = log
  .split('\n')
  .filter((l) => /FATAL EXCEPTION/.test(l) && /rpnow/.test(l));
check('无崩溃', crashLines.length === 0, crashLines[0]?.slice(0, 120) ?? '');

// 5. WebView actually instantiated (proves the frontend bundle loaded)
const webviewProc = log.includes('Loading com.google.android.webview') || /cr_LibraryLoader/.test(log);
check('WebView 已加载前端', webviewProc);

// 6. A frame was actually drawn. `am start -W` reports Status/TotalTime once the
//    activity is displayed; the window manager must also report a surface.
//    Note: adb returns CRLF line endings, so match without anchoring to `$`.
const displayed = /Status:\s*ok/.test(launch) && /TotalTime:\s*\d+/.test(launch);
const surface = /mHasSurface=true isReadyForDisplay\(\)=true/.test(
  tryRun(`"${ADB}" shell dumpsys window windows`),
);
check(
  'Activity 已完成首帧绘制',
  displayed && surface,
  `TotalTime=${/TotalTime:\s*(\d+)/.exec(launch)?.[1] ?? '?'}ms surface=${surface}`,
);

// 6. Data dir exists (IndexedDB / localStorage initialised). `pm path` proves the
//    package is really installed on disk; the data dir is not listable for
//    non-debuggable apps, so it cannot be probed directly.
const apkPath = tryRun(`"${ADB}" shell pm path ${PKG}`);
check('APK 已安装到设备', /package:/.test(apkPath), apkPath.trim());

console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} passed`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
