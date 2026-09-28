/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect } from 'vitest';
import {
  parseChannel, encodeChannel, emptyChannel, isEmptyChannelRecord,
  decodeChannelName, encodeChannelName, UVK5_CTCSS_TONES, UVK5_DCS_CODES,
} from '../../src/radios/uvk5/structures';
import { UVK5_CHANNEL_SIZE, UVK5_NAME_SIZE } from '../../src/radios/uvk5/constants';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');

/** 16 バイトのチャンネル記録を組み立てる（テスト用） */
function record(opts: {
  rxHz: number; offsetHz?: number; offsetDir?: number;
  rxTone?: [number, number]; txTone?: [number, number];
  flags?: number; step?: number; scrambler?: number; modulation?: number;
}): Uint8Array {
  const r = new Uint8Array(UVK5_CHANNEL_SIZE);
  const put = (at: number, v: number) => {
    r[at] = v & 0xff; r[at + 1] = (v >>> 8) & 0xff; r[at + 2] = (v >>> 16) & 0xff; r[at + 3] = (v >>> 24) & 0xff;
  };
  put(0, Math.round(opts.rxHz / 10));
  put(4, Math.round((opts.offsetHz ?? 0) / 10));
  r[8] = opts.rxTone?.[1] ?? 0;
  r[9] = opts.txTone?.[1] ?? 0;
  r[10] = ((opts.txTone?.[0] ?? 0) << 4) | (opts.rxTone?.[0] ?? 0);
  r[11] = ((opts.modulation ?? 0) << 4) | (opts.offsetDir ?? 0);
  r[12] = opts.flags ?? 0;
  r[14] = opts.step ?? 0;
  r[15] = opts.scrambler ?? 0;
  return r;
}

const name = (s: string) => encodeChannelName(s);

describe('UV-K5 チャンネルの読み', () => {
  it('周波数（10 Hz 単位）とシンプレックス', () => {
    const ch = parseChannel({ number: 1, record: record({ rxHz: 145_000_000 }), attribute: 0, nameField: name('HOME') })!;
    expect(ch.rxFrequency).toBeCloseTo(145.0, 6);
    expect(ch.txFrequency).toBeCloseTo(145.0, 6);
    expect(ch.name).toBe('HOME');
  });

  it('オフセットの向き（+ と −）', () => {
    const plus = parseChannel({ number: 1, record: record({ rxHz: 439_000_000, offsetHz: 5_000_000, offsetDir: 1 }), attribute: 0, nameField: name('') })!;
    expect(plus.txFrequency).toBeCloseTo(444.0, 6);
    const minus = parseChannel({ number: 1, record: record({ rxHz: 439_000_000, offsetHz: 5_000_000, offsetDir: 2 }), attribute: 0, nameField: name('') })!;
    expect(minus.txFrequency).toBeCloseTo(434.0, 6);
  });

  it('CTCSS・DCS・無し', () => {
    const ctcss = UVK5_CTCSS_TONES.indexOf(88.5);
    const dcs = UVK5_DCS_CODES.indexOf(131);
    const ch = parseChannel({
      number: 1,
      record: record({ rxHz: 145_000_000, rxTone: [1, ctcss], txTone: [2, dcs] }),
      attribute: 0, nameField: name(''),
    })!;
    expect(ch.rxCtcssDcs).toEqual({ type: 'CTCSS', value: 88.5 });
    expect(ch.txCtcssDcs).toEqual({ type: 'DCS', value: 131, polarity: 'N' });

    const none = parseChannel({ number: 1, record: record({ rxHz: 145_000_000 }), attribute: 0, nameField: name('') })!;
    expect(none.rxCtcssDcs).toEqual({ type: 'None' });
  });

  it('出力・帯域・送信禁止', () => {
    // bits 4-2 = 0b111 (High), bit 1 = 1 (narrow), bit 6 = 1 (送信禁止)
    const ch = parseChannel({ number: 1, record: record({ rxHz: 145_000_000, flags: 0b0101_1110 }), attribute: 0, nameField: name('') })!;
    expect(ch.power).toBe('High');
    expect(ch.bandwidth).toBe('12.5kHz');
    expect(ch.forbidTx).toBe(true);

    const mid = parseChannel({ number: 1, record: record({ rxHz: 145_000_000, flags: 0b0001_1000 }), attribute: 0, nameField: name('') })!;
    expect(mid.power).toBe('Medium');
    expect(mid.bandwidth).toBe('25kHz');
    expect(mid.forbidTx).toBe(false);
  });

  it('未使用の枠は null', () => {
    expect(parseChannel({ number: 1, record: new Uint8Array(16).fill(0xff), attribute: 0xff, nameField: new Uint8Array(16) })).toBeNull();
    expect(parseChannel({ number: 1, record: new Uint8Array(16), attribute: 0xff, nameField: new Uint8Array(16) })).toBeNull();
    expect(isEmptyChannelRecord(emptyChannel().record)).toBe(true);
  });

  it('スキャンリストのビットから scanAdd を決める。未使用の属性（0xFF）は false', () => {
    const rec = record({ rxHz: 145_000_000 });
    expect(parseChannel({ number: 1, record: rec, attribute: 0b001_00_000, nameField: name('') })!.scanAdd).toBe(true);
    expect(parseChannel({ number: 1, record: rec, attribute: 0, nameField: name('') })!.scanAdd).toBe(false);
    expect(parseChannel({ number: 1, record: rec, attribute: 0xff, nameField: name('') })!.scanAdd).toBe(false);
  });
});

