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

const FOREST_GREEN: Record<string, string> = {
  '--rp-bg': 'oklch(0.16 0.03 150)',
  '--rp-bg-elevated': 'oklch(0.21 0.035 150)',
  '--rp-bg-sunken': 'oklch(0.13 0.03 150)',
  '--rp-fg': 'oklch(0.93 0.02 140)',
  '--rp-fg-muted': 'oklch(0.72 0.03 145)',
  '--rp-fg-subtle': 'oklch(0.58 0.03 145)',
  '--rp-border': 'oklch(0.3 0.04 150)',
  '--rp-border-strong': 'oklch(0.4 0.05 150)',
  '--rp-accent': 'oklch(0.72 0.15 145)',
  '--rp-accent-fg': 'oklch(0.15 0.03 150)',
  '--rp-accent-soft': 'oklch(0.3 0.06 150)',
  '--rp-accent-ring': 'oklch(0.72 0.15 145 / 0.5)',
  '--rp-secondary': 'oklch(0.68 0.12 90)',
  '--rp-user-bubble': 'oklch(0.26 0.045 150)',
  '--rp-char-bubble': 'oklch(0.21 0.035 150)',
};

const SAKURA_PINK: Record<string, string> = {
  '--rp-bg': 'oklch(0.97 0.015 350)',
  '--rp-bg-elevated': 'oklch(0.99 0.008 350)',
  '--rp-bg-sunken': 'oklch(0.94 0.02 350)',
  '--rp-fg': 'oklch(0.3 0.03 350)',
  '--rp-fg-muted': 'oklch(0.5 0.03 350)',
  '--rp-fg-subtle': 'oklch(0.62 0.025 350)',
  '--rp-border': 'oklch(0.89 0.025 350)',
  '--rp-border-strong': 'oklch(0.8 0.04 350)',
  '--rp-accent': 'oklch(0.62 0.16 350)',
  '--rp-accent-fg': 'oklch(0.99 0 0)',
  '--rp-accent-soft': 'oklch(0.93 0.04 350)',
  '--rp-accent-ring': 'oklch(0.62 0.16 350 / 0.4)',
  '--rp-secondary': 'oklch(0.68 0.1 20)',
  '--rp-user-bubble': 'oklch(0.94 0.03 350)',
  '--rp-char-bubble': 'oklch(0.99 0.008 350)',
};

const DEEP_OCEAN: Record<string, string> = {
  '--rp-bg': 'oklch(0.15 0.025 240)',
  '--rp-bg-elevated': 'oklch(0.2 0.03 240)',
  '--rp-bg-sunken': 'oklch(0.12 0.025 240)',
  '--rp-fg': 'oklch(0.93 0.015 230)',
  '--rp-fg-muted': 'oklch(0.71 0.03 230)',
  '--rp-fg-subtle': 'oklch(0.57 0.03 235)',
  '--rp-border': 'oklch(0.29 0.04 240)',
  '--rp-border-strong': 'oklch(0.39 0.05 240)',
  '--rp-accent': 'oklch(0.74 0.14 210)',
  '--rp-accent-fg': 'oklch(0.14 0.025 240)',
  '--rp-accent-soft': 'oklch(0.29 0.06 230)',
  '--rp-accent-ring': 'oklch(0.74 0.14 210 / 0.5)',
  '--rp-secondary': 'oklch(0.68 0.12 260)',
  '--rp-user-bubble': 'oklch(0.25 0.04 240)',
  '--rp-char-bubble': 'oklch(0.2 0.03 240)',
};

const OBSIDIAN: Record<string, string> = {
  '--rp-bg': 'oklch(0.13 0.005 0)',
  '--rp-bg-elevated': 'oklch(0.18 0.005 0)',
  '--rp-bg-sunken': 'oklch(0.1 0.005 0)',
  '--rp-fg': 'oklch(0.92 0.005 0)',
  '--rp-fg-muted': 'oklch(0.7 0.005 0)',
  '--rp-fg-subtle': 'oklch(0.55 0.005 0)',
  '--rp-border': 'oklch(0.28 0.005 0)',
  '--rp-border-strong': 'oklch(0.38 0.005 0)',
  '--rp-accent': 'oklch(0.75 0.14 70)',
  '--rp-accent-fg': 'oklch(0.15 0.005 0)',
  '--rp-accent-soft': 'oklch(0.28 0.04 70)',
  '--rp-accent-ring': 'oklch(0.75 0.14 70 / 0.5)',
  '--rp-secondary': 'oklch(0.65 0.08 40)',
  '--rp-user-bubble': 'oklch(0.23 0.005 0)',
  '--rp-char-bubble': 'oklch(0.18 0.005 0)',
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
  {
    id: 'rpnow.theme.forest-green',
    label: '森林绿',
    description: '深绿林间底色 + 嫩叶高光，沉静护眼，适合长剧情慢慢读。',
    mode: 'dark',
    tokens: FOREST_GREEN,
  },
  {
    id: 'rpnow.theme.sakura-pink',
    label: '樱花粉',
    description: '柔粉纸面 + 樱花高光，轻软温暖，doro 最搭的一套。',
    mode: 'light',
    tokens: SAKURA_PINK,
    css: '.rp-md{font-family:var(--font-serif);}',
  },
  {
    id: 'rpnow.theme.deep-ocean',
    label: '深海蓝',
    description: '深蓝海底 + 青色水光，安静克制，夜里读也不刺眼。',
    mode: 'dark',
    tokens: DEEP_OCEAN,
  },
  {
    id: 'rpnow.theme.obsidian',
    label: '曜石黑',
    description: '近乎纯黑的中性底色 + 琥珀高光，对比最强、最省电。',
    mode: 'dark',
    tokens: OBSIDIAN,
  },
];

export const THEME_MAP = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));
