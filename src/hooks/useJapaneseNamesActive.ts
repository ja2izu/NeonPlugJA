/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { useRadioCapabilities } from './useRadioCapabilities';
import { useJapaneseNamesStore } from '../store/japaneseNamesStore';

/** 日本語名スイッチが ON で、今の無線機が対応している（DM-32 のみ）とき true */
export function useJapaneseNamesActive(): boolean {
  const { caps } = useRadioCapabilities();
  const on = useJapaneseNamesStore((s) => s.japaneseNames);
  return on && caps?.supportsJapaneseNames === true;
}
