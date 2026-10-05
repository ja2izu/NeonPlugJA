/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Channel } from '../../src/models';
import { createDefaultChannel } from '../../src/utils/channelHelpers';
import { buildFrame, scramble } from '../../src/radios/uvk5/framing';
import { spiWritePayload, spiWriteAccepted } from '../../src/radios/uvk1/framing';
import {
  assertWritable, bandForFrequency, buildTarget, encodeAttribute, encodeChannelName,
  planWrites, unsupportedCharacters, validateChannels, WRITABLE_RANGES,
} from '../../src/radios/uvk1/writePlan';
import { UVK1Protocol, UVK1_IMAGE_SIZE, channelsFromImage } from '../../src/radios/uvk1/protocol';
import { decodeChannelName } from '../../src/radios/uvk1/structures';
import { UVK1_ADDR, UVK1_FONT_BASE, UVK1_FONT_PROFILES } from '../../src/radios/uvk1/constants';
import { FONT_25JA_COUNT, FONT_25JA_CHARS } from '../../src/radios/uvk1/font25ja';

const ch = (number: number, name: string, mhz: number, extra: Partial<Channel> = {}): Channel => ({
  ...createDefaultChannel({ number, name, rxFrequency: mhz, txFrequency: mhz }),
  ...extra,
});

function putSlot(image: Uint8Array, slot: number, mhz: number, name: string, attr: number) {
  const r = new Uint8Array(16);
  const v = Math.round((mhz * 1e6) / 10);
  r[0] = v & 0xff; r[1] = (v >>> 8) & 0xff; r[2] = (v >>> 16) & 0xff; r[3] = (v >>> 24) & 0xff;
  r[14] = 4; // step 12.5 kHz — must survive a write
  image.set(r, UVK1_ADDR.CHANNELS + slot * 16);
  image.set(encodeChannelName(name), UVK1_ADDR.CHANNEL_NAMES + slot * 16);
  image[UVK1_ADDR.CHANNEL_ATTR + slot * 2] = attr & 0xff;
  image[UVK1_ADDR.CHANNEL_ATTR + slot * 2 + 1] = attr >> 8;
}

describe('UV-K1 書込コマンド（0x0521）', () => {
  it('Dondji の CMD_0521_t と同じ並び', () => {
    const p = spiWritePayload(0x4010, Uint8Array.of(0xaa, 0xbb));
    expect(Array.from(p.subarray(0, 12))).toEqual([0x21, 0x05, 14, 0, 0x10, 0x40, 0, 0, 2, 0, 0, 0]);
    expect(Array.from(p.subarray(16))).toEqual([0xaa, 0xbb]);
  });
  it('応答の番地を確かめる', () => {
    const r = Uint8Array.of(0x22, 0x05, 8, 0, 0x10, 0x40, 0, 0, 0, 0, 0, 0);
    expect(spiWriteAccepted(r, 0x4010)).toBe(true);
    expect(spiWriteAccepted(r, 0x4020)).toBe(false);
  });
});

describe('UV-K1 書込できる範囲', () => {
  it('CH の周波数・名前・属性だけ', () => {
    expect(WRITABLE_RANGES).toEqual([[0x0000, 0x4000], [0x4000, 0x8000], [0x8000, 0x8800]]);
    expect(() => assertWritable(0x3ff0, 16)).not.toThrow();
    expect(() => assertWritable(0x87fe, 2)).not.toThrow();
  });
  it('リスト名・VFO・設定・較正・字庫・範囲またぎは拒否', () => {
    for (const [a, n] of [[0x880e, 4], [0x8800, 2], [0x9000, 16], [0xa000, 8], [0xb000, 8], [0x10000, 8], [0x24000, 1], [0x3ff8, 16], [0x7ff8, 16]]) {
      expect(() => assertWritable(a, n)).toThrow(/refusing/);
    }
  });
});

describe('UV-K1 帯（属性の band）', () => {
  it('frequencyBandTable の下端で切り替わる', () => {
    expect([18, 50, 107.99, 108, 136.99, 137, 145, 174, 350, 400, 433, 470, 1300].map(bandForFrequency))
      .toEqual([0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 5, 6, 6]);
  });
});

