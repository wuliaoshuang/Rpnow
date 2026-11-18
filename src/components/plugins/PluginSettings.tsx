/**
 * Plugin settings form.
 *
 * Renders the JSON-Schema-ish `config` block a plugin declares in its manifest.
 * Without this a plugin with an API key would be unconfigurable from the UI, so
 * it is a core surface rather than something each plugin must build itself.
 *
 * Supports the subset the manifest spec allows: string (with `enum` → select,
 * and `format: password` → secret field) and boolean.
 */

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { useApp } from '@/state/store.js';

export interface PluginConfigSchema {
  type?: string;
  properties?: Record<string, PluginConfigProperty>;
  required?: string[];
}

export interface PluginConfigProperty {
  type?: 'string' | 'boolean' | 'number';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  format?: string;
}

export function PluginSettings({ pluginId, schema }: { pluginId: string; schema: PluginConfigSchema }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const stored = settings.pluginConfig?.[pluginId] ?? {};

  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(schema?.properties ?? {})) {
      defaults[key] = stored[key] ?? prop.default ?? (prop.type === 'boolean' ? false : '');
    }
    setDraft(defaults);
    // Intentionally keyed on pluginId only: re-seeding on every settings change
    // would clobber what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId]);

  const props = Object.entries(schema?.properties ?? {});
  if (!props.length) return null;

  async function save() {
    setSaving(true);
    try {
      const next = {
        ...settings.pluginConfig,
        [pluginId]: { ...(settings.pluginConfig?.[pluginId] ?? {}), ...draft },
      };
      setSettings({ pluginConfig: next });
      toast.success('插件配置已保存');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/40 p-3">
      {props.map(([key, prop]) => {
        const id = `plugin-${pluginId}-${key}`;
        const required = schema.required?.includes(key);
        const value = draft[key];
        return (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={id} required={required}>
              {prop.title ?? key}
            </Label>
            {prop.type === 'boolean' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={id}
                  checked={Boolean(value)}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                />
                <span className="text-[12px] text-[var(--rp-fg-muted)]">{prop.description}</span>
              </div>
            ) : prop.enum?.length ? (
              <Select
                value={String(value ?? '')}
                onValueChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {prop.enum.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={id}
                type={prop.format === 'password' ? 'password' : 'text'}
                autoComplete="off"
                value={String(value ?? '')}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={prop.default !== undefined ? String(prop.default) : ''}
              />
            )}
            {prop.description && prop.type !== 'boolean' && (
              <p className="text-[11px] text-[var(--rp-fg-subtle)]">{prop.description}</p>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1">
        <Badge variant="outline">保存后立即生效</Badge>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" aria-hidden="true" />}
          保存配置
        </Button>
      </div>
    </div>
  );
}
