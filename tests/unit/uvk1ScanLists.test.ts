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

import { exportScanListsToCSV, importScanListsFromCSV } from '../../src/services/csv';
import { checkScanListLimits } from '../../src/services/csv/importLimits';

describe('UV-K1 スキャンリストの CSV', () => {
  const list = (name: string, slot?: number): ScanList => ({ name, slot, channels: [], ctcScanMode: 0, scanTxMode: 0 });
  const ch = (number: number, scanListId: number): Channel =>
    ({ number, name: `CH${number}`, rxFrequency: 145.5, txFrequency: 145.5, mode: 'Analog', scanListId } as Channel);

  it('書出し：番号（1〜24）、名前、使っているチャンネル（ALL を含む）', () => {
    const csv = exportScanListsToCSV([list('別名１', 0), list('別名前', 1)], { channels: [ch(3, 2), ch(1, 1), ch(7, 25), ch(9, 0)], allValue: 25 });
    expect(csv.split('\n')).toEqual([
      'Number,Name,Channels',
      '"1","別名１","1;7"',
      '"2","別名前","3;7"',
    ]);
  });

  it('書出し→読込で、番号と名前がそのまま戻る（飛び番、名前に引用符）', () => {
    const lists = [list('別名１', 0), list('"引用"です', 4), list('枠24', 23)];
    const csv = exportScanListsToCSV(lists, { channels: [], allValue: 25 });
    const r = importScanListsFromCSV(csv);
    expect(r.errors).toBeUndefined();
    expect(r.scanLists!.map((l) => [l.name, l.slot])).toEqual([['別名１', 0], ['"引用"です', 4], ['枠24', 23]]);
  });

  it('番号が 0 以下・小数・重複なら、その行を名指しで外す', () => {
    const r = importScanListsFromCSV('Number,Name\n0,A\n1.5,B\n2,C\n2,D');
    expect(r.success).toBe(false);
    expect(r.scanLists!.map((l) => l.name)).toEqual(['C']);
    expect(r.errors!.join('\n')).toMatch(/Row 2: Number "0"/);
    expect(r.errors!.join('\n')).toMatch(/Row 3: Number "1.5"/);
    expect(r.errors!.join('\n')).toMatch(/Row 5: Slot 1 appears more than once/);
  });

  it('従来の Slot 列のファイルも読める', () => {
    expect(importScanListsFromCSV('Name,Channels,Slot\nA,1;2,3').scanLists![0].slot).toBe(3);
  });

  it('25 番以降は UV-K1 に無いので外して知らせる', () => {
    const r = checkScanListLimits([list('A', 0), list('B', 24)], UVK1_CAPS);
    expect(r.trimmed.map((l) => l.name)).toEqual(['A']);
    expect(r.issues.join('\n')).toMatch(/number 25 is beyond the 24/);
  });

  it('DM-32 向けの書出しは従来の見出しのまま', () => {
    expect(exportScanListsToCSV([list('A')]).split('\n')[0]).toBe('Name,Channels,CTC Scan Mode,Scan TX Mode,Hang Time,Priority 1 Type,Priority 2 Type,Priority Channel 1,Priority Channel 2,Designated TX Channel,Slot');
  });
});

import { decodeUvk1Power, applyUvk1Power } from '../../src/radios/uvk1/structures';
import { powerLevelsFor, powerAbbrev, clampPowerLevel } from '../../src/utils/powerLevels';

describe('UV-K1 送信電力（Low1〜Low5・Medium・High）', () => {
  const rec = (bits: number) => { const r = new Uint8Array(16); r[12] = 0b1010_0011 | (bits << 2); return r; };
  it('能力：7 段、TG の列なし、除外を編集できる', () => {
    expect(UVK1_CAPS.powerLevels).toEqual(['Low1', 'Low2', 'Low3', 'Low4', 'Low5', 'Medium', 'High']);
    expect(UVK1_CAPS.noTxContactColumn).toBe(true);
    expect(UVK1_CAPS.scanExcludeEditable).toBe(true);
    expect(powerLevelsFor(UVK1_CAPS)).toHaveLength(7);
    expect(powerAbbrev('Low3')).toBe('L3');
  });
  it('読込：1〜5 は Low1〜Low5、6 は Medium、7 は High、0 は Low1', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 0].map((b) => decodeUvk1Power(rec(b)))).toEqual(['Low1', 'Low2', 'Low3', 'Low4', 'Low5', 'Medium', 'High', 'Low1']);
  });
  it('書込：Low1〜Low5 は電力ビットだけを変え、他のビットは保つ', () => {
    const r = rec(7);
    applyUvk1Power(r, 'Low4');
    expect(r[12]).toBe(0b1010_0011 | (4 << 2));
    applyUvk1Power(r, 'High'); // High / Medium は共通の書き手が決める：ここでは触らない
    expect(r[12]).toBe(0b1010_0011 | (4 << 2));
  });
  it('他機種へ移すと、Low1〜Low5 は Low に下げる（上げない）', () => {
    expect(clampPowerLevel('Low3', ['Low', 'Medium', 'High'])).toBe('Low');
    expect(clampPowerLevel('Low', UVK1_CAPS.powerLevels!)).toBe('Low1');
    expect(clampPowerLevel('Turbo', UVK1_CAPS.powerLevels!)).toBe('High');
  });
  it('書込の往復：Low3 の CH は読み戻しても Low3、Medium は Medium', () => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    [3, 6].forEach((bits, slot) => {
      const r = record(145_000_000 + slot * 12_500); r[12] = bits << 2;
      img.set(r, UVK1_ADDR.CHANNELS + slot * 16);
      img.set(name16('X'), UVK1_ADDR.CHANNEL_NAMES + slot * 16);
      img[UVK1_ADDR.CHANNEL_ATTR + slot * 2] = 0x02; img[UVK1_ADDR.CHANNEL_ATTR + slot * 2 + 1] = 0;
    });
    const chs = channelsFromImage(img);
    expect(chs.map((c) => c.power)).toEqual(['Low3', 'Medium']);
    const changed = chs.map((c) => (c.number === 2 ? { ...c, power: 'Low5' as const } : c));
    const t = buildTarget(img, changed);
    expect((t.image[UVK1_ADDR.CHANNELS + 16 + 12] >> 2) & 7).toBe(5);
    expect((t.image[UVK1_ADDR.CHANNELS + 12] >> 2) & 7).toBe(3);
  });
});
