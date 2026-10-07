/*
 * NeonPlugJA Ver.0.93 — UV-K1 (25Ja) 起動画面の文言の保持
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { create } from 'zustand';

interface BootTextState {
  /** 読み込んだ無線機が起動文言（25Ja v0.3 以降）に対応している */
  supported: boolean;
  /** 編集中の文言（空は「文言なし」＝本体の既定の表示） */
  text: string;
  /** 読み込み時に無線機が持っていた文言 */
  radioText: string;
  setFromRadio: (text: string) => void;
  setText: (text: string) => void;
  /** 対応しない無線機を読んだとき、または接続し直したとき */
  clear: () => void;
}

export const useBootTextStore = create<BootTextState>((set) => ({
  supported: false,
  text: '',
  radioText: '',
  setFromRadio: (text) => set({ supported: true, text, radioText: text }),
  setText: (text) => set({ text }),
  clear: () => set({ supported: false, text: '', radioText: '' }),
}));
