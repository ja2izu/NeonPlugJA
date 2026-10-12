/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  encodeNameJa,
  decodeNameJa,
  byteLengthJa,
  MASTER_SHA256,
} from '../../src/radios/dm32uv/nameCodec';
import { GB_KU, DONOR_JA, DONOR_SLOT } from '../../src/radios/dm32uv/nameCodecTables';
import { migrate } from '../helpers/nameMigrate';

// dm32_slotmap.py（CPS 経由の手順で使っている変換）が出した期待値。
// tools/gen-name-codec-parity.py で作る。
interface Parity {
  masterSha256: string;
  encode: { chars: string; gbk: string[]; bytes: (string | null)[] };
  decode: { hex: string[]; chars: string };
  zoneTest: { ja: string; hex: string }[];
}
const parity: Parity = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/nameCodec/slotmapParity.json'), 'utf8'),
);

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

// GB2312 の全区点
const slots: { bytes: Uint8Array; gb: string; slot: number }[] = [];
GB_KU.forEach((row, k) => {
  Array.from(row).forEach((c, t) => {
    if (c !== '\u0000') slots.push({ bytes: Uint8Array.of(0xa1 + k, 0xa1 + t), gb: c, slot: k * 94 + t });
  });
});
const donorJa = Array.from(DONOR_JA);
const donorSlotSet = new Set(DONOR_SLOT);
const donorChinese = new Set(slots.filter((s) => donorSlotSet.has(s.slot)).map((s) => s.gb));

// 0.95: かな・記号・全角英数 332 字は、漢字域の空きの区点へ移した（master_1990_v2）。
// 旧い区点（A4A2 など）は読みだけに残り、書くときは移した区点になる。
// migrate: 旧 master で書かれていたバイト列を、移した後のバイト列にする（tests/helpers/nameMigrate.ts）。
const MOVED = 332;
const DONOR_OLD = 3070;
const donorSlotOf = new Map<string, number>();
donorJa.forEach((c, i) => donorSlotOf.set(c, DONOR_SLOT[i]));

describe('nameCodec 変換表', () => {
  it('master は新版（かな・記号を移した版）。dm32_slotmap の期待値は旧版 master で作ったまま', () => {
    expect(parity.masterSha256).toBe('1f3fa9bcac4416f2ae7ac99bb4e3b993d791ecc2e7a36a8e5d91862e2dd4f6a1');
    expect(MASTER_SHA256).toBe('5c9826feabb6b76b39d593f1d6492a261ac13e05d5df2364a9c0e9d538f3530f');
  });

  it('GB2312 7,445 字・置換 3,070 組＋移した 332 組', () => {
    expect(slots).toHaveLength(7445);
    expect(donorJa).toHaveLength(DONOR_OLD + MOVED);
    expect(DONOR_SLOT).toHaveLength(DONOR_OLD + MOVED);
    expect(donorSlotSet.size).toBe(DONOR_OLD + MOVED);
  });

  it('移した 332 字は、旧い区点（GB2312 の位置）にもある字で、移し先は漢字域（区16 以降）', () => {
    const nativeChars = new Set(slots.map((s) => s.gb));
    const moved = donorJa.filter((c) => nativeChars.has(c));
    expect(moved).toHaveLength(MOVED);
    for (const c of moved) expect(donorSlotOf.get(c)! >= 15 * 94).toBe(true);
  });
});

describe('nameCodec 往復', () => {
  it('GB2312 全区点: バイト → 文字 → バイト が元に戻る', () => {
    const ng: string[] = [];
    for (const s of slots) {
      const c = decodeNameJa(s.bytes);
      const r = encodeNameJa(c, 2);
      // 移した字は、旧い区点を読んで書き直すと移し先の区点になる
      if (r.errors.length || hex(r.bytes) !== migrate(hex(s.bytes))) ng.push(hex(s.bytes));
    }
    expect(ng).toEqual([]);
  });

  it('置換 3,070 字＋移した 332 字: 文字 → 供出区点 → 文字 が元に戻る（GBK で表せない 28 字を含む）', () => {
    const ng: string[] = [];
    donorJa.forEach((c, i) => {
      const r = encodeNameJa(c, 2);
      const slot = DONOR_SLOT[i];
      const want = Uint8Array.of(0xa1 + Math.floor(slot / 94), 0xa1 + (slot % 94));
      if (r.errors.length || hex(r.bytes) !== hex(want) || decodeNameJa(r.bytes) !== c) ng.push(c);
    });
    expect(ng).toEqual([]);
  });

  it('供出区点は日本語で読める', () => {
    expect(decodeNameJa(encodeNameJa('東京', 4).bytes)).toBe('東京');
    expect(decodeNameJa(fromHex('C4A1'))).toBe('張'); // 摹 の区点
  });

  it('英数字 0x20-0x7E は1バイトのまま', () => {
    let s = '';
    for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
    const r = encodeNameJa(s, 1000);
    expect(r.errors).toEqual([]);
    expect(Array.from(r.bytes)).toEqual(Array.from(s, (c) => c.charCodeAt(0)));
    expect(decodeNameJa(r.bytes)).toBe(s);
  });
});

