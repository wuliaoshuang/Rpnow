/**
 * Package a plugin directory into a `.rpnx` (a ZIP with manifest.json +
 * plugin.js + optional assets).
 *
 * A source directory keeps plugins reviewable in git; `.rpnx` is the install
 * artifact users open in the app.
 *
 * Usage: node scripts/build-plugin.mjs <plugin-dir> [out-file]
 */
import JSZip from 'jszip';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/build-plugin.mjs <plugin-dir> [out-file]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
for (const field of ['id', 'name', 'version', 'apiVersion', 'host']) {
  if (manifest[field] === undefined) {
    console.error(`manifest.json 缺少必填字段：${field}`);
    process.exit(1);
  }
}

const zip = new JSZip();

/** Add a file or directory recursively. */
function add(path, zipPath) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) add(join(path, entry), `${zipPath}/${entry}`);
    return;
  }
  zip.file(zipPath, readFileSync(path));
}

zip.file('manifest.json', JSON.stringify(manifest, null, 2));
add(join(dir, 'plugin.js'), 'plugin.js');
for (const extra of ['README.md', 'assets']) {
  try {
    add(join(dir, extra), extra);
  } catch {
    /* optional */
  }
}

const out = process.argv[3] ?? `${manifest.id}.rpnx`;
const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(out, buffer);
console.log(`打包完成：${out}（${(buffer.length / 1024).toFixed(1)} KB）`);
console.log(`  插件：${manifest.name} v${manifest.version} → ${basename(out)}`);
