/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFrame, scramble, SESSION } from '../../src/radios/uvk5/framing';
import { spiReadPayload, dataFromSpiReadReply } from '../../src/radios/uvk1/framing';
import {
  decodeAttribute, isUnusedAttribute, decodeChannelName, parseChannel, scanListLabel,
} from '../../src/radios/uvk1/structures';
import {
  UVK1Protocol, UVK1_IMAGE_SIZE, usedSlotsFromImage, blocksForSlots, channelsFromImage,
} from '../../src/radios/uvk1/protocol';
import { UVK1_ADDR, UVK1_FONT_BASE, UVK1_FONT_PROFILES } from '../../src/radios/uvk1/constants';
import { UVK5_CTCSS_TONES } from '../../src/radios/uvk5/structures';

const utf8 = (s: string) => new TextEncoder().encode(s);
const nameField = (s: string) => { const f = new Uint8Array(16); f.set(utf8(s).subarray(0, 16)); return f; };

/** 16-byte record in the F4HWN layout (receive frequency in 10 Hz units). */
function record(rxHz: number, opts: { flags?: number; rxTone?: [number, number] } = {}): Uint8Array {
  const r = new Uint8Array(16);
  const v = Math.round(rxHz / 10);
  r[0] = v & 0xff; r[1] = (v >>> 8) & 0xff; r[2] = (v >>> 16) & 0xff; r[3] = (v >>> 24) & 0xff;
  if (opts.rxTone) { r[10] = opts.rxTone[0]; r[8] = opts.rxTone[1]; }
  r[12] = opts.flags ?? 0;
  return r;
}

/** Attribute word: band, scan list. */
const attr = (band: number, scanList = 0, exclude = false) =>
  (band & 7) | (exclude ? 0x80 : 0) | ((scanList & 0xff) << 8);

function putSlot(image: Uint8Array, slot: number, rec: Uint8Array, name: string, a: number) {
  image.set(rec, UVK1_ADDR.CHANNELS + slot * 16);
  image.set(nameField(name), UVK1_ADDR.CHANNEL_NAMES + slot * 16);
  image[UVK1_ADDR.CHANNEL_ATTR + slot * 2] = a & 0xff;
  image[UVK1_ADDR.CHANNEL_ATTR + slot * 2 + 1] = (a >> 8) & 0xff;
}

describe('UV-K1 SPI 読出コマンド（0x051F）', () => {
  it('Dondji の CMD_051F_t と同じ並び', () => {
    const p = spiReadPayload(0x051704, 1);
    expect(Array.from(p.subarray(0, 12))).toEqual([0x1f, 0x05, 0x0c, 0x00, 0x04, 0x17, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00]);
    expect(Array.from(p.subarray(12))).toEqual(Array.from(SESSION));
  });

  it('応答（0x0520）から中身を取り出す・番地違いは拒否', () => {
    const reply = Uint8Array.of(0x20, 0x05, 0x09, 0x00, 0x04, 0x17, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x04);
    expect(Array.from(dataFromSpiReadReply(reply, 0x051704))).toEqual([4]);
    expect(() => dataFromSpiReadReply(reply, 0x051705)).toThrow(/asked/);
  });
});

describe('UV-K1 属性（2 バイト）', () => {
  it('ビット割当', () => {
    const a = decodeAttribute(0x80 | (2 << 3) | 5, 25);
    expect(a).toMatchObject({ band: 5, compander: 2, exclude: true, scanList: 25 });
  });
  it('band 7 は未使用（消去状態 FFFF と削除後 0007）', () => {
    expect(isUnusedAttribute(decodeAttribute(0xff, 0xff))).toBe(true);
    expect(isUnusedAttribute(decodeAttribute(0x07, 0x00))).toBe(true);
    expect(isUnusedAttribute(decodeAttribute(0x06, 0x00))).toBe(false);
  });
  it('スキャンリストの表示', () => {
    expect([0, 1, 24, 25, 26].map(scanListLabel)).toEqual(['', '1', '24', 'ALL', '?']);
  });
});

