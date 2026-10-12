/*
 * NeonPlugJA — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { GB_KU, DONOR_JA, DONOR_SLOT } from '../../src/radios/dm32uv/nameCodecTables';

/**
 * 旧 master（かな・記号を GB2312 の区点のまま書く版）で書かれたバイト列を、
 * 新 master（かな・記号・全角英数 332 字を漢字域の空きの区点へ移した版）のバイト列にする。
 * 表の GB2312 の字が置換表（DONOR_JA）にあれば、その字は移した字。
 */
const slotOf = new Map<string, number>();
Array.from(DONOR_JA).forEach((c, i) => slotOf.set(c, DONOR_SLOT[i]));

const hex2 = (b: ArrayLike<number>) => Array.from(b as number[], (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');

export function migrate(h: string | null): string | null {
  if (h === null) return null;
  const b = Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  let out = '';
  let i = 0;
  while (i < b.length) {
    if (b[i] >= 0xa1 && i + 1 < b.length) {
      const k = b[i] - 0xa1;
      const t = b[i + 1] - 0xa1;
      const c = Array.from(GB_KU[k] ?? '')[t];
      const to = c && c !== '\u0000' ? slotOf.get(c) : undefined;
      out += to !== undefined ? hex2([0xa1 + Math.floor(to / 94), 0xa1 + (to % 94)]) : hex2([b[i], b[i + 1]]);
      i += 2;
    } else {
      out += hex2([b[i]]);
      i++;
    }
  }
  return out;
}
