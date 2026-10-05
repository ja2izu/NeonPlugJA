/*
 * NeonPlugJA Ver.0.91.2 — 日本語表示のときの配色
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * 配色 1 組。項目はユーザー定義ファイル（JSON）と同じ名前。
 * tailwind.config.js の色名との対応:
 *   bg = dark-charcoal, panel = deep-gray, text = cool-gray,
 *   accent = neon-cyan, accentBright = neon-cyan-bright,
 *   primary = neon-magenta, primaryBright = neon-magenta-bright, highlight = neon-yellow
 * 警告・エラーの色（Tailwind の amber / red）は配色に関係なく固定。
 */
export interface Palette {
  name: string;
  bg: string;
  panel: string;
  text: string;
  accent: string;
  accentBright: string;
  primary: string;
  primaryBright: string;
  highlight: string;
}

export const PALETTE_KEYS = [
  'bg', 'panel', 'text', 'accent', 'accentBright', 'primary', 'primaryBright', 'highlight',
] as const;
type ColorKey = (typeof PALETTE_KEYS)[number];

const CSS_VAR: Record<ColorKey, string> = {
  bg: '--np-charcoal',
  panel: '--np-deep-gray',
  text: '--np-cool-gray',
  accent: '--np-cyan',
  accentBright: '--np-cyan-bright',
  primary: '--np-magenta',
  primaryBright: '--np-magenta-bright',
  highlight: '--np-yellow',
};

/** 英語表示の配色（上流 NeonPlug と同じ）。ユーザー定義で欠けた色もこれになる */
export const NEON: Palette = {
  name: 'ネオン', bg: '#121212', panel: '#1E1E1E', text: '#B0B0B0', accent: '#00FFF7',
  accentBright: '#33FFF9', primary: '#FF00FF', primaryBright: '#FF33FF', highlight: '#FFF200',
};

/** 内蔵の配色（伝統色の名前は「それらしい色」）。見本: NeonPlugJA_配色見本_2610050755.html */
export const BUILTIN = {
  spring: { name: '春「桜」', bg: '#2A1E2C', panel: '#3A2B3D', text: '#E8DCE0', accent: '#F4A7B9',
    accentBright: '#F8C3CF', primary: '#B4436C', primaryBright: '#C65A80', highlight: '#C7DC68' },
  summer: { name: '夏「藍」', bg: '#0F2350', panel: '#1B2D5A', text: '#DCDDDD', accent: '#5BC8D8',
    accentBright: '#8ADBE6', primary: '#2F5D8C', primaryBright: '#3E70A3', highlight: '#F8E58C' },
  autumn: { name: '秋「紅葉」', bg: '#2B1A12', panel: '#3B261B', text: '#E6DCCF', accent: '#F8B500',
    accentBright: '#FFCB45', primary: '#B7282E', primaryBright: '#C9403F', highlight: '#E9A368' },
  winter: { name: '冬「雪」', bg: '#17184B', panel: '#24265A', text: '#DCDDDD', accent: '#C1E4E9',
    accentBright: '#E2F3F5', primary: '#C9171E', primaryBright: '#D93A3F', highlight: '#F5B1AA' },
  special: { name: 'ハロウィン', bg: '#1A1020', panel: '#2A1B33', text: '#E6DDE8', accent: '#F08A24',
    accentBright: '#F7A85A', primary: '#7A3B9E', primaryBright: '#8E4FB3', highlight: '#B5D334' },
} satisfies Record<string, Palette>;

export type BuiltinTheme = keyof typeof BUILTIN;
export type ThemeChoice = 'auto' | BuiltinTheme | 'user1' | 'user2';

export const THEME_CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'auto', label: '自動' },
  { value: 'spring', label: '春' },
  { value: 'summer', label: '夏' },
  { value: 'autumn', label: '秋' },
  { value: 'winter', label: '冬' },
  { value: 'special', label: 'スペシャル' },
  { value: 'user1', label: 'ユーザー定義1' },
  { value: 'user2', label: 'ユーザー定義2' },
];

/** 自動のときの配色。10 月 25〜31 日はハロウィン、ほかは季節（3〜5 春、6〜8 夏、9〜11 秋、12〜2 冬） */
export function autoTheme(now: Date): BuiltinTheme {
  const m = now.getMonth();
  if (m === 9 && now.getDate() >= 25) return 'special';
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * ユーザー定義ファイル（JSON）を読む。#RRGGBB でない色・欠けた色はネオンの色。
 * JSON でなければ例外（呼び出し側が利用者に知らせる）。
 */
export function parsePalette(text: string, fallbackName: string): Palette {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('定義ファイルの形式が違います（{ } で囲んだ JSON にしてください）');
  }
  const o = raw as Record<string, unknown>;
  const p: Palette = { ...NEON, name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : fallbackName };
  for (const k of PALETTE_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && HEX.test(v)) p[k] = v.toUpperCase();
  }
  return p;
}

const rgb = (hex: string) =>
  `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;

/** チェック印・選択欄の矢印（data URI は CSS 変数を読めないので、強調色から作る） */
function iconCss(accent: string): string {
  const c = encodeURIComponent(accent);
  return [
    `input[type="checkbox"]:checked{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='${c}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 8l3 3 7-7'/%3E%3C/svg%3E")}`,
    `input[type="checkbox"]:indeterminate{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='${c}' d='M4 7h8v2H4z'/%3E%3C/svg%3E")}`,
    `select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='${c}' d='M6 9L1 4h10z'/%3E%3C/svg%3E")}`,
  ].join('\n');
}

/** 配色を画面に当てる。neon = true のときは上流の配色（光彩もそのまま） */
export function applyPalette(p: Palette, neon: boolean): void {
  const root = document.documentElement;
  for (const k of PALETTE_KEYS) root.style.setProperty(CSS_VAR[k], rgb(p[k]));
  root.dataset.theme = neon ? 'neon' : 'ja';
  let style = document.getElementById('np-theme-icons');
  if (!style) {
    style = document.createElement('style');
    style.id = 'np-theme-icons';
    document.head.appendChild(style);
  }
  style.textContent = neon ? '' : iconCss(p.accent);
}
