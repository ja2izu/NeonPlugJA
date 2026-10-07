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
 * Only these areas are ever written: channel records, channel names and the
 * 1024 channel attributes, plus (25Ja only, when asked) the second name slots and
 * the 24 scan list kanji names at 0x8880. Settings, VFOs, the 4-byte scan list
 * names at 0x880e, calibration and the font are outside the writable ranges and
 * cannot be reached.
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
  UVK1_FREQ_MAX_MHZ, UVK1_FREQ_MIN_MHZ, UVK1_IMAGE_EXT_BASE, UVK1_MAX_CHANNELS, UVK1_MAX_NAME_BYTES,
  UVK1_BOOT_TEXT_BASE, UVK1_BOOT_TEXT_SIZE, UVK1_LIST_KANJI_BASE, UVK1_LIST_KANJI_SIZE, UVK1_MAX_NAME_BYTES_LONG, UVK1_NAME_EXT_SPI, UVK1_NAME_SIZE, UVK1_SCAN_LISTS,
  UVK1_SPI_WRITE_MAX, type UVK1FontId,
} from './constants';
import { applyUvk1Power, applyUvk1RecordFields, decodeAttribute, isUnusedAttribute, previousForEncode } from './structures';
import { FONT_25JA_CHARS } from './font25ja';

/**
 * Image address ranges a write may touch: [start, end). For the channel areas
 * the image address is the SPI address; the second name slots (long names
 * only) sit at UVK1_IMAGE_EXT_BASE in the image, see imageToSpiAddress.
 */
export const WRITABLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [UVK1_ADDR.CHANNELS, UVK1_ADDR.CHANNELS + UVK1_MAX_CHANNELS * UVK1_CHANNEL_SIZE],
  [UVK1_ADDR.CHANNEL_NAMES, UVK1_ADDR.CHANNEL_NAMES + UVK1_MAX_CHANNELS * UVK1_NAME_SIZE],
  [UVK1_ADDR.CHANNEL_ATTR, UVK1_ADDR.CHANNEL_ATTR + UVK1_MAX_CHANNELS * UVK1_ATTR_SIZE],
];

/** The second name slots, writable only on a 25Ja that reports long names. */
export const WRITABLE_EXT_RANGE: readonly [number, number] =
  [UVK1_IMAGE_EXT_BASE, UVK1_IMAGE_EXT_BASE + UVK1_MAX_CHANNELS * UVK1_NAME_SIZE];

/** The scan list kanji names, writable only on a 25Ja when the app has names to write. */
export const WRITABLE_LIST_NAME_RANGE: readonly [number, number] =
  [UVK1_LIST_KANJI_BASE, UVK1_LIST_KANJI_BASE + UVK1_SCAN_LISTS * UVK1_LIST_KANJI_SIZE];

/** 25Ja v0.3 以降の起動文言（24 バイト）。文言があるときだけ書ける。 */
export const WRITABLE_BOOT_TEXT_RANGE: readonly [number, number] =
  [UVK1_BOOT_TEXT_BASE, UVK1_BOOT_TEXT_BASE + UVK1_BOOT_TEXT_SIZE];

/** Throws unless [address, address + length) lies inside one writable range. */
export function assertWritable(address: number, length: number, longNames = false, listNames = false, bootText = false): void {
  const ranges = [
    ...WRITABLE_RANGES,
    ...(longNames ? [WRITABLE_EXT_RANGE] : []),
    ...(listNames ? [WRITABLE_LIST_NAME_RANGE] : []),
    ...(bootText ? [WRITABLE_BOOT_TEXT_RANGE] : []),
  ];
  const ok = ranges.some(([s, e]) => address >= s && address + length <= e);
  if (!ok || length < 1) {
    throw new Error(`UV-K1: refusing to write 0x${address.toString(16)}+${length}: outside the channel areas`);
  }
}

