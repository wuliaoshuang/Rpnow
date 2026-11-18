import { readFileSync, writeFileSync } from 'node:fs';

const targets = [
  ['src/components/cards/CardLibrary.tsx', [475, 537]],
  ['src/components/settings/MemorySettingsPanel.tsx', [316]],
  ['src/main.tsx', [333]],
  ['src/pages/LorePage.tsx', [56]],
  ['src/pages/NovelPage.tsx', [273]],
  ['src/pages/PresetsPage.tsx', [293]],
  ['src/pages/SettingsPage.tsx', [626, 627, 947, 1112, 1195]],
];

for (const [f, lns] of targets) {
  const raw = readFileSync(f, 'utf8');
  const isCrlf = raw.includes('\r\n');
  const lines = raw.split(/\r?\n/);
  const done = new Set();
  for (const ln of lns) {
    for (let j = ln - 1; j >= Math.max(0, ln - 40); j--) {
      const l = lines[j];
      if (/async\s*\(\s*\)|async function/.test(l)) break;
      if (l.includes('() =>') && !done.has(j)) {
        lines[j] = l.replace('() =>', 'async () =>');
        done.add(j);
        break;
      }
      if (/function\s+\w+\s*\([^)]*\)\s*\{/.test(l) && !/async/.test(l)) {
        lines[j] = l.replace('function ', 'async function ');
        done.add(j);
        break;
      }
    }
  }
  writeFileSync(f, lines.join(isCrlf ? '\r\n' : '\n'), 'utf8');
  console.log('asyncified', f, [...done].join(','));
}
