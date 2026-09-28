/*
 * NeonPlugJA Ver.0.91 — UV-K1 の CSV 書き出しは常に BOM 付き
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { csvExportNeedsBom } from '../../src/services/csv/csvExporter';
import { useRadioStore } from '../../src/store/radioStore';

const setModel = (m: string | null) => useRadioStore.setState({ selectedRadioModel: m } as never);

describe('CSV 書き出しの BOM', () => {
  afterEach(() => setModel(null));
  it('UV-K1 は日本語名スイッチに関係なく BOM を付ける', () => {
    setModel('UV-K1');
    expect(csvExportNeedsBom()).toBe(true);
  });
  it('UV-K5 は付けない（従来どおり）', () => {
    setModel('UV-K5');
    expect(csvExportNeedsBom()).toBe(false);
  });
});
