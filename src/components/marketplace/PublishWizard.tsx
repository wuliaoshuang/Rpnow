/**
 * 发布向导（角色卡 / 插件共用）。
 *
 * 流程：元数据 →（本地校验 + 隐私/风险扫描）→ 预览确认 → 打包 → 发布到商店。
 * 校验不过会逐条列出原因；发布会显示可读错误而不是一律静默失败。
 */

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';
import { Button } from '@/components/ui/button.js';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input.js';
import { Badge } from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { useApp } from '@/state/store.js';
import { listInstalled } from '@/core/plugins/rpnx.js';
import { listCategories } from '@/core/marketplace/categories.js';
import { validatePublishManifest, scanContent, scanPluginCode, LICENSES } from '@/core/marketplace/validate.js';
import { buildCardPackageInput, buildPluginPackageInput } from '@/core/marketplace/collect.js';
import { buildCardPackage, buildPluginPackage } from '@/core/marketplace/packaging.js';
import { makeMarketId } from '@/core/marketplace/packaging.js';
import { publishPackage } from '@/core/marketplace/client.js';
import type { MarketKind, PluginPermission, PublishManifest } from '@/core/marketplace/types.js';
import type { ScreenshotLike } from '@/core/marketplace/collect.js';

export interface PublishWizardProps {
  kind: MarketKind;
  /** 卡片 id 或已安装插件 manifest id。 */
  subjectId: string;
  open: boolean;
  onClose: () => void;
}

const PERMISSION_LABELS: Record<PluginPermission, string> = {
  network: '网络访问',
  storage: '本地存储',
  clipboard: '剪贴板',
  filesystem: '文件读写',
  'render-injection': '界面/渲染注入',
  'top-window': '顶层窗口访问',
};

