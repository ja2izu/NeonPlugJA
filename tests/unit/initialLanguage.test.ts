/*
 * NeonPlugJA — 最初の表示言語（保存された選択 > ブラウザの言語）
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { initialLanguage } from '../../src/store/uiLanguageStore';

function setup(saved: string | null, language: string, languages: string[] = [language]) {
  vi.stubGlobal('localStorage', { getItem: () => saved, setItem: () => undefined });
  vi.stubGlobal('navigator', { language, languages });
}
afterEach(() => vi.unstubAllGlobals());

describe('initialLanguage', () => {
  it('保存なし：ja / ja-JP は日本語、それ以外は英語', () => {
    setup(null, 'ja-JP'); expect(initialLanguage()).toBe('ja');
    setup(null, 'ja'); expect(initialLanguage()).toBe('ja');
    setup(null, 'en-US'); expect(initialLanguage()).toBe('en');
    setup(null, 'fr-FR'); expect(initialLanguage()).toBe('en');
  });
  it('保存あり：ブラウザの言語より優先（ja ブラウザで EN を選んだら EN）', () => {
    setup('en', 'ja-JP'); expect(initialLanguage()).toBe('en');
    setup('ja', 'en-US'); expect(initialLanguage()).toBe('ja');
  });
  it('保存が不正：ブラウザの言語に従う', () => {
    setup('xx', 'ja-JP'); expect(initialLanguage()).toBe('ja');
  });
});
