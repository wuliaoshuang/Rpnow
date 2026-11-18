/**
 * 发布前校验：元数据、语义化版本、许可，以及**内容安全扫描**。
 *
 * 两件事必须前置到发布阶段，而不是等用户安装后才发现：
 *   - 隐私：卡片文本里可能夹带 API key / token / 内部链接；
 *   - 风险：插件代码里可能有远程脚本注入、明文外发等行为（只提示，不拦截——
 *     浏览器端没有能力也不应假装能"判定恶意"）。
 */

import type { MarketKind, PublishManifest } from './types.js';
import { isValidCategory } from './categories.js';

/** 允许的 SPDX 简写 + 常见写法。 */
export const LICENSES = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'MIT',
  'Apache-2.0',
  'GPL-3.0-only',
  'AGPL-3.0-only',
  'LGPL-3.0-only',
  'BSD-3-Clause',
  'MPL-2.0',
  'Unlicense',
  'all-rights-reserved',
  'custom',
] as const;

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
/** Unicode 字母/数字（中文名可用），2–80 字符。 */
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{1,80}$/u;

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** 校验发布元数据。`kind` 决定 id 前缀与分类树。 */
export function validatePublishManifest(
  m: Partial<PublishManifest> | null | undefined,
  kind: MarketKind,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!m || typeof m !== 'object') return { errors: ['缺少 publish.json'], warnings };

  if (m.type !== kind) errors.push(`type 必须是 "${kind}"`);

  const expectedPrefix = kind === 'card' ? 'card.' : 'plugin.';
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    errors.push('id 必须是小写字母/数字/点/下划线/短横线组成（2–80 字符）');
  } else if (!m.id.startsWith(expectedPrefix)) {
    errors.push(`id 必须以 "${expectedPrefix}" 开头`);
  }

  if (!m.name?.trim()) errors.push('名称不能为空');
  if (m.name && m.name.length > 60) errors.push('名称不能超过 60 字');
  if (!m.summary?.trim()) errors.push('一句话简介不能为空');
  if (m.summary && m.summary.length > 120) warnings.push('简介偏长（建议 ≤120 字）');

  if (!SEMVER_RE.test(m.version ?? '')) errors.push('version 必须是语义化版本（如 1.2.0）');
  if (!LICENSES.includes(m.license as never)) errors.push('license 必须是已知许可或 custom');
  if ((m.license as string) === 'custom' && !m.homepage?.trim()) {
    warnings.push('自定义许可建议填写 homepage 以便他人查看条款');
  }

  if (!m.author?.trim()) errors.push('作者不能为空');
  if (!m.category || !isValidCategory(kind, m.category)) errors.push('请选择有效分类');
  if (!Array.isArray(m.tags) || m.tags.length === 0) warnings.push('建议至少添加一个标签，便于被搜索到');
  if (Array.isArray(m.tags) && m.tags.length > 12) warnings.push('标签过多会降低可检索性（建议 ≤12）');

  if (m.rating === 'nsfw') warnings.push('NSFW 内容将在商店中默认隐藏，需用户显式开启');
  if (!['sfw', 'suggestive', 'nsfw'].includes(m.rating ?? '')) errors.push('rating 只能是 sfw/suggestive/nsfw');

  if (!Array.isArray(m.screenshots)) errors.push('screenshots 必须是数组');
  if ((m.screenshots?.length ?? 0) > 6) errors.push('截图最多 6 张');

  if (kind === 'plugin') {
    if (!Array.isArray(m.permissions) || m.permissions.length === 0) {
      warnings.push('未声明权限；安装时将按"完全信任"提示');
    }
    const unknown = (m.permissions ?? []).filter(
      (p) => !['network', 'storage', 'clipboard', 'filesystem', 'render-injection', 'top-window'].includes(p),
    );
    if (unknown.length) errors.push(`未知权限：${unknown.join(', ')}`);
  }

  return { errors, warnings };
}

/** 版本比较（semver，忽略构建元数据）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10));
  const pb = b.split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export interface ScanFinding {
  level: 'warn' | 'block';
  kind: 'secret' | 'privacy' | 'risk';
  detail: string;
}

/** 疑似密钥/令牌（用于发布前的隐私自查）。 */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9_-]{16,}/g, label: 'OpenAI/兼容 API Key（sk-…）' },
  { re: /\bAKIA[0-9A-Z]{12,}\b/g, label: 'AWS Access Key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, label: 'GitHub Token' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\./g, label: 'JWT' },
  { re: /(Bearer|token|api[_-]?key)\s*[:=]\s*["'][^"']{12,}["']/gi, label: '疑似令牌赋值' },
];

/** 高风险代码模式（仅提示，不做判定）。 */
const RISK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /createElement\(\s*['"]script['"][\s\S]{0,200}?src\s*=/i, label: '动态注入外部 <script>' },
  { re: /eval\s*\(|new Function\s*\(/, label: '使用 eval/new Function 执行字符串' },
  { re: /fetch\s*\([\s\S]{0,120}(token|authorization)/i, label: '携带凭据发起网络请求' },
  { re: /localStorage[\s\S]{0,80}(token|password|authorization)/i, label: '读取本地存储中的敏感键' },
];

/** 扫描任意文本（卡片字段/README/插件源码），返回需要提示的条目。 */
export function scanContent(text: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const { re, label } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) out.push({ level: 'warn', kind: 'secret', detail: `检测到疑似密钥：${label}` });
  }
  return out;
}

/** 扫描插件代码里的风险模式。 */
export function scanPluginCode(code: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const { re, label } of RISK_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(code)) out.push({ level: 'warn', kind: 'risk', detail: label });
  }
  return out;
}
