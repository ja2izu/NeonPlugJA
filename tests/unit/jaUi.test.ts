/*
 * NeonPlugJA Ver.0.91.2 — 日本語表示スイッチと配色
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { autoTheme, parsePalette, NEON, BUILTIN, THEME_CHOICES } from '../../src/utils/jaThemes';
import { resolvePalette, useUiLanguageStore } from '../../src/store/uiLanguageStore';
import { tr } from '../../src/utils/tr';
import { JA_DICT } from '../../src/utils/jaDict';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);

describe('自動の配色', () => {
  it('月で季節を選ぶ', () => {
    expect(autoTheme(d(2026, 3, 1))).toBe('spring');
    expect(autoTheme(d(2026, 5, 31))).toBe('spring');
    expect(autoTheme(d(2026, 6, 1))).toBe('summer');
    expect(autoTheme(d(2026, 8, 31))).toBe('summer');
    expect(autoTheme(d(2026, 9, 1))).toBe('autumn');
    expect(autoTheme(d(2026, 11, 30))).toBe('autumn');
    expect(autoTheme(d(2026, 12, 1))).toBe('winter');
    expect(autoTheme(d(2027, 2, 28))).toBe('winter');
  });

  it('10 月の最後の 7 日間（25〜31 日）はハロウィン', () => {
    expect(autoTheme(d(2026, 10, 24))).toBe('autumn');
    expect(autoTheme(d(2026, 10, 25))).toBe('special');
    expect(autoTheme(d(2026, 10, 31))).toBe('special');
    expect(autoTheme(d(2026, 11, 1))).toBe('autumn');
  });

  it('選択肢は 自動・春夏秋冬・スペシャル・ユーザー定義 2 つの 8 通り', () => {
    expect(THEME_CHOICES.map((c) => c.value)).toEqual(
      ['auto', 'spring', 'summer', 'autumn', 'winter', 'special', 'user1', 'user2']);
  });
});

describe('ユーザー定義ファイル', () => {
  it('#RRGGBB の色だけ受け付け、欠けた色・形式の違う色はネオンの色', () => {
    const p = parsePalette(JSON.stringify({ name: 'わたしの色', bg: '#102030', accent: 'red', text: '#abcdef' }), 'ユーザー定義1');
    expect(p.name).toBe('わたしの色');
    expect(p.bg).toBe('#102030');
    expect(p.text).toBe('#ABCDEF');
    expect(p.accent).toBe(NEON.accent);
    expect(p.primary).toBe(NEON.primary);
  });

  it('名前が無ければ枠の名前', () => {
    expect(parsePalette('{}', 'ユーザー定義2').name).toBe('ユーザー定義2');
  });

  it('JSON でなければ例外、配列も例外', () => {
    expect(() => parsePalette('not json', 'x')).toThrow();
    expect(() => parsePalette('[]', 'x')).toThrow();
  });
});

describe('当てる配色', () => {
  const none = { user1: null, user2: null };
  it('英語表示はいつもネオン', () => {
    expect(resolvePalette('en', 'spring', none)).toEqual({ palette: NEON, neon: true });
  });
  it('日本語表示は選んだ配色', () => {
    expect(resolvePalette('ja', 'winter', none).palette).toBe(BUILTIN.winter);
    expect(resolvePalette('ja', 'auto', none, d(2026, 10, 30)).palette).toBe(BUILTIN.special);
  });
  it('未読込のユーザー定義はネオンの色（日本語表示の扱い）', () => {
    expect(resolvePalette('ja', 'user1', none)).toEqual({ palette: NEON, neon: false });
  });
});

describe('tr()', () => {
  afterEach(() => useUiLanguageStore.setState({ language: 'en' }));

  it('英語表示では原文のまま、差し込みも効く', () => {
    expect(tr('Write to Radio')).toBe('Write to Radio');
    expect(tr('Write to {0}', 'UV-K1')).toBe('Write to UV-K1');
  });

  it('日本語表示では対応表を引く', () => {
    useUiLanguageStore.setState({ language: 'ja' });
    expect(tr('Write to Radio')).toBe('無線機へ書込');
    expect(tr('Write to {0}', 'UV-K1')).toBe('UV-K1 へ書込');
    expect(tr('Export')).toBe('エクスポート');
  });

  it('表に無い文言は英語のまま', () => {
    useUiLanguageStore.setState({ language: 'ja' });
    expect(tr('No such text in the table')).toBe('No such text in the table');
  });

  it('対応表の差し込み {n} の数は英語と日本語で同じ', () => {
    for (const [en, ja] of Object.entries(JA_DICT)) {
      const count = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      expect(count(ja), en).toBe(count(en));
    }
  });
});
