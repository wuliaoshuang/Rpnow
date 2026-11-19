/**
 * SecretInput (R05, RP-Hub parity).
 *
 * A password field with show/hide + copy, which hides itself again on blur —
 * so a key the user peeked at does not stay visible after they move on.
 * Drop-in replacement for the bare `type="password"` inputs in settings.
 */

import * as React from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input.js';
import { cn } from '@/lib/utils';

export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = 'off',
  className,
  ariaLabel,
  onBlur,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  /** Accessible label for the input when there is no visible <Label>. */
  ariaLabel?: string;
  onBlur?: () => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="pr-16 font-mono text-[12.5px]"
        onBlur={() => {
          // RP-Hub behaviour: peeking is temporary — leaving the field hides it.
          setVisible(false);
          onBlur?.();
        }}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
        <button
          type="button"
          aria-label={visible ? '隐藏密钥' : '显示密钥'}
          title={visible ? '隐藏密钥' : '显示密钥'}
          onClick={() => setVisible((v) => !v)}
          className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label="复制密钥"
          title="复制密钥"
          disabled={!value}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.clearTimeout(copyTimer.current);
              copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)] disabled:opacity-40"
        >
          {copied ? <Check className="size-4 text-[var(--rp-ok)]" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