/** SPI address of an image address (the second name slots move to 0x020000). */
export function imageToSpiAddress(address: number): number {
  const [s, e] = WRITABLE_EXT_RANGE;
  return address >= s && address < e ? UVK1_NAME_EXT_SPI + (address - s) : address;
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

/**
 * Name bytes as SETTINGS_SaveChannelName writes them: UTF-8, rest 0.
 * Returns 16 bytes, or 32 (both slots) when `maxBytes` is 31. The second slot
 * only matters when the name is 16 bytes or longer; see buildTarget.
 */
export function encodeChannelName(name: string, maxBytes: number = UVK1_MAX_NAME_BYTES): Uint8Array {
  const out = new Uint8Array(maxBytes > UVK1_MAX_NAME_BYTES ? UVK1_NAME_SIZE * 2 : UVK1_NAME_SIZE);
  const bytes = encoder.encode(name.replace(/ +$/, ''));
  out.set(bytes.subarray(0, maxBytes));
  return out;
}

/** Name length in bytes as it will be stored (trailing spaces dropped). */
export function encodedNameLength(name: string): number {
  return encoder.encode(name.replace(/ +$/, '')).length;
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
export function validateChannels(channels: Channel[], font: UVK1FontId, maxNameBytes: number = UVK1_MAX_NAME_BYTES): string[] {
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
    const listId = ch.scanListId ?? 0;
    if (!Number.isInteger(listId) || listId < 0 || listId > UVK1_SCAN_LISTS + 1) {
      problems.push(`${where}: scan list ${listId} does not exist on this radio (0 none, 1-${UVK1_SCAN_LISTS}, ${UVK1_SCAN_LISTS + 1} = ALL)`);
    }
    const name = ch.name.replace(/ +$/, '');
    const bytes = encoder.encode(name).length;
    if (bytes > maxNameBytes) {
      problems.push(
        `${where}: name is ${bytes} bytes, the radio holds ${maxNameBytes} ` +
          `(${Math.floor(maxNameBytes / 3)} kanji / kana, or ${maxNameBytes} ASCII)`,
      );
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

/**
 * 2-byte attribute for a written channel, keeping what the app does not model.
 *
 * The scan list number is the channel's `scanListId` (0 none, 1-24 that list,
 * 25 all lists). The exclude bit is not edited by the app: it is written back as
 * `scanExcluded` carried from the read, and only while the channel has a list.
 * A channel that has no list number but is marked `scanAdd` (an import from a
 * source with no lists) keeps the list it was in, or goes to list 1.
 */
export function encodeAttribute(channel: Channel, previousRaw: number | null): number {
  const prev = previousRaw === null ? null : decodeAttribute(previousRaw & 0xff, previousRaw >> 8);
  const band = bandForFrequency(channel.rxFrequency);
  const compander = Number.isInteger(channel.uvk1Compander)
    ? Math.max(0, Math.min(3, channel.uvk1Compander as number))
    : prev ? prev.compander : 0;
  // bits 5-6 are unused by the firmware; keep them as the radio had them. JA: 未使用 bit は元のまま保つ
  const keptBits = prev ? prev.raw & 0x60 : 0;
  const listId = Number.isInteger(channel.scanListId) ? Math.max(0, Math.min(UVK1_SCAN_LISTS + 1, channel.scanListId)) : 0;
  let scanList: number;
  let exclude = false;
  if (listId > 0) {
    scanList = listId;
    exclude = channel.scanExcluded === true;
  } else if (channel.scanAdd) {
    scanList = prev && prev.scanList !== 0 ? prev.scanList : 1;
  } else {
    scanList = 0;
  }
  return (band & 0x07) | ((compander & 0x03) << 3) | keptBits | ((exclude ? 1 : 0) << 7) | ((scanList & 0xff) << 8);
}

/** One list name as the radio stores it: UTF-8, 0x00 padded to 12 bytes. */
export function encodeListName(name: string): Uint8Array {
  const out = new Uint8Array(UVK1_LIST_KANJI_SIZE);
  out.set(encoder.encode(name.replace(/ +$/, '')).subarray(0, UVK1_LIST_KANJI_SIZE));
  return out;
}

/** Problems with list names (index = list number - 1; undefined = no list). One line each. */
export function validateListNames(names: ReadonlyArray<string | undefined>, font: UVK1FontId): string[] {
  const problems: string[] = [];
  names.forEach((raw, i) => {
    if (raw === undefined) return;
    const name = raw.replace(/ +$/, '');
    const where = `Scan list ${i + 1}${name ? ` "${name}"` : ''}`;
    const bytes = encoder.encode(name).length;
    if (bytes > UVK1_LIST_KANJI_SIZE) {
      problems.push(`${where}: name is ${bytes} bytes, the radio holds ${UVK1_LIST_KANJI_SIZE} (${Math.floor(UVK1_LIST_KANJI_SIZE / 3)} kanji / kana, or ${UVK1_LIST_KANJI_SIZE} ASCII)`);
    }
    const bad = unsupportedCharacters(name, font);
    if (bad.length > 0) problems.push(`${where}: not in the 25ja font: ${bad.join(' ')}`);
  });
  return problems;
}

/**
 * Put the app's list names into `image` (a copy of the radio's). A list the app
 * does not have (undefined) leaves the radio's name alone. An empty name clears
 * the entry only if it holds something; an entry the radio already shows as empty
 * (first byte 0x00 or 0xFF) is left as it is, so nothing is written for it.
 */
export function applyListNames(image: Uint8Array, names: ReadonlyArray<string | undefined>): void {
  for (let i = 0; i < UVK1_SCAN_LISTS; i++) {
    const name = names[i];
    if (name === undefined) continue;
    const at = UVK1_LIST_KANJI_BASE + i * UVK1_LIST_KANJI_SIZE;
    const bytes = encodeListName(name);
    if (bytes[0] === 0 && (image[at] === 0x00 || image[at] === 0xff)) continue;
    image.set(bytes, at);
  }
}

/** SPI writes for the list names that differ, runs of neighbours merged (at most 120 bytes each). */
export function planListNameWrites(current: Uint8Array, target: Uint8Array): PlannedWrite[] {
  const size = UVK1_LIST_KANJI_SIZE;
  const changed: number[] = [];
  for (let i = 0; i < UVK1_SCAN_LISTS; i++) {
    const at = UVK1_LIST_KANJI_BASE + i * size;
    for (let b = 0; b < size; b++) {
      if (current[at + b] !== target[at + b]) { changed.push(i); break; }
    }
  }
  const writes: PlannedWrite[] = [];
  const perWrite = Math.floor(UVK1_SPI_WRITE_MAX / size);
  let i = 0;
  while (i < changed.length) {
    let j = i + 1;
    while (j < changed.length && changed[j] === changed[j - 1] + 1 && j - i < perWrite) j++;
    const start = UVK1_LIST_KANJI_BASE + changed[i] * size;
    const end = UVK1_LIST_KANJI_BASE + (changed[j - 1] + 1) * size;
    assertWritable(start, end - start, false, true);
    writes.push({ address: start, data: target.slice(start, end) });
    i = j;
  }
  return writes;
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
export function buildTarget(current: Uint8Array, channels: Channel[], longNames = false): WriteTarget {
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
    const originalRecord = previous?.record.slice();
    const record = encodeChannel(ch, previous && { ...previous, record: previousForEncode(previous.record) }).record;
    applyUvk1Power(record, ch.power, originalRecord);
    applyUvk1RecordFields(record, ch, originalRecord);
    const attr = encodeAttribute(ch, usedOnRadio ? prevRaw : null);

    image.set(record, recAt);
    if (longNames) {
      const both = encodeChannelName(ch.name, UVK1_MAX_NAME_BYTES_LONG);
      image.set(both.subarray(0, UVK1_NAME_SIZE), nameAt);
      // The second slot is read only when the first holds no 0x00 / 0xFF, i.e.
      // for names of 16 bytes or more; the radio writes it only then too.
      if (encodedNameLength(ch.name) >= UVK1_NAME_SIZE) {
        image.set(both.subarray(UVK1_NAME_SIZE), UVK1_IMAGE_EXT_BASE + slot * UVK1_NAME_SIZE);
      }
    } else {
      image.set(encodeChannelName(ch.name), nameAt);
    }
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
export function planWrites(current: Uint8Array, target: Uint8Array, touched: number[], longNames = false): PlannedWrite[] {
  const writes: PlannedWrite[] = [];
  const areas = [
    { base: UVK1_ADDR.CHANNELS, size: UVK1_CHANNEL_SIZE },
    { base: UVK1_ADDR.CHANNEL_NAMES, size: UVK1_NAME_SIZE },
    { base: UVK1_ADDR.CHANNEL_ATTR, size: UVK1_ATTR_SIZE },
    ...(longNames ? [{ base: UVK1_IMAGE_EXT_BASE, size: UVK1_NAME_SIZE }] : []),
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
      assertWritable(start, end - start, longNames);
      writes.push({ address: start, data: target.slice(start, end) });
      i = j;
    }
  }
  return writes;
}
