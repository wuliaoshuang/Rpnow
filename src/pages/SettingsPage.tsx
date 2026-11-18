/**
 * Settings.
 *
 * This is the heaviest form in the product, so it is organised the way users
 * actually think:
 *
 *   模型  → connections + model picker (the first thing anyone must do)
 *   图像  → GPT Image / Seedream / NovelAI
 *   外观  → theme, font size, message width
 *   对话  → prompt assembly switches, streaming, reasoning visibility
 *   身份  → personas
 *   网络  → proxy
 *   数据  → backup / restore / reset
 *
 * Form rules applied: label above input, helper text explaining consequences,
 * inline validation for URLs/keys, explicit "test connection" feedback, and
 * destructive actions fenced behind confirmation + a clear description of scope.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Download,
  FlaskConical,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import { useApp } from '@/state/store.js';
import { PROVIDERS, providersByGroup, providerInfo } from '@/core/llm/providers.js';
import { BUILTIN_IMAGE_ADAPTERS } from '@/core/image/types.js';
import { BUILTIN_THEMES } from '@/core/defaults/themes.js';
import { exportAll, importAll } from '@/core/storage/index.js';
import { applyTheme } from '@/boot.js';
import { useLLM } from '@/hooks/useKernel.js';
import type { LLMConnection } from '@/core/llm/types.js';
import type { ImageConnection } from '@/core/image/types.js';
import type { RPPersona } from '@/core/types/chat.js';
import { MemorySettingsPanel } from '@/components/settings/MemorySettingsPanel.js';
import { ToolSettingsPanel } from '@/components/settings/ToolSettingsPanel.js';
import { TemplateSettingsPanel } from '@/components/settings/TemplateSettingsPanel.js';
import { ImageGenSettingsPanel } from '@/components/settings/ImageGenSettingsPanel.js';
import { BackupSettingsPanel } from '@/components/settings/BackupSettingsPanel.js';
import { blobToDataUrl } from '@/core/card/parser.js';
import { Button } from '@/components/ui/button.js';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
} from '@/components/ui/input.js';
import { Badge, EmptyState, Hint } from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { cn, downloadBlob, uid } from '@/lib/utils.js';
import { runtime, providerNeedsProxy } from '@/lib/runtime.js';
import { SettingsHub } from './SettingsHub.js';
import { SLOT, SlotOutlet } from '@/core/plugin/slots.js';
import { hapticsSupported, vibratePreview } from '@/lib/haptics';
import { confirmAction } from '@/components/ui/confirm.js';

export function SettingsPage({
  /** Current sub-route section; `undefined` = hub directory. */
  section,
  /** Navigate to a section (URL-driven — the shell header owns the back). */
  onOpenSection,
  /** Opens the standalone plugins page from the hub. */
  onOpenPlugins,
  /** Opens sibling content pages (世界书/预设/小说). */
  onOpenRoute,
}: {
  section?: string;
  onOpenSection?: (id: string) => void;
  onOpenPlugins?: () => void;
  onOpenRoute?: (route: 'lore' | 'presets' | 'novel') => void;
} = {}) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const fileInput = useRef<HTMLInputElement>(null);
  /*
   * Fully controlled by the app's flat sub-route (`#/settings/models`) —
   * NO nested router and NO in-page header: the shell top bar renders the
   * back chevron and the section title for us.
   */

  // ---------------------------------------------------------------- hub view
  if (!section) {
    return (
      <div className="rp-scroll h-full overflow-y-auto">
        {/* Padding lives only here — the hub adds none, so margins stay tight. */}
        <div className="mx-auto max-w-2xl py-3">
          <SettingsHub onOpen={(id) => onOpenSection?.(id)} onOpenPlugins={onOpenPlugins} onOpenRoute={onOpenRoute} />
          {/* Plugins may append their own settings sections. */}
          <SlotOutlet slot={SLOT.SETTINGS} />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- section view
  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <>

          {/* ------------------------------------------------------ models */}
          {section === 'models' && (
          <div>
            <ModelSettings />
          </div>
          )}

          {/* ------------------------------------------------------- image */}
          {section === 'image' && (
          <div>
            <ImageSettings />
          </div>
          )}

          {/* -------------------------------------------------- appearance */}
          {section === 'appearance' && (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">主题</h3>
              <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
                主题本身也是插件：安装一个主题类 .rpnx 插件即可替换这里的全部配色。
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {BUILTIN_THEMES.map((t) => {
                  const active = settings.themeId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setSettings({ themeId: t.id });
                        applyTheme(t.id);
                      }}
                      aria-pressed={active}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                        active
                          ? 'border-[var(--rp-accent)] bg-[var(--rp-accent-soft)]/40'
                          : 'border-[var(--rp-border)] hover:bg-[var(--rp-bg-sunken)]',
                      )}
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 gap-0.5 overflow-hidden rounded-md border border-[var(--rp-border)]">
                        {['--rp-bg', '--rp-accent', '--rp-fg'].map((k) => (
                          <span key={k} className="h-full flex-1" style={{ background: t.tokens[k] }} />
                        ))}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                          {t.label}
                          {active && <Check className="size-3.5 text-[var(--rp-accent)]" aria-hidden="true" />}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--rp-fg-muted)]">
                          {t.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">阅读</h3>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>正文字号</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                    {settings.render.fontSize}px
                  </span>
                </div>
                <Slider
                  value={[settings.render.fontSize]}
                  min={13}
                  max={20}
                  step={1}
                  onValueChange={([v]) => setSettings({ render: { ...settings.render, fontSize: v } })}
                  aria-label="正文字号"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="width">消息宽度</Label>
                <Select
                  value={settings.render.messageWidth}
                  onValueChange={(v) =>
                    setSettings({ render: { ...settings.render, messageWidth: v as 'narrow' | 'full' } })
                  }
                >
                  <SelectTrigger id="width">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narrow">窄栏（阅读更舒适）</SelectItem>
                    <SelectItem value="full">宽栏（信息更多）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">触感反馈</h3>
              <div className="space-y-1">
                <ToggleRow
                  id="haptics-enabled"
                  label="按键振动"
                  hint="点击导航、发送、开关等操作时短振一下（仅安卓等有振动马达的设备）。"
                  checked={settings.haptics.enabled}
                  onChange={(v) => setSettings({ haptics: { ...settings.haptics, enabled: v } })}
                />
                <ToggleRow
                  id="haptics-message"
                  label="消息到达振动"
                  hint="AI 回复开始输出时轻振一下，不用盯着屏幕也知道回复来了。"
                  checked={settings.haptics.onMessage}
                  onChange={(v) => setSettings({ haptics: { ...settings.haptics, onMessage: v } })}
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => vibratePreview()}>
                    测试振动
                  </Button>
                  {!hapticsSupported() && (
                    <span className="text-[11px] text-[var(--rp-fg-subtle)]">
                      当前设备不支持振动（桌面浏览器 / 无振动马达）
                    </span>
                  )}
                </div>
              </div>
            </section>
          </div>
          )}

          {/* -------------------------------------------------------- chat */}
          {section === 'chat' && (
          <div className="space-y-4">
            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">提示词组装</h3>
              <ToggleRow
                id="prefer-char-prompt"
                label="角色卡的 system_prompt 覆盖预设主提示"
                hint="开启后，卡片自带的主提示生效；其中的 {{original}} 会替换为预设原本的主提示。"
                checked={settings.chat.preferCharacterPrompt}
                onChange={(v) => setSettings({ chat: { ...settings.chat, preferCharacterPrompt: v } })}
              />
              <ToggleRow
                id="prefer-char-jb"
                label="角色卡的 post_history_instructions 覆盖越狱位"
                hint="注入在聊天记录之后，用于强化格式与语气。"
                checked={settings.chat.preferCharacterJailbreak}
                onChange={(v) => setSettings({ chat: { ...settings.chat, preferCharacterJailbreak: v } })}
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>聊天记录长度预算</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                    {settings.chat.historyBudgetChars.toLocaleString()} 字
                  </span>
                </div>
                <Slider
                  value={[settings.chat.historyBudgetChars]}
                  min={2000}
                  max={120000}
                  step={1000}
                  onValueChange={([v]) => setSettings({ chat: { ...settings.chat, historyBudgetChars: v } })}
                  aria-label="聊天记录长度预算"
                />
                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  未设置「上下文长度」时生效；超出部分会从最早的消息开始丢弃。
                </p>
              </div>

              {/* Token limits — 0 means unlimited (no truncation). */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="max-output-tokens">最大输出 token</Label>
                  <Input
                    id="max-output-tokens"
                    inputMode="numeric"
                    value={String(settings.chat.maxTokens)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0));
                      setSettings({ chat: { ...settings.chat, maxTokens: v } });
                    }}
                    aria-label="最大输出 token，0 表示无限制"
                  />
                  <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                    输入 0 视为无限制，请求不再携带 max_tokens，防止长回复被截断。
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="context-tokens">上下文长度（token）</Label>
                  <Input
                    id="context-tokens"
                    inputMode="numeric"
                    value={String(settings.chat.contextTokens)}
                    onChange={(e) => {
                      const v = Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0));
                      setSettings({ chat: { ...settings.chat, contextTokens: v } });
                    }}
                    aria-label="上下文长度 token，默认跟随模型上限，未知时填 1000000"
                  />
                  <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                    跟随所用模型的上下文上限；把握不准就保持默认 1000000，基本等于不裁剪。
                  </p>
                </div>
              </div>

              {/* Auto-compress threshold (works regardless of memory mode). */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="compress-threshold">自动压缩阈值</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                    {settings.chat.compressThresholdPct ?? 80}% 上下文
                  </span>
                </div>
                <Slider
                  id="compress-threshold"
                  value={[settings.chat.compressThresholdPct ?? 80]}
                  min={50}
                  max={95}
                  step={5}
                  onValueChange={([v]) => setSettings({ chat: { ...settings.chat, compressThresholdPct: v } })}
                  aria-label="上下文自动压缩阈值百分比"
                />
                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  占用达到该比例时，较早楼层自动折叠为一条「前情摘要」并弹出提醒（记忆关闭时同样生效）。
                </p>
              </div>
              <ToggleRow
                id="prevent-truncation"
                label="Gemini 抗截断（提交正文到 output_reply 工具）"
                hint="仅对 Gemini 模型生效。开启后正文通过工具提交，避免长回复被截断；空回最多重试 3 次。"
                checked={settings.chat.preventTruncation}
                onChange={(v) => setSettings({ chat: { ...settings.chat, preventTruncation: v } })}
              />
              <div className="space-y-1.5">
                <Label htmlFor="reasoning-effort">推理强度</Label>
                <Select
                  value={settings.chat.reasoningEffort}
                  onValueChange={(v) =>
                    setSettings({
                      chat: { ...settings.chat, reasoningEffort: v as typeof settings.chat.reasoningEffort },
                    })
                  }
                >
                  <SelectTrigger id="reasoning-effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">默认（跟随服务商）</SelectItem>
                    <SelectItem value="none">关闭</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="max">最高</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  以 <code className="rounded bg-[var(--rp-bg-sunken)] px-1">reasoning_effort</code> 传给支持该参数的
                  服务商（OpenRouter / DeepSeek 等），各家语义略有差异。
                </p>
              </div>
              <ToggleRow
                id="use-char-bg"
                label="使用角色封面背景"
                hint="把角色头像模糊后铺在聊天背景里；关闭后使用纯色背景。"
                checked={settings.render.useCharacterBackground}
                onChange={(v) => setSettings({ render: { ...settings.render, useCharacterBackground: v } })}
              />
              <ToggleRow
                id="immersive-mode"
                label="沉浸模式"
                hint="隐藏部分界面边框，让正文占满屏幕。"
                checked={settings.render.immersiveMode}
                onChange={(v) => setSettings({ render: { ...settings.render, immersiveMode: v } })}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">触感反馈</h3>
              <div className="space-y-1">
                <ToggleRow
                  id="haptics-enabled"
                  label="按键振动"
                  hint="点击导航、发送、开关等操作时短振一下（仅安卓等有振动马达的设备）。"
                  checked={settings.haptics.enabled}
                  onChange={(v) => setSettings({ haptics: { ...settings.haptics, enabled: v } })}
                />
                <ToggleRow
                  id="haptics-message"
                  label="消息到达振动"
                  hint="AI 回复开始输出时轻振一下，不用盯着屏幕也知道回复来了。"
                  checked={settings.haptics.onMessage}
                  onChange={(v) => setSettings({ haptics: { ...settings.haptics, onMessage: v } })}
                />
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      vibratePreview();
                    }}
                  >
                    测试振动
                  </Button>
                  {!hapticsSupported() && (
                    <span className="text-[11px] text-[var(--rp-fg-subtle)]">
                      当前设备不支持振动（桌面浏览器 / 无振动马达）
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">世界书</h3>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>扫描深度（最近 N 条消息）</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                    {settings.lorebook.scanDepth}
                  </span>
                </div>
                <Slider
                  value={[settings.lorebook.scanDepth]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([v]) => setSettings({ lorebook: { ...settings.lorebook, scanDepth: v } })}
                  aria-label="世界书扫描深度"
                />
              </div>
              <ToggleRow
                id="recursive"
                label="启用递归扫描"
                hint="被激活的条目内容里出现的关键词，可以继续触发其他条目。"
                checked={settings.lorebook.recursiveScanning}
                onChange={(v) => setSettings({ lorebook: { ...settings.lorebook, recursiveScanning: v } })}
              />
            </section>

            <section className="space-y-3">
              <h3 className="text-[13px] font-semibold">显示</h3>
              <ToggleRow
                id="stream"
                label="流式输出"
                hint="边生成边显示。关闭后等完整回复再出现（某些卡的中文排版更稳定）。"
                checked={settings.chat.streamResponses}
                onChange={(v) => setSettings({ chat: { ...settings.chat, streamResponses: v } })}
              />
              <ToggleRow
                id="reasoning"
                label="显示思考过程"
                hint="推理模型（如 DeepSeek R1）的思考内容会折叠显示，不进入对话记录。"
                checked={settings.chat.showReasoning}
                onChange={(v) => setSettings({ chat: { ...settings.chat, showReasoning: v } })}
              />
              <ToggleRow
                id="external-media"
                label="允许显示外部图片"
                hint="关闭时，角色卡里引用的外链图片会被拦截，避免追踪像素与意外加载。"
                checked={settings.render.allowExternalMedia}
                onChange={(v) => setSettings({ render: { ...settings.render, allowExternalMedia: v } })}
              />
              <ToggleRow
                id="sandbox-html"
                label="渲染卡片 HTML（沙盒隔离）"
                hint="开启后卡片里的完整 HTML 页面与 ```html 代码块会在隔离框架内渲染出真实效果；关闭则直接显示源代码。"
                checked={settings.render.sandboxHtml}
                onChange={(v) => setSettings({ render: { ...settings.render, sandboxHtml: v } })}
              />
            </section>
          </div>
          )}

          {/* --------------------------------------------------------- persona */}
          {section === 'persona' && (
          <div>
            <PersonaSettings />
          </div>
          )}

          {/* -------------------------------------------------------- memory */}
          {section === 'memory' && (
          <div>
            <MemorySettingsPanel />
          </div>
          )}

          {/* --------------------------------------------------------- tools */}
          {section === 'tools' && (
          <div>
            <ToolSettingsPanel />
          </div>
          )}

          {/* ----------------------------------------------------- templates */}
          {section === 'templates' && (
          <div>
            <TemplateSettingsPanel />
          </div>
          )}

          {/* ------------------------------------------------------ imagegen */}
          {section === 'imagegen' && (
          <div>
            <ImageGenSettingsPanel />
          </div>
          )}

          {/* -------------------------------------------------------- backup */}
          {section === 'backup' && (
          <div>
            <BackupSettingsPanel />
          </div>
          )}

          {/* ----------------------------------------------------- network */}
          {section === 'network' && (
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--rp-warn)]/40 bg-[var(--rp-warn)]/10 p-3 text-[12px] leading-relaxed">
              <p className="mb-1 flex items-center gap-1.5 font-semibold">
                <CircleAlert className="size-3.5" aria-hidden="true" /> 为什么需要代理
              </p>
              <p className="text-[var(--rp-fg-muted)]">
                OpenAI、NovelAI、火山方舟等接口不发送 CORS 头，浏览器无法直接访问。填写一个转发地址即可解决；
                本地运行时也可以用自建的反向代理。
              </p>
              {runtime.desktop && (
                <p className="mt-1.5 text-[var(--rp-success,var(--rp-ok))]">
                  ✓ 当前运行于桌面版：请求由系统原生发出，不受 CORS 限制，通常无需配置代理。
                </p>
              )}
            </div>
            <ToggleRow
              id="proxy"
              label="启用请求代理"
              hint="仅对不支持浏览器直连的服务商生效。"
              checked={settings.network.proxyEnabled}
              onChange={(v) => setSettings({ network: { ...settings.network, proxyEnabled: v } })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="proxy-url">代理地址</Label>
              <Input
                id="proxy-url"
                value={settings.network.proxyUrl}
                onChange={(e) => setSettings({ network: { ...settings.network, proxyUrl: e.target.value } })}
                placeholder="https://your-proxy.example.com/v1"
                aria-describedby="proxy-hint"
              />
              <p id="proxy-hint" className="text-[11px] text-[var(--rp-fg-subtle)]">
                需为 OpenAI 兼容的转发地址。桌面版 RPNow 可内置本地转发，无需第三方服务。
              </p>
            </div>
          </div>
          )}

          {/* -------------------------------------------------------- data */}
          {section === 'data' && (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">备份与恢复</h3>
              <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
                备份包含角色卡、聊天记录、世界书、预设、身份与 API 配置。文件含密钥，请妥善保管。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const blob = await exportAll();
                    downloadBlob(blob, `rpnow-backup-${new Date().toISOString().slice(0, 10)}.json`);
                    toast.success('备份已导出');
                  }}
                >
                  <Download className="size-3.5" aria-hidden="true" /> 导出全部数据
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      await importAll(f);
                      await useApp.getState().reloadAll();
                      toast.success('恢复完成，正在重新加载…');
                      setTimeout(() => location.reload(), 600);
                    } catch (err) {
                      toast.error('恢复失败', err instanceof Error ? err.message : String(err));
                    }
                    e.target.value = '';
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-3.5" aria-hidden="true" /> 从备份恢复
                </Button>
              </div>
            </section>

            <section className="space-y-2 rounded-lg border border-[var(--rp-danger)]/30 p-3">
              <h3 className="text-[13px] font-semibold text-[var(--rp-danger)]">危险操作</h3>
              <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
                清空浏览器中的所有 RPNow 数据（角色卡、聊天、设定）。此操作不可撤销。
              </p>
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  if (!(await confirmAction({ title: '确认操作', description: '确定要清空全部数据吗？建议先导出备份。' }))) return;
                  if (!(await confirmAction({ title: '确认操作', description: '最后确认：所有角色卡和聊天记录都会永久删除。' }))) return;
                  localStorage.clear();
                  const req = indexedDB.deleteDatabase('keyval-store');
                  req.onsuccess = req.onerror = req.onblocked = () => location.reload();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" /> 清空全部数据
              </Button>
            </section>
          </div>
          )}
        </>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--rp-border)] p-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p id={`${id}-hint`} className="mt-0.5 text-[11px] leading-snug text-[var(--rp-fg-muted)]">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} />
    </div>
  );
}

