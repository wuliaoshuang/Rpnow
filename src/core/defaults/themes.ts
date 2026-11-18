/**
 * Built-in themes.
 *
 * A theme is a plugin that `provide`s the `theme` service. Installing another
 * theme plugin pushes this one onto the override stack; uninstalling restores
 * it. That is the whole mechanism — no special-casing in the UI.
 *
 * Each theme supplies CSS custom properties. Because every component reads
 * tokens (never hex), a theme swap recolours the entire app including
 * third-party plugin surfaces.
 */

export interface BuiltinTheme {
  id: string;
  label: string;
  description: string;
  /** Light or dark base, used for the `dark` class and meta theme-color. */
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
  /** Optional extra CSS appended to the document. */
  css?: string;
}

const MIDNIGHT_ROSE: Record<string, string> = {
  '--rp-bg': 'oklch(0.155 0.018 320)',
  '--rp-bg-elevated': 'oklch(0.205 0.022 322)',
  '--rp-bg-sunken': 'oklch(0.125 0.016 318)',
  '--rp-fg': 'oklch(0.94 0.012 330)',
  '--rp-fg-muted': 'oklch(0.72 0.02 325)',
  '--rp-fg-subtle': 'oklch(0.58 0.02 325)',
  '--rp-border': 'oklch(0.29 0.025 322)',
  '--rp-border-strong': 'oklch(0.38 0.03 322)',
  '--rp-accent': 'oklch(0.68 0.19 8)',
  '--rp-accent-fg': 'oklch(0.16 0.02 320)',
  '--rp-accent-soft': 'oklch(0.3 0.06 350)',
  '--rp-accent-ring': 'oklch(0.68 0.19 8 / 0.5)',
  '--rp-secondary': 'oklch(0.68 0.13 350)',
  '--rp-user-bubble': 'oklch(0.27 0.035 330)',
  '--rp-char-bubble': 'oklch(0.205 0.022 322)',
};

const PAPER_INK: Record<string, string> = {
  '--rp-bg': 'oklch(0.975 0.008 90)',
  '--rp-bg-elevated': 'oklch(0.995 0.004 90)',
  '--rp-bg-sunken': 'oklch(0.945 0.012 90)',
  '--rp-fg': 'oklch(0.26 0.015 60)',
  '--rp-fg-muted': 'oklch(0.48 0.014 60)',
  '--rp-fg-subtle': 'oklch(0.6 0.012 60)',
  '--rp-border': 'oklch(0.9 0.014 80)',
  '--rp-border-strong': 'oklch(0.82 0.02 80)',
  '--rp-accent': 'oklch(0.5 0.11 30)',
  '--rp-accent-fg': 'oklch(0.99 0 0)',
  '--rp-accent-soft': 'oklch(0.94 0.03 60)',
  '--rp-accent-ring': 'oklch(0.5 0.11 30 / 0.4)',
  '--rp-secondary': 'oklch(0.6 0.09 40)',
  '--rp-user-bubble': 'oklch(0.95 0.015 80)',
  '--rp-char-bubble': 'oklch(0.995 0.004 90)',
};

const CYBER_NEON: Record<string, string> = {
  '--rp-bg': 'oklch(0.14 0.03 265)',
  '--rp-bg-elevated': 'oklch(0.19 0.04 265)',
  '--rp-bg-sunken': 'oklch(0.11 0.03 265)',
  '--rp-fg': 'oklch(0.94 0.02 200)',
  '--rp-fg-muted': 'oklch(0.72 0.04 210)',
  '--rp-fg-subtle': 'oklch(0.58 0.05 220)',
  '--rp-border': 'oklch(0.3 0.06 260)',
  '--rp-border-strong': 'oklch(0.42 0.09 255)',
  '--rp-accent': 'oklch(0.78 0.18 195)',
  '--rp-accent-fg': 'oklch(0.14 0.03 265)',
  '--rp-accent-soft': 'oklch(0.3 0.08 220)',
  '--rp-accent-ring': 'oklch(0.78 0.18 195 / 0.5)',
  '--rp-secondary': 'oklch(0.7 0.2 330)',
  '--rp-user-bubble': 'oklch(0.24 0.05 265)',
  '--rp-char-bubble': 'oklch(0.19 0.04 265)',
};

const SEPIA: Record<string, string> = {
  '--rp-bg': 'oklch(0.92 0.025 75)',
  '--rp-bg-elevated': 'oklch(0.95 0.02 78)',
  '--rp-bg-sunken': 'oklch(0.88 0.03 72)',
  '--rp-fg': 'oklch(0.3 0.04 55)',
  '--rp-fg-muted': 'oklch(0.48 0.04 55)',
  '--rp-fg-subtle': 'oklch(0.6 0.035 55)',
  '--rp-border': 'oklch(0.82 0.035 70)',
  '--rp-border-strong': 'oklch(0.72 0.045 65)',
  '--rp-accent': 'oklch(0.52 0.13 45)',
  '--rp-accent-fg': 'oklch(0.98 0.01 80)',
  '--rp-accent-soft': 'oklch(0.87 0.05 70)',
  '--rp-accent-ring': 'oklch(0.52 0.13 45 / 0.4)',
  '--rp-secondary': 'oklch(0.62 0.1 50)',
  '--rp-user-bubble': 'oklch(0.88 0.03 72)',
  '--rp-char-bubble': 'oklch(0.95 0.02 78)',
};

export const BUILTIN_THEMES: BuiltinTheme[] = [
  {
    id: 'rpnow.theme.midnight-rose',
    label: '午夜玫瑰',
    description: '深紫夜色 + 玫瑰高光，适合长时间沉浸阅读的默认深色主题。',
    mode: 'dark',
    tokens: MIDNIGHT_ROSE,
  },
  {
    id: 'rpnow.theme.paper-ink',
    label: '纸墨',
    description: '暖白纸面与墨色文字，中文衬线正文更适合长篇剧情。',
    mode: 'light',
    tokens: PAPER_INK,
    css: '.rp-md{font-family:var(--font-serif);}',
  },
  {
    id: 'rpnow.theme.cyber-neon',
    label: '赛博霓虹',
    description: '冷蓝夜色与青色霓虹，科技/未来题材的沉浸感更强。',
    mode: 'dark',
    tokens: CYBER_NEON,
    css: '.rp-md strong{color:var(--rp-accent);}',
  },
  {
    id: 'rpnow.theme.sepia',
    label: '复古棕褐',
    description: '低蓝光护眼配色，模仿旧书页的阅读体验。',
    mode: 'light',
    tokens: SEPIA,
    css: '.rp-md{font-family:var(--font-serif);}',
  },
];

export const THEME_MAP = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));
