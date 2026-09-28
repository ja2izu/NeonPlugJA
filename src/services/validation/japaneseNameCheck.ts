/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * 日本語名 ON のときの書込前の検査: 書けない字（字庫に無い字）を含む名前を探す。
 *
 * findUnwritableNames は通常の書込（ツールバーの Write）で送るレコードを見る。
 * CSV Contacts は別の書込なので findUnwritableContactNames で別に見る。
 */
import type {
  Channel, Zone, ScanList, QuickContact, RXGroup, DMRRadioID,
  DigitalEmergency, AnalogEmergency, EncryptionKey, Contact,
} from '../../models';
import { unwritableChars } from '../../utils/japaneseNames';

export interface JapaneseNameCheckInput {
  channels: readonly Channel[];
  zones: readonly Zone[];
  scanLists: readonly ScanList[];
  talkGroups: readonly QuickContact[];
  rxGroups: readonly RXGroup[];
  radioIds: readonly DMRRadioID[];
  digitalEmergencies: readonly DigitalEmergency[];
  analogEmergencies: readonly AnalogEmergency[];
  encryptionKeys: readonly EncryptionKey[];
}

export interface UnwritableName {
  /** 例: 'チャンネル 12' */
  what: string;
  name: string;
  chars: string[];
}

export function findUnwritableNames(input: JapaneseNameCheckInput): UnwritableName[] {
  const out: UnwritableName[] = [];
  const check = (what: string, name: string | undefined) => {
    if (!name) return;
    const chars = unwritableChars(name);
    if (chars.length) out.push({ what, name, chars });
  };
  input.channels.forEach((c) => check(`チャンネル ${c.number}`, c.name));
  input.zones.forEach((z, i) => check(`ゾーン ${i + 1}`, z.name));
  input.scanLists.forEach((s, i) => check(`スキャンリスト ${s.slot ?? i + 1}`, s.name));
  input.talkGroups.forEach((t) => check(`トークグループ ${t.index}`, t.name));
  input.rxGroups.forEach((g) => check(`RX グループ ${g.index + 1}`, g.name));
  input.radioIds.forEach((r) => check(`無線機 ID ${r.index + 1}`, r.name));
  input.digitalEmergencies.forEach((d, i) => check(`デジタル緊急 ${i + 1}`, d.name));
  input.analogEmergencies.forEach((a, i) => check(`アナログ緊急 ${i + 1}`, a.name));
  input.encryptionKeys.forEach((k) => check(`暗号鍵 ${k.entryNumber}`, k.name));
  return out;
}

/**
 * 連絡先（CSV Contacts）の書込前の検査。名前だけでなく、無線機に書く
 * 都市・州・国・備考も見る。コールサインは英数字なので見ない。
 */
export function findUnwritableContactNames(contacts: readonly Contact[]): UnwritableName[] {
  const out: UnwritableName[] = [];
  for (const c of contacts) {
    const where = `連絡先 ${c.dmrId}`;
    for (const [label, value] of [
      ['名前', c.name], ['都市', c.city], ['州', c.province], ['国', c.country], ['備考', c.remark],
    ] as const) {
      if (!value) continue;
      const chars = unwritableChars(value);
      if (chars.length) out.push({ what: `${where} の${label}`, name: value, chars });
    }
  }
  return out;
}
