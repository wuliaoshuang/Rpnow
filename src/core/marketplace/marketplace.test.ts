import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  CARD_CATEGORIES,
  categoryLabel,
  isValidCategory,
  listCategories,
  PLUGIN_CATEGORIES,
} from './categories.js';
import {
  buildCardPackage,
  buildPluginPackage,
  isNewerVersion,
  isPublishPackage,
  listScreenshots,
  makeMarketId,
  readPublishManifest,
  sha256Hex,
} from './packaging.js';
import { LICENSES, scanContent, scanPluginCode, validatePublishManifest } from './validate.js';
import type { PluginPublishManifest, PublishManifest } from './types.js';

function baseManifest(over: Partial<PublishManifest> = {}): PublishManifest {
  return {
    type: 'card',
    schema: 1,
    id: 'card.probe.my-card',
    name: '测试卡',
    version: '1.0.0',
    summary: '一句话简介',
    author: '探针',
    license: 'CC-BY-4.0',
    category: 'modern',
    tags: ['测试'],
    rating: 'sfw',
    contentWarnings: [],
    screenshots: [],
    createdAt: new Date(0).toISOString(),
    ...over,
    // 覆盖项可能把 type 换成 'plugin'，字面量类型推断会混用两个分支；
    // 测试辅助函数以运行期形状为准。
  } as unknown as PublishManifest;
}

describe('categories', () => {
  it('提供两类一级分类', () => {
    expect(listCategories('card').map((c) => c.id)).toContain('fantasy');
    expect(listCategories('plugin').map((c) => c.id)).toContain('render');
    expect(CARD_CATEGORIES.length).toBeGreaterThan(3);
    expect(PLUGIN_CATEGORIES.length).toBeGreaterThan(3);
  });

  it('校验分类归属并给显示名', () => {
    expect(isValidCategory('card', 'fantasy')).toBe(true);
    expect(isValidCategory('card', 'render')).toBe(false);
    expect(categoryLabel('fantasy')).toBe('奇幻');
    expect(categoryLabel('unknown-id')).toBe('unknown-id');
  });
});

describe('validatePublishManifest', () => {
  it('合法元数据通过', () => {
    const r = validatePublishManifest(baseManifest(), 'card');
    expect(r.errors).toEqual([]);
  });

  it('必填缺失逐条报错', () => {
    const r = validatePublishManifest(
      baseManifest({ name: '', summary: '', author: '', category: '', version: '1' }),
      'card',
    );
    expect(r.errors.join('\n')).toMatch(/名称|简介|作者|分类|version/);
  });

  it('id 必须带类型前缀', () => {
    expect(validatePublishManifest(baseManifest({ id: 'plugin.x.y' }), 'card').errors.join()).toMatch(/必须以 "card\." 开头/);
    expect(validatePublishManifest(baseManifest({ id: 'card.x.y' }), 'plugin').errors.join()).toMatch(/必须以 "plugin\." 开头/);
  });

  it('未知分类与未知许可被拒', () => {
    expect(validatePublishManifest(baseManifest({ category: 'nope' }), 'card').errors.length).toBeGreaterThan(0);
    expect(validatePublishManifest(baseManifest({ license: 'MIT-ish' }), 'card').errors.length).toBeGreaterThan(0);
    expect(LICENSES).toContain('CC-BY-NC-SA-4.0');
  });

  it('NSFW 只是警告；权限缺失也是警告', () => {
    const nsfw = validatePublishManifest(baseManifest({ rating: 'nsfw' }), 'card');
    expect(nsfw.errors).toEqual([]);
    expect(nsfw.warnings.join()).toMatch(/默认隐藏/);

    const plugin = validatePublishManifest(
      baseManifest({ type: 'plugin', id: 'plugin.a.b', permissions: [] }),
      'plugin',
    );
    expect(plugin.warnings.join()).toMatch(/未声明权限/);
  });

  it('插件未知权限被拒', () => {
    const r = validatePublishManifest(
      baseManifest({ type: 'plugin', id: 'plugin.a.b', permissions: ['nuclear'] as never }),
      'plugin',
    );
    expect(r.errors.join()).toMatch(/未知权限/);
  });
});

describe('packaging', () => {
  it('卡片发布包可读回元数据并列出截图', async () => {
    const blob = await buildCardPackage({
      manifest: baseManifest(),
      card: { spec: 'chara_card_v2', data: { name: '测试卡' } },
      worldbook: { entries: [] },
      screenshots: [{ name: 'cover.png', bytes: new Uint8Array([1, 2, 3]) }],
      readme: '# 说明',
    });
    expect(await isPublishPackage(blob)).toBe(true);
    const manifest = await readPublishManifest(blob);
    expect(manifest.name).toBe('测试卡');
    expect(manifest.type).toBe('card');
    expect(await listScreenshots(blob)).toEqual(['cover.png']);
  });

  it('插件发布包保留 .rpnx 结构 + publish.json', async () => {
    const blob = await buildPluginPackage({
      manifest: baseManifest({ type: 'plugin', id: 'plugin.probe.demo', permissions: ['network'] }),
      pluginManifest: { id: 'probe.demo', name: '探针插件', version: '1.0.0', apiVersion: 1 },
      entryName: 'plugin.js',
      entry: 'export function apply(ctx) {}',
      assets: { 'style.css': '.a{}' },
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('publish.json')).toBeTruthy();
    expect(zip.file('manifest.json')).toBeTruthy();
    expect(zip.file('plugin.js')).toBeTruthy();
    const manifest = await readPublishManifest(blob);
    expect((manifest as PluginPublishManifest).permissions).toEqual(['network']);
  });

  it('生成稳定 id 与版本比较', () => {
    expect(makeMarketId('card', '张三', '我的 卡片')).toBe('card.张三.我的-卡片');
    expect(makeMarketId('plugin', 'Alice', 'my.plugin')).toBe('plugin.alice.my-plugin');
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('sha256 稳定且随内容变化', async () => {
    const a = await sha256Hex(new TextEncoder().encode('rpnow'));
    const b = await sha256Hex(new TextEncoder().encode('rpnow'));
    const c = await sha256Hex(new TextEncoder().encode('other'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('内容安全扫描', () => {
  it('发现疑似密钥', () => {
    const findings = scanContent('api_key = "sk-abcdefghijklmnopqrstuvwxyz"');
    expect(findings.map((f) => f.kind)).toContain('secret');
  });

  it('干净文本不误报', () => {
    expect(scanContent('这是一段普通的角色设定。')).toEqual([]);
  });

  it('识别高风险插件代码', () => {
    expect(scanPluginCode('const s=document.createElement("script"); s.src=url;').length).toBeGreaterThan(0);
    expect(scanPluginCode('function add(a,b){return a+b}').length).toBe(0);
  });
});
