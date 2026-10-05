/*
 * NeonPlugJA Ver.0.91.2 — 日本語表示スイッチと配色
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { create } from 'zustand';
import {
  BUILTIN, NEON, THEME_CHOICES, autoTheme, parsePalette,
  type Palette, type ThemeChoice,
} from '../utils/jaThemes';

/**
 * 画面の表示言語（右上の EN／日本語）と、日本語表示のときの配色。
 * 英語表示のときは上流と同じネオンの配色。日本語表示のときは選んだ配色にして、
 * どちらの表示か一目で分かるようにする。
 * 名前の文字コードを切り替える「日本語名」スイッチ（japaneseNamesStore）とは別物。
 */
export type UiLanguage = 'en' | 'ja';
type UserSlot = 'user1' | 'user2';

const LANG_KEY = 'neonplugja-ui-language';
const THEME_KEY = 'neonplugja-ui-theme';
const USER_KEY: Record<UserSlot, string> = { user1: 'neonplugja-ui-user1', user2: 'neonplugja-ui-user2' };
const USER_NAME: Record<UserSlot, string> = { user1: 'ユーザー定義1', user2: 'ユーザー定義2' };

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice still applies until the page closes.
  }
};

const loadUser = (slot: UserSlot): Palette | null => {
  const t = read(USER_KEY[slot]);
  if (!t) return null;
  try {
    return parsePalette(t, USER_NAME[slot]);
  } catch {
    return null;
  }
};

const loadTheme = (): ThemeChoice => {
  const v = read(THEME_KEY);
  return THEME_CHOICES.some((c) => c.value === v) ? (v as ThemeChoice) : 'auto';
};

/** 今の設定で画面に当てる配色。ユーザー定義が未読込ならネオン */
export function resolvePalette(
  language: UiLanguage, theme: ThemeChoice, user: Record<UserSlot, Palette | null>, now: Date = new Date(),
): { palette: Palette; neon: boolean } {
  if (language !== 'ja') return { palette: NEON, neon: true };
  if (theme === 'user1' || theme === 'user2') return { palette: user[theme] ?? NEON, neon: false };
  return { palette: BUILTIN[theme === 'auto' ? autoTheme(now) : theme], neon: false };
}

interface UiLanguageState {
  language: UiLanguage;
  theme: ThemeChoice;
  user: Record<UserSlot, Palette | null>;
  setLanguage: (language: UiLanguage) => void;
  setTheme: (theme: ThemeChoice) => void;
  /** 定義ファイルの中身を読む。形式が違えば例外 */
  loadUserFile: (slot: UserSlot, text: string) => Palette;
}

export const useUiLanguageStore = create<UiLanguageState>((set, get) => ({
  language: read(LANG_KEY) === 'ja' ? 'ja' : 'en',
  theme: loadTheme(),
  user: { user1: loadUser('user1'), user2: loadUser('user2') },
  setLanguage: (language) => {
    write(LANG_KEY, language);
    set({ language });
  },
  setTheme: (theme) => {
    write(THEME_KEY, theme);
    set({ theme });
  },
  loadUserFile: (slot, text) => {
    const p = parsePalette(text, USER_NAME[slot]);
    write(USER_KEY[slot], text);
    set({ user: { ...get().user, [slot]: p } });
    return p;
  },
}));

/** 日本語表示か（文言の対応表を引くかどうか） */
export const isJaUi = (): boolean => useUiLanguageStore.getState().language === 'ja';
