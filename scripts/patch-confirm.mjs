import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('Get-ChildItem -Recurse src -Include *.tsx,*.ts | Select-String -Pattern "window\\.confirm" | Select-Object -ExpandProperty Path', { shell: 'powershell.exe' })
  .toString()
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

for (const f of files) {
  let t = readFileSync(f, 'utf8');
  const before = t;

  // Wrap-expression variants (single-line EXPR only — verified by census).
  t = t.replace(/if \(window\.confirm\((.+?)\)\) \{/g, "if (await confirmAction({ title: '确认操作', description: $1 })) {");
  t = t.replace(/if \(window\.confirm\((.+?)\)\)/g, "if (await confirmAction({ title: '确认操作', description: $1 }))");

  // Auto-async: for each line with `await confirmAction`, walk up to the
  // nearest line containing a `() =>` handler start and make it async.
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('await confirmAction')) continue;
    for (let j = i; j >= Math.max(0, i - 40); j--) {
      const l = lines[j];
      if (/\(\s*async\s*\(\)/.test(l)) break; // already async
      const m = l.match(/\(\s*\(\)\s*=>/);
      if (m) {
        lines[j] = l.replace(/\(\s*\(\)\s*=>/, 'async () =>');
        break;
      }
      // `function foo() {` handlers become async too.
      const fm = l.match(/function\s+\w+\(\)\s*\{/);
      if (fm) {
        lines[j] = l.replace(/function\s+(\w+)\(\)\s*\{/, 'async function $1() {');
        break;
      }
      const fm2 = l.match(/const\s+(\w+)\s*=\s*\(\)\s*=>\s*\{/);
      if (fm2) {
        lines[j] = l.replace(/const\s+(\w+)\s*=\s*\(\)\s*=>\s*\{/, 'const $1 = async () => {');
        break;
      }
    }
  }
  t = lines.join('\n');

  if (t !== before && !t.includes("from '@/components/ui/confirm.js'")) {
    // Insert the import after the first existing import line.
    const lines2 = t.split('\n');
    const idx = lines2.findIndex((l, k) => k > 30 && /^import /.test(l));
    const lastImport = lines2.reduce((acc, l, k) => (/^import /.test(l) ? k : acc), 0);
    lines2.splice(lastImport + 1, 0, "import { confirmAction } from '@/components/ui/confirm.js';");
    t = lines2.join('\n');
  }
  if (t !== before) {
    writeFileSync(f, t, 'utf8');
    console.log('patched', f);
  }
}