describe('UV-K1 名前の検査', () => {
  it('25ja 字庫は 6647 字', () => {
    expect(FONT_25JA_COUNT).toBe(6647);
    expect(FONT_25JA_CHARS.size).toBe(6647);
  });
  it('字庫に無い字を挙げる', () => {
    expect(unsupportedCharacters('名古屋〜', '25ja')).toEqual([]);
    expect(unsupportedCharacters('A～B※', '25ja')).toEqual(['～', '※']);
    expect(unsupportedCharacters('名古屋', 'dondji')).toEqual(['名', '古', '屋']);
    expect(unsupportedCharacters('HOME 1', 'unknown')).toEqual([]);
  });
  it('一覧でまとめて返す（長さ・字・番号・周波数・空リスト）', () => {
    const p = validateChannels([
      ch(1, '六文字の名前', 145),
      ch(2, '波～', 145),
      ch(2, 'X', 145),
      ch(1025, 'X', 145),
      ch(3, 'X', 10),
    ], '25ja');
    expect(p.join('\n')).toMatch(/CH 1 .*18 bytes/);
    expect(p.join('\n')).toMatch(/CH 2 .*not in the 25ja font: ～/);
    expect(p.join('\n')).toMatch(/CH 2 .*used twice/);
    expect(p.join('\n')).toMatch(/CH 1025 .*1-1024/);
    expect(p.join('\n')).toMatch(/CH 3 .*RX 10 MHz/);
    expect(validateChannels([], '25ja')[0]).toMatch(/delete every channel/);
    // 半角カナは字庫に無く、しかも 18 バイトになる：2 件
    expect(validateChannels([ch(1, '名古屋ﾚﾋﾟ', 145)], '25ja').length).toBe(2);
    expect(validateChannels([ch(1, 'ABCDEFGHIJKLMNO', 145), ch(2, '五文字名前', 433)], '25ja')).toEqual([]);
  });
  it('名前欄は UTF-8 と 0 埋め', () => {
    const f = encodeChannelName('あA');
    expect(Array.from(f)).toEqual([0xe3, 0x81, 0x82, 0x41, ...new Array(12).fill(0)]);
    expect(decodeChannelName(f)).toBe('あA');
  });
});

describe('UV-K1 属性の組み立て', () => {
  const raw = (band: number, scan: number, exclude = false, comp = 0) => band | (comp << 3) | (exclude ? 0x80 : 0) | (scan << 8);
  it('新しい CH：スキャン有りはリスト 1', () => {
    expect(encodeAttribute(ch(1, '', 145, { scanAdd: true }), null)).toBe(raw(2, 1));
    expect(encodeAttribute(ch(1, '', 433, { scanAdd: false }), null)).toBe(raw(5, 0));
  });
  it('既存の CH：リスト番号とコンパンダを保つ', () => {
    expect(encodeAttribute(ch(1, '', 145, { scanAdd: true }), raw(2, 7, false, 2))).toBe(raw(2, 7, false, 2));
    expect(encodeAttribute(ch(1, '', 145, { scanAdd: false }), raw(2, 7, false, 2))).toBe(raw(2, 0, false, 2));
    expect(encodeAttribute(ch(1, '', 145, { scanAdd: true }), raw(2, 7, true))).toBe(raw(2, 7, false));
    expect(encodeAttribute(ch(1, '', 433, { scanAdd: true }), raw(2, 25))).toBe(raw(5, 25));
  });
  it('リスト番号（scanListId）を書く：0 なし、1-24、25 ALL', () => {
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 5, scanAdd: true }), raw(2, 7))).toBe(raw(2, 5));
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 24, scanAdd: true }), null)).toBe(raw(2, 24));
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 25, scanAdd: true }), raw(2, 3))).toBe(raw(2, 25));
    // 「なし」＝ 0、元がリスト 7 でも 0 にする（スキャン OFF）
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 0, scanAdd: false }), raw(2, 7, false, 2))).toBe(raw(2, 0, false, 2));
    // なし を選んだ後は、元が除外中でも 0・除外なし
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 0, scanAdd: false, scanExcluded: false }), raw(2, 7, true))).toBe(raw(2, 0, false));
  });
  it('除外ビット：読み込んだ scanExcluded をそのまま書き戻す（アプリでは変えない）', () => {
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 7, scanAdd: false, scanExcluded: true }), raw(2, 7, true))).toBe(raw(2, 7, true));
    // 別のリストへ変えても除外は保つ
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 9, scanAdd: false, scanExcluded: true }), raw(2, 7, true))).toBe(raw(2, 9, true));
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 7, scanExcluded: false }), raw(2, 7, true))).toBe(raw(2, 7, false));
    // 番号が 0 の CH に除外ビットは付けない
    expect(encodeAttribute(ch(1, '', 145, { scanListId: 0, scanAdd: false, scanExcluded: true }), raw(2, 7, true))).toBe(raw(2, 0, false));
  });
  it('範囲外のリスト番号は検査で止める（26 以上、負、小数）', () => {
    expect(validateChannels([ch(1, 'A', 145, { scanListId: 26 })], '25ja').join('\n')).toMatch(/scan list 26/);
    expect(validateChannels([ch(1, 'A', 145, { scanListId: -1 })], '25ja')).not.toEqual([]);
    expect(validateChannels([ch(1, 'A', 145, { scanListId: 1.5 })], '25ja')).not.toEqual([]);
    expect(validateChannels([ch(1, 'A', 145, { scanListId: 25 })], '25ja')).toEqual([]);
  });
});

