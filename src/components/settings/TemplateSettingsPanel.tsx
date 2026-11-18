/**
 * UI template manager.
 *
 * Templates are HTML fragments plus a JSON variable state. This panel creates
 * and edits them; the chat renders the enabled ones into a sandboxed iframe.
 */

import * as React from 'react';
import { Code2, Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { createTemplate, type RPUITemplate } from '@/core/uitemplate/types.js';
import { renderTemplate } from '@/core/uitemplate/engine.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';

export function TemplateSettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const templates = useApp((s) => s.uiTemplates);
  const saveTemplate = useApp((s) => s.saveUITemplate);
  const removeTemplate = useApp((s) => s.removeUITemplate);
  const cards = useApp((s) => s.cards);

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const patchSettings = (p: Partial<typeof settings.uiTemplate>) =>
    setSettings({ uiTemplate: { ...settings.uiTemplate, ...p } });

  const editing = templates.find((t) => t.id === editingId) ?? null;

  const startNew = () => {
    const tpl = createTemplate({
      name: `模板 ${templates.length + 1}`,
      scopeId: cards[0]?.id ?? 'global',
    });
    void saveTemplate(tpl);
    setEditingId(tpl.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-[var(--rp-border)] p-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="ui-tpl-enabled" className="cursor-pointer">
            UI 模板（HTML 状态栏）
          </Label>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--rp-fg-muted)]">
            用模板变量在消息上方/下方渲染 HTML 卡片，模型可更新变量，卡片里的按钮会变成用户消息。
          </p>
        </div>
        <Switch
          id="ui-tpl-enabled"
          checked={settings.uiTemplate.enabled}
          onCheckedChange={(v) => patchSettings({ enabled: v })}
        />
      </div>

      {settings.uiTemplate.enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ui-tpl-mode">更新方式</Label>
              <Select
                value={settings.uiTemplate.mainModelAnalysis ? 'main' : 'sub'}
                onValueChange={(v) => patchSettings({ mainModelAnalysis: v === 'main' })}
              >
                <SelectTrigger id="ui-tpl-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">主模型（正文后输出更新）</SelectItem>
                  <SelectItem value="sub">副模型（每轮后分析）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!settings.uiTemplate.mainModelAnalysis && (
              <div className="space-y-1.5">
                <Label htmlFor="ui-tpl-model">分析模型</Label>
                <Input
                  id="ui-tpl-model"
                  value={settings.uiTemplate.model}
                  onChange={(e) => patchSettings({ model: e.target.value })}
                  placeholder="留空则用当前对话模型"
                />
              </div>
            )}
          </div>

          {!settings.uiTemplate.mainModelAnalysis && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label>分析对话层数</Label>
                <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                  {settings.uiTemplate.analysisDepth} 层
                </span>
              </div>
              <Slider
                value={[settings.uiTemplate.analysisDepth]}
                min={4}
                max={10}
                step={1}
                onValueChange={([v]) => patchSettings({ analysisDepth: v })}
                aria-label="分析对话层数"
              />
              <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                <Switch
                  checked={settings.uiTemplate.injectContext}
                  onCheckedChange={(v) => patchSettings({ injectContext: v })}
                />
                把变量快照注入分析提示词
              </label>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold">模板列表</p>
              <Button size="sm" variant="outline" onClick={startNew}>
                <Plus className="size-3.5" aria-hidden="true" /> 新建模板
              </Button>
            </div>

            {templates.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--rp-border)] p-3 text-[12px] text-[var(--rp-fg-muted)]">
                还没有模板。模板是一段 HTML，用 {'{{变量}}'} 引用状态，用 {'{{#each}}'} 循环。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {templates.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex items-center gap-2 rounded-lg border border-[var(--rp-border)] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{tpl.name}</p>
                      <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">
                        {tpl.scope === 'global' ? '全局' : '角色'} · {tpl.placement === 'top' ? '正文上方' : '正文下方'} ·{' '}
                        {tpl.enabled ? '已启用' : '已停用'}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(tpl.id);
                      }}
                    >
                      <Code2 className="size-3.5" aria-hidden="true" /> 编辑
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-[var(--rp-danger)]"
                      aria-label="删除模板"
                      onClick={async () => {
                        if (await confirmAction({ title: '确认操作', description: `删除模板「${tpl.name}」？` })) void removeTemplate(tpl.id);
                      }}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {editing && (
            <TemplateEditor
              template={editing}
              cards={cards.map((c) => ({ id: c.id, name: c.data.name }))}
              onSave={async (tpl) => {
                await saveTemplate(tpl);
                toast.success('模板已保存', tpl.name);
              }}
              onClose={() => setEditingId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  cards,
  onSave,
  onClose,
}: {
  template: RPUITemplate;
  cards: Array<{ id: string; name: string }>;
  onSave: (tpl: RPUITemplate) => Promise<void>;
  onClose: () => void;
}) {
  const [tpl, setTpl] = React.useState<RPUITemplate>(template);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const preview = React.useMemo(() => {
    try {
      return renderTemplate(tpl.htmlTemplate, tpl.variableState);
    } catch {
      return '';
    }
  }, [tpl.htmlTemplate, tpl.variableState]);

  const update = (p: Partial<RPUITemplate>) => setTpl((t) => ({ ...t, ...p }));

  const applyState = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      update({ variableState: parsed, initialVariableState: parsed });
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--rp-accent)] p-3">
      <div className="flex items-center gap-2">
        <Input value={tpl.name} onChange={(e) => update({ name: e.target.value })} aria-label="模板名称" className="max-w-56" />
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
          <Switch checked={tpl.enabled} onCheckedChange={(v) => update({ enabled: v })} aria-label="启用模板" />
          启用
        </label>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button size="sm" onClick={() => void onSave(tpl)}>
            保存
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tpl-scope">作用域</Label>
          <Select value={tpl.scope} onValueChange={(v) => update({ scope: v as RPUITemplate['scope'] })}>
            <SelectTrigger id="tpl-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="character">当前角色</SelectItem>
              <SelectItem value="global">全局</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tpl-placement">位置</Label>
          <Select
            value={tpl.placement}
            onValueChange={(v) => update({ placement: v as RPUITemplate['placement'] })}
          >
            <SelectTrigger id="tpl-placement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">正文上方</SelectItem>
              <SelectItem value="bottom">正文下方</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {tpl.scope === 'character' && (
        <div className="space-y-1.5">
          <Label htmlFor="tpl-scope-id">角色</Label>
          <Select value={tpl.scopeId} onValueChange={(v) => update({ scopeId: v })}>
            <SelectTrigger id="tpl-scope-id">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cards.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="tpl-html">HTML 模板</Label>
        <Textarea
          id="tpl-html"
          value={tpl.htmlTemplate}
          onChange={(e) => update({ htmlTemplate: e.target.value })}
          rows={6}
          className="font-mono text-[12px]"
          spellCheck={false}
        />
        <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">
          支持 {'{{路径}}'}、{'{{#each 列表 as 别名}}…{{else}}…{{/each}}'}、{'@index'}、{'@first'}、{'@last'}、{'data-slash="发送的内容"'}。
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tpl-state">变量初始状态 (JSON)</Label>
        <Textarea
          id="tpl-state"
          value={JSON.stringify(tpl.variableState, null, 2)}
          onChange={(e) => applyState(e.target.value)}
          rows={6}
          className="font-mono text-[12px]"
          spellCheck={false}
        />
        {jsonError && <p className="text-[11px] text-[var(--rp-danger)]">JSON 有误：{jsonError}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>预览</Label>
        <div className="rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-3 text-[12px]">
          <div className="rp-md" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
      </div>
    </div>
  );
}
