/*
 * NeonPlugJA Ver.0.93 — UV-K1 (25Ja) チャンネル項目（受信モード・ステップ・反転・ビジーロック・DTMF受信・PTT ID・コンパンド）
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect } from 'vitest';
import type { Channel } from '../../src/models';
import { UVK1_ADDR } from '../../src/radios/uvk1/constants';
import { buildTarget, planWrites } from '../../src/radios/uvk1/writePlan';
import { UVK1_IMAGE_SIZE, channelsFromImage } from '../../src/radios/uvk1/protocol';
import { decodeUvk1RecordFields } from '../../src/radios/uvk1/structures';
import { createDefaultChannel } from '../../src/utils/channelHelpers';

const REC = (slot: number) => UVK1_ADDR.CHANNELS + slot * 16;
const ATTR = (slot: number) => UVK1_ADDR.CHANNEL_ATTR + slot * 2;

/** 145.00 MHz の使用中スロット 0。record の byte 11..15 と属性を指定できる。 */
function image(rec: Partial<Record<11 | 12 | 13 | 14 | 15, number>> = {}, attr = 2): Uint8Array {
  const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
  const r = new Uint8Array(16);
  const v = Math.round((145 * 1e6) / 10);
  r[0] = v & 0xff; r[1] = (v >>> 8) & 0xff; r[2] = (v >>> 16) & 0xff; r[3] = (v >>> 24) & 0xff;
  r[11] = rec[11] ?? 0; r[12] = rec[12] ?? 0x1c; r[13] = rec[13] ?? 0; r[14] = rec[14] ?? 4; r[15] = rec[15] ?? 0;
  img.set(r, REC(0));
  img.fill(0, UVK1_ADDR.CHANNEL_NAMES, UVK1_ADDR.CHANNEL_NAMES + 16); // 名前は空（0x00）
  img[ATTR(0)] = attr & 0xff;
  img[ATTR(0) + 1] = attr >> 8;
  return img;
}
const read = (img: Uint8Array): Channel => channelsFromImage(img)[0];
const write = (img: Uint8Array, ch: Channel) => buildTarget(img, [ch]).image;

describe('UV-K1 チャンネル項目：読み', () => {
  it('byte 11/12/13/14 と属性から 7 項目を読む', () => {
    // AM(1)、反転+ビジーロック+ナロー+High、DTMF受信+PTT ID 3、ステップ 9、コンパンド 2
    const ch = read(image({ 11: 0x10, 12: 0x01 | 0x20 | 0x02 | (7 << 2), 13: 0x01 | (3 << 1), 14: 9 }, 2 | (2 << 3)));
    expect(ch).toMatchObject({
      uvk1Modulation: 1, uvk1Step: 9, uvk1Reverse: true, uvk1Bclo: true,
      uvk1DtmfDecode: true, uvk1PttId: 3, uvk1Compander: 2, bandwidth: '12.5kHz', power: 'High',
    });
  });
  it('範囲外は FW と同じ読み替え（変調→FM、ステップ→12.5k、PTT ID→なし）', () => {
    const f = decodeUvk1RecordFields(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x50, 0, 6 << 1, 30, 0));
    expect(f).toMatchObject({ modulation: 0, step: 4, pttId: 0 });
  });
  it('byte 12 / 13 が 0xFF（未設定）は「なし・ワイド・Low1・TX禁止あり」', () => {
    const ch = read(image({ 12: 0xff, 13: 0xff }));
    expect(ch).toMatchObject({
      uvk1Reverse: false, uvk1Bclo: false, uvk1DtmfDecode: false, uvk1PttId: 0,
      bandwidth: '25kHz', power: 'Low1', forbidTx: true,
    });
  });
});

