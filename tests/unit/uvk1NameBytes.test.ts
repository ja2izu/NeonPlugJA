/*
 * NeonPlugJA Ver.0.91 — UV-K1 (25Ja) channel name: UTF-8 byte limit at input
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import { utf8NameByteLength, fitUtf8NameBytes } from '../../src/utils/japaneseNames';
import { channelProblems } from '../../src/services/validation/channelProblems';
import { validateChannel } from '../../src/services/validation/channelValidator';
import { createDefaultChannel } from '../../src/utils/channelHelpers';
import { UVK1_CAPS } from '../../src/radios/uvk1/capabilities';

describe('UTF-8 バイト数（UV-K1）', () => {
  it('英数字 1、漢字・かな 3', () => {
    expect(utf8NameByteLength('')).toBe(0);
    expect(utf8NameByteLength('ABC')).toBe(3);
    expect(utf8NameByteLength('東京AIR')).toBe(9);
    expect(utf8NameByteLength('あいうえおかきくけこ')).toBe(30);
  });

  it('31 バイトで切る（文字の途中では切らない）', () => {
    expect(fitUtf8NameBytes('あいうえおかきくけこさ', 31)).toBe('あいうえおかきくけこ'); // 11 字 = 33 B → 10 字 30 B
    expect(fitUtf8NameBytes('A' + 'あいうえおかきくけこ', 31)).toBe('Aあいうえおかきくけこ'); // 31 B ちょうど
    expect(fitUtf8NameBytes('AB' + 'あいうえおかきくけこ', 31)).toBe('ABあいうえおかきくけ'); // 次の 3 B で 35 → 落とす
    expect(fitUtf8NameBytes('A'.repeat(40), 31)).toBe('A'.repeat(31));
    expect(fitUtf8NameBytes('東京', 31)).toBe('東京');
  });

  it('サロゲートペア（4 バイト）も途中で切らない', () => {
    expect(fitUtf8NameBytes('A'.repeat(29) + '😀', 31)).toBe('A'.repeat(29));
    expect(fitUtf8NameBytes('A'.repeat(27) + '😀', 31)).toBe('A'.repeat(27) + '😀');
  });
});

describe('UV-K1 の能力フラグと検査', () => {
  it('能力フラグ: UTF-8 バイトで数える、上限 31', () => {
    expect(UVK1_CAPS.channelNameUtf8Bytes).toBe(true);
    expect(UVK1_CAPS.maxChannelNameLength).toBe(31);
  });

  const rule = { maxNameLength: 31, nameUtf8: true, bandLimits: UVK1_CAPS.bandLimits } as const;
  const ch = (name: string) => ({ ...createDefaultChannel(1), name, rxFrequency: 145.5, txFrequency: 145.5 });

  it('channelProblems: 31 バイトは問題なし、32 バイトは印', () => {
    expect(channelProblems(ch('A' + 'あいうえおかきくけこ'), rule).name).toBeUndefined();
    expect(channelProblems(ch('AB' + 'あいうえおかきくけこ'), rule).name).toMatch(/31 バイト/);
  });

  it('validateChannel: 31 バイトは通り、32 バイトはエラー', () => {
    const opts = { maxNameLength: 31, nameUtf8: true };
    expect(validateChannel(ch('A' + 'あいうえおかきくけこ'), UVK1_CAPS.bandLimits, 1024, opts).filter((e) => e.field === 'name')).toEqual([]);
    expect(validateChannel(ch('AB' + 'あいうえおかきくけこ'), UVK1_CAPS.bandLimits, 1024, opts).some((e) => e.field === 'name')).toBe(true);
  });

  it('nameUtf8 なしの無線機は従来どおり文字数', () => {
    const plain = { maxNameLength: 16, bandLimits: UVK1_CAPS.bandLimits };
    expect(channelProblems(ch('あ'.repeat(16)), plain).name).toBeUndefined();
    expect(channelProblems(ch('あ'.repeat(17)), plain).name).toMatch(/16 characters/);
  });
});