export function PublishWizard({ kind, subjectId, open, onClose }: PublishWizardProps) {
  const settings = useApp((s) => s.settings);
  const cards = useApp((s) => s.cards);
  const personaName = useApp((s) => s.personas[0]?.name ?? '');
  const [step, setStep] = useState<'form' | 'busy' | 'done'>('form');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<{ id: string; version: string } | null>(null);

  // 元数据
  const card = kind === 'card' ? cards.find((c) => c.id === subjectId) : undefined;
  const fallbackName = card?.data.name ?? '';
  const [name, setName] = useState(fallbackName);
  const [version, setVersion] = useState('1.0.0');
  const [summary, setSummary] = useState('');
  const [author, setAuthor] = useState(personaName);
  const [license, setLicense] = useState<string>('CC-BY-4.0');
  const [category, setCategory] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [rating, setRating] = useState<PublishManifest['rating']>('sfw');
  const [warningsText, setWarningsText] = useState('');
  const [changelog, setChangelog] = useState('');
  const [permissions, setPermissions] = useState<PluginPermission[]>(kind === 'plugin' ? ['storage'] : []);
  const [screenshots, setScreenshots] = useState<ScreenshotLike[]>([]);

  const categories = useMemo(() => listCategories(kind), [kind]);

  async function handlePublish() {
    setError('');
    setWarnings([]);
    if (!subjectId) {
      setError('缺少要发布的内容');
      return;
    }

    const tags = tagsText.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
    const base = {
      schema: 1 as const,
      id: makeMarketId(kind, author || 'anonymous', name || fallbackName || 'untitled'),
      name: name.trim(),
      version: version.trim(),
      summary: summary.trim(),
      author: author.trim() || 'anonymous',
      license,
      category: category || categories[categories.length - 1]!.id,
      tags,
      rating,
      contentWarnings: warningsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      screenshots: screenshots.map((s) => s.name),
      permissions: kind === 'plugin' ? permissions : undefined,
      changelog: changelog.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    // 组装完整 manifest 以复用校验（type 由 collect/packaging 补）
    const manifest: PublishManifest = { ...base, type: kind };
    const result = validatePublishManifest(manifest, kind);
    if (result.errors.length) {
      setError(result.errors.join('；'));
      return;
    }

    // 隐私 / 风险扫描
    let contentText = '';
    let pluginCode = '';
    let pkgInput;
    try {
      if (kind === 'card') {
        if (!card) throw new Error('找不到要发布的角色卡');
        const worldbook = card.data.character_book
          ? ({ entries: card.data.character_book.entries, name: card.data.name } as unknown as Record<string, unknown>)
          : undefined;
        pkgInput = await buildCardPackageInput(card, base, {
          worldbook,
          regexScripts: (card.data.extensions?.regex_scripts as never[] | undefined) ?? [],
          screenshots,
        });
        contentText = JSON.stringify(card.data);
      } else {
        const record = (await listInstalled()).find((r) => r.manifest.id === subjectId);
        if (!record) throw new Error('找不到要发布的插件');
        pkgInput = buildPluginPackageInput(record, base, { screenshots });
        pluginCode = record.code;
        contentText = `${record.manifest.description ?? ''}\n${record.readme ?? ''}`;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    const findings = [...scanContent(contentText), ...(kind === 'plugin' ? scanPluginCode(pluginCode) : [])];
    if (findings.length) setWarnings(findings.map((f) => f.detail));

    setStep('busy');
    try {
      const blob =
        kind === 'card'
          ? await buildCardPackage(pkgInput as never)
          : await buildPluginPackage(pkgInput as never);
      await publishPackage(manifest, blob);
      setResult({ id: manifest.id, version: manifest.version });
      setStep('done');
      toast.success(`已发布「${manifest.name}」v${manifest.version}`, '在商店中可见');
    } catch (err) {
      setStep('form');
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPickScreenshots(files: FileList | null) {
    if (!files) return;
    const next: ScreenshotLike[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      next.push({ name: file.name.replace(/[^\w.-]/g, '_'), bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    setScreenshots(next.slice(0, 6));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>发布{kind === 'card' ? '角色卡' : '插件'}到商店</DialogTitle>
          <DialogDescription>
            生成发布包并上传到当前商店源（{settings.market?.baseURL ?? 'http://127.0.0.1:8799'}）。发布前会做本地校验与隐私自查。
          </DialogDescription>
        </DialogHeader>

        {step === 'done' && result ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-[14px] font-medium">发布成功</p>
            <p className="break-all font-mono text-[11.5px] text-[var(--rp-fg-subtle)]">{result.id}</p>
            <Badge variant="accent">v{result.version}</Badge>
            <Button onClick={onClose}>完成</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pub-name">名称</Label>
                <Input id="pub-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="商店里显示的名称" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-version">版本（semver）</Label>
                <Input id="pub-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pub-summary">一句话简介</Label>
                <Input id="pub-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-author">作者</Label>
                <Input id="pub-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-license">许可</Label>
                <Select value={license} onValueChange={setLicense}>
                  <SelectTrigger id="pub-license">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENSES.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-category">分类</Label>
                <Select value={category || categories[categories.length - 1]!.id} onValueChange={setCategory}>
                  <SelectTrigger id="pub-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-tags">标签（逗号分隔，≤12）</Label>
                <Input id="pub-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="现代, 校园" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-rating">内容分级</Label>
                <Select value={rating} onValueChange={(v) => setRating(v as PublishManifest['rating'])}>
                  <SelectTrigger id="pub-rating">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sfw">SFW</SelectItem>
                    <SelectItem value="suggestive">轻度暗示</SelectItem>
                    <SelectItem value="nsfw">NSFW（默认隐藏）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pub-cw">内容警告（逗号分隔，可空）</Label>
                <Input id="pub-cw" value={warningsText} onChange={(e) => setWarningsText(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pub-changelog">本次更新说明</Label>
                <Input id="pub-changelog" value={changelog} onChange={(e) => setChangelog(e.target.value)} />
              </div>

              {kind === 'plugin' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>声明权限（安装时会明示给用户）</Label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(PERMISSION_LABELS) as PluginPermission[]).map((p) => (
                      <label key={p} className="flex items-center gap-1.5 text-[12px]">
                        <input
                          type="checkbox"
                          checked={permissions.includes(p)}
                          onChange={(e) =>
                            setPermissions((cur) =>
                              e.target.checked ? [...cur, p] : cur.filter((x) => x !== p),
                            )
                          }
                        />
                        {PERMISSION_LABELS[p]}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="pub-shots">截图（最多 6 张，可空）</Label>
                <input id="pub-shots" type="file" accept="image/*" multiple onChange={(e) => void onPickScreenshots(e.target.files)} />
                {screenshots.length ? (
                  <p className="text-[11px] text-[var(--rp-fg-subtle)]">{screenshots.map((s) => s.name).join('、')}</p>
                ) : null}
              </div>
            </div>

            {warnings.length ? (
              <div className="rounded-md border border-[var(--rp-warning)]/30 bg-[var(--rp-warning)]/5 p-2.5 text-[11.5px] space-y-1">
                <p className="font-medium">发布前自查提示：</p>
                {warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            ) : null}
            {error ? (
              <p className="rounded-md border border-[var(--rp-danger)]/30 bg-[var(--rp-danger)]/5 p-2.5 text-[11.5px] text-[var(--rp-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {step !== 'done' ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={step === 'busy'}>
                取消
              </Button>
              <Button onClick={() => void handlePublish()} disabled={step === 'busy'}>
                {step === 'busy' ? '正在打包上传…' : '校验并发布'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
