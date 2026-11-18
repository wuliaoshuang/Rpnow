/**
 * Plugins page.
 *
 * Lists every plugin in the kernel — built-in and installed — with the services
 * it provides/requires, its activation state, and per-plugin enable toggles.
 *
 * The "everything is a plugin" claim is verifiable here: RPNow's own renderer,
 * agent loop and theme appear in the same table as an installed `.rpnx`, and any
 * of them can be swapped.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Download,
  GitBranch,
  Loader2,
  Package,
  Plus,
  Power,
  Settings2,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '@/state/store.js';
import { SERVICE } from '@/core/plugin/kernel-types.js';
import type { PluginRecord } from '@/core/plugin/kernel-types.js';
import { slotSummary, subscribeSlots } from '@/core/plugin/slots.js';
import {
  createTemplate,
  install,
  parseRpnx,
  listInstalled,
  uninstall,
  type InstalledPlugin,
} from '@/core/plugins/rpnx.js';
import { applyTheme, reloadInstalledPlugins } from '@/boot.js';
import { parseGitHubUrl, fetchPackageFromGitHub } from '@/core/plugins/github.js';
import { Input } from '@/components/ui/input.js';
import { Button } from '@/components/ui/button.js';
import { PluginSettings, type PluginConfigSchema } from '@/components/plugins/PluginSettings.js';
import { Badge, EmptyState, Hint } from '@/components/ui/misc.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js';
import { toast } from '@/components/ui/toast.js';
import { downloadBlob, formatBytes, formatRelativeTime, cn } from '@/lib/utils.js';
import { confirmAction } from '@/components/ui/confirm.js';
import { PublishWizard } from '@/components/marketplace/PublishWizard.js';

const STATE_LABEL: Record<string, { text: string; variant: 'ok' | 'warn' | 'danger' | 'outline' }> = {
  active: { text: '运行中', variant: 'ok' },
  pending: { text: '等待依赖', variant: 'warn' },
  activating: { text: '激活中', variant: 'outline' },
  registered: { text: '已注册', variant: 'outline' },
  failed: { text: '失败', variant: 'danger' },
  disposed: { text: '已卸载', variant: 'outline' },
};

export function PluginsPage() {
  const kernel = useApp((s) => s.kernel);
  const [records, setRecords] = useState<PluginRecord[]>([]);
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  /** Which plugin's settings form is expanded. */
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);
  /** Installed plugin id being published to the marketplace. */
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** GitHub URL typed by the user. */
  const [ghUrl, setGhUrl] = useState('');
  const [, force] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setRecords(kernel?.records() ?? []);
    setInstalled(await listInstalled());
    force((x) => x + 1);
  };

  // The kernel is created asynchronously during boot, so read it from the store
  // at effect time rather than trusting the captured value (which is undefined
  // on the first render and would leave the list permanently empty).
  useEffect(() => {
    void refresh();
  }, [kernel]);

  useEffect(() => subscribeSlots(() => force((x) => x + 1)), []);

  async function handleInstall(files: FileList) {
    setBusy(true);
    try {
      const installed: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const parsed = await parseRpnx(file);
          const existing = (await listInstalled()).find((p) => p.manifest.id === parsed.manifest.id);
          if (existing) {
            const ok = await confirmAction({ title: '确认操作', description: `插件「${existing.manifest.name}」已安装，是否覆盖安装？`, confirmText: '覆盖安装' });
            if (!ok) continue;
          }
          await install(parsed, true);
          installed.push(parsed.manifest.name);
        } catch (err) {
          toast.error(`安装失败：${file.name}`, err instanceof Error ? err.message : String(err));
        }
      }
      await finishInstall(installed);
    } finally {
      setBusy(false);
    }
  }

  /** Install from a GitHub URL (repo, sub-directory or packaged folder). */
  async function handleInstallFromGitHub() {
    const raw = ghUrl.trim();
    if (!raw) return;
    setBusy(true);
    try {
      const target = parseGitHubUrl(raw);
      const pkg = await fetchPackageFromGitHub(target);
      const file = new File([pkg.blob], `${target.repo}.zip`, { type: 'application/zip' });
      const parsed = await parseRpnx(file);
      const existing = (await listInstalled()).find((p) => p.manifest.id === parsed.manifest.id);
      if (existing) {
        const ok = await confirmAction({
          title: '确认操作',
          description: `插件「${existing.manifest.name}」已安装，是否用 GitHub 上的版本覆盖？`,
          confirmText: '覆盖安装',
        });
        if (!ok) return;
      }
      await install(parsed, true);
      setGhUrl('');
      await finishInstall([parsed.manifest.name]);
      toast.success(`已从 GitHub 安装「${parsed.manifest.name}」`, pkg.source);
    } catch (err) {
      // A bad URL, a repo without a package, or an invalid manifest all land
      // here — one clear message, nothing installed.
      toast.error('无法从该链接安装插件', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Shared activation tail for both file and network installs. */
  async function finishInstall(names: string[]) {
    await reloadInstalledPlugins();
    await refresh();
    applyTheme(useApp.getState().settings.themeId);
    if (names.length) {
      toast.success(`已启用 ${names.join('、')}`, '插件立即生效，无需刷新');
    }
  }

  async function toggle(record: PluginRecord) {
    if (!kernel) return;
    await kernel.setEnabled(record.manifest.id, !record.enabled);
    const settings = useApp.getState().settings;
    useApp.getState().setSettings({
      plugins: { ...settings.plugins, [record.manifest.id]: !record.enabled },
    });
    await refresh();
    applyTheme(useApp.getState().settings.themeId);
  }

  const services = new Map<string, string>();
  for (const r of records) for (const s of r.manifest.provides ?? []) services.set(s, r.manifest.id);

  const builtins = records.filter((r) => r.origin === 'builtin');
  const userPlugins = records.filter((r) => r.origin !== 'builtin');

  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <Tabs defaultValue="installed">
          <TabsList className="sticky top-0 z-10">
            <TabsTrigger value="installed">已安装({userPlugins.length})</TabsTrigger>
            <TabsTrigger value="builtin">内置服务({builtins.length})</TabsTrigger>
            <TabsTrigger value="slots">界面插槽</TabsTrigger>
            <TabsTrigger value="dev">开发</TabsTrigger>
          </TabsList>

          {/* --------------------------------------------------- installed */}
          <TabsContent value="installed" className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold">用户插件</h3>
                <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
                  .rpnx 插件可以替换主题、注入预设与世界书、改写消息渲染，甚至可以替换整个 Agent 循环。
                </p>
              </div>
              {/*
                File picker filter.

                `.rpnx` is a ZIP, but Android has no MIME mapping for the
                extension and reports it as `application/octet-stream`. The
                Android document picker filters on **MIME type** (it does not
                understand the `.rpnx` token), so `accept=".rpnx,.zip"` greyed the
                file out and made it unselectable. Listing the octet-stream and
                zip MIME types lets the picker offer it; the extension is
                validated again after selection in `parseRpnx`.
              */}
              <input
                ref={fileInput}
                type="file"
                accept=".rpnx,.zip,application/zip,application/x-zip-compressed,application/octet-stream"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handleInstall(e.target.files);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" aria-hidden="true" />}
                安装 .rpnx
              </Button>
            </div>

            {/* GitHub 链接安装：直接下载仓库/目录里的插件包并安装。 */}
            <div className="rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium">
                <GitBranch className="size-3.5" aria-hidden="true" /> 从 GitHub 安装
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={ghUrl}
                  onChange={(e) => setGhUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleInstallFromGitHub();
                  }}
                  placeholder="https://github.com/用户名/仓库"
                  aria-label="GitHub 插件链接"
                  inputMode="url"
                  className="h-9 min-w-0 flex-1 text-[12.5px]"
                  disabled={busy}
                />
                <Button size="sm" onClick={() => void handleInstallFromGitHub()} disabled={busy || !ghUrl.trim()}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" aria-hidden="true" />}
                  获取
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--rp-fg-subtle)]">
                支持仓库根目录、子目录（<code className="text-[10.5px]">/tree/分支/目录</code>）或已构建的 .rpnx 插件包目录；SillyTavern 扩展不受支持。
                链接指向的不是插件包时会提示具体原因，不会安装任何东西。
              </p>
            </div>

            <div className="rounded-md border border-[var(--rp-danger)]/30 bg-[var(--rp-danger)]/5 p-2.5 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
              <p className="flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--rp-danger)]" aria-hidden="true" />
                插件代码在你的浏览器里以应用同等权限运行，请只安装可信来源的 .rpnx 文件。安装前会校验 manifest，但不会沙箱隔离代码。
              </p>
            </div>

                        {userPlugins.length === 0 ? (
              <EmptyState
                icon={<Package className="size-5" aria-hidden="true" />}
                title="还没有安装插件"
                description="从「开发」标签页可以导出一个可运行的示例插件，了解 .rpnx 的结构。"
                action={
                  <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                    安装插件
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {userPlugins.map((r) => {
                  const o = installed.find((p) => p.manifest.id === r.manifest.id);
                  const st = STATE_LABEL[r.state] ?? STATE_LABEL.registered;
                  return (
                    <li key={r.manifest.id} className="rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold">
                            {r.manifest.name}
                            <span className="font-mono text-[10.5px] text-[var(--rp-fg-subtle)]">v{r.manifest.version}</span>
                            <Badge variant={st.variant}>{st.text}</Badge>
                            {r.manifest.provides?.length ? (
                              <Badge variant="accent">提供 {r.manifest.provides.join(', ')}</Badge>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-[var(--rp-fg-muted)]">
                            {r.manifest.description || '没有描述'}
                          </p>
                          <p className="mt-1 text-[10.5px] text-[var(--rp-fg-subtle)]">
                            {r.manifest.id} · {r.manifest.author ?? '未知作者'} ·{' '}
                            {o ? `${formatBytes(o.size)} · ${formatRelativeTime(o.installedAt)}` : ''}
                          </p>
                          {r.error && <p className="mt-1 text-[11px] text-[var(--rp-danger)]">{r.error}</p>}
                        </div>
                        <Hint label="发布到商店">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="发布到商店"
                            onClick={() => setPublishingId(r.manifest.id)}
                          >
                            <Store className="size-4" aria-hidden="true" />
                          </Button>
                        </Hint>
                        {r.manifest.config ? (
                          /*
                           * Settings live in the shared surface above the list
                           * (see `rp-extensions-surface`); this button scrolls to
                           * it instead of opening an inline panel that the flex
                           * row used to squeeze.
                           */
                          <Hint label="插件设置">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="插件设置"
                              onClick={() => {
                                setExpandedConfig((cur) => (cur === r.manifest.id ? null : r.manifest.id));
                              }}
                            >
                              <Settings2 className="size-4" aria-hidden="true" />
                            </Button>
                          </Hint>
                        ) : null}
                        <Hint label={r.enabled ? '停用' : '启用'}>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={r.enabled ? '停用插件' : '启用插件'}
                            onClick={() => void toggle(r)}
                          >
                            <Power className={cn('size-4', r.enabled ? 'text-[var(--rp-ok)]' : 'text-[var(--rp-fg-subtle)]')} aria-hidden="true" />
                          </Button>
                        </Hint>
                        <Hint label="卸载">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-[var(--rp-danger)]"
                            aria-label="卸载插件"
                            onClick={async () => {
                              if (!(await confirmAction({ title: '确认操作', description: `卸载插件「${r.manifest.name}」？` }))) return;
                              if (kernel) await kernel.unregister(r.manifest.id);
                              await uninstall(r.manifest.id);
                              await reloadInstalledPlugins();
                              await refresh();
                              applyTheme(useApp.getState().settings.themeId);
                              toast.success('已卸载', '插件已停用，界面即时更新');
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </Hint>
                      </div>
                      {/*
                         * 声明式配置表单就地展开在卡片整行宽度上（处于 flex 标题行
                         * 之外，`w-full`，不会被 `min-w-0 flex-1` 挤压）。
                         */
                      }
                      {r.manifest.config && expandedConfig === r.manifest.id ? (
                        <div className="mt-2 w-full">
                          <PluginSettings
                            pluginId={r.manifest.id}
                            schema={r.manifest.config as PluginConfigSchema}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          {/* ----------------------------------------------------- builtin */}
          <TabsContent value="builtin" className="space-y-3">
            <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
              RPNow 自身功能同样是插件。任何一家第三方插件只要 provide 同名服务，就会替换对应实现。
            </p>
            <ul className="space-y-1.5">
              {builtins.map((r) => {
                const st = STATE_LABEL[r.state] ?? STATE_LABEL.registered;
                return (
                  <li key={r.manifest.id} className="flex items-center gap-2 rounded-lg border border-[var(--rp-border)] p-2.5">
                    {r.state === 'active' ? (
                      <CircleCheck className="size-4 shrink-0 text-[var(--rp-ok)]" aria-hidden="true" />
                    ) : r.state === 'failed' ? (
                      <CircleAlert className="size-4 shrink-0 text-[var(--rp-danger)]" aria-hidden="true" />
                    ) : (
                      <CircleSlash className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{r.manifest.name}</p>
                      <p className="truncate font-mono text-[10.5px] text-[var(--rp-fg-subtle)]">
                        {r.manifest.provides?.join(', ') || '(无服务)'}
                        {r.manifest.uses?.length ? ` ← 依赖 ${r.manifest.uses.join(', ')}` : ''}
                      </p>
                    </div>
                    <Badge variant={st.variant}>{st.text}</Badge>
                    <SwitchSmall enabled={r.enabled} onToggle={() => void toggle(r)} />
                  </li>
                );
              })}
            </ul>
          </TabsContent>

          {/* ------------------------------------------------------- slots */}
          <TabsContent value="slots" className="space-y-2">
            <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
              界面同样由插槽组成。插件注册到同名插槽且顺序更靠前时，会取代默认组件。
            </p>
            <ul className="space-y-1.5">
              {slotSummary().map((s) => (
                <li key={s.slot} className="flex items-center gap-2 rounded-lg border border-[var(--rp-border)] p-2.5">
                  <Boxes className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{s.slot}</code>
                  <Badge variant="outline">{s.count} 个实现</Badge>
                  <span className="hidden max-w-[10rem] truncate text-[10.5px] text-[var(--rp-fg-subtle)] sm:block">
                    {s.owners.join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </TabsContent>

          {/* --------------------------------------------------------- dev */}
          <TabsContent value="dev" className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">.rpnx 结构</h3>
              <pre className="overflow-x-auto rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-3 font-mono text-[11.5px] leading-relaxed">{`my-plugin.rpnx  (ZIP)
├── manifest.json     # id / name / version / apiVersion / host / provides / uses
├── plugin.js         # export function apply(ctx) { ... }
├── README.md
└── assets/           # 可选：主题 CSS、图标`}</pre>
            </section>
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">插件能做什么</h3>
              <ul className="list-inside list-disc space-y-1 text-[12px] text-[var(--rp-fg-muted)]">
                <li><code>ctx.rpnow.cards</code> — 读取 / 新增 / 修改角色卡</li>
                <li><code>ctx.rpnow.chats</code> — 读写对话、追加消息、改写最后一条回复</li>
                <li><code>ctx.rpnow.lorebooks</code> — 插入世界书，并 <code>enableForChat()</code> 让它影响聊天</li>
                <li><code>ctx.rpnow.presets</code> — 插入 / 替换预设</li>
                <li><code>ctx.provide('theme', …)</code> — 替换整套主题</li>
                <li><code>ctx.provide('agentLoop', …)</code> — 替换 Agent 循环</li>
                <li><code>ctx.provide('renderer', …)</code> — 替换消息渲染</li>
                <li><code>ctx.events.on('chat:message', …)</code> — 监听对话事件</li>
              </ul>
            </section>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const manifest = {
                    id: 'example.rpnow.hello',
                    name: '示例：问候插件',
                    version: '1.0.0',
                    description: '演示读取角色卡、写入世界书与注册设置项。',
                    author: 'RPNow',
                    apiVersion: 1,
                    host: 'host' as const,
                    provides: ['example-hello'],
                    uses: [],
                    tags: ['example'],
                  };
                  const code = `// 示例 .rpnx 插件：所有能力都通过 apply(ctx) 获得。
export function apply(ctx) {
  const db = ctx.rpnow;

  // 1) 读取现有角色卡
  const cards = db.cards.list();
  ctx.logger.info('当前角色卡数量：', cards.length);

  // 2) 插入一本世界书，并绑定到最近的对话，使其影响后续聊天
  db.lorebooks.save({
    id: 'lb_example_hello',
    name: '示例世界书',
    description: '由示例插件注入',
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: true,
    source: 'plugin',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entries: [{
      id: 'e1', comment: '示例条目', keys: ['示例'], secondaryKeys: [], content: '这是一条由插件注入的世界书内容。',
      enabled: true, constant: false, selective: false, selectiveLogic: 0, position: 0, depth: 4, role: 0,
      order: 100, probability: 100, useProbability: false, caseSensitive: false, matchWholeWords: false,
      useRegex: false, group: '', groupWeight: 100, groupOverride: false, excludeRecursion: false,
      preventRecursion: false, delayUntilRecursion: false, scanDepth: null, sticky: 0, cooldown: 0,
      delay: 0, outletName: '', ignoreBudget: false, displayIndex: 0,
    }],
  });

  // 3) 监听消息事件（核心会广播 chat:message）
  ctx.use(ctx.events.on('chat:message', (payload) => {
    ctx.logger.info('新消息：', payload);
  }));

  return () => ctx.logger.info('问候插件已停用');
}
`;
                  const blob = await createTemplate(manifest, code);
                  downloadBlob(blob, 'example.rpnow.hello.rpnx');
                  toast.success('示例插件已导出', '解压即可看到目录结构');
                }}
              >
                <Download className="size-3.5" aria-hidden="true" /> 导出示例插件
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const doc = `# RPNow 插件开发

## 打包
把 manifest.json + plugin.js 压缩成 .rpnx（ZIP）即可安装。

## manifest.json
\`\`\`json
{
  "id": "yourname.plugin",
  "name": "插件名称",
  "version": "1.0.0",
  "apiVersion": 1,
  "host": "host",
  "provides": ["theme"],
  "uses": ["settings"]
}
\`\`\`

## plugin.js
\`\`\`js
export function apply(ctx) {
  ctx.provide('theme', { ... });
  return () => { /* 清理 */ };
}
\`\`\`

当前内核 API 版本：1
`;
                  downloadBlob(new Blob([doc], { type: 'text/markdown' }), 'rpnow-plugin-guide.md');
                }}
              >
                <Plus className="size-3.5" aria-hidden="true" /> 下载开发指南
              </Button>
            </div>
            <section className="space-y-1.5 rounded-lg border border-[var(--rp-border)] p-3">
              <h3 className="text-[12.5px] font-semibold">当前已提供的服务</h3>
              <ul className="grid gap-1 sm:grid-cols-2">
                {[...services.entries()].map(([key, owner]) => (
                  <li key={key} className="flex items-center gap-1.5 text-[11.5px]">
                    <code className="rounded bg-[var(--rp-bg-sunken)] px-1.5 py-0.5 font-mono">{key}</code>
                    <span className="truncate text-[var(--rp-fg-subtle)]">← {owner}</span>
                  </li>
                ))}
                {services.size === 0 && <li className="text-[11.5px] text-[var(--rp-fg-subtle)]">暂无</li>}
              </ul>
              <p className="pt-1 text-[10.5px] text-[var(--rp-fg-subtle)]">
                内置服务键：{Object.values(SERVICE).join(' · ')}
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <PublishWizard kind="plugin" subjectId={publishingId ?? ''} open={!!publishingId} onClose={() => setPublishingId(null)} />
    </div>
  );
}

function SwitchSmall({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      aria-label={enabled ? '停用' : '启用'}
      className={cn(
        'h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        enabled ? 'bg-[var(--rp-accent)]' : 'bg-[var(--rp-border-strong)]',
      )}
    >
      <span
        className={cn(
          'block size-4 rounded-full bg-white shadow transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}
