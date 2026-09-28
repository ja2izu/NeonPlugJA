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
import type { Channel } from '../../models';
import { parseChannel as parseK5Record, isEmptyChannelRecord } from '../uvk5/structures';
import { UVK1_BAND_EMPTY, UVK1_CHANNEL_SIZE, UVK1_MAX_NAME_BYTES, UVK1_SCAN_LISTS } from './constants';

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
  };
}
