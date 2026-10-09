/*
 * NeonPlugJA Ver.0.93 — UV-K1 (25Ja) 起動画面のユーザー文言（SPI 0x0089A0、24 バイト）
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 *
 * 書式は 25Ja F/W 担当の申し送り「起動表示ユーザー文言（0x0089A0）」による（実機では未確認）。
 */
import {
  UVK1_BOOT_TEXT_BASE, UVK1_BOOT_TEXT_FULL_PX, UVK1_BOOT_TEXT_HALF_PX, UVK1_BOOT_TEXT_MAX_PX, UVK1_BOOT_TEXT_SIZE,
  type UVK1FontId,
} from './constants';
import { unsupportedCharacters } from './writePlan';
import { decodeChannelName } from './structures';

const encoder = new TextEncoder();

/** 1 文字の送り幅（px）。半角 0x20-0x7E は 7、それ以外（漢字・かな）は 13。 */
function advance(ch: string): number {
  const cp = ch.codePointAt(0)!;
  return cp >= 0x20 && cp <= 0x7e ? UVK1_BOOT_TEXT_HALF_PX : UVK1_BOOT_TEXT_FULL_PX;
}

/** 表示幅（px）= 各文字の送りの合計 − 1。空は 0。 */
export function bootTextWidth(text: string): number {
  const chars = Array.from(text);
  return chars.length === 0 ? 0 : chars.reduce((n, c) => n + advance(c), 0) - 1;
}

/** 保存するバイト数（UTF-8）。 */
export function bootTextBytes(text: string): number {
  return encoder.encode(text).length;
}

/** 24 バイトと 128 px の両方に収まる最長の前半を返す（入力欄の制限用）。 */
export function truncateBootText(text: string): string {
  let out = '';
  for (const ch of Array.from(text)) {
    const next = out + ch;
    if (bootTextBytes(next) > UVK1_BOOT_TEXT_SIZE || bootTextWidth(next) > UVK1_BOOT_TEXT_MAX_PX) break;
    out = next;
  }
  return out;
}

/** 問題を 1 行ずつ。空なら書ける。空文字列（消去）は常に書ける。 */
export function validateBootText(text: string, font: UVK1FontId): string[] {
  const problems: string[] = [];
  const bytes = bootTextBytes(text);
  if (bytes > UVK1_BOOT_TEXT_SIZE) {
    problems.push(`Boot text: ${bytes} bytes, the radio holds ${UVK1_BOOT_TEXT_SIZE} (${Math.floor(UVK1_BOOT_TEXT_SIZE / 3)} kanji / kana, or ${UVK1_BOOT_TEXT_SIZE} ASCII)`);
  }
  const width = bootTextWidth(text);
  if (width > UVK1_BOOT_TEXT_MAX_PX) {
    problems.push(`Boot text: ${width} px wide, the screen shows ${UVK1_BOOT_TEXT_MAX_PX} px (ASCII 7 px, kanji / kana 13 px)`);
  }
  const bad = unsupportedCharacters(text, font);
  if (bad.length > 0) problems.push(`Boot text: not in the 25ja font: ${bad.join(' ')}`);
  return problems;
}

/** 24 バイトの保存形式: UTF-8、残りは 0x00。 */
export function encodeBootText(text: string): Uint8Array {
  const out = new Uint8Array(UVK1_BOOT_TEXT_SIZE);
  out.set(encoder.encode(text).subarray(0, UVK1_BOOT_TEXT_SIZE));
  return out;
}

/** 保存された 24 バイトから文言を読む（FW と同じ規則。先頭が 0x00/0xFF なら空）。 */
export function decodeBootText(bytes: Uint8Array): string {
  return decodeChannelName(bytes.subarray(0, UVK1_BOOT_TEXT_SIZE), UVK1_BOOT_TEXT_SIZE);
}

/**
 * `image`（無線機の読み取りの複製）に文言を入れる。空の文言は、無線機がすでに空（先頭が 0x00 か 0xFF）なら触らない。
 */
export function applyBootText(image: Uint8Array, text: string): void {
  const bytes = encodeBootText(text);
  if (bytes[0] === 0 && (image[UVK1_BOOT_TEXT_BASE] === 0x00 || image[UVK1_BOOT_TEXT_BASE] === 0xff)) return;
  image.set(bytes, UVK1_BOOT_TEXT_BASE);
}

/** 差があるときの SPI 書込（なければ空）。 */
export function planBootTextWrite(current: Uint8Array, target: Uint8Array): { address: number; data: Uint8Array }[] {
  const a = UVK1_BOOT_TEXT_BASE;
  for (let i = 0; i < UVK1_BOOT_TEXT_SIZE; i++) {
    if (current[a + i] !== target[a + i]) return [{ address: a, data: target.slice(a, a + UVK1_BOOT_TEXT_SIZE) }];
  }
  return [];
}