describe('nameCodec 中点・ダッシュ・横棒', () => {
  it('A1A4 は ・(U+30FB) で読み、U+30FB と U+00B7 のどちらも移し先の区点に書く', () => {
    const want = migrate('A1A4')!;
    expect(want).not.toBe('A1A4');
    expect(decodeNameJa(fromHex('A1A4'))).toBe('\u30FB');
    expect(decodeNameJa(fromHex(want))).toBe('\u30FB');
    expect(hex(encodeNameJa('\u30FB', 2).bytes)).toBe(want);
    expect(hex(encodeNameJa('\u00B7', 2).bytes)).toBe(want);
  });

  it('A1AA は ―(U+2015) で読み、U+2015 と U+2014 のどちらも移し先の区点に書く', () => {
    const want = migrate('A1AA')!;
    expect(want).not.toBe('A1AA');
    expect(decodeNameJa(fromHex('A1AA'))).toBe('\u2015');
    expect(decodeNameJa(fromHex(want))).toBe('\u2015');
    expect(hex(encodeNameJa('\u2015', 2).bytes)).toBe(want);
    expect(hex(encodeNameJa('\u2014', 2).bytes)).toBe(want);
  });

  it('A844 は区点外: GBK の ―(U+2015) として読み、書き直すと区点内（移し先）の区点になる', () => {
    expect(decodeNameJa(fromHex('A844'))).toBe('\u2015');
    expect(hex(encodeNameJa(decodeNameJa(fromHex('A844')), 2).bytes)).toBe(migrate('A1AA'));
  });

  it('かな・記号・全角英数は移し先に書き、旧い区点（A4A2 など）も読める', () => {
    const want = migrate('A4A2')!;
    expect(want).not.toBe('A4A2');
    expect(hex(encodeNameJa('あ', 2).bytes)).toBe(want);
    expect(decodeNameJa(fromHex(want))).toBe('あ');
    expect(decodeNameJa(fromHex('A4A2'))).toBe('あ');
    // 移し先の区点の元の中国漢字は書けない（実機では「あ」が出る）
    expect(encodeNameJa(slots.find((x) => hex(x.bytes) === want)!.gb, 2).errors[0].reason).toBe('donorSlot');
  });
});

describe('nameCodec 切り詰め', () => {
  it('上限ちょうどは切らない', () => {
    const r = encodeNameJa('名張豊中宝塚槇原', 16);
    expect(r.bytes).toHaveLength(16);
    expect(r.truncated).toBe(false);
  });

  it('1バイト超過は最後の字を落とす', () => {
    const r = encodeNameJa('1234567890abcdefg', 16);
    expect(hex(r.bytes)).toBe(hex(new TextEncoder().encode('1234567890abcdef')));
    expect(r.truncated).toBe(true);
  });

  it('2バイト文字は途中で切らない', () => {
    const r = encodeNameJa('A名張豊中宝塚槇原', 16);
    expect(r.bytes).toHaveLength(15);
    expect(decodeNameJa(r.bytes)).toBe('A名張豊中宝塚槇');
    expect(r.truncated).toBe(true);
  });

  it('切り詰めた後ろの字も検査する', () => {
    const r = encodeNameJa('ABC😀', 2);
    expect(r.truncated).toBe(true);
    expect(r.errors).toEqual([{ index: 3, char: '😀', reason: 'unencodable' }]);
  });
});