// --------------------------------------------------------------- models

function ModelSettings() {
  const connections = useApp((s) => s.llmConnections);
  const save = useApp((s) => s.saveLLMConnection);
  const remove = useApp((s) => s.removeLLMConnection);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const llm = useLLM();

  const [adding, setAdding] = useState(false);
  const [providerKey, setProviderKey] = useState('openai');
  const [form, setForm] = useState<Partial<LLMConnection>>({});
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const info = providerInfo(providerKey);

  useEffect(() => {
    setForm({
      name: info?.label ?? '自定义',
      baseURL: info?.baseURL ?? '',
      provider: providerKey,
      defaultModel: info?.models[0] ?? '',
      apiKey: '',
    });
  }, [providerKey, info]);

  async function testConnection() {
    if (!llm) return;
    setTesting(true);
    try {
      const id = uid('probe');
      // Build a throwaway connection so we do not need to persist first.
      const probe: LLMConnection = {
        id,
        name: form.name ?? 'probe',
        provider: form.provider ?? providerKey,
        baseURL: form.baseURL ?? '',
        apiKey: form.apiKey ?? '',
        defaultModel: form.defaultModel,
        headers: form.headers,
      };
      const res = await llm.completeFrom?.(probe, {
        model: probe.defaultModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say OK' }],
        maxTokens: 8,
      });
      toast.success('连接成功', res ? `模型回复：${res.text.slice(0, 40)}` : undefined);
    } catch (err) {
      toast.error('连接失败', err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function fetchModels() {
    if (!llm) return;
    setLoadingModels(true);
    try {
      const probe: LLMConnection = {
        id: uid('probe'),
        name: 'probe',
        provider: form.provider ?? providerKey,
        baseURL: form.baseURL ?? '',
        apiKey: form.apiKey ?? '',
      };
      const list = await llm.listModelsFrom?.(probe);
      setModels(list ?? []);
      if (!list?.length) toast.info('服务没有返回模型列表，请手动填写模型名');
    } catch (err) {
      toast.error('获取模型列表失败', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">模型连接</h3>
          <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
            支持 {PROVIDERS.length} 家服务商以及任意 OpenAI 兼容接口。密钥只保存在本机浏览器。
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-3.5" aria-hidden="true" /> 添加连接
        </Button>
      </div>

      {adding && (
        <section className="space-y-3 rounded-lg border border-[var(--rp-accent)]/40 bg-[var(--rp-bg-sunken)]/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="prov">服务商</Label>
              <Select value={providerKey} onValueChange={setProviderKey}>
                <SelectTrigger id="prov">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providersByGroup().map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{g.group}</SelectLabel>
                      {g.items.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cname">连接名称</Label>
              <Input
                id="cname"
                value={form.name ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如：我的 DeepSeek"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cbase" required>
              接口地址
            </Label>
            <Input
              id="cbase"
              value={form.baseURL ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
              placeholder="https://api.example.com/v1"
              aria-describedby="cbase-hint"
            />
            <p id="cbase-hint" className="text-[11px] text-[var(--rp-fg-subtle)]">
              填到 <code>/v1</code> 为止，不要加 <code>/chat/completions</code>。
              {info?.note && ` ${info.note}`}
            </p>
            {info?.altBaseURLs?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {info.altBaseURLs.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, baseURL: u }))}
                    className="cursor-pointer rounded border border-[var(--rp-border)] px-1.5 py-0.5 text-[10.5px] hover:bg-[var(--rp-bg-elevated)]"
                  >
                    {u}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ckey">
              API Key
              {info?.keyOptional && <span className="ml-1 font-normal text-[var(--rp-fg-subtle)]">（本地服务可留空）</span>}
            </Label>
            <Input
              id="ckey"
              type="password"
              autoComplete="off"
              value={form.apiKey ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder="sk-…"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cmodel">默认模型</Label>
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={fetchModels} disabled={loadingModels}>
                {loadingModels ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" aria-hidden="true" />}
                从服务获取列表
              </Button>
            </div>
            <Input
              id="cmodel"
              list="model-options"
              value={form.defaultModel ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
              placeholder="直接输入模型名也可以"
            />
            <datalist id="model-options">
              {(models.length ? models : (info?.models ?? [])).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          {providerNeedsProxy(Boolean(info?.browserCors)) && (
            <p className="rounded border border-[var(--rp-warn)]/40 bg-[var(--rp-warn)]/10 p-2 text-[11px] text-[var(--rp-warn)]">
              该服务商通常不发送 CORS 头，浏览器直连可能失败。可在「网络」中启用代理，或改用桌面版（桌面版无需代理）。
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={testConnection} disabled={testing}>
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" aria-hidden="true" />}
              测试连接
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                if (!form.baseURL?.trim()) {
                  toast.error('接口地址不能为空');
                  return;
                }
                const conn: LLMConnection = {
                  id: uid('llm'),
                  name: form.name?.trim() || info?.label || '自定义连接',
                  provider: form.provider ?? providerKey,
                  baseURL: form.baseURL.trim().replace(/\/+$/, ''),
                  apiKey: form.apiKey ?? '',
                  defaultModel: form.defaultModel?.trim(),
                };
                await save(conn);
                if (!settings.defaultConnectionId) setSettings({ defaultConnectionId: conn.id });
                setAdding(false);
                toast.success('连接已保存');
              }}
            >
              <Save className="size-3.5" aria-hidden="true" /> 保存连接
            </Button>
          </div>
        </section>
      )}

      {connections.length === 0 && !adding ? (
        <EmptyState
          icon={<KeyRound className="size-5" aria-hidden="true" />}
          title="还没有模型连接"
          description="添加一个 API 后即可开始对话。推荐：OpenRouter（一个 Key 多模型）或 DeepSeek（性价比高）。"
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              添加第一个连接
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => {
            const p = providerInfo(c.provider);
            return (
              <li key={c.id} className="rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      {c.name}
                      {settings.defaultConnectionId === c.id && <Badge variant="accent">默认</Badge>}
                      {providerNeedsProxy(Boolean(p?.browserCors)) && <Badge variant="warn">需代理</Badge>}
                    </p>
                    <p className="truncate text-[11px] text-[var(--rp-fg-muted)]">
                      {p?.label ?? c.provider} · {c.baseURL}
                    </p>
                    <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                      模型：{c.defaultModel || '未设置'} · 密钥：{c.apiKey ? '已填写' : '未填写'}
                    </p>
                  </div>
                  {settings.defaultConnectionId !== c.id && (
                    <Button size="sm" variant="outline" onClick={() => setSettings({ defaultConnectionId: c.id })}>
                      设为默认
                    </Button>
                  )}
                  <Hint label="删除连接">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-[var(--rp-danger)]"
                      aria-label="删除连接"
                      onClick={async () => {
                        if (!(await confirmAction({ title: '确认操作', description: `删除连接「${c.name}」？` }))) return;
                        void remove(c.id);
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </Hint>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- image

function ImageSettings() {
  const connections = useApp((s) => s.imageConnections);
  const save = useApp((s) => s.saveImageConnection);
  const remove = useApp((s) => s.removeImageConnection);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<ImageConnection>>({});
  const [providerKey, setProviderKey] = useState('openai-image');

  const adapter = BUILTIN_IMAGE_ADAPTERS.find((a) => a.key === providerKey);

  useEffect(() => {
    setForm({
      name: adapter?.label ?? '',
      provider: providerKey,
      baseURL: adapter?.defaultBaseURL ?? '',
      apiKey: '',
      defaultModel: adapter?.knownModels[0],
    });
  }, [providerKey, adapter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">图像生成</h3>
          <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
            GPT Image、Seedream（火山方舟 / BytePlus）、NovelAI 三种提供商，可在对话里一键出图。
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-3.5" aria-hidden="true" /> 添加
        </Button>
      </div>

      {adding && (
        <section className="space-y-3 rounded-lg border border-[var(--rp-accent)]/40 bg-[var(--rp-bg-sunken)]/40 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="iprov">提供商</Label>
            <Select value={providerKey} onValueChange={setProviderKey}>
              <SelectTrigger id="iprov">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUILTIN_IMAGE_ADAPTERS.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {adapter?.note && <p className="text-[11px] text-[var(--rp-warn)]">{adapter.note}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iname">名称</Label>
            <Input id="iname" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ibase" required>
              接口地址
            </Label>
            <Input
              id="ibase"
              value={form.baseURL ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, baseURL: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ikey">API Key</Label>
            <Input
              id="ikey"
              type="password"
              autoComplete="off"
              value={form.apiKey ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={providerKey === 'novelai' ? 'pst-…' : 'sk-…'}
            />
            {providerKey === 'novelai' && (
              <p className="text-[11px] text-[var(--rp-fg-subtle)]">NovelAI 使用 Persistent Token（以 pst- 开头）。</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imodel">默认模型</Label>
            <Select
              value={form.defaultModel ?? ''}
              onValueChange={(v) => setForm((f) => ({ ...f, defaultModel: v }))}
            >
              <SelectTrigger id="imodel">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {(adapter?.knownModels ?? []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={async () => {
                if (!form.baseURL?.trim()) {
                  toast.error('接口地址不能为空');
                  return;
                }
                await save({
                  id: uid('img'),
                  name: form.name?.trim() || adapter?.label || '图像服务',
                  provider: providerKey,
                  baseURL: form.baseURL.trim().replace(/\/+$/, ''),
                  apiKey: form.apiKey ?? '',
                  defaultModel: form.defaultModel,
                });
                setAdding(false);
                toast.success('图像服务已保存');
              }}
            >
              <Save className="size-3.5" aria-hidden="true" /> 保存
            </Button>
          </div>
        </section>
      )}

      {connections.length === 0 && !adding ? (
        <EmptyState
          icon={<ImageIcon className="size-5" aria-hidden="true" />}
          title="还没有图像服务"
          description="添加一个后即可在聊天里生成场景插图，也可以给角色卡生成头像。"
        />
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold">{c.name}</p>
                <p className="truncate text-[11px] text-[var(--rp-fg-muted)]">
                  {c.provider} · {c.baseURL} · {c.defaultModel ?? '默认模型'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-[var(--rp-danger)]"
                aria-label="删除图像服务"
                onClick={async () => {
                  if (!(await confirmAction({ title: '确认操作', description: `删除图像服务「${c.name}」？` }))) return;
                  void remove(c.id);
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- persona

function PersonaSettings() {
  const personas = useApp((s) => s.personas);
  const save = useApp((s) => s.savePersona);
  const remove = useApp((s) => s.removePersona);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const personaFileInput = useRef<HTMLInputElement | null>(null);
  const personaTarget = useRef<string | null>(null);
  const avatarInputs = { current: { add: (id: string) => {
    personaTarget.current = id;
    personaFileInput.current?.click();
  } } };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold">我的身份（Persona）</h3>
          <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
            你在角色扮演中的身份。描述会作为「我的身份」区块进入提示词，
            <code className="mx-1 rounded bg-[var(--rp-bg-sunken)] px-1">{'{{user}}'}</code>
            会替换为这个名字。
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            void save({
              id: uid('persona'),
              name: '新的身份',
              description: '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            })
          }
        >
          <Plus className="size-3.5" aria-hidden="true" /> 新建身份
        </Button>
      </div>

      {personas.length === 0 && (
        <EmptyState icon={<UserRound className="size-5" aria-hidden="true" />} title="还没有身份" description="创建一个身份，让角色知道「你是谁」。" />
      )}

      <ul className="space-y-3">
        {personas.map((p) => (
          <li key={p.id} className="space-y-2 rounded-lg border border-[var(--rp-border)] p-3">
            <div className="flex items-center gap-2">
              <Input
                value={p.name}
                onChange={(e) => void save({ ...p, name: e.target.value })}
                className="h-8 max-w-xs"
                aria-label="身份名称"
              />
              {settings.defaultPersonaId === p.id && <Badge variant="accent">默认</Badge>}
              <div className="ml-auto flex items-center gap-1">
                {settings.defaultPersonaId !== p.id && (
                  <Button size="sm" variant="outline" onClick={() => setSettings({ defaultPersonaId: p.id })}>
                    设为默认
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-[var(--rp-danger)]"
                  aria-label="删除身份"
                  onClick={async () => {
                    if (!(await confirmAction({ title: '确认操作', description: `删除身份「${p.name}」？` }))) return;
                    void remove(p.id);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <Textarea
              value={p.description}
              rows={3}
              onChange={(e) => void save({ ...p, description: e.target.value })}
              placeholder="描述你的身份：姓名、外貌、与角色的关系…"
              aria-label="身份描述"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`pref-${p.id}`} className="text-[12px]">
                  偏好设定
                </Label>
                <Input
                  id={`pref-${p.id}`}
                  value={p.preferences ?? ''}
                  onChange={(e) => void save({ ...p, preferences: e.target.value })}
                  placeholder="可选，进入 [User Info] 区块"
                  aria-label="偏好设定"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`person-${p.id}`} className="text-[12px]">
                  叙述人称
                </Label>
                <Select
                  value={p.person ?? 'second'}
                  onValueChange={(v) => void save({ ...p, person: v as 'second' | 'third' })}
                >
                  <SelectTrigger id={`person-${p.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="second">第二人称（你）</SelectItem>
                    <SelectItem value="third">第三人称（他/她）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex size-12 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
                {p.avatar ? <img src={p.avatar} alt="" className="size-full object-cover" /> : (p.name || '?').slice(0, 1)}
              </div>
              <Button size="sm" variant="outline" onClick={() => avatarInputs.current.add(p.id)}>
                上传头像
              </Button>
              {p.avatar && (
                <Button size="sm" variant="ghost" onClick={() => void save({ ...p, avatar: undefined })}>
                  移除
                </Button>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              ref={(el) => {
                personaFileInput.current = el;
              }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                const target = personaTarget.current;
                if (file && target) {
                  const dataUrl = await blobToDataUrl(file);
                  const current = useApp.getState().personas.find((x) => x.id === target);
                  if (current) await useApp.getState().savePersona({ ...current, avatar: dataUrl });
                }
                e.target.value = '';
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { RPPersona };