describe('UV-K5 チャンネルの名前', () => {
  it('10 文字まで。英数字以外は落とす', () => {
    expect(hex(encodeChannelName('HOME'))).toBe('484F4D45' + '00'.repeat(UVK5_NAME_SIZE - 4));
    expect(decodeChannelName(encodeChannelName('1234567890ABC'))).toBe('1234567890');
    expect(decodeChannelName(encodeChannelName('東京 JA2IZU'))).toBe('JA2IZU');
  });

  it('0x00 でも 0xFF でも終端として扱う', () => {
    const f = new Uint8Array(UVK5_NAME_SIZE).fill(0xff);
    f.set([0x41, 0x42]);
    expect(decodeChannelName(f)).toBe('AB');
  });
});

describe('UV-K5 チャンネルの書き', () => {
  it('読み → 書き → 読み で元に戻る', () => {
    const rec = record({
      rxHz: 439_300_000, offsetHz: 7_600_000, offsetDir: 2,
      rxTone: [1, UVK5_CTCSS_TONES.indexOf(88.5)], txTone: [1, UVK5_CTCSS_TONES.indexOf(88.5)],
      flags: 0b0001_1100, step: 5, scrambler: 3, modulation: 0,
    });
    const before = { record: rec, attribute: 0b010_01_101, nameField: name('JR-430') };
    const ch = parseChannel({ number: 7, ...before })!;
    const after = encodeChannel(ch, before);
    expect(hex(after.record)).toBe(hex(rec));
    expect(after.attribute).toBe(before.attribute);
    expect(hex(after.nameField)).toBe(hex(before.nameField));

    const again = parseChannel({ number: 7, record: after.record, attribute: after.attribute, nameField: after.nameField })!;
    expect(again).toEqual(ch);
  });

  it('こちらが扱わない欄（変調・ステップ・スクランブラ・DTMF・バンド）は元の値を残す', () => {
    const before = {
      record: record({ rxHz: 145_000_000, step: 9, scrambler: 4, modulation: 1 }),
      attribute: 0b000_11_010,
      nameField: name('OLD'),
    };
    before.record[13] = 0b0000_0101;
    const ch = parseChannel({ number: 1, ...before })!;
    const after = encodeChannel({ ...ch, name: 'NEW', rxFrequency: 433.0, txFrequency: 433.0 }, before);
    expect(after.record[11] >> 4).toBe(1);      // 変調
    expect(after.record[13]).toBe(0b0000_0101); // DTMF
    expect(after.record[14]).toBe(9);           // ステップ
    expect(after.record[15]).toBe(4);           // スクランブラ
    expect(after.attribute & 0x1f).toBe(0b11_010); // コンパンダとバンド
    expect(decodeChannelName(after.nameField)).toBe('NEW');
  });

  it('元の記録が無くても書ける（新規チャンネル）', () => {
    const ch = parseChannel({ number: 1, record: record({ rxHz: 145_000_000 }), attribute: 0, nameField: name('NEW') })!;
    const out = encodeChannel({ ...ch, txFrequency: 145.6, power: 'High', bandwidth: '12.5kHz', scanAdd: true });
    const back = parseChannel({ number: 1, record: out.record, attribute: out.attribute, nameField: out.nameField })!;
    expect(back.rxFrequency).toBeCloseTo(145.0, 6);
    expect(back.txFrequency).toBeCloseTo(145.6, 6);
    expect(back.power).toBe('High');
    expect(back.bandwidth).toBe('12.5kHz');
    expect(back.scanAdd).toBe(true);
  });

  it('Turbo は High に丸める（無線機は3段）', () => {
    const ch = parseChannel({ number: 1, record: record({ rxHz: 145_000_000 }), attribute: 0, nameField: name('') })!;
    const out = encodeChannel({ ...ch, power: 'Turbo' });
    expect(parseChannel({ number: 1, record: out.record, attribute: out.attribute, nameField: out.nameField })!.power).toBe('High');
  });
});
