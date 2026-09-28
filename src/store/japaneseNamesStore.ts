/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { create } from 'zustand';

/**
 * 日本語名スイッチ（About）。日本語化した字庫（master_1990）を焼いた DM-32 向け。
 * ON のあいだ、名前を GB2312 と供出区点で読み書きする（src/radios/dm32uv/nameCodec.ts）。
 * OFF のときは上流と同じ読み書きをする。
 * 切り替えたら、読み込み済みの名前の解釈が変わるので無線機から読み直すこと。
 */
interface JapaneseNamesState {
  japaneseNames: boolean;
  setJapaneseNames: (on: boolean) => void;
}

const STORAGE_KEY = 'neonplug-japanese-names';

const load = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const useJapaneseNamesStore = create<JapaneseNamesState>((set) => ({
  japaneseNames: load(),
  setJapaneseNames: (on) => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'true' : 'false');
    } catch {
      // Blocked storage: the switch still applies until the page closes.
    }
    set({ japaneseNames: on });
  },
}));
