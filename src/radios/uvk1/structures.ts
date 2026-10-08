/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UV-K1 channel slots.
 *
 * A channel is spread over three areas (EEPROM command addresses):
 *   0x0000 + 16*n  the 16-byte record — same layout as the UV-K5 F4HWN record
 *                  (SETTINGS_SaveChannel writes the same bytes), so it is decoded
 *                  by ../uvk5/structures.ts
 *   0x4000 + 16*n  the name: UTF-8, at most 15 bytes, rest 0
 *   0x8000 + 2*n   the attribute, 16 bits little endian:
 *                    bits 2-0  band (7 = slot unused)
 *                    bits 4-3  compander
 *                    bit  7    excluded from scanning
 *                    bits 15-8 scan list (0 none, 1-24 that list, 25 all lists)
 *
 * The radio itself decides whether a slot is in use from the band bits
 * (RADIO_CheckValidChannel: band > BAND7_470MHz means invalid), and a deleted
 * channel gets band 7 (SETTINGS_UpdateChannel). This driver follows the same
 * rule, and also treats a record with no receive frequency as unused.
 */
import type { Channel, PowerLevel } from '../../models';
import { parseChannel as parseK5Record, isEmptyChannelRecord } from '../uvk5/structures';
import { UVK1_BAND_EMPTY, UVK1_CHANNEL_SIZE, UVK1_MAX_NAME_BYTES, UVK1_SCAN_LISTS } from './constants';

/**
 * Byte 12 of a record that was never set is 0xFF. The firmware reads that as: no reverse,
 * wide, Low1, no BCLO, TX locked (RADIO_ConfigureChannel). JA: 未設定のレコードの扱い。
 */
const UNSET_BYTE = 0xff;

/** Power as the channel record stores it (byte 12 bits 4-2): 1-5 Low1-Low5, 6 Medium, 7 High; anything else the radio reads as Low1. A record whose byte 12 is 0xFF reads as Low1. */
export function decodeUvk1Power(record: Uint8Array): PowerLevel {
  if (record[12] === UNSET_BYTE) return 'Low1';
  const bits = (record[12] >> 2) & 0x07;
  if (bits === 7) return 'High';
  if (bits === 6) return 'Medium';
  return (bits >= 1 && bits <= 5 ? `Low${bits}` : 'Low1') as PowerLevel;
}

/** Put Low1-Low5 into a record's power bits. Other levels are already encoded by the shared K5 record writer. */
export function applyUvk1Power(record: Uint8Array, power: PowerLevel, previousRecord?: Uint8Array): void {
  // A channel whose power did not change keeps its bits as they are (a stored 0 reads as Low1 and stays 0).
  if (previousRecord && decodeUvk1Power(previousRecord) === power) return;
  const m = /^Low([1-5])$/.exec(power);
  if (m) record[12] = (record[12] & ~(0x07 << 2)) | (Number(m[1]) << 2);
}

/** FW default step (12.5 kHz) for a channel the app creates. */
export const UVK1_DEFAULT_STEP = 4;
/** Step numbers 0-23 are valid on 25Ja (gStepFrequencyTable has 24 entries); 24 and above the firmware reads as 12.5 kHz. */
export const UVK1_MAX_STEP = 23;

/** The record fields beyond the shared K5 record that the app edits, as the firmware reads them. */
export interface UVK1RecordFields {
  modulation: number;
  step: number;
  reverse: boolean;
  bclo: boolean;
  dtmfDecode: boolean;
  pttId: number;
}

/** Decode the record fields the way RADIO_ConfigureChannel does (0xFF bytes mean "none"; out of range falls back). */
export function decodeUvk1RecordFields(record: Uint8Array): UVK1RecordFields {
  const mod = (record[11] >> 4) & 0x0f;
  const unset12 = record[12] === UNSET_BYTE;
  const unset13 = record[13] === UNSET_BYTE;
  const ptt = unset13 ? 0 : (record[13] >> 1) & 0x07;
  return {
    modulation: mod <= 2 ? mod : 0,
    step: record[14] <= UVK1_MAX_STEP ? record[14] : UVK1_DEFAULT_STEP,
    reverse: !unset12 && (record[12] & 0x01) === 1,
    bclo: !unset12 && ((record[12] >> 5) & 0x01) === 1,
    dtmfDecode: !unset13 && (record[13] & 0x01) === 1,
    pttId: ptt <= 4 ? ptt : 0,
  };
}

