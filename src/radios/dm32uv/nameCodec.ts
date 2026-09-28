/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * DM32 日本語名コーデック（日本語オプション ON のときだけ使う）
 *
 * 無線機の字庫は GB2312 の区点で引く。日本語化した字庫（master_1990）を焼いた無線機では、
 *   - GB2312 にある字（かな・記号・日中共通の漢字）はそのまま GB2312 の2バイトで書く
 *   - GB2312 に無い日本の字（ー 東 関 塚 など 3,070 字）は、字庫の側で日本語のグリフを焼いた
 *     「供出区点」（日本語では使わない中国漢字の区点）の2バイトで書く
 *
 * 日本語オプション OFF のときはこのモジュールを使わない（上流のコードをそのまま通す）。
 *
 * 書き: encodeNameJa
 *   - 0x20-0x7E は1バイト
 *   - GB2312 の 7,445 字と置換 3,070 字は2バイト
 *   - 別名 U+00B7（中点）・U+2014（ダッシュ）は GBK と同じ区点へ書く
 *   - それ以外（制御文字・windows-1252 の高位文字・GB2312 外の字）は errors に積む
 *   - 供出区点の元の中国漢字は、実機では日本語のグリフで表示されるので errors に積む
 *   - 切り詰めはバイト数で行い、2バイト文字の途中では切らない
 *   errors が空でないときは書き込まないこと（bytes は符号化できた字だけを並べたもの）
 *
 * 読み: decodeNameJa
 *   - 0x00-0x7F は1バイトの文字
 *   - GB2312 の区点表にある2バイトはその字。供出区点なら日本語に戻す
 *   - GB2312 の区点に無いが GBK として正しい2バイトは GBK の字として読む
 *     （CPS が変換なしで書いた 関 島 などを読むため。書き戻すと供出区点に変換される。
 *      置換表に無い字（CPS の入力で化けた 丒 など）は書こうとすると errors になる）
 *   - どちらでもない2バイトと単独の高位バイトは、上流と同じく windows-1252 で1バイトずつ読む
 *     （情報を落とさない。再度書こうとすると encodeNameJa が errors を返す）
 *   終端（NUL・0xFF）の処理は呼び出し元が行う。
 *
 * 変換表は tools/gen-name-codec-tables.py が master から生成して nameCodecTables.ts に埋め込む。
 * ブラウザの GBK デコーダには依存しない。
 */
import { GB_KU, DONOR_JA, DONOR_SLOT, ALIASES, GBK_EXT, MASTER_SHA256 } from './nameCodecTables';

export { MASTER_SHA256 };

export type NameCodecErrorReason =
  /** GB2312 にも置換表にも無い字、制御文字、windows-1252 の高位文字 */
  | 'unencodable'
  /** 供出区点の元の中国漢字（実機では別の日本語の字が表示される） */
  | 'donorSlot';

export interface NameCodecError {
  /** 名前の中での位置（UTF-16 のコード単位ではなく、先頭からの文字数） */
  index: number;
  char: string;
  reason: NameCodecErrorReason;
}

export interface EncodeNameResult {
  bytes: Uint8Array;
  errors: NameCodecError[];
  /** maxBytes に収まらず後ろを落としたとき true */
  truncated: boolean;
}

const TEN_MAX = 94;
const KU_MAX = 87;

interface Tables {
  /** 区点の通し番号 → 読みで返す文字（供出区点は日本語）。GB2312 に無い区点は '' */
  decode: string[];
  /** 文字 → 区点の通し番号（GB2312 の字・置換の日本語・別名） */
  encode: Map<string, number>;
  /** 供出区点の元の中国漢字 */
  donorChinese: Set<string>;
}

let tables: Tables | null = null;

function getTables(): Tables {
  if (tables) return tables;

  const decode: string[] = new Array(KU_MAX * TEN_MAX).fill('');
  const encode = new Map<string, number>();
  const donorChinese = new Set<string>();

  for (let k = 0; k < KU_MAX; k++) {
    const row = GB_KU[k];
    for (let t = 0; t < TEN_MAX; t++) {
      const c = row[t];
      if (c === '\u0000') continue;
      const slot = k * TEN_MAX + t;
      decode[slot] = c;
      encode.set(c, slot);
    }
  }

  const ja = Array.from(DONOR_JA);
  if (ja.length !== DONOR_SLOT.length) {
    throw new Error(`nameCodec: DONOR_JA (${ja.length}) と DONOR_SLOT (${DONOR_SLOT.length}) の数が違う`);
  }
  for (let i = 0; i < ja.length; i++) {
    const slot = DONOR_SLOT[i];
    const chinese = decode[slot];
    donorChinese.add(chinese);
    encode.delete(chinese);
    decode[slot] = ja[i];
    encode.set(ja[i], slot);
  }

  for (const [cp, slot] of ALIASES) {
    encode.set(String.fromCodePoint(cp), slot);
  }

  tables = { decode, encode, donorChinese };
  return tables;
}

