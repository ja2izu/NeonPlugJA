/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nameByteLength, fitNameBytes, unwritableChars, isJapaneseNamesActive, JA_NAME_BYTES } from '../../src/utils/japaneseNames';
import { decodeCsvBytes, readCsvText } from '../../src/utils/readCsvText';
import { findUnwritableNames, findUnwritableContactNames } from '../../src/services/validation/japaneseNameCheck';
import { channelProblems } from '../../src/services/validation/channelProblems';
import { validateChannel } from '../../src/services/validation/channelValidator';
import { useJapaneseNamesStore } from '../../src/store/japaneseNamesStore';
import { useRadioStore } from '../../src/store/radioStore';
import { useZonesStore } from '../../src/store/zonesStore';
import { useScanListsStore } from '../../src/store/scanListsStore';
import { useQuickContactsStore } from '../../src/store/quickContactsStore';
import { createDefaultChannel } from '../../src/utils/channelHelpers';
import type { QuickContact } from '../../src/models';

const setOn = (on: boolean) => useJapaneseNamesStore.getState().setJapaneseNames(on);
const setModel = (m: string | null) => useRadioStore.setState({ selectedRadioModel: m });

describe('バイト数の数え方と切り詰め', () => {
  it('英数字 1、それ以外（書けない字を含む）2', () => {
    expect(nameByteLength('')).toBe(0);
    expect(nameByteLength('ABC')).toBe(3);
    expect(nameByteLength('東京AIR')).toBe(7);
    expect(nameByteLength('名張豊中宝塚槇原')).toBe(16);
    expect(nameByteLength('😀')).toBe(2);
    expect(nameByteLength('a\tb')).toBe(4);
  });

  it('上限で切り、2 バイト文字の途中では切らない', () => {
    expect(fitNameBytes('名張豊中宝塚槇原X', 16)).toBe('名張豊中宝塚槇原');
    expect(fitNameBytes('A名張豊中宝塚槇原', 16)).toBe('A名張豊中宝塚槇');
    expect(fitNameBytes('ABCDEFGHIJKLMNOPQ', 16)).toBe('ABCDEFGHIJKLMNOP');
    expect(fitNameBytes('東京', 3)).toBe('東');
    expect(fitNameBytes('', 16)).toBe('');
  });

  it('書けない字を重複なしで出てきた順に返す', () => {
    expect(unwritableChars('東京')).toEqual([]);
    expect(unwritableChars('マ丒丒😀丒')).toEqual(['丒', '😀']);
  });

  it('上限は書き（structures.ts）と同じ値', () => {
    expect(JA_NAME_BYTES).toEqual({
      channel: 16, zone: 16, scanList: 11, contact: 15, talkGroup: 16,
      rxGroup: 10, radioId: 11, digitalEmergency: 10, encryptionKey: 10, analogEmergency: 16,
    });
  });
});

describe('isJapaneseNamesActive', () => {
  afterEach(() => { setOn(false); setModel(null); });

  it('スイッチ ON かつ DM-32 のときだけ true', () => {
    setModel('DP570UV');
    expect(isJapaneseNamesActive()).toBe(false);
    setOn(true);
    expect(isJapaneseNamesActive()).toBe(true);
    setModel('DM-32UV');
    expect(isJapaneseNamesActive()).toBe(true);
    setModel('UV-5R Mini');
    expect(isJapaneseNamesActive()).toBe(false);
    setModel(null);
    expect(isJapaneseNamesActive()).toBe(false);
  });
});

describe('CSV の文字コード判定', () => {
  const cp932 = Uint8Array.of(
    0x93, 0x8c, 0x8b, 0x9e, // 東京
    0x81, 0x5b,             // ー
    0xea, 0xa0,             // 槇
    0x82, 0xf1,             // ん
    0x87, 0x40,             // ①（NEC 特殊文字）
  );

  it('UTF-8（BOM あり・なし）はそのまま、BOM は除く', () => {
    const utf8 = new TextEncoder().encode('Name,東京ー槇ん');
    expect(decodeCsvBytes(utf8)).toBe('Name,東京ー槇ん');
    expect(decodeCsvBytes(Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8))).toBe('Name,東京ー槇ん');
  });

  it('UTF-8 として不正なら CP932 として読む', () => {
    expect(decodeCsvBytes(cp932)).toBe('東京ー槇ん①');
  });

  it('英数字だけのファイルはどちらでも同じ', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('a,b\r\n1,2'))).toBe('a,b\r\n1,2');
  });

  it('OFF のときは file.text()（上流どおり UTF-8 固定）', async () => {
    const f = new File([cp932], 'x.csv');
    expect(await readCsvText(f, false)).toBe(await f.text());
    expect(await readCsvText(f, true)).toBe('東京ー槇ん①');
  });
});

