/**
 * 依赖完整性审计：源码里的「裸导入」是否都在 package.json 里声明。
 * 用途：保证别人 clone 后能构建（干净环境不会碰巧有传递依赖）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...walk(join(root, 'src'))];
const found = new Map(); // spec -> [files]
const re = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  // 去掉注释，避免注释里出现的包名被当成真实导入
  const text = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  let m;
  while ((m = re.exec(text))) {
    const spec = m[2];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    if (spec.startsWith('@/') || spec === '…' || spec.startsWith('…')) continue; // 路径别名与省略号
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(f.replace(root + '/', ''));
  }
}

const missing = [];
for (const [name, where] of [...found.entries()].sort()) {
  if (!declared.has(name)) missing.push({ name, where: where.slice(0, 3) });
}

console.log(`裸导入模块 ${found.size} 个，已声明 ${found.size - missing.length} 个`);
if (missing.length) {
  console.log('\n缺少声明的依赖：');
  for (const m of missing) console.log(`  ${m.name}  <- ${m.where.join(', ')}`);
  process.exit(1);
} else {
  console.log('全部已声明 ✓');
}