/** 1文字の符号化。符号化できなければ { reason } を返す */
function encodeChar(ch: string, t: Tables): { bytes: number[] } | { reason: NameCodecErrorReason } {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x20 && cp <= 0x7e) return { bytes: [cp] };
  const slot = t.encode.get(ch);
  if (slot !== undefined) {
    const ku = Math.floor(slot / TEN_MAX) + 1;
    const ten = (slot % TEN_MAX) + 1;
    return { bytes: [0xa0 + ku, 0xa0 + ten] };
  }
  if (t.donorChinese.has(ch)) return { reason: 'donorSlot' };
  return { reason: 'unencodable' };
}

/**
 * 名前を無線機のバイト列にする。
 * @param name 名前
 * @param maxBytes 書けるバイト数（終端は含めない。終端は呼び出し元が置く）
 */
export function encodeNameJa(name: string, maxBytes: number): EncodeNameResult {
  const t = getTables();
  const out: number[] = [];
  const errors: NameCodecError[] = [];
  let truncated = false;
  let index = 0;

  for (const ch of name) {
    const r = encodeChar(ch, t);
    if ('reason' in r) {
      errors.push({ index, char: ch, reason: r.reason });
    } else if (!truncated) {
      if (out.length + r.bytes.length <= maxBytes) {
        out.push(...r.bytes);
      } else {
        truncated = true;
      }
    }
    index++;
  }

  return { bytes: Uint8Array.from(out), errors, truncated };
}

/** 名前を書いたときのバイト数。符号化できない字があれば null */
export function byteLengthJa(name: string): number | null {
  const t = getTables();
  let n = 0;
  for (const ch of name) {
    const r = encodeChar(ch, t);
    if ('reason' in r) return null;
    n += r.bytes.length;
  }
  return n;
}

/**
 * バイト列の中の 0x80 以上のバイトが、すべて GB2312 の区点表にある2バイト（供出区点を含む）の
 * 一部になっているか。0x80 以上のバイトが1つも無ければ false。
 * CSV の文字コード判定用（GB2312＋供出区点で書かれた CPS 用の CSV を見分ける）。
 */
export function isGb2312KutenOnly(bytes: Uint8Array): boolean {
  const t = getTables();
  let seen = false;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    if (b < 0xa1 || b > 0xa0 + KU_MAX || i + 1 >= bytes.length) return false;
    const b2 = bytes[i + 1];
    if (b2 < 0xa1 || b2 > 0xfe) return false;
    if (!t.decode[(b - 0xa1) * TEN_MAX + (b2 - 0xa1)]) return false;
    seen = true;
    i += 2;
  }
  return seen;
}

const cp1252 = new TextDecoder('windows-1252');

/** 無線機のバイト列を名前にする。終端の処理は呼び出し元が行う */
export function decodeNameJa(bytes: Uint8Array): string {
  const t = getTables();
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      s += String.fromCharCode(b);
      i++;
      continue;
    }
    if (b >= 0xa1 && b <= 0xa0 + KU_MAX && i + 1 < bytes.length) {
      const b2 = bytes[i + 1];
      if (b2 >= 0xa1 && b2 <= 0xfe) {
        const c = t.decode[(b - 0xa1) * TEN_MAX + (b2 - 0xa1)];
        if (c) {
          s += c;
          i += 2;
          continue;
        }
      }
    }
    if (b >= 0x81 && b <= 0xfe && i + 1 < bytes.length) {
      const b2 = bytes[i + 1];
      if (b2 >= 0x40 && b2 <= 0xfe && b2 !== 0x7f) {
        const c = GBK_EXT[b - 0x81][b2 - 0x40];
        if (c !== '\u0000') {
          s += c;
          i += 2;
          continue;
        }
      }
    }
    s += cp1252.decode(bytes.subarray(i, i + 1));
    i++;
  }
  return s;
}