describe('UV-K1 書込の計画', () => {
  const base = () => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(img, 0, 145, 'A', 2 | (1 << 8));
    putSlot(img, 1, 145.5, 'B', 2);
    putSlot(img, 2, 433, 'C', 5);
    return img;
  };
  // 無線機から読んだ一覧（読んだものをそのまま書けば差分は無いはず）
  const listOf = () => channelsFromImage(base());

  it('変更なしなら何も書かない', () => {
    const cur = base();
    const t = buildTarget(cur, listOf());
    expect(planWrites(cur, t.image, t.touched)).toEqual([]);
  });

  it('名前だけ変えたら名前の 16 バイトだけ', () => {
    const cur = base();
    const list = listOf(); list[1] = { ...list[1], name: '名古屋' };
    const t = buildTarget(cur, list);
    const w = planWrites(cur, t.image, t.touched);
    expect(w.map((x) => [x.address, x.data.length])).toEqual([[0x4010, 16]]);
  });

  it('削除は属性だけ 0x0007（周波数と名前はそのまま）', () => {
    const cur = base();
    const t = buildTarget(cur, listOf().filter((c) => c.number !== 2));
    const w = planWrites(cur, t.image, t.touched);
    expect(w.map((x) => [x.address, Array.from(x.data)])).toEqual([[0x8002, [0x07, 0x00]]]);
  });

  it('隣り合う CH はまとめ、120 バイトと 4KB 境界で切る', () => {
    const cur = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const list: Channel[] = [];
    for (let n = 250; n <= 262; n++) list.push(ch(n, `N${n}`, 145));
    const t = buildTarget(cur, list);
    const w = planWrites(cur, t.image, t.touched);
    const rec = w.filter((x) => x.address < 0x4000).map((x) => [x.address, x.data.length]);
    // slots 249..261; sector boundary at slot 256 (0x1000)
    expect(rec).toEqual([[0x0f90, 112], [0x1000, 96]]);
    for (const x of w) {
      expect(x.data.length).toBeLessThanOrEqual(120);
      expect(Math.floor(x.address / 0x1000)).toBe(Math.floor((x.address + x.data.length - 1) / 0x1000));
    }
  });

  it('使用中の CH は刻み（byte 14）などを保ち、空き枠の残骸は使わない', () => {
    const cur = base();
    const list = listOf(); list[0] = { ...list[0], name: 'Z' };
    const t = buildTarget(cur, list);
    expect(t.image[UVK1_ADDR.CHANNELS + 14]).toBe(4);
    putSlot(cur, 5, 146, 'OLD', 7); // deleted leftovers
    const t2 = buildTarget(cur, [...listOf(), ch(6, 'NEW', 146)]);
    expect(t2.image[UVK1_ADDR.CHANNELS + 5 * 16 + 14]).toBe(0);
  });
});

// ---- 疑似無線機での書込 ----