describe('UV-K1 CH 名（UTF-8・15 バイト）', () => {
  it('漢字・かな・ASCII', () => {
    expect(decodeChannelName(nameField('名古屋レピ'))).toBe('名古屋レピ');
    expect(decodeChannelName(nameField('JR2 あ'))).toBe('JR2 あ');
    expect(decodeChannelName(nameField('ABCDEFGHIJKLMNOP'))).toBe('ABCDEFGHIJKLMNO');
  });
  it('15 バイト目で途中になる字は落とす', () => {
    const f = new Uint8Array(16);
    f.set(utf8('ABCDEFGHIJKLM')); // 13 bytes
    f.set(utf8('あ'), 13);        // 13-15: would end past byte 15
    expect(decodeChannelName(f)).toBe('ABCDEFGHIJKLM');
  });
  it('0x00・0xFF・範囲外の字で終わる、末尾の空白は削る', () => {
    expect(decodeChannelName(Uint8Array.of(0x41, 0x42, 0xff, 0x43))).toBe('AB');
    expect(decodeChannelName(Uint8Array.of(0x41, 0xc3, 0xa9, 0x43))).toBe('A');
    expect(decodeChannelName(nameField('HOME  '))).toBe('HOME');
    expect(decodeChannelName(new Uint8Array(16).fill(0xff))).toBe('');
  });
});

describe('UV-K1 チャンネル', () => {
  it('周波数・名前・スキャン', () => {
    const ch = parseChannel({
      number: 3, record: record(433_000_000, { rxTone: [1, UVK5_CTCSS_TONES.indexOf(88.5)] }),
      attrLo: 5, attrHi: 1, nameField: nameField('呼出'),
    })!;
    expect(ch.number).toBe(3);
    expect(ch.rxFrequency).toBeCloseTo(433.0, 6);
    expect(ch.name).toBe('呼出');
    expect(ch.scanAdd).toBe(true);
    expect(ch.rxCtcssDcs).toEqual({ type: 'CTCSS', value: 88.5 });
  });
  it('スキャンリスト 0 または除外なら scanAdd は false', () => {
    expect(parseChannel({ number: 1, record: record(145e6), attrLo: 2, attrHi: 0, nameField: nameField('') })!.scanAdd).toBe(false);
    expect(parseChannel({ number: 1, record: record(145e6), attrLo: 0x82, attrHi: 1, nameField: nameField('') })!.scanAdd).toBe(false);
  });
  it('属性が未使用なら記録があっても空き', () => {
    expect(parseChannel({ number: 1, record: record(145e6), attrLo: 7, attrHi: 0, nameField: nameField('X') })).toBeNull();
  });
  it('属性が使用中でも周波数が空なら空き', () => {
    expect(parseChannel({ number: 1, record: new Uint8Array(16).fill(0xff), attrLo: 2, attrHi: 0, nameField: nameField('') })).toBeNull();
  });
});

describe('UV-K1 空き CH の読み飛ばし', () => {
  it('使用中の CH を含むブロックだけ読む（8 CH / ブロック）', () => {
    const image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    for (const s of [0, 7, 8, 1023]) putSlot(image, s, record(145e6), '', attr(2));
    expect(usedSlotsFromImage(image)).toEqual([0, 7, 8, 1023]);
    expect(blocksForSlots([0, 7, 8, 1023])).toEqual([0x0000, 0x0080, 0x3f80, 0x4000, 0x4080, 0x7f80]);
  });
  it('1〜1024 の番号で並ぶ', () => {
    const image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(image, 0, record(145.0e6), 'いち', attr(2, 1));
    putSlot(image, 1023, record(439.0e6), 'LAST', attr(5));
    const chs = channelsFromImage(image);
    expect(chs.map((c) => [c.number, c.name])).toEqual([[1, 'いち'], [1024, 'LAST']]);
  });
});