/** True when two byte-12 values mean the same to the firmware (reverse, BCLO, bandwidth, TX lock, power). */
function sameFlags(a: number, b: number): boolean {
  const view = (v: number) => {
    const r = new Uint8Array(16);
    r[12] = v;
    return v === UNSET_BYTE
      ? `0|0|0|1|${decodeUvk1Power(r)}`
      : `${v & 1}|${(v >> 5) & 1}|${(v >> 1) & 1}|${(v >> 6) & 1}|${decodeUvk1Power(r)}`;
  };
  return view(a) === view(b);
}

/**
 * The previous record as the shared K5 writer should see it. A byte 12 of 0xFF (never set) is replaced by what the
 * firmware reads from it (TX locked, everything else off), so the writer does not carry its 1-bits over as
 * reverse / BCLO / power Low5. JA: 未設定（0xFF）のレコードを、FW が読む意味の値に直してから共有の書込処理へ渡す。
 */
export function previousForEncode(record: Uint8Array): Uint8Array {
  if (record[12] !== UNSET_BYTE) return record;
  const copy = new Uint8Array(record);
  copy[12] = 0x40;
  return copy;
}

/**
 * Apply the app's UV-K1 record fields to `record` (already built by the shared K5 writer from `previous`).
 * A field the channel does not carry (undefined) or that equals what the radio already has is left as it is;
 * a new channel (no previous) starts at the firmware defaults (FM, 12.5 kHz, no flags).
 * JA: 値が変わらない項目は触らない。新規チャンネルは FW の既定値（FM・12.5k）。
 */
export function applyUvk1RecordFields(record: Uint8Array, channel: Channel, previous?: Uint8Array): void {
  const had = previous && previous.length === UVK1_CHANNEL_SIZE ? previous : undefined;
  const base = decodeUvk1RecordFields(had ?? (() => { const r = new Uint8Array(UVK1_CHANNEL_SIZE); r[14] = UVK1_DEFAULT_STEP; return r; })());
  if (!had) record[14] = UVK1_DEFAULT_STEP;

  const m = channel.uvk1Modulation;
  if (m !== undefined && Number.isInteger(m) && m >= 0 && m <= 2 && m !== base.modulation) {
    record[11] = (record[11] & 0x0f) | (m << 4);
  }
  const st = channel.uvk1Step;
  if (st !== undefined && Number.isInteger(st) && st >= 0 && st <= UVK1_MAX_STEP && st !== base.step) {
    record[14] = st;
  }
  if (channel.uvk1Reverse !== undefined && channel.uvk1Reverse !== base.reverse) {
    record[12] = channel.uvk1Reverse ? record[12] | 0x01 : record[12] & ~0x01;
  }
  if (channel.uvk1Bclo !== undefined && channel.uvk1Bclo !== base.bclo) {
    record[12] = channel.uvk1Bclo ? record[12] | 0x20 : record[12] & ~0x20;
  }
  const dtmf = channel.uvk1DtmfDecode;
  const ptt = channel.uvk1PttId;
  const dtmfChanged = dtmf !== undefined && dtmf !== base.dtmfDecode;
  const pttChanged = ptt !== undefined && Number.isInteger(ptt) && ptt >= 0 && ptt <= 4 && ptt !== base.pttId;
  if (dtmfChanged || pttChanged) {
    let b = had ? had[13] : 0;
    if (b === UNSET_BYTE) b = 0;
    if (dtmfChanged) b = dtmf ? b | 0x01 : b & ~0x01;
    if (pttChanged) b = (b & ~0x0e) | ((ptt as number) << 1);
    record[13] = b;
  }

  // Nothing the firmware reads from an unset (0xFF) byte 12 changed: leave it as the radio had it.
  if (had && had[12] === UNSET_BYTE && sameFlags(record[12], UNSET_BYTE)) record[12] = UNSET_BYTE;
}

