/*
 * NeonPlugJA — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * 日本語化フォント（master_1990_v2）が無線機に入っているかの判定
 *
 * 無線機の Radio_Y16（16 ドットのフォント）は 0x0C9000 から始まる固定の領域で、1 字 32 バイト。
 * 日本語化フォント v2 では、漢字域の空き区点（区85 点40 = F5C8）に「あ」の字形（JISKAN の 16 ドット）が入る。
 * 純正のフォントや、かなを旧い区点に置いた旧版では、そこは別の字（中国漢字）なので一致しない。
 * その 1 字の 32 バイトを、基準の字形と比べて判定する。目印は使わない。
 *
 * 読むのは、その字を含む 4 KiB（0x102000）の 1 ブロック。
 * 基準の字形は master_1990_v2.csv の「あ」と jiskan16_1990.bdf から作ったもの。
 */

/** Radio_Y16 の先頭アドレス（V 応答 idx 7 の領域。0x0C9000〜0x148FFF） */
export const Y16_START = 0x0c9000;
/** 漢字域の先頭のスロット番号（区1〜9 の 9*94 = 846） */
const Y16_HANZI_BASE_IDX = 846;
/** 判定に使う字（「あ」の移し先） */
export const PROBE_KU = 85;
export const PROBE_TEN = 40;
const GLYPH_BYTES = 32;
const BLOCK_BYTES = 4096;

/** 判定の字のスロット番号と、フォント内のオフセット・無線機のアドレス */
const slot = Y16_HANZI_BASE_IDX + (PROBE_KU - 16) * 94 + (PROBE_TEN - 1);
const glyphOffset = slot * GLYPH_BYTES;
/** 読むブロックのアドレス（4 KiB 境界） */
export const PROBE_BLOCK_ADDRESS = Y16_START + Math.floor(glyphOffset / BLOCK_BYTES) * BLOCK_BYTES;
export const PROBE_BLOCK_LENGTH = BLOCK_BYTES;
/** ブロックの中の字の位置 */
export const PROBE_GLYPH_OFFSET = glyphOffset % BLOCK_BYTES;

/** 基準の字形（JISKAN 16 ドット「あ」を Radio_Y16 の形式にしたもの 32 バイト） */
export const PROBE_GLYPH_HEX = '000084c444fc272424f4246444c00000001e2320201f10080641406020390f00';

const PROBE_GLYPH = Uint8Array.from(PROBE_GLYPH_HEX.match(/../g) ?? [], (h) => parseInt(h, 16));

/** 読んだブロックが、日本語化フォント v2 のものか */
export function isJapaneseFontBlock(block: Uint8Array): boolean {
  if (block.length < PROBE_GLYPH_OFFSET + GLYPH_BYTES) return false;
  for (let i = 0; i < GLYPH_BYTES; i++) {
    if (block[PROBE_GLYPH_OFFSET + i] !== PROBE_GLYPH[i]) return false;
  }
  return true;
}
