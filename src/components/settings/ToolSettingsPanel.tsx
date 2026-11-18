/**
 * Agent tool settings.
 *
 * Mirrors RP-Hub's tool panel: three independent toggles, the call policy, the
 * result count, and the Tavily key that only matters when web search is on.
 */

import * as React from 'react';
import { Globe, KeyRound, Search, Shuffle } from 'lucide-react';
import { useApp } from '@/state/store.js';
import type { ToolAggressiveness } from '@/core/tools/types.js';
import { TOOL_RESULT_COUNT } from '@/core/tools/types.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';

export function ToolSettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const tools = settings.tools;
  const patch = (p: Partial<typeof tools>) => setSettings({ tools: { ...tools, ...p } });

  const enabled = [tools.keywordEnabled, tools.webEnabled, tools.randomEnabled].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ToolCard
          icon={<Search className="size-4" aria-hidden="true" />}
          title="关键词检索"
          hint="在当前对话历史里查找原文片段，返回轮次、说话方和上下文。"
          checked={tools.keywordEnabled}
          onChange={(v) => patch({ keywordEnabled: v })}
        />
        <ToolCard
          icon={<Globe className="size-4" aria-hidden="true" />}
          title="联网搜索"
          hint="调用 Tavily；查询里带网址时改为读取该网页。需要 API Key。"
          checked={tools.webEnabled}
          onChange={(v) => patch({ webEnabled: v })}
        />
        <ToolCard
          icon={<Shuffle className="size-4" aria-hidden="true" />}
          title="随机生成"
          hint="按 min/max 生成含两端的整数，或从候选里等概率抽取（去重）。"
          checked={tools.randomEnabled}
          onChange={(v) => patch({ randomEnabled: v })}
        />
      </div>

      {enabled > 0 && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="tool-aggressiveness">调用策略</Label>
            <Select
              value={tools.aggressiveness}
              onValueChange={(v) => patch({ aggressiveness: v as ToolAggressiveness })}
            >
              <SelectTrigger id="tool-aggressiveness">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="adaptive">自适应（模型自行判断）</SelectItem>
                <SelectItem value="force">强制（每轮至少调用一个工具）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              {tools.aggressiveness === 'force'
                ? '正式回复前必须先调用至少 1 个最相关的工具，收到结果后再回答。'
                : '人设、剧情、记忆、事实或前文细节不明确时先调用工具；上下文足够时可直接回复。'}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>检索条数</Label>
              <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">{tools.resultCount} 条</span>
            </div>
            <Slider
              value={[tools.resultCount]}
              min={TOOL_RESULT_COUNT.min}
              max={TOOL_RESULT_COUNT.max}
              step={1}
              onValueChange={([v]) => patch({ resultCount: v })}
              aria-label="检索条数"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              只影响关键词检索和联网搜索的返回条数；增强记忆的召回上限由记忆设置单独控制。
            </p>
          </div>

          {tools.webEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="tavily-key" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" aria-hidden="true" /> Tavily API Key
              </Label>
              <Input
                id="tavily-key"
                type="password"
                value={tools.tavilyKey}
                onChange={(e) => patch({ tavilyKey: e.target.value })}
                placeholder="tvly-…"
                autoComplete="off"
              />
              <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                仅在浏览器直连可用时有效；Tauri 桌面端与安卓端不受 CORS 限制。
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.success('已保存', '联网搜索将在下次回复时可用')}
              >
                保存密钥
              </Button>
            </div>
          )}
        </>
      )}

      {enabled === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--rp-border)] p-3 text-[12px] text-[var(--rp-fg-muted)]">
          还没有启用任何工具。工具由模型自主决定是否调用，调用结果只在本次请求内有效，不会写入聊天记录。
        </p>
      )}
    </div>
  );
}

function ToolCard({
  icon,
  title,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--rp-border)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-[var(--rp-accent)]">{icon}</span>
        <p className="text-[12.5px] font-medium">{title}</p>
      </div>
      <p className="min-h-8 flex-1 text-[11px] leading-snug text-[var(--rp-fg-muted)]">{hint}</p>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
