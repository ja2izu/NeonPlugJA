/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeCsvBytesWithEncoding, readCsvText } from '../../src/utils/readCsvText';
import { encodeNameJa, isGb2312KutenOnly } from '../../src/radios/dm32uv/nameCodec';
import { importContactsFromCSV } from '../../src/services/csv/csvImporter';

const parity: { zoneTest: { ja: string; hex: string }[] } = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/nameCodec/slotmapParity.json'), 'utf8'),
);
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const ascii = (s: string) => Array.from(new TextEncoder().encode(s));
const ja = (s: string) => {
  const r = encodeNameJa(s, 1000);
  expect(r.errors).toEqual([]);
  return Array.from(r.bytes);
};

describe('CSV の文字コード判定（日本語名 ON）', () => {
  it('GB2312＋供出区点の CSV（CPS で書き実機表示を確認済みの Zone 名 21 件）を日本語で読む', () => {
    const bytes: number[] = [...ascii('No.,Zone Name\r\n')];
    parity.zoneTest.forEach((z, i) => bytes.push(...ascii(`${i + 1},`), ...fromHex(z.hex), 0x0d, 0x0a));
    const r = decodeCsvBytesWithEncoding(Uint8Array.from(bytes));
    expect(r.encoding).toBe('gb2312');
    const names = r.text.split('\r\n').slice(1, -1).map((l) => l.split(',')[1]);
    expect(names).toEqual(parity.zoneTest.map((z) => z.ja));
  });

  it('UTF-8（BOM あり）は UTF-8', () => {
    const r = decodeCsvBytesWithEncoding(Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('名前,東京')]));
    expect(r).toEqual({ text: '名前,東京', encoding: 'utf-8' });
  });

  it('ひらがな・漢字を含む CP932 は CP932', () => {
    // 名前,東京ー槇ん
    const r = decodeCsvBytesWithEncoding(Uint8Array.of(0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x93, 0x8c, 0x8b, 0x9e, 0x81, 0x5b, 0xea, 0xa0, 0x82, 0xf1));
    expect(r).toEqual({ text: '名前,東京ー槇ん', encoding: 'cp932' });
  });

  it('isGb2312KutenOnly: 区点表に無い2バイト・単独の高位バイト・高位バイト無しは false', () => {
    expect(isGb2312KutenOnly(fromHex('B6AB'))).toBe(true);      // 东（GB2312）
    expect(isGb2312KutenOnly(fromHex('C4A1'))).toBe(true);      // 摹（供出区点）
    expect(isGb2312KutenOnly(fromHex('E976'))).toBe(false);     // 関（GBK 拡張。CPS が変換なしで書いた形）
    expect(isGb2312KutenOnly(fromHex('AAA1'))).toBe(false);     // 区10（区点表に無い）
    expect(isGb2312KutenOnly(fromHex('41B6'))).toBe(false);     // 末尾の単独バイト
    expect(isGb2312KutenOnly(new TextEncoder().encode('abc'))).toBe(false);
  });

  it('OFF のときは file.text()（上流どおり）', async () => {
    const f = new File([fromHex(parity.zoneTest[21 - 1].hex)], 'x.csv');
    expect(await readCsvText(f, false)).toBe(await f.text());
    expect(await readCsvText(f, true)).toBe(parity.zoneTest[20].ja);
  });
});

describe('DM-32 の CPS の連絡先 CSV（GB2312＋供出区点）', () => {
  // 生成ツール（make_dmr_contact.py）の DM32UV 出力と同じ見出し
  const header = 'No.,ID,Repeater,Name,City,Province,Country,Remark,Type,Alert Call\r\n';
  const bytes = Uint8Array.from([
    ...ascii(header),
    ...ascii('1,4401234,JA2IZU,'), ...ja('槇ー東関ん'), ...ascii(','), ...ja('名張市'), ...ascii(','),
    ...ja('三重県'), ...ascii(','), ...ja('日本'), ...ascii(',,Private Call,0\r\n'),
    ...ascii('2,4409999,JA9ZZZ,Taro,,,,,Private Call,0\r\n'),
    ...ascii('3,abc,JA1AAA,Bad,,,,,Private Call,0\r\n'),
  ]);

  it('ON: 見出しを CPS の形式と判定し、ID→DMR ID、Repeater→コールサインで読む', () => {
    const { text, encoding } = decodeCsvBytesWithEncoding(bytes);
    expect(encoding).toBe('gb2312');
    const r = importContactsFromCSV(text, { cpsHeaders: true });
    expect(r.contacts).toEqual([
      { id: 1, name: '槇ー東関ん', dmrId: 4401234, callSign: 'JA2IZU', city: '名張市', province: '三重県', country: '日本', remark: undefined },
      { id: 2, name: 'Taro', dmrId: 4409999, callSign: 'JA9ZZZ', city: undefined, province: undefined, country: undefined, remark: undefined },
    ]);
    expect(r.errors).toEqual(['Row 4: ID が DMR ID として正しくない (abc)']);
  });

  it('OFF（cpsHeaders なし）は上流どおり NeonPlug の見出しとして読む', () => {
    const { text } = decodeCsvBytesWithEncoding(bytes);
    const r = importContactsFromCSV(text);
    // 上流の読み方: id は ID 列、DMR ID 列は無いので 0
    expect(r.contacts?.[0].dmrId).toBe(0);
    expect(r.contacts?.[0].id).toBe(4401234);
  });

  it('NeonPlug の見出し（DMR ID 列あり）は、ON でも従来どおり', () => {
    const text = 'ID,Name,DMR ID,Call Sign,City,Province,Country,Remark,Friend\r\n1,東京,4401234,JA2IZU,,,,,\r\n';
    const r = importContactsFromCSV(text, { cpsHeaders: true });
    expect(r.contacts?.[0]).toMatchObject({ id: 1, name: '東京', dmrId: 4401234, callSign: 'JA2IZU' });
  });
});
