/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * 日本語名スイッチの切替口（DM-32 の structures.ts から使う）
 *
 * OFF のときは上流と同じ読み方（TextDecoder('ascii') ＝ windows-1252）をそのまま返す。
 * 書きは呼び出し元で japaneseNamesOn() を見て分岐し、OFF のときは上流の行をそのまま通す。
 */
import { useJapaneseNamesStore } from '../../store/japaneseNamesStore';
import { encodeNameJa, decodeNameJa } from './nameCodec';
import { log } from '../../utils/protocolLogger';

/** 日本語名スイッチが ON か */
export function japaneseNamesOn(): boolean {
  return useJapaneseNamesStore.getState().japaneseNames;
}

/**
 * 名前のバイト列を読む。終端の処理は呼び出し元が行う。
 * OFF: new TextDecoder('ascii', { fatal: false }).decode(bytes)（上流と同じ）
 * ON : decodeNameJa(bytes)
 */
export function decodeName(bytes: Uint8Array): string {
  return japaneseNamesOn() ? decodeNameJa(bytes) : new TextDecoder('ascii', { fatal: false }).decode(bytes);
}

/**
 * ON のときの書き。maxBytes まで（終端は含めない）。
 * 書けない字は落として警告を残す（warn=false なら残さない）。
 * 通常の書込は書込前の検査（Toolbar）で止める。ここは最後の防御。
 * CSV Contacts の書込は検査しない（海外の名前を大量に含み得る）ので、落として書く。
 */
export function encodeNameForWrite(name: string, maxBytes: number, what: string, warn = true): Uint8Array {
  const r = encodeNameJa(name, maxBytes);
  if (warn && r.errors.length) {
    log.warn(
      `${what} "${name}": 書けない字を落とした: ${r.errors.map((e) => `${e.char}(${e.reason})`).join(' ')}`,
      'Structures',
    );
  }
  return r.bytes;
}