// ---- 疑似無線機で接続から読込までを通す ----

/** Dondji / 25ja の応答を真似る。spi=false なら F4HWN のように 0x051F に答えない。 */
function fakeRadio(image: Uint8Array, opts: { spi: boolean; longNames?: boolean; fwVersion?: [number, number]; fontVersionAt?: Record<number, number> }) {
  const reads: number[] = [];
  const writes: Array<[number, number]> = [];
  let push: (b: Uint8Array) => void = () => {};
  const readable = new ReadableStream<Uint8Array>({ start(c) { push = (b) => c.enqueue(b); } });
  let pending = new Uint8Array(0);
  const reply = (payload: Uint8Array) => push(buildFrame(payload));
  let hung = false;
  const handle = (payload: Uint8Array) => {
    if (hung) return;
    const id = payload[0] | (payload[1] << 8);
    // 実機（2026-09-28）：応答の長さが奇数だと USB 送信の途中で HardFault、以後無反応
    if ((id === 0x051b && payload[6] % 2 === 1) || (id === 0x051f && (payload[8] | (payload[9] << 8)) % 2 === 1)) {
      hung = true;
      return;
    }
    if (id === 0x0514) {
      const r = new Uint8Array(4 + 36); r.set([0x15, 0x05, 36, 0]); r.set(utf8('F4HWN v5.2.8'), 4);
      if (opts.longNames) r.set([0x25, 0x4a, 0x01], 17); // 25Ja: Version[13..15]
      if (opts.fwVersion) r.set(opts.fwVersion, 22); // 25Ja 0.4+: Padding[0..1] = (major<<4)|minor, patch
      reply(r);
    } else if (id === 0x051b) {
      const off = payload[4] | (payload[5] << 8); const len = payload[6];
      reads.push(off);
      const r = new Uint8Array(8 + len); r.set([0x1c, 0x05, len + 4, 0, payload[4], payload[5], len, 0]);
      r.set(image.subarray(off, off + len), 8); reply(r);
    } else if (id === 0x0521 && opts.spi) {
      const addr = (payload[4] | (payload[5] << 8) | (payload[6] << 16) | (payload[7] << 24)) >>> 0;
      const len = payload[8] | (payload[9] << 8);
      writes.push([addr, len]);
      image.set(payload.subarray(16, 16 + len), spiToImage(addr));
      reply(Uint8Array.of(0x22, 0x05, 0x08, 0x00, payload[4], payload[5], payload[6], payload[7], 0, 0, 0, 0));
    } else if (id === 0x051f && opts.spi) {
      const addr = (payload[4] | (payload[5] << 8) | (payload[6] << 16) | (payload[7] << 24)) >>> 0;
      const len = payload[8] | (payload[9] << 8);
      const r = new Uint8Array(12 + len); r.set([0x20, 0x05, len + 8, 0]); r.set(payload.subarray(4, 10), 4);
      for (let i = 0; i < len; i++) {
        const a = addr + i;
        const at = spiToImage(a);
        r[12 + i] = opts.fontVersionAt?.[a] ?? (at < image.length ? image[at] : 0xff);
      }
      reply(r);
    }
  };
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const next = new Uint8Array(pending.length + chunk.length); next.set(pending); next.set(chunk, pending.length); pending = next;
      while (pending.length >= 4) {
        const len = pending[2] | (pending[3] << 8);
        if (pending.length < 4 + len + 4) break;
        handle(scramble(pending.subarray(4, 4 + len + 2)).subarray(0, len));
        pending = pending.slice(4 + len + 4);
      }
    },
  });
  const port = { readable, writable, open: async () => {}, close: async () => {} };
  return { port, reads, writes, inject: (b: Uint8Array) => push(b) };
}

