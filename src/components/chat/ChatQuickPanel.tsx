/**
 * Chat quick panel (N02 / N03).
 *
 * RP-Hub's input-island quick panel, anchored above the composer: model
 * slots (quality/balanced/fast), reasoning-effort slider, temperature
 * slider, stream toggle, immersive toggle. In Rpnow the four generation
 * controls are **per-chat** — they write `chat.params` overrides and fall
 * back to the global setting / preset when a chat has none — while the
 * three model slots themselves are global settings (edited through the
 * model picker). The footnote in the panel says exactly that, so a user
 * never mistakes a per-chat temperature for a global one.
 */

import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RPAppSettings, RPChat } from '@/core/types/chat.js';
import { Slider, Switch } from '@/components/ui/input.js';
import {
  MODEL_SLOTS,
  REASONING_EFFORT_OPTIONS,
  chatImmersive,
  chatModelSlot,
  chatReasoningEffort,
  chatStream,
  chatTemperature,
  hasChatReasoningEffort,
  hasChatTemperature,
  reasoningEffortIndex,
  slotModel,
} from '@/core/llm/modelSlots.js';
import type { ModelPickerTarget } from '@/components/chat/ModelPicker.js';

export interface ChatQuickPanelProps {
  chat: RPChat;
  settings: RPAppSettings;
  /** Preset temperature the chat falls back to (displayed when unoverridden). */
  presetTemperature?: number;
  currentModel: string;
  onPatchChat: (patch: Partial<RPChat>) => void;
  onOpenModelPicker: (target: ModelPickerTarget) => void;
  onClose: () => void;
}

export function ChatQuickPanel({
  chat,
  settings,
  presetTemperature,
  currentModel,
  onPatchChat,
  onOpenModelPicker,
  onClose,
}: ChatQuickPanelProps) {
  const setParam = (key: string, value: unknown) =>
    onPatchChat({ params: { ...(chat.params ?? {}), [key]: value } });
  const clearParam = (key: string) => {
    const next = { ...(chat.params ?? {}) };
    delete next[key];
    onPatchChat({ params: next });
  };

  const temperature = chatTemperature(chat, presetTemperature);
  const effort = chatReasoningEffort(chat, settings);
  const effortIndex = reasoningEffortIndex(effort);
  const stream = chatStream(chat, settings);
  const immersive = chatImmersive(chat, settings);
  const activeSlot = chatModelSlot(chat);

  return (
    <div
      role="dialog"
      aria-label="快捷面板"
      className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 shadow-rp"
      style={{ maxHeight: 'calc(100dvh - 12rem)' }}
    >
      <div className="flex items-center justify-between pl-1">
        <h3 className="text-sm font-bold">快捷面板</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭快捷面板"
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg)]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Current model + open the picker. */}
      <button
        type="button"
        onClick={() => onOpenModelPicker('chat')}
        aria-label="更换模型"
        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl bg-[var(--rp-bg-sunken)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--rp-bg-sunken)]/70"
      >
        <span className="shrink-0 text-[12px] font-semibold text-[var(--rp-fg-muted)]">当前模型</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={currentModel}>
          {currentModel || '未设置'}
        </span>
        <span className="shrink-0 text-[12px] font-medium text-[var(--rp-accent)]">换模型</span>
      </button>

      {/* N03: three model slots; tap a configured slot to switch to it. */}
      <div className="rounded-xl bg-[var(--rp-bg-sunken)]/70 p-1">
        <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
          <span className="text-[12px] font-semibold text-[var(--rp-fg-muted)]">模型槽位</span>
          <button
            type="button"
            onClick={() => onOpenModelPicker('slots')}
            aria-label="编辑模型槽位"
            className="cursor-pointer text-[12px] font-medium text-[var(--rp-accent)]"
          >
            编辑
          </button>
        </div>
        {MODEL_SLOTS.map((slot) => {
          const model = slotModel(settings, slot.id);
          const active = activeSlot === slot.id && Boolean(model);
          return (
            <button
              key={slot.id}
              type="button"
              onClick={() => {
                if (!model) return;
                onPatchChat({ model, params: { ...(chat.params ?? {}), modelSlot: slot.id } });
              }}
              disabled={!model}
              aria-pressed={active}
              aria-label={`切换到${slot.label}槽位${model ? `：${model}` : '（未配置）'}`}
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                active ? 'text-[var(--rp-accent)]' : 'text-[var(--rp-fg-muted)]',
                !model ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:text-[var(--rp-accent)]',
              )}
            >
              <span className="shrink-0 text-[12px] font-semibold">
                槽位 {slot.index + 1} · {slot.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={model}>
                {model || '未配置'}
              </span>
              {active ? (
                <Check className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <span className="w-4 shrink-0" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      {/* N02: reasoning effort + temperature, per chat. */}
      <div className="flex flex-col gap-2 rounded-xl bg-[var(--rp-bg-sunken)]/70 px-3 py-2.5">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-1 text-[12px]">
            <span className="font-bold text-[var(--rp-fg-muted)]">推理强度</span>
            <span className="font-semibold text-[var(--rp-fg-muted)]">
              {REASONING_EFFORT_OPTIONS[effortIndex].label}
              {hasChatReasoningEffort(chat) ? '' : '（全局）'}
            </span>
          </div>
          <Slider
            value={[effortIndex]}
            onValueChange={([v]) => setParam('reasoningEffort', REASONING_EFFORT_OPTIONS[v]?.value ?? '')}
            min={0}
            max={REASONING_EFFORT_OPTIONS.length - 1}
            step={1}
            aria-label="推理强度"
          />
        </div>
        <div className="min-w-0 border-t border-[var(--rp-border)] pt-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-1 text-[12px]">
            <span className="font-bold text-[var(--rp-fg-muted)]">温度</span>
            <span className="flex items-center gap-2">
              <span className="font-mono font-semibold tabular-nums text-[var(--rp-fg-muted)]">
                {temperature.toFixed(2)}
              </span>
              {hasChatTemperature(chat) && (
                <button
                  type="button"
                  onClick={() => clearParam('temperature')}
                  aria-label="恢复预设温度"
                  className="cursor-pointer font-medium text-[var(--rp-accent)]"
                >
                  恢复预设
                </button>
              )}
            </span>
          </div>
          <Slider
            value={[temperature]}
            onValueChange={([v]) => setParam('temperature', Math.round(v * 100) / 100)}
            min={0}
            max={2}
            step={0.01}
            aria-label="温度"
          />
        </div>
      </div>

      {/* N02: stream + immersive, per chat. */}
      <div className="flex flex-col gap-1 rounded-xl bg-[var(--rp-bg-sunken)]/70">
        <label className="flex cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2.5 py-2.5 text-[12px] font-semibold text-[var(--rp-fg-muted)] transition-colors hover:bg-[var(--rp-bg-sunken)]">
          <span>流式输出</span>
          <Switch checked={stream} onCheckedChange={(v) => setParam('stream', v)} aria-label="流式输出" />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-1.5 rounded-xl px-2.5 py-2.5 text-[12px] font-semibold text-[var(--rp-fg-muted)] transition-colors hover:bg-[var(--rp-bg-sunken)]">
          <span>沉浸模式</span>
          <Switch checked={immersive} onCheckedChange={(v) => setParam('immersiveMode', v)} aria-label="沉浸模式" />
        </label>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-[var(--rp-fg-subtle)]">
        温度 / 推理强度 / 流式 / 沉浸只对本聊天生效；模型槽位是全局设置，三个聊天共用。
      </p>
    </div>
  );
}
