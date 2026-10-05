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
export function tr(en: string, ...args: Array<string | number>): string {
  const s = (isJaUi() && JA_DICT[en]) || en;
  return args.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? '')) : s;
}