function fakeRadio(image: Uint8Array, opts: { dropEvery?: number; longNames?: boolean } = {}) {
  const writes: Array<[number, number]> = [];
  let seen = 0;
  let push: (b: Uint8Array) => void = () => {};
  const readable = new ReadableStream<Uint8Array>({ start(c) { push = (b) => c.enqueue(b); } });
  let pending = new Uint8Array(0);
  const reply = (p: Uint8Array) => push(buildFrame(p));
  const u32 = (p: Uint8Array, at: number) => (p[at] | (p[at + 1] << 8) | (p[at + 2] << 16) | (p[at + 3] << 24)) >>> 0;
  let hung = false;
  const handle = (p: Uint8Array) => {
    if (hung) return;
    const id = p[0] | (p[1] << 8);
    // 実機（2026-09-28）：コマンドがときどき黙って捨てられる（応答なし）。送り直せば通る
    if (id !== 0x0514 && opts.dropEvery && ++seen % opts.dropEvery === 0) return;
    if ((id === 0x051b && p[6] % 2 === 1) || (id === 0x051f && (p[8] | (p[9] << 8)) % 2 === 1)) {
      hung = true; // 実機と同じく、奇数長の読出応答で固まる
      return;
    }
    if (id === 0x0514) {
      const r = new Uint8Array(40); r.set([0x15, 0x05, 36, 0]); r.set(new TextEncoder().encode('F4HWN v5.2.8'), 4);
      if (opts.longNames) r.set([0x25, 0x4a, 0x01], 17); // 25Ja: Version[13..15]
      reply(r);
    } else if (id === 0x051b) {
      const off = p[4] | (p[5] << 8); const len = p[6];
      const r = new Uint8Array(8 + len); r.set([0x1c, 0x05, len + 4, 0, p[4], p[5], len, 0]); r.set(image.subarray(off, off + len), 8); reply(r);
    } else if (id === 0x051f) {
      const addr = u32(p, 4); const len = p[8] | (p[9] << 8);
      const r = new Uint8Array(12 + len); r.set([0x20, 0x05, len + 8, 0]); r.set(p.subarray(4, 10), 4);
      const ver = UVK1_FONT_BASE + UVK1_FONT_PROFILES[0].versionOffset;
      for (let i = 0; i < len; i++) {
        const at = spiToImage(addr + i);
        r[12 + i] = addr + i === ver ? 4 : at < image.length ? image[at] : 0xff;
      }
      reply(r);
    } else if (id === 0x0521) {
      const addr = u32(p, 4); const len = p[8] | (p[9] << 8);
      writes.push([addr, len]);
      image.set(p.subarray(16, 16 + len), spiToImage(addr));
      reply(Uint8Array.of(0x22, 0x05, 8, 0, p[4], p[5], p[6], p[7], 0, 0, 0, 0));
    }
  };
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const next = new Uint8Array(pending.length + chunk.length); next.set(pending); next.set(chunk, pending.length); pending = next;
      while (pending.length >= 4) {
        const len = pending[2] | (pending[3] << 8);
        if (pending.length < 8 + len) break;
        handle(scramble(pending.subarray(4, 4 + len + 2)).subarray(0, len));
        pending = pending.slice(8 + len);
      }
    },
  });
  return { port: { readable, writable, open: async () => {}, close: async () => {} }, writes };
}

/** SPI address -> fake radio image index (second name slots at 0x020000 live at 0x9000). */
const spiToImage = (a: number) => (a >= 0x20000 && a < 0x24000 ? 0x9000 + (a - 0x20000) : a);

const serial = vi.hoisted(() => ({ port: null as unknown }));
vi.mock('../../src/radios/shared/serialPort', () => ({ requestSerialPort: async () => serial.port }));

