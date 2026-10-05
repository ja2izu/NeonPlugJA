/*
 * NeonPlugJA Ver.0.91 — UV-K1 (25Ja) scan lists: list number on the channel, names in the app only
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import { parseChannel } from '../../src/radios/uvk1/structures';
import { channelsFromImage, UVK1_IMAGE_SIZE } from '../../src/radios/uvk1/protocol';
import { buildTarget, planWrites, encodeChannelName } from '../../src/radios/uvk1/writePlan';
import { UVK1_ADDR } from '../../src/radios/uvk1/constants';
import { UVK1_CAPS } from '../../src/radios/uvk1/capabilities';
import { migrateCodeplug } from '../../src/services/codeplugMigration';
import { scanListByReference, scanListReference } from '../../src/utils/scanListReference';
import type { CodeplugData } from '../../src/services/codeplugExport';
import type { Channel } from '../../src/models/Channel';
import type { ScanList } from '../../src/models/ScanList';

function record(hz: number): Uint8Array {
  const r = new Uint8Array(16);
  const v = Math.round(hz / 10);
  r[0] = v & 0xff; r[1] = (v >>> 8) & 0xff; r[2] = (v >>> 16) & 0xff; r[3] = (v >>> 24) & 0xff;
  r[14] = 4;
  return r;
}
const name16 = (s: string) => encodeChannelName(s);

describe('UV-K1 読込：リスト番号と除外', () => {
  const parse = (lo: number, hi: number) =>
    parseChannel({ number: 1, record: record(145_000_000), attrLo: lo, attrHi: hi, nameField: name16('') })!;
  it('番号 0 = なし', () => {
    const ch = parse(0x02, 0);
    expect([ch.scanListId, ch.scanAdd, ch.scanExcluded]).toEqual([0, false, false]);
  });
  it('番号 1〜24 と 25（ALL）', () => {
    expect([parse(0x02, 1).scanListId, parse(0x02, 24).scanListId, parse(0x02, 25).scanListId]).toEqual([1, 24, 25]);
    expect(parse(0x02, 25).scanAdd).toBe(true);
  });
  it('除外ビット：番号ありのときだけ「除外中」、スキャンは OFF', () => {
    const ch = parse(0x82, 7);
    expect([ch.scanListId, ch.scanAdd, ch.scanExcluded]).toEqual([7, false, true]);
    expect(parse(0x82, 0).scanExcluded).toBe(false);
  });
});

describe('UV-K1 読込→そのまま書込で属性が変わらない', () => {
  const imageWith = (attrs: Array<[number, number]>) => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    attrs.forEach(([lo, hi], slot) => {
      img.set(record(145_000_000 + slot * 12_500), UVK1_ADDR.CHANNELS + slot * 16);
      img.set(name16(`CH${slot + 1}`), UVK1_ADDR.CHANNEL_NAMES + slot * 16);
      img[UVK1_ADDR.CHANNEL_ATTR + slot * 2] = lo;
      img[UVK1_ADDR.CHANNEL_ATTR + slot * 2 + 1] = hi;
    });
    return img;
  };
  it('なし・1・24・ALL・除外中・除外中の ALL が全部そのまま戻る', () => {
    const img = imageWith([[0x02, 0], [0x02, 1], [0x02, 24], [0x02, 25], [0x82, 7], [0x82, 25]]);
    const channels = channelsFromImage(img);
    expect(channels).toHaveLength(6);
    const t = buildTarget(img, channels);
    expect(planWrites(img, t.image, t.touched)).toEqual([]);
  });
  it('番号を変えると、その CH の属性 2 バイトだけが書込になる', () => {
    const img = imageWith([[0x02, 1], [0x02, 2]]);
    const channels = channelsFromImage(img).map((c) => (c.number === 2 ? { ...c, scanListId: 25, scanAdd: true } : c));
    const t = buildTarget(img, channels);
    const w = planWrites(img, t.image, t.touched);
    expect(w).toHaveLength(1);
    expect(w[0].address).toBe(UVK1_ADDR.CHANNEL_ATTR + 2);
    expect(Array.from(w[0].data)).toEqual([0x02, 25]);
  });
});

describe('UV-K1 能力フラグ', () => {
  it('24 枠・ALL = 25・名前はアプリ側のみ・リスト設定欄なし', () => {
    expect(UVK1_CAPS.supportsScanLists).toBe(true);
    expect(UVK1_CAPS.maxScanLists).toBe(24);
    expect(UVK1_CAPS.scanListsBySlot).toBe(true);
    expect(UVK1_CAPS.scanListAllValue).toBe(25);
    expect(UVK1_CAPS.scanListNamesAppSideOnly).toBe(true);
    expect(UVK1_CAPS.scanListFields).toEqual([]);
  });
  it('枠番号で名前を引く（飛び番でもずれない）', () => {
    const lists: ScanList[] = [
      { name: '別名１', slot: 0, channels: [], ctcScanMode: 0, scanTxMode: 0 },
      { name: '別名前', slot: 4, channels: [], ctcScanMode: 0, scanTxMode: 0 },
    ];
    expect(scanListReference(lists[1], 1, true)).toBe(5);
    expect(scanListByReference(lists, 5, true)?.name).toBe('別名前');
    expect(scanListByReference(lists, 2, true)).toBeUndefined();
  });
});

describe('UV-K1 への変換（codeplugMigration）', () => {
  const ch = (number: number, scanListId: number): Channel =>
    ({ number, name: `CH${number}`, rxFrequency: 145.5, txFrequency: 145.5, mode: 'Analog', scanListId } as Channel);
  const cp = (scanLists: ScanList[], channels: Channel[]): CodeplugData => ({
    channels, zones: [], scanLists, contacts: [],
    digitalEmergencies: [], digitalEmergencyConfig: null, analogEmergencies: [],
    radioSettings: null,
    radioInfo: { model: 'UV-K1', firmware: 'x' } as CodeplugData['radioInfo'],
    messages: [], radioIds: [], quickContacts: [], rxGroups: [], encryptionKeys: [],
    exportDate: '2026-10-05T00:00:00.000Z', version: '1.1.0',
  });
  const list = (name: string, slot?: number): ScanList => ({ name, slot, channels: [], ctcScanMode: 0, scanTxMode: 0 });

  it('メンバーのない（名前だけの）リストを捨てない、枠も保つ', () => {
    const { migrated } = migrateCodeplug(cp([list('別名１', 0), list('別名前', 4)], [ch(1, 5)]), 'UV-K1');
    expect(migrated.scanLists.map((l) => [l.name, l.slot])).toEqual([['別名１', 0], ['別名前', 4]]);
    expect(migrated.channels[0].scanListId).toBe(5);
  });
  it('チャンネルの番号は 0〜24 と 25（ALL）を残し、それ以外は 0 にして数える', () => {
    const { migrated, loss } = migrateCodeplug(cp([], [ch(1, 24), ch(2, 25), ch(3, 26), ch(4, 40)]), 'UV-K1');
    expect(migrated.channels.map((c) => c.scanListId)).toEqual([24, 25, 0, 0]);
    expect(loss.scanListRefsCleared).toBe(2);
  });
  it('他機種から来たリストは並び順を枠にする（DM-32 の位置参照と同じ番号）', () => {
    const src = cp([list('甲'), list('乙')], [ch(1, 2)]);
    src.radioInfo = { model: 'DM-32UV', firmware: 'x' } as CodeplugData['radioInfo'];
    const { migrated } = migrateCodeplug(src, 'UV-K1');
    expect(migrated.scanLists.map((l) => l.slot)).toEqual([0, 1]);
  });
});