describe('書込前の検査', () => {
  it('書けない字を含む名前だけを、どのレコードか付きで返す', () => {
    const tg = (index: number, name: string): QuickContact => ({
      index, offset: 0, name, contactNumber: 44000 + index, callType: 4, hasHeader: false, flag: 0, rawData: new Uint8Array(0),
    });
    const r = findUnwritableNames({
      channels: [
        createDefaultChannel({ number: 1, name: '東京', rxFrequency: 438.5, txFrequency: 438.5 }),
        createDefaultChannel({ number: 12, name: 'マ丒丒1d', rxFrequency: 438.5, txFrequency: 438.5 }),
      ],
      zones: [{ id: 'a', name: '関西', channels: [] }, { id: 'b', name: 'Z😀', channels: [] }],
      scanLists: [],
      talkGroups: [tg(1, 'TG1'), tg(2, 'Straße')],
      rxGroups: [],
      radioIds: [],
      digitalEmergencies: [],
      analogEmergencies: [],
      encryptionKeys: [],
    });
    expect(r).toEqual([
      { what: 'チャンネル 12', name: 'マ丒丒1d', chars: ['丒'] },
      { what: 'ゾーン 2', name: 'Z😀', chars: ['😀'] },
      { what: 'トークグループ 2', name: 'Straße', chars: ['ß'] },
    ]);
  });
});

describe('連絡先の書込前の検査', () => {
  it('名前・都市・州・国・備考を見る。コールサインは見ない', () => {
    const c = (over: Partial<import('../../src/models').Contact>) => ({
      id: 1, name: '東京太郎', dmrId: 4401234, callSign: 'JA2IZU', city: '名張市',
      province: '三重県', country: '日本', remark: '', ...over,
    } as import('../../src/models').Contact);
    expect(findUnwritableContactNames([c({})])).toEqual([]);
    expect(findUnwritableContactNames([c({ name: 'マ丒', city: 'Straße', remark: '😀' })])).toEqual([
      { what: '連絡先 4401234 の名前', name: 'マ丒', chars: ['丒'] },
      { what: '連絡先 4401234 の都市', name: 'Straße', chars: ['ß'] },
      { what: '連絡先 4401234 の備考', name: '😀', chars: ['😀'] },
    ]);
  });
});

describe('チャンネル名の検証（ON はバイト数・書けない字も問題）', () => {
  const rule = { maxNameLength: 16, nameBytes: true } as Parameters<typeof channelProblems>[1];
  const ch = (name: string) => createDefaultChannel({ number: 1, name, rxFrequency: 438.5, txFrequency: 438.5 });

  it('channelProblems', () => {
    expect(channelProblems(ch('名張豊中宝塚槇原'), rule).name).toBeUndefined();
    expect(channelProblems(ch('名張豊中宝塚槇原X'), rule).name).toMatch(/16 バイト/);
    expect(channelProblems(ch('マ丒'), rule).name).toMatch(/丒/);
    // OFF は上流どおり文字数
    expect(channelProblems(ch('名張豊中宝塚槇原X'), { ...rule, nameBytes: false }).name).toBeUndefined();
  });

  it('validateChannel', () => {
    const names = (n: string, nameBytes: boolean) =>
      validateChannel(ch(n), null, 4000, { maxNameLength: 16, nameBytes }).filter((e) => e.field === 'name').length;
    expect(names('名張豊中宝塚槇原', true)).toBe(0);
    expect(names('名張豊中宝塚槇原X', true)).toBe(1);
    expect(names('名張豊中宝塚槇原X', false)).toBe(0);
  });
});

describe('ストアの名前の検証（ON はバイト数）', () => {
  beforeEach(() => { setModel('DP570UV'); });
  afterEach(() => { setOn(false); setModel(null); });

  it('ゾーン名: ON 16 バイト、OFF 10 文字（上流どおり）', () => {
    useZonesStore.setState({ zones: [{ id: 'z1', name: 'A', channels: [] }] });
    const rename = (n: string) => useZonesStore.getState().renameZone('z1', n);
    setOn(true);
    expect(rename('名張豊中宝塚槇原')).toBe(true);
    expect(rename('名張豊中宝塚槇原X')).toBe(false);
    setOn(false);
    expect(rename('ABCDEFGHIJ')).toBe(true);
    expect(rename('ABCDEFGHIJK')).toBe(false);
  });

  it('スキャンリスト名: ON 11 バイト', () => {
    useScanListsStore.setState({ scanLists: [{ name: 'A', channels: [], ctcScanMode: 0, scanTxMode: 0 }] });
    const rename = (n: string) => useScanListsStore.getState().renameScanList(0, n);
    setOn(true);
    expect(rename('東京神奈川X')).toBe(true);   // 11 バイト
    expect(rename('東京神奈川横')).toBe(false); // 12 バイト
  });

  it('トークグループ名: ON は日本語を残す、OFF は上流どおり英数字以外を除く', () => {
    const tg: QuickContact = { index: 1, offset: 0, name: '東海TG', contactNumber: 44001, callType: 4, hasHeader: false, flag: 0, rawData: new Uint8Array(0) };
    setOn(true);
    useQuickContactsStore.getState().setContacts([tg]);
    expect(useQuickContactsStore.getState().contacts[0].name).toBe('東海TG');
    setOn(false);
    useQuickContactsStore.getState().setContacts([tg]);
    expect(useQuickContactsStore.getState().contacts[0].name).toBe('TG');
  });
});