/** SPI address -> fake radio image index (second name slots at 0x020000 live at 0x9000). */
const spiToImage = (a: number) => (a >= 0x20000 && a < 0x24000 ? 0x9000 + (a - 0x20000) : a);

const serial = vi.hoisted(() => ({ port: null as unknown }));
vi.mock('../../src/radios/shared/serialPort', () => ({ requestSerialPort: async () => serial.port }));

describe('UV-K1 接続と読込（疑似無線機）', () => {
  const ja = UVK1_FONT_PROFILES[0];
  const dj = UVK1_FONT_PROFILES[1];
  let image: Uint8Array;
  beforeEach(() => {
    image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    putSlot(image, 0, record(145.0e6), '名古屋', attr(2, 1));
    putSlot(image, 500, record(433.0e6), 'かな', attr(5));
  });

  it('25ja：hello の版数（Padding）を読む：0.3 / 0.3.1 / 00 00 = 版数なし / 25Ja の目印なしでは読まない', async () => {
    const info = async (o: { longNames?: boolean; fwVersion?: [number, number] }) => {
      const r = fakeRadio(image, { spi: true, fontVersionAt: { [UVK1_FONT_BASE + ja.versionOffset]: 4 }, ...o });
      serial.port = r.port;
      const p = new UVK1Protocol();
      await p.connect();
      return p.getRadioInfo();
    };
    expect((await info({ longNames: true, fwVersion: [0x03, 0] })).firmware).toMatch(/^25Ja v0\.3\(F4HWN v5\.2\.8\) \/ font: 25ja/);
    expect((await info({ longNames: true, fwVersion: [0x03, 1] })).firmware).toMatch(/^25Ja v0\.3\.1\(F4HWN/);
    expect((await info({ longNames: true, fwVersion: [0x1c, 5] })).firmware).toMatch(/^25Ja v1\.12\.5\(F4HWN/);
    expect((await info({ longNames: true, fwVersion: [0, 0] })).firmware).toMatch(/^25Ja\(F4HWN/);
    expect((await info({ fwVersion: [0x03, 0] })).firmware).toMatch(/^25Ja\(F4HWN/);
  });

  it('25ja：字庫の版 4 を判定し、使用中の CH のブロックだけ読む', async () => {
    const r = fakeRadio(image, { spi: true, fontVersionAt: { [UVK1_FONT_BASE + ja.versionOffset]: 4 } });
    serial.port = r.port;
    const p = new UVK1Protocol();
    await p.connect();
    expect(p.getFontId()).toBe('25ja');
    expect((await p.getRadioInfo()).firmware).toContain('F4HWN v5.2.8');
    const info = await p.getRadioInfo();
    expect(info.firmwareLabel).toBe('F/W:');
    expect(info.firmware).toMatch(/^25Ja\(F4HWN v5\.2\.8\) \/ font: 25ja \(Shinonome JIS X 0208\) \/ names: \d+ bytes$/);
    const chs = await p.readChannels();
    expect(chs.map((c) => [c.number, c.name])).toEqual([[1, '名古屋'], [501, 'かな']]);
    const attrBlocks = r.reads.filter((a) => a >= 0x8000);
    expect(attrBlocks.length).toBe(17);
    expect(r.reads.filter((a) => a < 0x8000)).toEqual([0x0000, 0x1f00, 0x4000, 0x5f00]);
    await p.disconnect();
  });

  it('公式 Dondji：版 2 を判定', async () => {
    const r = fakeRadio(image, { spi: true, fontVersionAt: { [UVK1_FONT_BASE + dj.versionOffset]: 2 } });
    serial.port = r.port;
    const p = new UVK1Protocol();
    await p.connect();
    expect(p.getFontId()).toBe('dondji');
    await p.disconnect();
  });

  it('0x051F に答えない（UV-K5 や F4HWN の K1）なら接続を断る', async () => {
    const r = fakeRadio(image, { spi: false });
    serial.port = r.port;
    const p = new UVK1Protocol();
    await expect(p.connect()).rejects.toThrow(/did not answer the SPI flash read/);
    expect(p.isConnected()).toBe(false);
    expect(r.reads).toEqual([]);
  });
});

// ---- 受信の組み立て（Web ツールと同じく AB CD を探す） ----
import { takePacket } from '../../src/radios/uvk1/connection';

describe('UV-K1 受信バッファから packet を取り出す', () => {
  const pkt = buildFrame(Uint8Array.of(0x15, 0x05, 0x02, 0x00, 0x41, 0x42));
  it('前にごみがあっても AB CD から読む', () => {
    const buf = new Uint8Array([0x00, 0x55, ...pkt, 0x99]);
    const r = takePacket(buf);
    expect(Array.from(r.payload!)).toEqual([0x15, 0x05, 0x02, 0x00, 0x41, 0x42]);
    expect(r.used).toBe(2 + pkt.length);
  });
  it('途中までしか届いていなければ待つ', () => {
    const r = takePacket(pkt.subarray(0, pkt.length - 1));
    expect(r.payload).toBeNull();
    expect(r.used).toBe(0);
  });
  it('AB CD が無ければ捨てる（末尾の AB だけ残す）', () => {
    expect(takePacket(Uint8Array.of(1, 2, 3)).used).toBe(3);
    expect(takePacket(Uint8Array.of(1, 2, 0xab)).used).toBe(2);
  });
  it('終端が合わない AB CD は読み飛ばす', () => {
    const bad = pkt.slice(); bad[bad.length - 1] = 0;
    const r = takePacket(bad);
    expect(r.payload).toBeNull();
    expect(r.used).toBe(2);
  });
});

describe('UV-K1 接続：関係ない packet が先に来ても待つ', () => {
  it('挨拶の前に別の packet があっても接続できる', async () => {
    const image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const r = fakeRadio(image, { spi: true, fontVersionAt: { [UVK1_FONT_BASE + UVK1_FONT_PROFILES[0].versionOffset]: 4 } });
    serial.port = r.port;
    const p = new UVK1Protocol();
    const pending = p.connect();
    // 開いた直後に、ごみ 3 バイトと関係ない packet（0x0999）を流す
    r.inject(Uint8Array.of(0x01, 0x02, 0x03, ...buildFrame(Uint8Array.of(0x99, 0x09, 0x00, 0x00))));
    await pending;
    expect(p.getFontId()).toBe('25ja');
    await p.disconnect();
  });
});

// ---- 奇数長の読出を送らない（実機で無線機が止まった件） ----
import { UVK1Connection } from '../../src/radios/uvk1/connection';

describe('UV-K1 奇数長の読出は送る前に拒否', () => {
  it('EEPROM 読出・SPI 読出とも、奇数なら 1 バイトも送らない', async () => {
    const sent: Uint8Array[] = [];
    const port = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>({ write(c) { sent.push(c); } }),
      open: async () => {}, close: async () => {},
    };
    const c = new UVK1Connection();
    await c.open(port);
    await expect(c.readBlock(0x8000, 127)).rejects.toThrow(/odd-sized reply stops the radio/);
    await expect(c.spiRead(0x51704, 1)).rejects.toThrow(/odd-sized reply stops the radio/);
    expect(sent).toEqual([]);
    await c.close();
  });

  it('判定の読出は 2 バイト（疑似無線機は奇数長で固まる設定のまま接続できる）', async () => {
    const image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const r = fakeRadio(image, { spi: true, fontVersionAt: { [UVK1_FONT_BASE + UVK1_FONT_PROFILES[0].versionOffset]: 4 } });
    serial.port = r.port;
    const p = new UVK1Protocol();
    await p.connect();
    expect(p.getFontId()).toBe('25ja');
    await p.disconnect();
  });
});
