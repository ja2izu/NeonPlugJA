/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  encodeChannel, parseChannel,
  encodeZone, parseZones,
  encodeScanList, parseScanLists,
  encodeContactEntry, parseContactEntry,
  encodeRXGroups, parseRXGroups,
  encodeDMRRadioID, parseDMRRadioIDs,
  encodeQuickContactsBlocks, parseQuickContacts,
  encodeDigitalEmergencies, parseDigitalEmergencies,
  encodeEncryptionKey, parseEncryptionKeys,
  encodeAnalogEmergency, parseAnalogEmergencies,
} from '../../src/radios/dm32uv/structures';
import { OFFSET } from '../../src/radios/dm32uv/constants';
import { encodeNameJa } from '../../src/radios/dm32uv/nameCodec';
import { migrate } from '../helpers/nameMigrate';
import { useJapaneseNamesStore } from '../../src/store/japaneseNamesStore';
import { createDefaultChannel } from '../../src/utils/channelHelpers';
import type { Contact, QuickContact, RXGroup, DMRRadioID, DigitalEmergency, AnalogEmergency, EncryptionKey } from '../../src/models';

/**
 * 日本語名スイッチ ON のときの各レコードの読み書き。
 * 名前は必ず `槇` `ー` `東` `関` と語尾の `ん` を含める（CPS 経由で化けた字）。
 */

const setOn = (on: boolean) => useJapaneseNamesStore.getState().setJapaneseNames(on);
const ja = (name: string, max: number) => Array.from(encodeNameJa(name, max).bytes);
const hex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');

const parity: { zoneTest: { ja: string; hex: string }[] } = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/nameCodec/slotmapParity.json'), 'utf8'),
);

