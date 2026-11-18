/**
 * Runs a Tauri CLI command with the Android toolchain environment prepared.
 *
 * Android builds need JAVA_HOME / ANDROID_HOME / NDK_HOME pointing at a JDK 21+
 * and an NDK installed under `$ANDROID_HOME/ndk/<version>` (the Tauri CLI scans
 * that directory; it ignores NDK_HOME for discovery but the Rust build uses it).
 * Everything is discovered here so `pnpm build:android` works without the
 * developer setting variables by hand.
 *
 * Usage: node scripts/android-env.mjs tauri android build --apk
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';

const env = { ...process.env };

/** Find a JDK 21+ by checking JAVA_HOME then common install locations. */
function findJdk() {
  const candidates = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Java\\jdk-21',
    join(process.env.USERPROFILE ?? '', 'jdk', 'jdk-21.0.13+9'),
    '/usr/lib/jvm/java-21-openjdk',
  ].filter(Boolean);

  // Expand `jdk-21*` style folders that carry a patch suffix.
  const javaHome = 'C:\\Program Files\\Java';
  if (existsSync(javaHome)) {
    for (const d of readdirSync(javaHome)) {
      if (/^jdk-2[1-9]/.test(d)) candidates.push(join(javaHome, d));
    }
  }
  const userJdk = join(process.env.USERPROFILE ?? '', 'jdk');
  if (existsSync(userJdk)) {
    for (const d of readdirSync(userJdk)) {
      if (/^jdk-2[1-9]/.test(d)) candidates.push(join(userJdk, d));
    }
  }

  for (const c of candidates) {
    if (c && existsSync(join(c, 'bin', 'javac.exe'))) return c;
    if (c && existsSync(join(c, 'bin', 'javac'))) return c;
  }
  return null;
}

/** Find an NDK: prefer the versioned dir under $ANDROID_HOME/ndk, else any. */
function findNdk(androidHome) {
  const ndkRoot = join(androidHome, 'ndk');
  if (existsSync(ndkRoot)) {
    const versions = readdirSync(ndkRoot).filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort();
    if (versions.length) {
      // Highest version wins; Tauri needs 26+.
      return join(ndkRoot, versions[versions.length - 1]);
    }
  }
  if (process.env.NDK_HOME && existsSync(process.env.NDK_HOME)) return process.env.NDK_HOME;
  return null;
}

const androidHome =
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'D:\\asSdk';
const jdk = findJdk();
const ndk = findNdk(androidHome);

if (!jdk) {
  console.error('找不到 JDK 21+。请安装 JDK 21 或设置 JAVA_HOME。');
  process.exit(1);
}
if (!existsSync(androidHome)) {
  console.error(`找不到 Android SDK：${androidHome}。请设置 ANDROID_HOME。`);
  process.exit(1);
}

env.JAVA_HOME = jdk;
env.ANDROID_HOME = androidHome;
env.ANDROID_SDK_ROOT = androidHome;
if (ndk) env.NDK_HOME = ndk;
// Windows exposes the variable as `Path`; POSIX as `PATH`. Preserve whichever
// exists, otherwise the child process loses node/npm entirely.
const basePath = env.PATH ?? env.Path ?? '';
env.PATH = [
  join(jdk, 'bin'),
  join(androidHome, 'cmdline-tools', 'latest', 'bin'),
  join(androidHome, 'platform-tools'),
  basePath,
]
  .filter(Boolean)
  .join(delimiter);
if (!env.Path) delete env.Path;
env.Path = env.PATH;

if (!ndk) {
  console.warn(
    '警告：未找到 Android NDK。请执行：sdkmanager "ndk;27.0.12077973"',
  );
}

const [cmd, ...args] = process.argv.slice(2);
// Run through the shell so `.cmd` shims resolve on Windows.
const result = spawnSync(cmd, args, { stdio: 'inherit', env, shell: true });
process.exit(result.status ?? 1);
