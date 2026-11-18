/**
 * 实验：把 26 个宿主模块的 shim 作为 hostModules 提供，看酒馆助手能否加载。
 *
 * 目的：用真实数据确认「宿主运行时」这条路走不走得通，以及接下来还缺什么。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const shims = JSON.parse(readFileSync('th-shims.json', 'utf8'));
const js = readFileSync('th-index.js', 'utf8');

// hostModules 的键 = 归一化宿主路径
const hostModules = {};
for (const [key, info] of Object.entries(shims)) {
  hostModules[key] = info.source;
}

const browserCode = `
  export async function apply(ctx) {
    const bridge = await import('/src/core/plugins/st-bridge.ts');
    const script = ${JSON.stringify(js)};
    const hostModules = ${JSON.stringify(hostModules)};
    window.__thProbe = {};
    try {
      const h = await bridge.activateSTExtension('st.th-probe', {
        manifest: { display_name: 'probe', js: 'dist/index.js' },
        entryPath: 'dist/index.js',
        script,
        hostModules,
      });
      window.__thProbe.activated = true;
      window.__thProbe.dispose = () => h.dispose();
    } catch (e) {
      window.__thProbe.error = String(e && e.message ? e.message : e).slice(0, 500);
    }
  }
`;

const zip = (await import('jszip')).default;
const z = new zip();
z.file('manifest.json', JSON.stringify({ id: 'com.probe.th', name: 'TH 探针', version: '1.0.0', apiVersion: 2 }));
z.file('plugin.js', browserCode);
writeFileSync('th-probe.rpnx', await z.generateAsync({ type: 'nodebuffer' }));
console.log('probe written; host modules:', Object.keys(hostModules).length);
