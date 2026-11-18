import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(500);

const info = await page.evaluate(async () => {
  const out = { lsKeys: [], pluginRows: [], dbStores: {} };

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (/plugin|rpnx|st\./i.test(k)) {
      out.lsKeys.push({ key: k, len: (localStorage.getItem(k) ?? '').length });
    }
  }

  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    if (!d.name) continue;
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(d.name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      out.dbStores[d.name] = [...db.objectStoreNames];
      db.close();
    } catch {}
  }

  // Find the store that holds installed plugins and print only metadata.
  for (const d of dbs) {
    if (!d.name) continue;
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(d.name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      for (const store of [...db.objectStoreNames]) {
        const rows = await new Promise((res, rej) => {
          const tx = db.transaction(store, 'readonly');
          const q = tx.objectStore(store).getAll();
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        const arr = Array.isArray(rows) ? rows : [];
        const looksPlugin = arr.some((r) => r && typeof r === 'object' && 'manifest' in r && 'code' in r);
        if (looksPlugin) {
          out.pluginRows = arr.map((r) => {
            const m = r.manifest ?? {};
            return {
              id: m.id,
              name: m.name,
              version: m.version,
              kind: m.kind,
              stEntry: m.stEntry,
              origin: r.origin,
              enabled: r.enabled,
              codeLen: typeof r.code === 'string' ? r.code.length : 0,
              assetKeys: r.assets ? Object.keys(r.assets) : [],
            };
          });
        }
      }
      db.close();
    } catch {}
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
