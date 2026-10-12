/*
 * NeonPlugJA — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
/**
 * 日本語化フォント（master_1990_v2）の自動判定。
 * 無線機の Radio_Y16 の 1 ブロックを読み、「あ」の移し先の字形が基準と一致するかを見る。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isJapaneseFontBlock,
  PROBE_BLOCK_ADDRESS,
  PROBE_BLOCK_LENGTH,
  PROBE_GLYPH_HEX,
  PROBE_GLYPH_OFFSET,
  PROBE_KU,
  PROBE_TEN,
  Y16_START,
} from '../../src/radios/dm32uv/japaneseFontProbe';
import { DM32UVProtocol } from '../../src/radios/dm32uv/protocol';

const glyph = Uint8Array.from(PROBE_GLYPH_HEX.match(/../g)!, (h) => parseInt(h, 16));

function block(withGlyph: boolean, fill = 0x5a): Uint8Array {
  const b = new Uint8Array(PROBE_BLOCK_LENGTH).fill(fill);
  if (withGlyph) b.set(glyph, PROBE_GLYPH_OFFSET);
  return b;
}

describe('日本語化フォントの判定', () => {
  it('位置: 区85点40 → スロット 7371 → Radio_Y16 の 0x102960、読むブロックは 0x102000', () => {
    expect(Y16_START).toBe(0x0c9000);
    expect(PROBE_BLOCK_ADDRESS).toBe(0x102000);
    expect(PROBE_BLOCK_LENGTH).toBe(4096);
    expect(PROBE_GLYPH_OFFSET).toBe(0x960);
    expect(PROBE_BLOCK_ADDRESS + PROBE_GLYPH_OFFSET).toBe(0x102960);
    expect(glyph).toHaveLength(32);
  });

  it('判定の字は master_1990_v2.csv の「あ」の区点と同じ（master を変えたら気づく）', () => {
    const csv = readFileSync(join(__dirname, '../../tools/data/master_1990_v2.csv'), 'utf8').replace(/^﻿/, '');
    const row = csv.split(/\r?\n/).find((l) => l.startsWith('あ,'))!;
    const [, kind, ku, ten] = row.split(',');
    expect(kind).toBe('moved');
    expect([Number(ku), Number(ten)]).toEqual([PROBE_KU, PROBE_TEN]);
  });

  it('基準の字形が入っていれば日本語化フォント', () => {
    expect(isJapaneseFontBlock(block(true))).toBe(true);
  });

  it('入っていなければ違う（純正・旧い版・消去済み 0xFF）', () => {
    expect(isJapaneseFontBlock(block(false))).toBe(false);
    expect(isJapaneseFontBlock(block(false, 0xff))).toBe(false);
    expect(isJapaneseFontBlock(block(false, 0x00))).toBe(false);
  });

  it('1 バイトでも違えば違う。短いデータも違う', () => {
    const b = block(true);
    b[PROBE_GLYPH_OFFSET + 31] ^= 0x01;
    expect(isJapaneseFontBlock(b)).toBe(false);
    expect(isJapaneseFontBlock(new Uint8Array(16))).toBe(false);
  });
});

describe('DM32UVProtocol.probeJapaneseFont', () => {
  function protocolWith(readMemory: (address: number, length: number) => Promise<Uint8Array>) {
    const p = new DM32UVProtocol() as unknown as {
      connection: unknown;
      radioInfo: unknown;
      probeJapaneseFont(): Promise<boolean>;
    };
    p.connection = { readMemory };
    p.radioInfo = { model: 'DM-32UV' };
    return p;
  }

  it('0x102000 から 4096 バイトを 1 回だけ読み、一致すれば true', async () => {
    const read = vi.fn(async () => block(true));
    const p = protocolWith(read);
    expect(await p.probeJapaneseFont()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(0x102000, 4096);
  });

  it('一致しなければ false', async () => {
    expect(await protocolWith(async () => block(false)).probeJapaneseFont()).toBe(false);
  });

  it('読めなかったときは例外にせず false（読み込み全体は止めない）', async () => {
    const p = protocolWith(async () => {
      throw new Error('timeout');
    });
    expect(await p.probeJapaneseFont()).toBe(false);
  });
});
