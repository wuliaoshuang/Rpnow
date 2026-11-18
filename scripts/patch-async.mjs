import { readFileSync, writeFileSync } from 'node:fs';

const targets = [
  ['src/components/cards/CardLibrary.tsx', 366],
  ['src/components/chat/BranchPanel.tsx', 256],
  ['src/components/chat/SessionRail.tsx', 102],
  ['src/components/layout/ChatListPanel.tsx', 163],
  ['src/components/lore/LorebookEditor.tsx', 128],
  ['src/components/settings/TemplateSettingsPanel.tsx', 157],
  ['src/pages/ChatsPage.tsx', 136],
  ['src/pages/NovelPage.tsx', 475],
  ['src/pages/NovelPage.tsx', 565],
  ['src/pages/NovelPage.tsx', 656],
  ['src/pages/NovelPage.tsx', 813],
];

const byFile = new Map();
for (const [f, ln] of targets) {
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(ln);
}

for (const [f, lns] of byFile) {
  const raw = readFileSync(f, 'utf8');
  const isCrlf = raw.includes('\r\n');
  const lines = raw.split(/\r?\n/);
  const done = new Set();
  for (const ln of lns) {
    // walk up from the await line to the nearest handler opening line
    for (let j = ln - 1; j >= Math.max(0, ln - 40); j--) {
      const l = lines[j];
      if (/async\s*\(\s*\)/.test(l)) { j = -1; break; }
      if (l.includes('() =>') && !done.has(j)) {
        lines[j] = l.replace('() =>', 'async () =>');
        done.add(j);
        break;
      }
    }
  }
  writeFileSync(f, lines.join(isCrlf ? '\r\n' : '\n'), 'utf8');
  console.log('asyncified', f, [...done].join(','));
}
