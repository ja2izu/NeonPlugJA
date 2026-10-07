/*
 * NeonPlugJA Ver.0.91.2 — 日本語表示スイッチ
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { JA_DICT } from './jaDict';
import { isJaUi } from '../store/uiLanguageStore';

/**
 * 画面の文言。見出し語は英語の原文そのもの。日本語表示のときだけ対応表（jaDict.ts）を引き、
 * 表に無ければ英語のまま。{0} {1} … には args を順に差し込む。
 * 本格的な i18n ではない（上流との差分を小さく保つため、英語の原文をそのまま残す）。
 */
/**
 * UV-K1 (25Ja): 本体のメニューは「スキャングループ」。無線機がそう呼ぶときだけ、日本語の
 * 「スキャンリスト」を「スキャングループ」に読み替える（DM-32UV などは「スキャンリスト」のまま）。
 * 値は App が選択中の無線機の capabilities（scanListTermGroup）から設定する。
 */
let scanTermGroup = false;
export function setScanTermGroup(on: boolean): void {
  scanTermGroup = on;
}
/** 日本語の文言の「スキャンリスト」を、無線機の呼び方に合わせる。 */
export function scanTerm(ja: string): string {
  return scanTermGroup ? ja.replace(/スキャン ?リスト/g, 'スキャングループ') : ja;
}

export function tr(en: string, ...args: Array<string | number>): string {
  const ja = isJaUi() && JA_DICT[en];
  const s = ja ? scanTerm(ja) : en;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : s;
}
