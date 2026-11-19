/**
 * N07: first-run onboarding wizard (RP-Hub parity).
 *
 * RP-Hub forces a "欢迎使用 RP Hub" dialog when the user name is still the
 * placeholder, and saving validates the name is non-empty. Rpnow had only an
 * empty-state nudge on the chat page and a sample persona named 旅人.
 *
 * The wizard shows on launch until `settings.onboardingCompleted` is set.
 * Identity (name) is required — the save button stays disabled until a name
 * is entered. It creates (or updates, when a default persona already exists)
 * the default persona and marks onboarding done. There is no dismiss path:
 * first launch must set an identity, as in RP-Hub.
 */

import * as React from 'react';
import { useApp } from '@/state/store.js';
import { Button } from '@/components/ui/button.js';
import { Input, Label, Textarea } from '@/components/ui/input.js';
import { toast } from '@/components/ui/toast.js';
import { uid } from '@/lib/utils.js';

export function OnboardingDialog() {
  const personas = useApp((s) => s.personas);
  const settings = useApp((s) => s.settings);
  const savePersona = useApp((s) => s.savePersona);
  const setSettings = useApp((s) => s.setSettings);

  const existing = personas.find((p) => p.id === settings.defaultPersonaId) ?? personas[0];
  const [name, setName] = React.useState(existing?.name ?? '');
  const [description, setDescription] = React.useState(existing?.description ?? '');
  const [saving, setSaving] = React.useState(false);

  const nameValid = name.trim().length > 0;

  const save = async () => {
    if (!nameValid || saving) return;
    setSaving(true);
    try {
      const persona = existing
        ? { ...existing, name: name.trim(), description: description.trim() }
        : {
            id: uid('persona'),
            name: name.trim(),
            description: description.trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
      await savePersona(persona);
      setSettings({ defaultPersonaId: persona.id, onboardingCompleted: true });
      toast.success('身份已保存', `你好，${persona.name}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="欢迎使用 RPNow"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold">欢迎使用 RPNow</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--rp-fg-muted)]">
          先设定你的身份，角色就知道「你是谁」了。名字是必填的，描述可以以后在「设置 → 身份」里再改。
        </p>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-name" required>
              你的名字
            </Label>
            <Input
              id="onboarding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：霜霜"
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
              }}
            />
            {!nameValid && <p className="text-[11px] text-[var(--rp-danger)]">名字是必填的。</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-desc">身份描述（可选）</Label>
            <Textarea
              id="onboarding-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="描述你的身份：姓名、外貌、与角色的关系…"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              描述会作为「我的身份」区块进入提示词，{'{{user}}'} 会替换为这个名字。
            </p>
          </div>
        </div>
        <Button className="mt-5 h-11 w-full rounded-full text-[15px]" disabled={!nameValid || saving} onClick={() => void save()}>
          {saving ? '正在保存…' : '开始使用'}
        </Button>
      </div>
    </div>
  );
}
