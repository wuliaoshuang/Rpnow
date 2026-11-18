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
  t = t.replace(/if \(!window\.confirm\((.+?)\)\) return;/g, "if (!(await confirmAction({ title: '确认操作', description: $1 }))) return;");
  if (t !== before && !t.includes("from '@/components/ui/confirm.js'")) {
    const lines = t.split('\n');
    const lastImport = lines.reduce((acc, l, k) => (/^import /.test(l) ? k : acc), 0);
    lines.splice(lastImport + 1, 0, "import { confirmAction } from '@/components/ui/confirm.js';");
    t = lines.join('\n');
  }
  if (t !== before) {
    writeFileSync(f, t, 'utf8');
    console.log('patched', f);
  }
}