describe('nameCodec 書けない字', () => {
  it('制御文字・GB2312 外の字（ß € 絵文字など）は unencodable', () => {
    const r = encodeNameJa('a\tbßc€d😀', 16);
    expect(r.errors.map((e) => [e.index, e.char, e.reason])).toEqual([
      [1, '\t', 'unencodable'],
      [3, 'ß', 'unencodable'],
      [5, '€', 'unencodable'],
      [7, '😀', 'unencodable'],
    ]);
    expect(decodeNameJa(r.bytes)).toBe('abcd');
  });

  it('GB2312 にあるラテン文字（é ú ü など）は2バイトで書ける', () => {
    expect(hex(encodeNameJa('Perú', 8).bytes)).toBe('506572A8B2');
    expect(decodeNameJa(fromHex('506572A8B2'))).toBe('Perú');
  });

  it('供出区点の元の中国漢字は donorSlot', () => {
    expect(encodeNameJa('你', 2).errors).toEqual([{ index: 0, char: '你', reason: 'donorSlot' }]);
    expect(donorChinese.size).toBe(DONOR_OLD + MOVED);
    const ng = Array.from(donorChinese).filter((c) => encodeNameJa(c, 2).errors[0]?.reason !== 'donorSlot');
    expect(ng).toEqual([]);
  });

  it('byteLengthJa はバイト数、書けない字があれば null', () => {
    expect(byteLengthJa('')).toBe(0);
    expect(byteLengthJa('ABC')).toBe(3);
    expect(byteLengthJa('東京AIR')).toBe(7);
    expect(byteLengthJa('Perú')).toBe(5);
    expect(byteLengthJa('Straße')).toBeNull();
    expect(byteLengthJa('你')).toBeNull();
  });
});

describe('nameCodec 読み: GB2312 以外のバイト', () => {
  const cp1252 = new TextDecoder('windows-1252');

  it('単独の高位バイトは上流と同じく windows-1252 で読む', () => {
    for (let b = 0x80; b <= 0xff; b++) {
      expect(decodeNameJa(Uint8Array.of(b))).toBe(cp1252.decode(Uint8Array.of(b)));
    }
  });

  it('上流の windows-1252 の名前は、後ろが GBK の2バイトにならなければそのまま読める', () => {
    // Perú: 末尾の 0xFA は単独なので windows-1252
    expect(decodeNameJa(Uint8Array.from(Array.from('Perú', (c) => c.charCodeAt(0))))).toBe('Perú');
    // Türkiye: 0xFC 0x72 が GBK の 黵 になる（ON のときの既知の曖昧さ。OFF では上流どおり）
    expect(decodeNameJa(Uint8Array.from(Array.from('Türkiye', (c) => c.charCodeAt(0))))).toBe('T黵kiye');
  });

  it('GBK にも無い2バイト（区10 の AAA1、CPS の化けで出る A581）は1バイトずつ読む', () => {
    expect(decodeNameJa(fromHex('AAA1'))).toBe(cp1252.decode(fromHex('AAA1')));
    expect(decodeNameJa(fromHex('A581'))).toBe(cp1252.decode(fromHex('A581')));
  });

  it('CPS が変換なしで書いた GBK の名前を読み、書き戻すと供出区点になる', () => {
    // 関西AP/RD（関 = E976）・広島（広 = 8EDA、島 = 8D75）・金沢（沢 = 9B67）
    const cases: [string, string][] = [
      ['E976CEF7' + hex(new TextEncoder().encode('AP/RD')), '関西AP/RD'],
      ['8EDA8D75', '広島'],
      ['BDF09B67', '金沢'],
    ];
    for (const [h, name] of cases) {
      expect(decodeNameJa(fromHex(h))).toBe(name);
      const r = encodeNameJa(name, 16);
      expect(r.errors).toEqual([]);
      expect(decodeNameJa(r.bytes)).toBe(name);
      expect(Array.from(r.bytes).every((b) => b < 0x80 || (b >= 0xa1 && b <= 0xfe))).toBe(true);
    }
    // CPS の入力で 槇 が化けた 丒（8145）は読めるが書けない
    expect(decodeNameJa(fromHex('8145'))).toBe('丒');
    expect(encodeNameJa('丒', 2).errors[0].reason).toBe('unencodable');
  });
});

