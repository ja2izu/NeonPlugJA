/*
 * NeonPlugJA Ver.0.93 — UV-K1 (25Ja) 起動画面の文言（0x0089A0）
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import { UVK1Protocol } from '../../src/radios/uvk1/protocol';
import { createDefaultChannel } from '../../src/utils/channelHelpers';
import {
  applyBootText, bootTextBytes, bootTextWidth, decodeBootText, encodeBootText, truncateBootText, validateBootText,
} from '../../src/radios/uvk1/bootText';
import { assertWritable } from '../../src/radios/uvk1/writePlan';

const CH = [createDefaultChannel({ number: 1, name: 'A', rxFrequency: 145.0, txFrequency: 145.0 })];

function fakeRadio() {
  const mem = new Map<number, number>();
  const get = (a: number) => mem.get(a) ?? 0xff;
  const writes: Array<{ address: number; data: number[] }> = [];
  const conn = {
    readBlock: async (a: number, len: number) => Uint8Array.from({ length: len }, (_, i) => get(a + i)),
    spiRead: async (a: number, len: number) => Uint8Array.from({ length: len }, (_, i) => get(a + i)),
    spiWrite: async (a: number, d: Uint8Array) => {
      writes.push({ address: a, data: [...d] });
      d.forEach((b, i) => mem.set(a + i, b));
    },
  };
  return { conn, mem, get, writes };
}
function protocol(font: '25ja' | 'dondji', fwVersion: string | null, conn: unknown) {
  const p = new UVK1Protocol();
  const any = p as unknown as Record<string, unknown>;
  any.conn = conn; any.font = font; any.longNames = font === '25ja'; any.fwVersion = fwVersion;
  return p;
}
const hex = (get: (a: number) => number, a: number, n: number) =>
  Array.from({ length: n }, (_, i) => get(a + i).toString(16).padStart(2, '0')).join(' ');

describe('起動文言：幅と長さの規則（FW 申し送りの例）', () => {
  it('半角 18 文字 = 125 px は収まり、19 文字 = 132 px は収まらない', () => {
    expect(bootTextWidth('SN:123456789012345')).toBe(125);
    expect(bootTextWidth('SN:1234567890123456')).toBe(132);
    expect(validateBootText('SN:123456789012345', '25ja')).toEqual([]);
    expect(validateBootText('SN:1234567890123456', '25ja').join()).toMatch(/132 px/);
  });
  it('漢字 8 文字 = 103 px・24 バイトで収まり、9 文字は 27 バイトで止まる', () => {
    expect(bootTextWidth('漢字万歳消防署活')).toBe(103);
    expect(bootTextBytes('漢字万歳消防署活')).toBe(24);
    expect(validateBootText('漢字万歳消防署活', '25ja')).toEqual([]);
    expect(validateBootText('漢字万歳消防署活大', '25ja').join()).toMatch(/27 bytes/);
  });
  it('空は 0 px。入力の切り詰めは両方の上限で止まる', () => {
    expect(bootTextWidth('')).toBe(0);
    expect(truncateBootText('SN:1234567890123456789')).toBe('SN:123456789012345');
    expect(truncateBootText('漢字万歳消防署活大阪')).toBe('漢字万歳消防署活');
  });
  it('フォント外の字は止める', () => {
    expect(validateBootText('😀', '25ja').join()).toMatch(/not in the 25ja font/);
  });
  it('符号化・復号：UTF-8、余りは 0x00。先頭が 0x00/0xFF は空', () => {
    const b = encodeBootText('SN:1');
    expect(Array.from(b.subarray(0, 5))).toEqual([0x53, 0x4e, 0x3a, 0x31, 0x00]);
    expect(b.length).toBe(24);
    expect(decodeBootText(b)).toBe('SN:1');
    expect(decodeBootText(new Uint8Array(24).fill(0xff))).toBe('');
    expect(decodeBootText(new Uint8Array(24))).toBe('');
  });
  it('書込範囲：0x89A0〜0x89B7 だけ。フラグが無ければ書けない', () => {
    expect(() => assertWritable(0x89a0, 24, false, false, true)).not.toThrow();
    expect(() => assertWritable(0x89a0, 24)).toThrow();
    expect(() => assertWritable(0x89a0, 25, false, false, true)).toThrow();
    // 設定領域（0xA170）は、長い名前の領域を許さない限り書けない（長い名前の領域は別の像アドレス）
    expect(() => assertWritable(0xa170, 2, false, true, true)).toThrow();
  });
  it('空の文言は、すでに空なら触らない', () => {
    const img = new Uint8Array(0x9000).fill(0xff);
    applyBootText(img, '');
    expect(img[0x89a0]).toBe(0xff);
  });
});

describe('UVK1Protocol：起動文言の書込', () => {
  it('書込：0x89A0 に 24 バイト、読み戻して一致。0xA170/71 は書かない', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', '0.3', r.conn);
    p.setBootText('SN:123456789012345');
    await p.writeChannels(CH);
    expect(hex(r.get, 0x89a0, 6)).toBe('53 4e 3a 31 32 33');
    expect(r.get(0x89a0 + 18)).toBe(0x00);
    expect(r.writes.filter((w) => w.address >= 0xa000).length).toBe(0);
    await p.readChannels();
    expect(p.readBootText()).toBe('SN:123456789012345');
  });
  it('同じ文言の再書込は何も書かない／空で消去（0x00）', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', '0.3', r.conn);
    p.setBootText('テスト');
    await p.writeChannels(CH);
    const n = r.writes.length;
    await p.writeChannels(CH);
    expect(r.writes.length).toBe(n);
    p.setBootText('');
    await p.writeChannels(CH);
    expect(hex(r.get, 0x89a0, 24)).toBe('00 '.repeat(23) + '00');
    await p.readChannels();
    expect(p.readBootText()).toBe('');
  });
  it('Null なら触らない', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', '0.3', r.conn);
    p.setBootText(null);
    await p.writeChannels(CH);
    expect(r.writes.some((w) => w.address >= 0x89a0 && w.address < 0x89b8)).toBe(false);
  });
  it('長すぎる文言は何も書かずに止まる', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', '0.3', r.conn);
    p.setBootText('SN:1234567890123456');
    await expect(p.writeChannels(CH)).rejects.toThrow(/Nothing was written/);
    expect(r.writes.length).toBe(0);
  });
  it('版数を返さない旧 25Ja と dondji では、読まず・書かない', async () => {
    for (const [font, v] of [['25ja', null], ['dondji', '0.3']] as const) {
      const r = fakeRadio();
      const p = protocol(font, v, r.conn);
      expect(p.supportsBootText()).toBe(false);
      p.setBootText('テスト');
      await p.writeChannels(CH);
      expect(r.writes.some((w) => w.address >= 0x89a0 && w.address < 0x89b8)).toBe(false);
      await p.readChannels();
      expect(p.readBootText()).toBeNull();
    }
  });
});
