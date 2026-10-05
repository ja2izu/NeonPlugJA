/*
 * NeonPlugJA Ver.0.91 — UV-K1 scan list names through UVK1Protocol with a fake radio memory
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import { UVK1Protocol } from '../../src/radios/uvk1/protocol';
import { createDefaultChannel } from '../../src/utils/channelHelpers';

const CH = [createDefaultChannel({ number: 1, name: 'A', rxFrequency: 145.0, txFrequency: 145.0 })];

/** Fake SPI flash: 64 KiB of 0xFF (+ ext area at 0x020000), records every write. */
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
function protocol(font: '25ja' | 'dondji', conn: unknown) {
  const p = new UVK1Protocol();
  const any = p as unknown as Record<string, unknown>;
  any.conn = conn; any.font = font; any.longNames = font === '25ja';
  return p;
}

describe('UVK1Protocol: スキャンリスト漢字名', () => {
  it('書込: 0x8880 + slot×12 に UTF-8、残りは 0x00、読み戻して一致', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', r.conn);
    const names: (string | undefined)[] = new Array(24).fill(undefined);
    names[0] = '消防署活'; names[1] = '大阪'; names[2] = '関西';
    p.setScanListNames(names);
    await p.writeChannels(CH);
    const hex = (a: number, n: number) => Array.from({ length: n }, (_, i) => r.get(a + i).toString(16).padStart(2, '0')).join(' ');
    expect(hex(0x8880, 12)).toBe('e6 b6 88 e9 98 b2 e7 bd b2 e6 b4 bb');
    expect(hex(0x888c, 6)).toBe('e5 a4 a7 e9 98 aa');
    expect(r.get(0x8892)).toBe(0x00);
    expect(hex(0x8898, 6)).toBe('e9 96 a2 e8 a5 bf');
    // 名前の書込は 0x8880〜0x899F の中だけ
    const nameWrites = r.writes.filter((w) => w.address >= 0x8880 && w.address < 0x9000);
    expect(nameWrites.length).toBeGreaterThan(0);
    expect(nameWrites.every((w) => w.address + w.data.length <= 0x89a0)).toBe(true);
    // 読み戻し
    await p.readChannels();
    expect(p.readScanListNames().slice(0, 4)).toEqual(['消防署活', '大阪', '関西', undefined]);
  });
  it('同じ内容の再書込は何も書かない', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', r.conn);
    const names: (string | undefined)[] = new Array(24).fill(undefined);
    names[0] = '防災';
    p.setScanListNames(names);
    await p.writeChannels(CH);
    const n = r.writes.length;
    await p.writeChannels(CH);
    expect(r.writes.length).toBe(n);
  });
  it('名前が長すぎる／フォント外は何も書かずに止まる', async () => {
    const r = fakeRadio();
    const p = protocol('25ja', r.conn);
    const names: (string | undefined)[] = new Array(24).fill(undefined);
    names[0] = '山岳移動運用';
    p.setScanListNames(names);
    await expect(p.writeChannels(CH)).rejects.toThrow(/Nothing was written/);
    expect(r.writes.length).toBe(0);
  });
  it('dondji フォントでは名前領域に触らない', async () => {
    const r = fakeRadio();
    const p = protocol('dondji', r.conn);
    expect(p.supportsScanListNames()).toBe(false);
    p.setScanListNames(['防災']);
    await p.writeChannels(CH);
    expect(r.writes.some((w) => w.address >= 0x8880 && w.address < 0x9000)).toBe(false);
  });
});
