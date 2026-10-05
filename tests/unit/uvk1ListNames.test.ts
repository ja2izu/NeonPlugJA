/*
 * NeonPlugJA Ver.0.91 — UV-K1 (25Ja) scan list names (SPI 0x8880, 12 bytes x 24, UTF-8)
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import {
  applyListNames, assertWritable, encodeListName, planListNameWrites, validateListNames, WRITABLE_RANGES,
} from '../../src/radios/uvk1/writePlan';
import { listNamesFromScanLists, mergeRadioListNames } from '../../src/radios/uvk1/scanListNames';
import { checkScanListLimits } from '../../src/services/csv/importLimits';
import { UVK1_CAPS } from '../../src/radios/uvk1/capabilities';
import { UVK1_IMAGE_SIZE } from '../../src/radios/uvk1/protocol';
import { decodeChannelName } from '../../src/radios/uvk1/structures';
import type { ScanList } from '../../src/models/ScanList';

const img = () => new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
const list = (name: string, slot?: number): ScanList => ({ name, channels: [], ctcScanMode: 0, scanTxMode: 0, slot });
const at = (i: number) => 0x8880 + i * 12;

describe('UV-K1 リスト名', () => {
  it('encode: 12 バイト、0x00 埋め、UTF-8', () => {
    const b = encodeListName('山岳');
    expect(b.length).toBe(12);
    expect([...b.subarray(0, 6)]).toEqual([0xe5, 0xb1, 0xb1, 0xe5, 0xb2, 0xb3]);
    expect([...b.subarray(6)].every((x) => x === 0)).toBe(true);
  });
  it('validate: 4 漢字 OK / 5 漢字は 15 バイトで NG / ASCII 12 OK', () => {
    expect(validateListNames(['山岳移動'], '25ja')).toEqual([]);
    expect(validateListNames(['山岳移動運用'], '25ja')[0]).toContain('18 bytes');
    expect(validateListNames(['ABCDEFGHIJKL'], '25ja')).toEqual([]);
    expect(validateListNames(['ABCDEFGHIJKLM'], '25ja')).toHaveLength(1);
    expect(validateListNames([undefined], '25ja')).toEqual([]);
  });
  it('apply: undefined は触らない / 書いた名前は読み戻せる', () => {
    const im = img();
    applyListNames(im, [undefined, '山岳']);
    expect(im[at(0)]).toBe(0xff);
    expect(decodeChannelName(im.subarray(at(1), at(1) + 12), 12)).toBe('山岳');
  });
  it('apply: 空名は既存エントリが空のとき触らない', () => {
    const im = img();
    applyListNames(im, ['']);
    expect(im[at(0)]).toBe(0xff);
  });
  it('plan: 差分のみ、隣接はまとめ、120 バイト以内', () => {
    const cur = img();
    const tgt = img();
    applyListNames(tgt, ['A', 'B', undefined, 'D']);
    const w = planListNameWrites(cur, tgt);
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) {
      expect(x.data.length).toBeLessThanOrEqual(120);
      expect(() => assertWritable(x.address, x.data.length, false, true)).not.toThrow();
    }
    const again = planListNameWrites(tgt, tgt);
    expect(again).toEqual([]);
  });
  it('writable: 既存の許可範囲は変わらず、listNames 指定時のみ 0x8880-0x899F', () => {
    expect(() => assertWritable(0x8880, 12)).toThrow();
    expect(() => assertWritable(0x8880, 288, false, true)).not.toThrow();
    expect(() => assertWritable(0x899f, 2, false, true)).toThrow();
    expect(() => assertWritable(0x886e, 2, false, true)).toThrow();
    expect(WRITABLE_RANGES.length).toBeGreaterThan(0);
  });
  it('names ⇄ lists: slot 優先、範囲外無視、マージは radio 優先', () => {
    const names = listNamesFromScanLists([list('A', 3), list('B'), list('Z', 24)]);
    expect(names[3]).toBe('A');
    expect(names[1]).toBe('B');
    expect(names).toHaveLength(24);
    const merged = mergeRadioListNames([list('旧', 0), list('保', 5)], ['新', undefined, '追']);
    expect(merged.map((l) => [l.slot, l.name])).toEqual([[0, '新'], [2, '追'], [5, '保']]);
  });
  it('caps と CSV 取込: 12 バイト超は切り詰め', () => {
    expect(UVK1_CAPS.maxScanListNameLength).toBe(12);
    expect(UVK1_CAPS.scanListNameUtf8Bytes).toBe(true);
    const r = checkScanListLimits([list('山岳移動運用', 0)], UVK1_CAPS);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.trimmed[0].name).toBe('山岳移動');
  });
});
