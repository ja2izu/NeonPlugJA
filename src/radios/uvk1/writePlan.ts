/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * What a channel write sends, worked out before anything is sent.
 *
 * 1. validateChannels  every problem in the list, so the user sees all of them
 *                      at once and nothing is written while any remain
 * 2. buildTarget       the image as it should be after the write
 * 3. planWrites        the byte ranges that differ, as SPI writes of at most
 *                      120 bytes, each checked against WRITABLE_RANGES
 *
 * Only three areas are ever written: channel records, channel names and the
 * 1024 channel attributes. Settings, VFOs, scan list names, calibration and
 * the font are outside WRITABLE_RANGES and cannot be reached.
 *
 * A channel that is on the radio but not in the list is deleted the way the
 * radio deletes one (SETTINGS_UpdateChannel with keep = false): its attribute
 * becomes band 7, compander 0, scan list 0 (0x0007). Its record and name are
 * left as they are, as the radio does.
 */
import type { Channel } from '../../models';
import { encodeChannel } from '../uvk5/structures';
import {
  UVK1_ADDR, UVK1_ATTR_SIZE, UVK1_BAND_EMPTY, UVK1_BAND_LOWER_MHZ, UVK1_CHANNEL_SIZE,
  UVK1_FREQ_MAX_MHZ, UVK1_FREQ_MIN_MHZ, UVK1_MAX_CHANNELS, UVK1_MAX_NAME_BYTES,
  UVK1_NAME_SIZE, UVK1_SPI_WRITE_MAX, type UVK1FontId,
} from './constants';
import { decodeAttribute, isUnusedAttribute } from './structures';
import { FONT_25JA_CHARS } from './font25ja';

/** Address ranges a write may touch: [start, end). SPI address = EEPROM address here. */
export const WRITABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [UVK1_ADDR.CHANNELS, UVK1_ADDR.CHANNELS + UVK1_MAX_CHANNELS * UVK1_CHANNEL_SIZE],
  [UVK1_ADDR.CHANNEL_NAMES, UVK1_ADDR.CHANNEL_NAMES + UVK1_MAX_CHANNELS * UVK1_NAME_SIZE],
  [UVK1_ADDR.CHANNEL_ATTR, UVK1_ADDR.CHANNEL_ATTR + UVK1_MAX_CHANNELS * UVK1_ATTR_SIZE],
];

/** Throws unless [address, address + length) lies inside one writable range. */
export function assertWritable(address: number, length: number): void {
  const ok = WRITABLE_RANGES.some(([s, e]) => address >= s && address + length <= e);
  if (!ok || length < 1) {
    throw new Error(`UV-K1: refusing to write 0x${address.toString(16)}+${length}: outside the channel areas`);
  }
}

/** Band index (0 = BAND1 .. 6 = BAND7) the radio uses for this frequency. */
export function bandForFrequency(mhz: number): number {
  for (let b = UVK1_BAND_LOWER_MHZ.length - 1; b >= 0; b--) {
    if (mhz >= UVK1_BAND_LOWER_MHZ[b] - 1e-9) return b;
  }
  return 0;
}

const SECTOR = 0x1000;
const encoder = new TextEncoder();

/** 16-byte name field: UTF-8, rest 0 (as SETTINGS_SaveChannelName writes it). */
export function encodeChannelName(name: string): Uint8Array {
  const out = new Uint8Array(UVK1_NAME_SIZE);
  const bytes = encoder.encode(name.replace(/ +$/, ''));
  out.set(bytes.subarray(0, UVK1_MAX_NAME_BYTES));
  return out;
}

/** Characters of `name` the radio cannot show with this font. */
export function unsupportedCharacters(name: string, font: UVK1FontId): string[] {
  const bad: string[] = [];
  for (const ch of Array.from(name)) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) continue;
    if (font === '25ja' && FONT_25JA_CHARS.has(ch)) continue;
    if (!bad.includes(ch)) bad.push(ch);
  }
  return bad;
}

/** Every problem in the list, as one line each. Empty when the list can be written. */
export function validateChannels(channels: Channel[], font: UVK1FontId): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  if (channels.length === 0) {
    problems.push('No channels to write — this would delete every channel on the radio.');
  }
  for (const ch of channels) {
    const where = `CH ${ch.number}${ch.name ? ` "${ch.name}"` : ''}`;
    if (!Number.isInteger(ch.number) || ch.number < 1 || ch.number > UVK1_MAX_CHANNELS) {
      problems.push(`${where}: number must be 1-${UVK1_MAX_CHANNELS}`);
      continue;
    }
    if (seen.has(ch.number)) problems.push(`${where}: number used twice`);
    seen.add(ch.number);
    for (const [label, f] of [['RX', ch.rxFrequency], ['TX', ch.txFrequency]] as const) {
      if (!(f >= UVK1_FREQ_MIN_MHZ && f <= UVK1_FREQ_MAX_MHZ)) {
        problems.push(`${where}: ${label} ${f} MHz is outside ${UVK1_FREQ_MIN_MHZ}-${UVK1_FREQ_MAX_MHZ} MHz`);
      }
    }
    const name = ch.name.replace(/ +$/, '');
    const bytes = encoder.encode(name).length;
    if (bytes > UVK1_MAX_NAME_BYTES) {
      problems.push(`${where}: name is ${bytes} bytes, the radio holds ${UVK1_MAX_NAME_BYTES} (5 kanji / kana, or 15 ASCII)`);
    }
    const bad = unsupportedCharacters(name, font);
    if (bad.length > 0) {
      problems.push(
        font === '25ja'
          ? `${where}: not in the 25ja font: ${bad.join(' ')}`
          : `${where}: this radio's font is not 25ja, so names are limited to ASCII: ${bad.join(' ')}`,
      );
    }
  }
  return problems;
}