describe('UV-K1 チャンネル項目：書き', () => {
  it('読んだまま書けば何も書かない（既存 CH の未モデル bit も壊さない）', () => {
    const img = image({ 11: 0x10, 12: 0x01 | 0x20 | (5 << 2), 13: 0x0b, 14: 9, 15: 0xaa }, 2 | (2 << 3) | 0x60);
    const t = buildTarget(img, [read(img)]);
    expect(planWrites(img, t.image, t.touched)).toEqual([]);
  });
  it('変えた項目だけが変わり、残りの bit は元のまま', () => {
    const img = image({ 11: 0x10, 12: 0x01 | 0x20 | (5 << 2), 13: 0x0b, 14: 9, 15: 0xaa }, 2 | 0x60);
    const out = write(img, { ...read(img), uvk1Modulation: 2, uvk1Step: 5, uvk1Reverse: false, uvk1PttId: 4, uvk1Compander: 3 });
    expect(out[REC(0) + 11] >> 4).toBe(2);
    expect(out[REC(0) + 14]).toBe(5);
    expect(out[REC(0) + 12]).toBe((5 << 2) | 0x20); // 反転だけ OFF、ビジーロック・電力は元のまま
    expect(out[REC(0) + 13]).toBe(0x01 | (4 << 1)); // DTMF 受信は元のまま、PTT ID だけ 4
    expect(out[REC(0) + 15]).toBe(0xaa);
    expect(out[ATTR(0)]).toBe(2 | (3 << 3) | 0x60); // コンパンド 3、属性 bit5・6 は元のまま
  });
  it('ステップ 23（500kHz）を読み書きできる。24 以上は 12.5kHz と読み、変えなければ元の値のまま', () => {
    expect(read(image({ 14: 23 })).uvk1Step).toBe(23);
    const out = write(image({ 14: 4 }), { ...read(image({ 14: 4 })), uvk1Step: 23 });
    expect(out[REC(0) + 14]).toBe(23);
    const odd = image({ 14: 30 });
    expect(read(odd).uvk1Step).toBe(4);
    expect(write(odd, read(odd))[REC(0) + 14]).toBe(30);
    const bad = write(image({ 14: 4 }), { ...read(image({ 14: 4 })), uvk1Step: 24 });
    expect(bad[REC(0) + 14]).toBe(4); // 範囲外の値は書かない
  });
  it('属性 bit 5・6 を保つ（0.92.1 までは 0 にしていた）', () => {
    const img = image({}, 2 | 0x60);
    expect(write(img, read(img))[ATTR(0)] & 0x60).toBe(0x60);
  });
  it('項目を持たないチャンネル（CSV 取込など）は無線機の値を保つ', () => {
    const img = image({ 11: 0x10, 13: 0x0b, 14: 9 }, 2 | (2 << 3));
    const ch = { ...read(img) };
    for (const k of ['uvk1Modulation', 'uvk1Step', 'uvk1Reverse', 'uvk1Bclo', 'uvk1DtmfDecode', 'uvk1PttId', 'uvk1Compander'] as const) delete ch[k];
    const out = write(img, ch);
    expect(out[REC(0) + 11] >> 4).toBe(1);
    expect(out[REC(0) + 14]).toBe(9);
    expect(out[REC(0) + 13]).toBe(0x0b);
    expect((out[ATTR(0)] >> 3) & 3).toBe(2);
  });
  it('新規 CH は FM・12.5 kHz・フラグなし。byte 12 は 0xFF にならない', () => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const ch = createDefaultChannel({ number: 1, name: 'N', rxFrequency: 145.5, txFrequency: 145.5, power: 'Low3' });
    const out = write(img, ch);
    expect(out[REC(0) + 11]).toBe(0);
    expect(out[REC(0) + 12]).toBe(3 << 2);
    expect(out[REC(0) + 13]).toBe(0);
    expect(out[REC(0) + 14]).toBe(4);
    expect(out[REC(0) + 15]).toBe(0);
  });
  it('新規 CH でも指定した項目は書く', () => {
    const img = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const ch = { ...createDefaultChannel({ number: 1, name: 'N', rxFrequency: 145.5, txFrequency: 145.5, power: 'High' }),
      uvk1Modulation: 1, uvk1Step: 1, uvk1Reverse: true, uvk1Bclo: true, uvk1DtmfDecode: true, uvk1PttId: 2, uvk1Compander: 1 };
    const out = write(img, ch);
    expect(out[REC(0) + 11] >> 4).toBe(1);
    expect(out[REC(0) + 14]).toBe(1);
    expect(out[REC(0) + 12]).toBe((7 << 2) | 0x01 | 0x20);
    expect(out[REC(0) + 13]).toBe(0x01 | (2 << 1));
    expect((out[ATTR(0)] >> 3) & 3).toBe(1);
  });
  it('byte 12 / 13 が 0xFF の既存 CH：触らなければ 0xFF のまま', () => {
    const img = image({ 12: 0xff, 13: 0xff });
    const t = buildTarget(img, [read(img)]);
    expect(planWrites(img, t.image, t.touched)).toEqual([]);
  });
  it('byte 12 が 0xFF の CH で電力を変えても、反転・ビジーロックは ON にならない', () => {
    const img = image({ 12: 0xff });
    const out = write(img, { ...read(img), power: 'Low3' });
    expect(out[REC(0) + 12] & 0x01).toBe(0);
    expect(out[REC(0) + 12] & 0x20).toBe(0);
    expect((out[REC(0) + 12] >> 2) & 7).toBe(3);
    expect(out[REC(0) + 12] & 0x40).toBe(0x40); // TX 禁止は元（あり）のまま
  });
  it('byte 12 が 0xFF の CH で TX 禁止を外すと、外れる', () => {
    const img = image({ 12: 0xff });
    const out = write(img, { ...read(img), forbidTx: false });
    expect(out[REC(0) + 12] & 0x40).toBe(0);
    expect(out[REC(0) + 12] & 0x21).toBe(0);
  });
  it('byte 13 が 0xFF の CH で PTT ID を変えると、他の bit は 0 から作る', () => {
    const img = image({ 13: 0xff });
    const out = write(img, { ...read(img), uvk1PttId: 2 });
    expect(out[REC(0) + 13]).toBe(2 << 1);
  });
});