describe('UV-K1 書込（疑似無線機）', () => {
  it('漢字名・追加・削除を書き、読み直すと一致し、他の場所は変わらない', async () => {
    const radio = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(radio, 0, 145, 'CALL', 2 | (1 << 8));
    putSlot(radio, 1, 145.5, 'DEL', 2);
    putSlot(radio, 700, 433, 'KEEP', 5);
    radio.set(new TextEncoder().encode('LST1'), UVK1_ADDR.LIST_NAMES);
    const before = radio.slice();
    const f = fakeRadio(radio);
    serial.port = f.port;

    const p = new UVK1Protocol();
    await p.connect();
    const read = await p.readChannels();
    expect(read.map((c) => c.number)).toEqual([1, 2, 701]);

    const list = read.filter((c) => c.number !== 2).map((c) => (c.number === 1 ? { ...c, name: '呼出チャン' } : c));
    list.push(ch(1024, 'さいご', 439.5, { scanAdd: true }));
    await p.writeChannels(list);

    for (const [a, n] of f.writes) expect(() => assertWritable(a, n)).not.toThrow();
    // untouched: CH 701, list names, CH 2 record/name
    const same = (a: number, n: number) => expect(Array.from(radio.subarray(a, a + n))).toEqual(Array.from(before.subarray(a, a + n)));
    same(UVK1_ADDR.CHANNELS + 700 * 16, 16);
    same(UVK1_ADDR.CHANNEL_NAMES + 700 * 16, 16);
    same(UVK1_ADDR.CHANNEL_ATTR + 700 * 2, 2);
    same(UVK1_ADDR.LIST_NAMES, 96);
    same(UVK1_ADDR.CHANNELS + 16, 16);
    expect(radio[UVK1_ADDR.CHANNEL_ATTR + 2]).toBe(7);

    const again = await p.readChannels();
    expect(again.map((c) => [c.number, c.name, c.rxFrequency])).toEqual([
      [1, '呼出チャン', 145], [701, 'KEEP', 433], [1024, 'さいご', 439.5],
    ]);
    expect(again.find((c) => c.number === 1024)!.scanAdd).toBe(true);

    // a second identical write sends nothing
    const n = f.writes.length;
    await p.writeChannels(again);
    expect(f.writes.length).toBe(n);
    await p.disconnect();
  });

  it('検査に通らなければ 1 バイトも送らない', async () => {
    const radio = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(radio, 0, 145, 'A', 2);
    const f = fakeRadio(radio);
    serial.port = f.port;
    const p = new UVK1Protocol();
    await p.connect();
    await expect(p.writeChannels([ch(1, '六文字の名前', 145)])).rejects.toThrow(/Nothing was written[\s\S]*18 bytes/);
    await expect(p.writeChannels([])).rejects.toThrow(/delete every channel/);
    expect(f.writes).toEqual([]);
    await p.disconnect();
  });
});

describe('UV-K1 応答のないコマンドは送り直す', () => {
  it('7 回に 1 回コマンドが捨てられても、読込・書込・照合が通る', async () => {
    const radio = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    for (let s = 0; s < 40; s++) putSlot(radio, s, 145 + s * 0.0125, `CH${s}`, 2);
    const f = fakeRadio(radio, { dropEvery: 7 });
    serial.port = f.port;
    const p = new UVK1Protocol();
    await p.connect();
    const read = await p.readChannels();
    expect(read.length).toBe(40);
    const list = read.map((c) => ({ ...c, name: `局${c.number}` }));
    await p.writeChannels(list);
    const again = await p.readChannels();
    expect(again.map((c) => c.name)).toEqual(list.map((c) => c.name));
    await p.disconnect();
  }, 60000);
});

// ---- 25Ja の長い名前（31 バイト = 前半 16 B + 後半 0x020000） ----
import { slotsNeedingExt, extReadsForSlots } from '../../src/radios/uvk1/protocol';
import { imageToSpiAddress } from '../../src/radios/uvk1/writePlan';

