/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * 日本語名スイッチ ON のときの UI 用ヘルパー
 *
 * 長さは文字数ではなくバイト数で数える（英数字 1、それ以外 2）。
 * 書けない字（絵文字など）も 2 と数えて入力欄には残し、書込前の検査で止める。
 */
import type { ChangeEvent, CompositionEvent } from 'react';
import { encodeNameJa } from '../radios/dm32uv/nameCodec';
import { useJapaneseNamesStore } from '../store/japaneseNamesStore';
import { useRadioStore } from '../store/radioStore';
import { getCapabilitiesForModel } from '../radios/capabilities';

/** 日本語名 ON のときの各レコードの名前の上限（バイト、終端を除く）。structures.ts の書きと同じ値 */
export const JA_NAME_BYTES = {
  channel: 16,
  zone: 16,
  scanList: 11,
  contact: 15,
  talkGroup: 16,
  rxGroup: 10,
  radioId: 11,
  digitalEmergency: 10,
  encryptionKey: 10,
  analogEmergency: 16,
} as const;

/** 日本語名スイッチが ON で、選択中の無線機が対応しているか（React の外から使う版） */
export function isJapaneseNamesActive(): boolean {
  if (!useJapaneseNamesStore.getState().japaneseNames) return false;
  const model = useRadioStore.getState().selectedRadioModel ?? '';
  return getCapabilitiesForModel(model)?.supportsJapaneseNames === true;
}

const isAscii = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x20 && c <= 0x7e;
};

/** 名前のバイト数（英数字 1、それ以外 2） */
export function nameByteLength(name: string): number {
  let n = 0;
  for (const ch of name) n += isAscii(ch) ? 1 : 2;
  return n;
}

/**
 * 名前の入力欄用: IME の変換中は切り詰めず、確定したあとに fit で切り詰める。
 *
 * 変換中の文字（未確定のかな・変換候補）まで毎回 fit で切ると、上限の近くでは変換中の文字が
 * 消えて、末尾の字が変換入力できない（貼り付けなら入る）。変換中の値は上限を超えてよい
 * （書込はバイト数で切るので、途中の長い値は無線機に書かれない）。
 * 使い方: <input value={v} {...imeFitHandlers((x) => fitNameBytes(x, 16), setV)} />
 */
let imeComposing = false;
export function imeFitHandlers(
  fit: (v: string) => string,
  apply: (v: string) => void,
): {
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => void;
} {
  return {
    onChange: (e) => {
      // 入力イベント自身の isComposing があればそれを使う（確定せずに閉じても、旗が残らない）。
      // 無いときだけ compositionstart/end の旗を使う。
      const native = (e.nativeEvent as InputEvent).isComposing;
      const composing = typeof native === 'boolean' ? native : imeComposing;
      apply(composing ? e.target.value : fit(e.target.value));
    },
    onCompositionStart: () => {
      imeComposing = true;
    },
    onCompositionEnd: (e) => {
      imeComposing = false;
      apply(fit(e.currentTarget.value));
    },
  };
}

/** maxBytes に収まるように後ろを落とす（2 バイト文字の途中では切らない） */
export function fitNameBytes(name: string, maxBytes: number): string {
  let n = 0;
  let out = '';
  for (const ch of name) {
    const w = isAscii(ch) ? 1 : 2;
    if (n + w > maxBytes) break;
    n += w;
    out += ch;
  }
  return out;
}

/**
 * UV-K1（25Ja）用：名前は UTF-8 で持つ（英数字 1、漢字・かな 3 バイト）。
 * 入力欄では末尾の空白も数える（書込は末尾の空白を落とすので、入力側が同じかやや厳しい）。
 */
const utf8Encoder = new TextEncoder();
export function utf8NameByteLength(name: string): number {
  return utf8Encoder.encode(name).length;
}

/** maxBytes（UTF-8）に収まるように後ろを落とす（文字の途中では切らない） */
export function fitUtf8NameBytes(name: string, maxBytes: number): string {
  let n = 0;
  let out = '';
  for (const ch of name) {
    const w = utf8Encoder.encode(ch).length;
    if (n + w > maxBytes) break;
    n += w;
    out += ch;
  }
  return out;
}

/** 書けない字（重複なし、出てきた順） */
export function unwritableChars(name: string): string[] {
  const seen = new Set<string>();
  for (const e of encodeNameJa(name, Number.MAX_SAFE_INTEGER).errors) seen.add(e.char);
  return Array.from(seen);
}
