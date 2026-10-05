/*
 * NeonPlugJA Ver.0.91.2 — 日本語表示スイッチと配色の選択（画面右上）
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import React, { useRef } from 'react';
import { useUiLanguageStore } from '../../store/uiLanguageStore';
import { THEME_CHOICES, type ThemeChoice } from '../../utils/jaThemes';

const THEME_HELP = '自動にすれば季節で配色が変わります。ユーザー定義も可能です。';

/**
 * EN／日本語の切替と、日本語表示のときの配色の選択。
 * ユーザー定義 1・2 は定義ファイル（JSON）を選んで読むだけ（画面で色は編集しない）。
 */
export const UiLanguageSwitch: React.FC = () => {
  const { language, theme, user, setLanguage, setTheme, loadUserFile } = useUiLanguageStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<'user1' | 'user2'>('user1');

  const pickFile = (slot: 'user1' | 'user2') => {
    slotRef.current = slot;
    fileRef.current?.click();
  };

  const onTheme = (v: ThemeChoice) => {
    setTheme(v);
    if ((v === 'user1' || v === 'user2') && !user[v]) pickFile(v);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      loadUserFile(slotRef.current, await file.text());
    } catch (err) {
      window.alert(`定義ファイルを読めませんでした: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const seg = (on: boolean) =>
    `px-2 py-0.5 text-xs border border-neon-cyan ${on ? 'bg-neon-cyan text-dark-charcoal' : 'text-neon-cyan hover:bg-neon-cyan/10'}`;

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="flex" role="group" aria-label="表示言語 / Language">
        <button type="button" className={`${seg(language === 'en')} rounded-l`} onClick={() => setLanguage('en')}>
          EN
        </button>
        <button type="button" className={`${seg(language === 'ja')} rounded-r border-l-0`} onClick={() => setLanguage('ja')}>
          日本語
        </button>
      </div>
      {language === 'ja' && (
        <>
          <select
            value={theme}
            onChange={(e) => onTheme(e.target.value as ThemeChoice)}
            title={THEME_HELP}
            aria-label="配色"
            className="bg-deep-gray text-neon-cyan border border-neon-cyan rounded text-xs py-0.5 pl-2"
          >
            {THEME_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {(c.value === 'user1' || c.value === 'user2') && user[c.value] ? `${c.label}（${user[c.value]!.name}）` : c.label}
              </option>
            ))}
          </select>
          {(theme === 'user1' || theme === 'user2') && (
            <button
              type="button"
              className="px-2 py-0.5 text-xs border border-neon-cyan text-neon-cyan rounded hover:bg-neon-cyan/10"
              title="定義ファイル（JSON）を選んで読み込みます"
              onClick={() => pickFile(theme)}
            >
              定義ファイル…
            </button>
          )}
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
        </>
      )}
    </div>
  );
};