export interface UVK1Attribute {
  band: number;
  compander: number;
  exclude: boolean;
  /** 0 none, 1-24 one list, 25 all lists */
  scanList: number;
  raw: number;
}

export function decodeAttribute(lo: number, hi: number): UVK1Attribute {
  const raw = (lo | (hi << 8)) & 0xffff;
  return {
    band: raw & 0x07,
    compander: (raw >> 3) & 0x03,
    exclude: ((raw >> 7) & 0x01) === 1,
    scanList: (raw >> 8) & 0xff,
    raw,
  };
}

/** True when the radio treats the slot as unused. */
export function isUnusedAttribute(attr: UVK1Attribute): boolean {
  return attr.band >= UVK1_BAND_EMPTY;
}

/** Scan list label for display: '', '1'-'24', 'ALL', or '?' for a value the radio does not use. */
export function scanListLabel(scanList: number): string {
  if (scanList === 0) return '';
  if (scanList <= UVK1_SCAN_LISTS) return String(scanList);
  if (scanList === UVK1_SCAN_LISTS + 1) return 'ALL';
  return '?';
}

/**
 * Name of a channel, read the way the radio reads it (SETTINGS_FetchChannelName
 * with the 25ja lead-byte range 0xE3-0xEF): stop at 0x00 or 0xFF; a byte
 * 0xE3-0xEF starts a 3-byte character; any other byte outside 0x20-0x7F ends
 * the name. Trailing spaces are dropped. With long names pass the 32 bytes of
 * both slots and maxBytes 31.
 */
export function decodeChannelName(nameField: Uint8Array, maxBytes: number = UVK1_MAX_NAME_BYTES): string {
  const limit = Math.min(nameField.length, maxBytes);
  let end = 0;
  while (end < limit) {
    const c = nameField[end];
    if (c === 0x00 || c === 0xff) break;
    if (c >= 0xe3 && c <= 0xef) {
      if (end + 3 > limit) break;
      end += 3;
      continue;
    }
    if (c < 0x20 || c > 0x7f) break;
    end += 1;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(nameField.subarray(0, end));
  return text.replace(/\u007f/g, '').replace(/ +$/, '');
}

export interface ParseChannelInput {
  number: number;
  record: Uint8Array;
  attrLo: number;
  attrHi: number;
  /** The 16-byte name slot, or 32 bytes (slot + second slot) for long names */
  nameField: Uint8Array;
  /** 15, or 31 with long names */
  maxNameBytes?: number;
}

function uvk1FieldsOf(record: Uint8Array, compander: number) {
  const f = decodeUvk1RecordFields(record);
  return {
    uvk1Modulation: f.modulation,
    uvk1Step: f.step,
    uvk1Reverse: f.reverse,
    uvk1Bclo: f.bclo,
    uvk1DtmfDecode: f.dtmfDecode,
    uvk1PttId: f.pttId,
    uvk1Compander: compander,
  };
}

/** Turn one slot into a Channel, or null when the slot is unused. */
export function parseChannel({ number, record, attrLo, attrHi, nameField, maxNameBytes }: ParseChannelInput): Channel | null {
  const attr = decodeAttribute(attrLo, attrHi);
  if (isUnusedAttribute(attr)) return null;
  if (record.length < UVK1_CHANNEL_SIZE || isEmptyChannelRecord(record)) return null;

  // The record itself is the UV-K5 F4HWN record. Its attribute argument only
  // feeds scanAdd, which is set below from the UV-K1 attribute instead.
  const base = parseK5Record({ number, record, attribute: 0, nameField: new Uint8Array(16) });
  if (!base) return null;

  return {
    ...base,
    name: decodeChannelName(nameField, maxNameBytes ?? UVK1_MAX_NAME_BYTES),
    scanAdd: attr.scanList !== 0 && !attr.exclude,
    power: decodeUvk1Power(record),
    // 0xFF の byte 12 は FW では「ワイド・TX 禁止あり」。共有のK5レコード読みは bit をそのまま読むので合わせる
    ...(record[12] === 0xff ? { bandwidth: '25kHz' as const, forbidTx: true } : {}),
    ...uvk1FieldsOf(record, attr.compander),
    scanListId: attr.scanList,
    scanExcluded: attr.exclude && attr.scanList !== 0,
  };
}
