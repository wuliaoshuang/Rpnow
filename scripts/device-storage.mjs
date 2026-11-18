import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
await page.waitForTimeout(500);

const info = await page.evaluate(async () => {
  const out = { localStorage: {}, idb: {} };

  // localStorage keys
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    const v = localStorage.getItem(k) ?? '';
    if (k.includes('plugin') || k.includes('rpnow')) {
      out.localStorage[k] = v.length > 400 ? v.slice(0, 400) + '…' : v;
    }
  }

  // IndexedDB: dump the plugins store directly
  const dbs = await indexedDB.databases();
  out.dbs = dbs.map((d) => d.name);
  for (const dbName of dbs.map((d) => d.name).filter(Boolean)) {
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(dbName);
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
        const slim = (rows ?? []).map((r) => {
          const s = { ...r };
          if (typeof s.code === 'string') s.code = `<${s.code.length} chars>`;
          if (s.assets) s.assets = Object.fromEntries(Object.entries(s.assets).map(([k, v]) => [k, typeof v === 'string' ? `<${v.length} chars>` : v]));
          return s;
        });
        out.idb[`${dbName}.${store}`] = Array.isArray(slim) ? slim.slice(0, 20) : slim;
      }
      db.close();
    } catch (e) {
      out.idb[dbName] = 'ERR ' + String(e.message).slice(0, 100);
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1).slice(0, 6000));
await browser.close();