describe('nameCodec と dm32_slotmap.py（CPS 経由の手順）の一致', () => {
  it('書き: GBK 全 21,791 字。違うのは供出区点の中国漢字（3,070＋移し先 332）と横棒 U+2015 だけ（かな・記号は期待値を移し先に読み替え）', () => {
    const chars = Array.from(parity.encode.chars);
    expect(chars).toHaveLength(21791);
    const same: number[] = [];
    const donor: string[] = [];
    const other: string[] = [];
    chars.forEach((c, i) => {
      const want = migrate(parity.encode.bytes[i]); // 旧 master の期待値を、移した後の区点にする
      const r = encodeNameJa(c, 2);
      const got = r.errors.length ? null : hex(r.bytes);
      if (got === want) {
        same.push(i);
      } else if (want !== null && got === null && r.errors[0].reason === 'donorSlot') {
        donor.push(c); // CPS 経由では通るが、実機では別の日本語の字が出るので書かせない
      } else {
        other.push(`${c} U+${c.codePointAt(0)!.toString(16)} want=${want} got=${got}`);
      }
    });
    expect(donor).toHaveLength(DONOR_OLD + MOVED);
    // CPS では横棒が区点外の A844 になり表示できないが、ブラウザからは書ける（移し先の区点）
    expect(other).toEqual([`― U+2015 want=null got=${migrate('A1AA')}`]);
    expect(same).toHaveLength(21791 - (DONOR_OLD + MOVED) - 1);
  });

  it('読み: GB2312 全 7,445 区点。違うのは A1A4・A1AA と、GBK で表せない置換 28 字、移し先の 332 区点だけ', () => {
    const chars = Array.from(parity.decode.chars);
    expect(chars).toHaveLength(7445);
    const diff: string[] = [];
    let noGbk = 0;
    parity.decode.hex.forEach((h, i) => {
      const got = decodeNameJa(fromHex(h));
      if (got === chars[i]) return;
      const idx = donorJa.indexOf(got);
      if (idx >= 0 && DONOR_SLOT[idx] === (parseInt(h.slice(0, 2), 16) - 0xa1) * 94 + parseInt(h.slice(2), 16) - 0xa1) {
        noGbk++; // CSV では GBK で書けないので供出字のまま残る字
      } else {
        diff.push(`${h} want=${chars[i]} got=${got}`);
      }
    });
    expect(noGbk).toBe(28 + MOVED); // 移し先の 332 区点は、旧 master では中国漢字のまま
    // CSV は GBK で読むので U+00B7 / U+2014、コーデックは字庫の字 U+30FB / U+2015
    expect(diff).toEqual(['A1A4 want=\u00B7 got=\u30FB', 'A1AA want=\u2014 got=\u2015']);
  });

  it('GBK 全 21,791 字を GBK のバイトのまま読むと、その字になる（例外は区点表の字を優先する所だけ）', () => {
    const chars = Array.from(parity.encode.chars);
    const diff: string[] = [];
    let donor = 0;
    chars.forEach((c, i) => {
      const got = decodeNameJa(fromHex(parity.encode.gbk[i]));
      if (got === c) return;
      if (donorChinese.has(c)) {
        donor++; // 供出区点は日本語で読む
      } else {
        diff.push(`${parity.encode.gbk[i]} want=${c} got=${got}`);
      }
    });
    expect(donor).toBe(DONOR_OLD + MOVED);
    expect(diff).toEqual(['A1A4 want=\u00B7 got=\u30FB', 'A1AA want=\u2014 got=\u2015']);
  });

  it('CPS が変換なしで書いた名前を読んで書き戻すと、CSV の encode と同じバイトになる（横棒を除く）', () => {
    const chars = Array.from(parity.encode.chars);
    const diff: string[] = [];
    chars.forEach((c, i) => {
      const want = migrate(parity.encode.bytes[i]);
      const r = encodeNameJa(decodeNameJa(fromHex(parity.encode.gbk[i])), 2);
      const got = r.errors.length ? null : hex(r.bytes);
      if (got !== want) diff.push(`${c} ${parity.encode.gbk[i]} want=${want} got=${got}`);
    });
    expect(diff).toEqual([`― A844 want=null got=${migrate('A1AA')}`]);
  });

  it('実データの Zone 名 21 件（CPS で書き実機表示を確認済み）が往復する', () => {
    expect(parity.zoneTest).toHaveLength(21);
    for (const z of parity.zoneTest) {
      expect(decodeNameJa(fromHex(z.hex))).toBe(z.ja);
      const r = encodeNameJa(z.ja, 16);
      expect(r.errors).toEqual([]);
      expect(r.truncated).toBe(false);
      expect(hex(r.bytes)).toBe(migrate(z.hex)); // 旧い区点で書いた名前は、書き直すと移し先の区点になる
    }
  });
});