describe('日本語名 ON', () => {
  beforeEach(() => setOn(true));
  afterEach(() => setOn(false));

  it('Channel: 16 バイト、16 未満のとき NUL', () => {
    for (const name of ['槇ー東関ん', '名張豊中宝塚槇原', 'JR東海ーん']) {
      const data = encodeChannel(createDefaultChannel({ number: 1, name, rxFrequency: 438.5, txFrequency: 438.5 }));
      const want = ja(name, 16);
      expect(Array.from(data.slice(0, want.length))).toEqual(want);
      if (want.length < 16) expect(data[want.length]).toBe(0);
      expect(parseChannel(data, 1).name).toBe(name);
    }
  });

  it('Channel: 17 バイト以上は2バイト文字の途中で切らない', () => {
    const data = encodeChannel(createDefaultChannel({ number: 1, name: 'A名張豊中宝塚槇原', rxFrequency: 438.5, txFrequency: 438.5 }));
    expect(data[15]).toBe(0);
    expect(parseChannel(data, 1).name).toBe('A名張豊中宝塚槇');
  });

  it('Zone: 実データ 21 件（CPS で書き実機表示を確認済み）と同じバイト列を書き、読み戻せる', () => {
    for (const z of parity.zoneTest) {
      const data = encodeZone({ id: 'z', name: z.ja, channels: [1, 2, 3] }, 1);
      const want = migrate(z.hex)!; // 旧い区点で書いた実データは、書き直すと移し先の区点になる
      const len = want.length / 2;
      expect(hex(data.slice(0, len))).toBe(want);
      if (len < 16) expect(data[len]).toBe(0);
      expect(data[16]).toBe(3);
      const buf = new Uint8Array(4096).fill(0xff);
      buf.set(data, OFFSET.ZONE_START);
      const back = parseZones(buf);
      expect(back[0].name).toBe(z.ja.trim());
      expect(back[0].channels).toEqual([1, 2, 3]);
    }
  });

  it('ScanList: 11 バイト', () => {
    for (const name of ['槇ー東関ん', '東京神奈川']) {
      const data = encodeScanList({ name, channels: [1], ctcScanMode: 0, scanTxMode: 0 }, 1);
      const buf = new Uint8Array(4096).fill(0xff);
      buf.set(data, 1); // list 1 は +0x01（parseScanLists の配置）
      expect(parseScanLists(buf)[0].name).toBe(name);
    }
    // 12 バイトは 11 に収まる 10 バイトで切る
    const data = encodeScanList({ name: '東京神奈川横', channels: [1], ctcScanMode: 0, scanTxMode: 0 }, 1);
    expect(Array.from(data.slice(0, 11))).toEqual([...ja('東京神奈川', 10), 0]);
  });

  it('Contact: 名前と都市・州・国・備考（各 15 バイト＋NUL）', () => {
    const c: Contact = { id: 1, name: '槇ー東関ん', dmrId: 4401234, callSign: 'JA2IZU', city: '名張', province: '三重県', country: '日本', remark: 'ー東関ん' };
    const data = encodeContactEntry(c);
    const back = parseContactEntry(data, 0)!;
    expect([back.name, back.city, back.province, back.country, back.remark, back.callSign])
      .toEqual(['槇ー東関ん', '名張', '三重県', '日本', 'ー東関ん', 'JA2IZU']);
  });

  it('トークグループ: 16 バイト', () => {
    const tg: QuickContact = { index: 1, offset: 0, name: '東海関西ー槇ん', contactNumber: 44001, callType: 0x04, hasHeader: false, flag: 0, rawData: new Uint8Array(0) };
    const [block] = encodeQuickContactsBlocks([tg], [0x44]);
    const back = parseQuickContacts(block.slice(0, OFFSET.METADATA_BYTE)).contacts;
    expect(back[0].name).toBe('東海関西ー槇ん');
    expect(back[0].contactNumber).toBe(44001);
  });

  it('RX グループ: 10 バイト', () => {
    const g: RXGroup = { index: 0, name: '槇ー東関ん', bitmask: 1, statusFlag: 0, entryFlag: 1, validationFlag: 0, talkGroupIndices: [44001] };
    const back = parseRXGroups(encodeRXGroups([g]));
    expect(back[0].name).toBe('槇ー東関ん');
  });

  it('無線機 ID: 11 バイト＋NUL', () => {
    const r: DMRRadioID = { index: 0, dmrId: '4401234', dmrIdValue: 4401234, dmrIdBytes: new Uint8Array(3), name: '東関ー槇ん' };
    const buf = new Uint8Array(4096).fill(0xff);
    buf[0] = 1;
    buf.set(encodeDMRRadioID(r), 0x10);
    expect(parseDMRRadioIDs(buf)[0].name).toBe('東関ー槇ん');
  });

  it('デジタル緊急・暗号鍵: 10 バイト、アナログ緊急: 16 バイト', () => {
    const buf = new Uint8Array(4096);
    const d: DigitalEmergency = { index: 0, name: '東関ー槇ん', alarmType: 0, alarmMode: 0, revertChannel: 1, retransmission: 1, hotMicDuration: 1, emergencyCallsNumber: 10, enabled: true, rxDurationTime: 1, autoEmergencyCallTimer: 10 };
    const withD = encodeDigitalEmergencies([d], {}, buf);
    expect(parseDigitalEmergencies(withD).systems[0].name).toBe('東関ー槇ん');

    const k: EncryptionKey = { entryNumber: 1, id: 1, name: '東関ー槇ん', encryptionType: 1, key: '00112233' };
    encodeEncryptionKey(k, buf);
    expect(parseEncryptionKeys(buf)[0].name).toBe('東関ー槇ん');

    const a: AnalogEmergency = { index: 0, name: '名張豊中宝塚槇原', alarmType: 0, alarmMode: 0, signalling: 0, revertChannel: 1, squelchMode: 0, idType: 0, flags: 1, frequencyId: 0, enabled: true };
    encodeAnalogEmergency(a, 0, buf);
    expect(parseAnalogEmergencies(buf)[0].name).toBe('名張豊中宝塚槇原');
  });

  it('書けない字は落として書く（書込前の検査で止めるのが本来）', () => {
    const data = encodeChannel(createDefaultChannel({ number: 1, name: '東😀京', rxFrequency: 438.5, txFrequency: 438.5 }));
    expect(parseChannel(data, 1).name).toBe('東京');
  });
});

describe('日本語名 OFF', () => {
  beforeEach(() => setOn(false));

  it('Zone 名は 16 バイト（上流の 10 バイトから拡張）。16 バイトちょうどは終端なし', () => {
    const data = encodeZone({ id: 'z', name: 'ABCDEFGHIJKLMNOP', channels: [7] }, 1);
    expect(hex(data.slice(0, 17))).toBe(hex(new TextEncoder().encode('ABCDEFGHIJKLMNOP')) + '01');
    const buf = new Uint8Array(4096).fill(0xff);
    buf.set(data, OFFSET.ZONE_START);
    expect(parseZones(buf)[0].name).toBe('ABCDEFGHIJKLMNOP');
  });

  it('10 バイト以下の Zone 名は上流と同じ（NUL の後は 0xFF）', () => {
    const data = encodeZone({ id: 'z', name: 'SFR U old', channels: [1] }, 1);
    expect(hex(data.slice(0, 17))).toBe('534652205520 6F6C6400FFFFFFFFFFFF01'.replace(/ /g, ''));
  });

  it('日本語名は上流と同じ読み方（windows-1252 の1バイトずつ）', () => {
    const data = encodeChannel(createDefaultChannel({ number: 1, name: 'x', rxFrequency: 438.5, txFrequency: 438.5 }));
    data.set([0xb6, 0xab, 0xbe, 0xa9, 0x00], 0); // 东京 の GB2312
    expect(parseChannel(data, 1).name).toBe('¶«¾©');
  });
});