/** 2-byte attribute for a written channel, keeping what the app does not model. */
export function encodeAttribute(channel: Channel, previousRaw: number | null): number {
  const prev = previousRaw === null ? null : decodeAttribute(previousRaw & 0xff, previousRaw >> 8);
  const band = bandForFrequency(channel.rxFrequency);
  const compander = prev ? prev.compander : 0;
  let scanList: number;
  let exclude: boolean;
  if (channel.scanAdd) {
    // Keep the list it was in; a channel newly added to scanning goes to list 1.
    scanList = prev && prev.scanList !== 0 ? prev.scanList : 1;
    exclude = false;
  } else if (prev && prev.scanList !== 0 && prev.exclude) {
    // Already out of scanning by the exclude bit: leave both as they are.
    scanList = prev.scanList;
    exclude = true;
  } else {
    scanList = 0;
    exclude = false;
  }
  return (band & 0x07) | ((compander & 0x03) << 3) | ((exclude ? 1 : 0) << 7) | ((scanList & 0xff) << 8);
}

/** Attribute the radio writes when it deletes a channel. */
export const DELETED_ATTRIBUTE = UVK1_BAND_EMPTY;

export interface WriteTarget {
  image: Uint8Array;
  /** Zero-based slots whose bytes may differ from the radio's */
  touched: number[];
}

/**
 * The image as it should be after writing `channels`.
 * @param current image read from the radio (attributes complete; records and
 *                names read for every slot in use on the radio)
 */
export function buildTarget(current: Uint8Array, channels: Channel[]): WriteTarget {
  const image = new Uint8Array(current);
  const bySlot = new Map<number, Channel>();
  for (const ch of channels) bySlot.set(ch.number - 1, ch);
  const touched: number[] = [];

  for (let slot = 0; slot < UVK1_MAX_CHANNELS; slot++) {
    const attrAt = UVK1_ADDR.CHANNEL_ATTR + slot * UVK1_ATTR_SIZE;
    const prevRaw = current[attrAt] | (current[attrAt + 1] << 8);
    const usedOnRadio = !isUnusedAttribute(decodeAttribute(current[attrAt], current[attrAt + 1]));
    const ch = bySlot.get(slot);

    if (!ch) {
      if (usedOnRadio) {
        image[attrAt] = DELETED_ATTRIBUTE & 0xff;
        image[attrAt + 1] = (DELETED_ATTRIBUTE >> 8) & 0xff;
        touched.push(slot);
      }
      continue;
    }

    const recAt = UVK1_ADDR.CHANNELS + slot * UVK1_CHANNEL_SIZE;
    const nameAt = UVK1_ADDR.CHANNEL_NAMES + slot * UVK1_NAME_SIZE;
    // Fields the app does not model (modulation, step, DTMF, compander) are
    // carried over only from a channel the radio has in use. A slot the radio
    // counts as empty may hold a deleted channel's leftovers; those are not reused.
    const previous = usedOnRadio
      ? { record: current.subarray(recAt, recAt + UVK1_CHANNEL_SIZE), attribute: 0, nameField: new Uint8Array(16) }
      : undefined;
    const record = encodeChannel(ch, previous).record;
    const attr = encodeAttribute(ch, usedOnRadio ? prevRaw : null);

    image.set(record, recAt);
    image.set(encodeChannelName(ch.name), nameAt);
    image[attrAt] = attr & 0xff;
    image[attrAt + 1] = (attr >> 8) & 0xff;
    touched.push(slot);
  }
  return { image, touched };
}

export interface PlannedWrite {
  address: number;
  data: Uint8Array;
}

/**
 * SPI writes that turn `current` into `target` for the touched slots.
 * Runs of changed slots next to each other are merged; a write never spans a
 * 4 KB sector boundary (so each costs at most one erase) and never carries a
 * byte of a slot that was not touched.
 */
export function planWrites(current: Uint8Array, target: Uint8Array, touched: number[]): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const areas = [
    { base: UVK1_ADDR.CHANNELS, size: UVK1_CHANNEL_SIZE },
    { base: UVK1_ADDR.CHANNEL_NAMES, size: UVK1_NAME_SIZE },
    { base: UVK1_ADDR.CHANNEL_ATTR, size: UVK1_ATTR_SIZE },
  ];
  const slots = [...touched].sort((a, b) => a - b);

  for (const { base, size } of areas) {
    const changed = slots.filter((s) => {
      const at = base + s * size;
      for (let i = 0; i < size; i++) if (current[at + i] !== target[at + i]) return true;
      return false;
    });
    let i = 0;
    while (i < changed.length) {
      const start = base + changed[i] * size;
      let end = start + size;
      let j = i + 1;
      while (
        j < changed.length &&
        changed[j] === changed[j - 1] + 1 &&
        end + size - start <= UVK1_SPI_WRITE_MAX &&
        Math.floor(start / SECTOR) === Math.floor((end + size - 1) / SECTOR)
      ) {
        end += size;
        j++;
      }
      assertWritable(start, end - start);
      writes.push({ address: start, data: target.slice(start, end) });
      i = j;
    }
  }
  return writes;
}
