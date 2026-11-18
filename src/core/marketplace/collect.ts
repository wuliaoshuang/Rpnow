/**
 * 从本地内容组装"可发布输入"，供打包器使用。
 *
 * 卡片：复用 `parser.ts` 的序列化（JSON/PNG），保证发布包里的 `card.json`
 * 与原导出完全一致；世界书/预设有值才附带。
 * 插件：直接取已安装记录（code + assets + manifest），保持 `.rpnx` 结构不变。
 */

import { toJsonBlob } from '../card/parser.js';
import type { RPCard, RPRegexScript } from '../types/card.js';
import type { RPCompletionPreset } from '../types/preset.js';
import type { InstalledPlugin } from '../plugins/rpnx.js';
import type { CardPackageInput, PluginPackageInput } from './packaging.js';
import type { PublishManifest } from './types.js';

export interface ScreenshotLike {
  name: string;
  bytes: Uint8Array;
}

/** 把 RPCard 序列化成发布包用的 `card.json` 结构。 */
async function cardToJsonObject(card: RPCard): Promise<Record<string, unknown>> {
  const text = await toJsonBlob(card, card.spec === 'v3' ? 'v3' : 'v2').text();
  return JSON.parse(text) as Record<string, unknown>;
}

export async function buildCardPackageInput(
  card: RPCard,
  manifest: Omit<PublishManifest, 'type'>,
  options: {
    avatar?: Uint8Array;
    worldbook?: Record<string, unknown>;
    preset?: RPCompletionPreset;
    regexScripts?: RPRegexScript[];
    screenshots?: ScreenshotLike[];
    readme?: string;
  } = {},
): Promise<CardPackageInput> {
  const cardObject = await cardToJsonObject(card);
  const preset = options.preset
    ? ({ ...options.preset, extensions: options.regexScripts ? { regex_scripts: options.regexScripts } : options.preset.extensions } as unknown as Record<string, unknown>)
    : undefined;
  return {
    manifest: { ...manifest, type: 'card' },
    card: cardObject,
    avatar: options.avatar,
    worldbook: options.worldbook,
    preset,
    screenshots: options.screenshots ?? [],
    readme: options.readme,
  };
}

export function buildPluginPackageInput(
  record: InstalledPlugin,
  manifest: Omit<PublishManifest, 'type'>,
  options: { screenshots?: ScreenshotLike[]; readme?: string } = {},
): PluginPackageInput {
  return {
    manifest: { ...manifest, type: 'plugin' },
    pluginManifest: record.manifest as unknown as Record<string, unknown>,
    entryName: 'plugin.js',
    entry: record.code,
    assets: record.assets ?? {},
    screenshots: options.screenshots ?? [],
    readme: options.readme,
  };
}