describe('UV-K1 長い名前（25Ja）', () => {
  const k10 = '名古屋駅前レピータ北'; // 10 字 = 30 バイト

  it('名前欄 32 バイトから最大 31 バイトを読む（途中で切れた字は捨てる）', () => {
    const f = encodeChannelName(k10, 31);
    expect(f.length).toBe(32);
    expect(decodeChannelName(f, 31)).toBe(k10);
    const eleven = encodeChannelName(k10 + 'あ', 31); // 33 B -> 31 B（11 字目の途中）
    expect(decodeChannelName(eleven, 31)).toBe(k10);
    expect(decodeChannelName(encodeChannelName('ABCDEFGHIJKLMNOPQRSTUVWXYZ01234', 31), 31)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
  });

  it('後半の置き場所（画像 0x9000〜 ⇔ SPI 0x020000〜）', () => {
    expect(imageToSpiAddress(0x9000)).toBe(0x20000);
    expect(imageToSpiAddress(0x9000 + 1023 * 16)).toBe(0x20000 + 1023 * 16);
    expect(imageToSpiAddress(0x4010)).toBe(0x4010);
    expect(() => assertWritable(0x9000, 16)).toThrow(/refusing/);
    expect(() => assertWritable(0x9000, 16, true)).not.toThrow();
    expect(() => assertWritable(0xd000, 16, true)).toThrow(/refusing/);
  });

  it('上限は無線機ごと：目印なし 15 B、目印あり 31 B', () => {
    expect(validateChannels([ch(1, '六文字の名前', 145)], '25ja', 15).length).toBe(1);
    expect(validateChannels([ch(1, k10, 145)], '25ja', 31)).toEqual([]);
    expect(validateChannels([ch(1, k10 + 'あ', 145)], '25ja', 31)[0]).toMatch(/33 bytes, the radio holds 31 \(10 kanji/);
  });

  it('16 B 以上のときだけ後半を書く、15 B 以下なら後半は触らない', () => {
    const cur = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(cur, 0, 145, 'A', 2);
    putSlot(cur, 1, 146, 'B', 2);
    const list = channelsFromImage(cur, true);
    list[0] = { ...list[0], name: k10 };
    list[1] = { ...list[1], name: 'みじかい' }; // 12 B
    const t = buildTarget(cur, list, true);
    const w = planWrites(cur, t.image, t.touched, true).map((x) => [imageToSpiAddress(x.address), x.data.length]);
    // 隣り合う 2 CH の名前は 1 回（32 B）にまとめる。後半は CH 1 の分だけ
    expect(w).toEqual([[0x4000, 32], [0x20000, 16]]);
  });

  it('後半を読むのは前半が埋まっている CH だけ（4 CH = 64 B ずつ）', () => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    img.set(encodeChannelName(k10, 31).subarray(0, 16), UVK1_ADDR.CHANNEL_NAMES + 5 * 16);
    img.set(encodeChannelName('SHORT'), UVK1_ADDR.CHANNEL_NAMES + 6 * 16);
    img.set(encodeChannelName('0123456789ABCDEF', 31).subarray(0, 16), UVK1_ADDR.CHANNEL_NAMES + 9 * 16);
    expect(slotsNeedingExt(img, [5, 6, 9])).toEqual([5, 9]);
    expect(extReadsForSlots([5, 9, 10])).toEqual([4, 8]);
  });

  it('疑似 25Ja：10 字の名前を書いて読み直すと一致、後半は 0x020000 に書かれる', async () => {
    const radio = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    for (let s = 0; s < 6; s++) putSlot(radio, s, 145 + s * 0.025, `C${s}`, 2);
    const f = fakeRadio(radio, { longNames: true });
    serial.port = f.port;
    const p = new UVK1Protocol();
    await p.connect();
    expect(p.maxNameBytes()).toBe(31);
    const read = await p.readChannels();
    const list = read.map((c, i) => ({ ...c, name: i % 2 === 0 ? k10 : `短${i}` }));
    await p.writeChannels(list);
    expect(f.writes.some(([a]) => a >= 0x20000 && a < 0x24000)).toBe(true);
    for (const [a, n] of f.writes) {
      const ok = (a < 0x8800) || (a >= 0x20000 && a + n <= 0x24000);
      expect(ok).toBe(true);
    }
    const again = await p.readChannels();
    expect(again.map((c) => c.name)).toEqual(list.map((c) => c.name));
    await p.disconnect();
  });

  it('目印のない 25ja には 16 B 以上の名前を送らない', async () => {
    const radio = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(radio, 0, 145, 'A', 2);
    const f = fakeRadio(radio);
    serial.port = f.port;
    const p = new UVK1Protocol();
    await p.connect();
    expect(p.maxNameBytes()).toBe(15);
    await expect(p.writeChannels([ch(1, k10, 145)])).rejects.toThrow(/30 bytes, the radio holds 15/);
    expect(f.writes).toEqual([]);
    await p.disconnect();
  });
});
