/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UV-K5 channel records.
 *
 * A channel is spread over three areas of the EEPROM:
 *   0x0000 + 16*n  the record below
 *   0x0D60 + n     one attribute byte (scan lists, compander, band)
 *   0x0F50 + 16*n  the name, 16 bytes, only the first 10 shown by the radio
 *
 * Record layout (16 bytes):
 *   0-3   receive frequency, little endian, in units of 10 Hz
 *   4-7   transmit offset, same units
 *   8     receive tone value
 *   9     transmit tone value
 *   10    high nibble transmit tone type, low nibble receive tone type
 *   11    high nibble modulation, low nibble offset direction
 *   12    bit 6 transmit inhibit, bit 5 busy lockout, bits 4-2 power,
 *         bit 1 bandwidth (1 = narrow), bit 0 reverse
 *   13    bits 3-1 DTMF PTT ID, bit 0 DTMF decode
 *   14    tuning step
 *   15    scrambler
 *
 * Fields this app does not model (modulation, step, scrambler, DTMF, and the
 * compander and band bits of the attribute) are carried over from the record
 * that was read, so writing a channel back leaves them as the radio had them.
 */
import type { Channel, CTCSSDCS, PowerLevel } from '../../models';
import { createDefaultChannel } from '../../utils/channelHelpers';
import { UVK5_CHANNEL_SIZE, UVK5_EMPTY_BYTE, UVK5_MAX_NAME_LENGTH, UVK5_NAME_SIZE } from './constants';

/** CTCSS tones the radio can store, in the order it numbers them. */
export const UVK5_CTCSS_TONES = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4,
  88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9,
  114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2,
  151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8,
  177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5,
  203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8,
  250.3, 254.1,
];

/** DCS codes the radio can store, in the order it numbers them. */
export const UVK5_DCS_CODES = [
  23, 25, 26, 31, 32, 36, 43, 47, 51, 53, 54,
  65, 71, 72, 73, 74, 114, 115, 116, 122, 125, 131,
  132, 134, 143, 145, 152, 155, 156, 162, 165, 172, 174,
  205, 212, 223, 225, 226, 243, 244, 245, 246, 251, 252,
  255, 261, 263, 265, 266, 271, 274, 306, 311, 315, 325,
  331, 332, 343, 346, 351, 356, 364, 365, 371, 411, 412,
  413, 423, 431, 432, 445, 446, 452, 454, 455, 462, 464,
  465, 466, 503, 506, 516, 523, 526, 532, 546, 565, 606,
  612, 624, 627, 631, 632, 654, 662, 664, 703, 712, 723,
  731, 732, 734, 743, 754,
];

const TONE_NONE = 0;
const TONE_CTCSS = 1;
const TONE_DCS = 2;
const TONE_DCS_INVERTED = 3;

const OFFSET_NONE = 0b00;
const OFFSET_PLUS = 0b01;
const OFFSET_MINUS = 0b10;

const POWER_HIGH = 0b111;
const POWER_MEDIUM = 0b110;

/** Hz per unit of the frequency fields. */
const FREQ_UNIT_HZ = 10;

