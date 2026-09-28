/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * CSV ファイルを文字列にする。
 *
 * 日本語名 OFF: file.text()（UTF-8。上流どおり）
 * 日本語名 ON : 次の順に判定する
 *   1. UTF-8 として正しければ UTF-8（先頭の BOM は除く）
 *   2. 0x80 以上のバイトがすべて GB2312 の区点表の2バイトなら、GB2312＋供出区点（CPS 用の CSV）
 *      として読み、供出区点は日本語に戻す
 *   3. それ以外は CP932（Shift_JIS）
 *   Excel の「CSV (コンマ区切り)」は CP932、「CSV UTF-8」は BOM 付き UTF-8 で保存される。
 *   既知の限界: 半角カナや第1バイト 0xE0-0xEA の漢字だけで書かれた短い CP932 の CSV は、
 *   2 で GB2312 と判定され得る（ひらがな・多くの漢字を含めば CP932 と判定される）。
 */
import { decodeNameJa, isGb2312KutenOnly } from '../radios/dm32uv/nameCodec';

export async function readCsvText(file: File, japanese: boolean): Promise<string> {
  if (!japanese) return file.text();
  return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
}

export type CsvEncoding = 'utf-8' | 'gb2312' | 'cp932';

/** 文字コードを判定して読む（判定の順は readCsvText の説明のとおり） */
export function decodeCsvBytesWithEncoding(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // UTF-8 ではない
  }
  if (isGb2312KutenOnly(bytes)) {
    return { text: decodeNameJa(bytes), encoding: 'gb2312' };
  }
  // WHATWG の shift_jis は CP932 相当（NEC 特殊文字・IBM 拡張を含む）
  return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'cp932' };
}

/** 文字コードを判定して読む */
export function decodeCsvBytes(bytes: Uint8Array): string {
  return decodeCsvBytesWithEncoding(bytes).text;
}