const readU32 = (d: Uint8Array, at: number) =>
  (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;

const writeU32 = (d: Uint8Array, at: number, value: number) => {
  d[at] = value & 0xff;
  d[at + 1] = (value >>> 8) & 0xff;
  d[at + 2] = (value >>> 16) & 0xff;
  d[at + 3] = (value >>> 24) & 0xff;
};

const toMHz = (units: number) => (units * FREQ_UNIT_HZ) / 1_000_000;
const toUnits = (mhz: number) => Math.round((mhz * 1_000_000) / FREQ_UNIT_HZ);

/** True when the slot holds no channel. */
export function isEmptyChannelRecord(record: Uint8Array): boolean {
  const freq = readU32(record, 0);
  return freq === 0 || freq === 0xffffffff;
}

function decodeTone(type: number, value: number): CTCSSDCS {
  if (type === TONE_CTCSS && value < UVK5_CTCSS_TONES.length) {
    return { type: 'CTCSS', value: UVK5_CTCSS_TONES[value] };
  }
  if ((type === TONE_DCS || type === TONE_DCS_INVERTED) && value < UVK5_DCS_CODES.length) {
    return { type: 'DCS', value: UVK5_DCS_CODES[value], polarity: type === TONE_DCS ? 'N' : 'P' };
  }
  return { type: 'None' };
}

function encodeTone(tone: CTCSSDCS | undefined): { type: number; value: number } {
  if (tone?.type === 'CTCSS' && tone.value !== undefined) {
    const i = UVK5_CTCSS_TONES.findIndex((t) => Math.abs(t - tone.value!) < 0.05);
    if (i >= 0) return { type: TONE_CTCSS, value: i };
  }
  if (tone?.type === 'DCS' && tone.value !== undefined) {
    const i = UVK5_DCS_CODES.indexOf(tone.value);
    if (i >= 0) return { type: tone.polarity === 'P' ? TONE_DCS_INVERTED : TONE_DCS, value: i };
  }
  return { type: TONE_NONE, value: 0 };
}

function decodePower(bits: number): PowerLevel {
  if (bits === POWER_HIGH) return 'High';
  if (bits === POWER_MEDIUM) return 'Medium';
  return 'Low';
}

function encodePower(power: PowerLevel, previous: number): number {
  if (power === 'High' || power === 'Turbo') return POWER_HIGH;
  if (power === 'Medium') return POWER_MEDIUM;
  // Low covers the radio's five low steps; keep the one already stored when it is one of them.
  return previous < POWER_MEDIUM ? previous : 0b101;
}

/** Name of a channel, from its 16-byte name field. */
export function decodeChannelName(nameField: Uint8Array): string {
  let out = '';
  for (let i = 0; i < Math.min(nameField.length, UVK5_MAX_NAME_LENGTH); i++) {
    const c = nameField[i];
    if (c === 0 || c === UVK5_EMPTY_BYTE) break;
    out += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ' ';
  }
  return out.trim();
}

/** 16-byte name field for a channel. Unused bytes are 0. */
export function encodeChannelName(name: string): Uint8Array {
  const out = new Uint8Array(UVK5_NAME_SIZE);
  const ascii = Array.from(name).filter((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x20 && c <= 0x7e;
  });
  for (let i = 0; i < Math.min(ascii.length, UVK5_MAX_NAME_LENGTH); i++) {
    out[i] = ascii[i].charCodeAt(0);
  }
  return out;
}

export interface ParseChannelInput {
  number: number;
  record: Uint8Array;
  /** Attribute byte from 0x0D60; 0xFF when the slot has none. */
  attribute: number;
  nameField: Uint8Array;
}

/** Turn the three areas of one slot into a Channel, or null when the slot is empty. */
export function parseChannel({ number, record, attribute, nameField }: ParseChannelInput): Channel | null {
  if (record.length < UVK5_CHANNEL_SIZE || isEmptyChannelRecord(record)) return null;

  const rxUnits = readU32(record, 0);
  const offsetUnits = readU32(record, 4);
  const offsetDir = record[11] & 0x0f;
  const rxFrequency = toMHz(rxUnits);
  const offsetMHz = toMHz(offsetUnits);
  const txFrequency =
    offsetDir === OFFSET_PLUS ? rxFrequency + offsetMHz
      : offsetDir === OFFSET_MINUS ? rxFrequency - offsetMHz
        : rxFrequency;

  const flags = record[12];
  // The scan-list bits are all 1 on a slot the radio has never used.
  const scanBits = attribute === UVK5_EMPTY_BYTE ? 0 : (attribute >> 5) & 0x07;

  const channel = createDefaultChannel({
    number,
    name: decodeChannelName(nameField),
    rxFrequency,
    txFrequency,
  });

  return {
    ...channel,
    bandwidth: (flags >> 1) & 0x01 ? '12.5kHz' : '25kHz',
    power: decodePower((flags >> 2) & 0x07),
    forbidTx: ((flags >> 6) & 0x01) === 1,
    scanAdd: scanBits !== 0,
    rxCtcssDcs: decodeTone(record[10] & 0x0f, record[8]),
    txCtcssDcs: decodeTone((record[10] >> 4) & 0x0f, record[9]),
  };
}

export interface EncodedChannel {
  record: Uint8Array;
  attribute: number;
  nameField: Uint8Array;
}

/**
 * Build the three areas of one slot.
 * @param previous the slot as it was read, so untouched fields survive a write
 */
export function encodeChannel(channel: Channel, previous?: EncodedChannel): EncodedChannel {
  const record = new Uint8Array(UVK5_CHANNEL_SIZE);
  if (previous?.record.length === UVK5_CHANNEL_SIZE) record.set(previous.record);

  const rxUnits = toUnits(channel.rxFrequency);
  const diff = Math.round((channel.txFrequency - channel.rxFrequency) * 1_000_000) / 1_000_000;
  const offsetDir = diff > 0 ? OFFSET_PLUS : diff < 0 ? OFFSET_MINUS : OFFSET_NONE;

  writeU32(record, 0, rxUnits);
  writeU32(record, 4, toUnits(Math.abs(diff)));

  const rx = encodeTone(channel.rxCtcssDcs);
  const tx = encodeTone(channel.txCtcssDcs);
  record[8] = rx.value;
  record[9] = tx.value;
  record[10] = ((tx.type & 0x0f) << 4) | (rx.type & 0x0f);
  record[11] = (record[11] & 0xf0) | offsetDir;

  const previousFlags = previous?.record.length === UVK5_CHANNEL_SIZE ? previous.record[12] : 0;
  const power = encodePower(channel.power, (previousFlags >> 2) & 0x07);
  record[12] =
    (previousFlags & 0b1000_0000) |
    ((channel.forbidTx ? 1 : 0) << 6) |
    (previousFlags & 0b0010_0000) |
    ((power & 0x07) << 2) |
    ((channel.bandwidth === '12.5kHz' ? 1 : 0) << 1) |
    (previousFlags & 0x01);

  const previousAttr = previous && previous.attribute !== UVK5_EMPTY_BYTE ? previous.attribute : 0;
  const scanBits = channel.scanAdd ? ((previousAttr >> 5) & 0x07) || 0b001 : 0;
  const attribute = ((scanBits & 0x07) << 5) | (previousAttr & 0x1f);

  return { record, attribute, nameField: encodeChannelName(channel.name) };
}

/** An empty slot: the radio clears a channel by filling its record with 0xFF. */
export function emptyChannel(): EncodedChannel {
  return {
    record: new Uint8Array(UVK5_CHANNEL_SIZE).fill(UVK5_EMPTY_BYTE),
    attribute: UVK5_EMPTY_BYTE,
    nameField: new Uint8Array(UVK5_NAME_SIZE),
  };
}
