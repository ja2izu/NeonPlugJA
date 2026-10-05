/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UVK1Protocol — Quansheng UV-K1 / UV-K5 V3 running Dondji or 25ja.
 *
 * Stage 2: connect, identify the firmware, read channels, write channels.
 * Settings are not handled.
 *
 * Identification. Every F4HWN-derived firmware answers hello with "F4HWN ...",
 * so hello cannot tell a UV-K1 running Dondji / 25ja from a UV-K5 or from a
 * UV-K1 running F4HWN, and the layouts differ (a UV-K5 write at 0x0D60 or
 * 0x0F50 would land in the UV-K1 frequency area). So after hello this driver
 * reads the font version byte through the SPI flash command 0x051F, which only
 * Dondji and 25ja implement. No answer: not this radio, disconnect.
 *
 * Reading skips unused channels. The attribute area is read first (17 blocks);
 * then only the 128-byte blocks of records and names that hold at least one
 * used channel are read (8 channels per block).
 */
import type { RadioInfo } from '../../types/radio';
import type { Channel } from '../../models';
import { BaseAnalogProtocol } from '../shared/BaseProtocols';
import { log as plog } from '../../utils/protocolLogger';
import { UVK1Connection, openUVK1Port, type UVK1SerialPort } from './connection';
import {
  UVK1_ADDR, UVK1_ATTR_SIZE, UVK1_BLOCK_SIZE, UVK1_CHANNEL_SIZE, UVK1_FONT_BASE,
  UVK1_LIST_KANJI_BASE, UVK1_LIST_KANJI_SIZE, UVK1_SCAN_LISTS,
  UVK1_FONT_PROFILES, UVK1_HELLO_MARKER, UVK1_IMAGE_EXT_BASE, UVK1_MAX_CHANNELS,
  UVK1_MAX_NAME_BYTES, UVK1_MAX_NAME_BYTES_LONG, UVK1_NAME_EXT_SPI, UVK1_NAME_SIZE, type UVK1FontId,
} from './constants';
import { decodeAttribute, decodeChannelName, isUnusedAttribute, parseChannel } from './structures';
import {
  applyListNames, assertWritable, buildTarget, imageToSpiAddress, planListNameWrites, planWrites,
  validateChannels, validateListNames,
} from './writePlan';

/**
 * Size of the image this driver keeps: channels, names, attributes and list
 * names (image address = EEPROM / SPI address), then the second name slots of
 * long names at UVK1_IMAGE_EXT_BASE.
 */
export const UVK1_IMAGE_SIZE = UVK1_IMAGE_EXT_BASE + UVK1_MAX_CHANNELS * UVK1_NAME_SIZE;

/** Second name slots per SPI read (64 bytes: even, and within the 120-byte limit). */
const EXT_SLOTS_PER_READ = 4;

/** Channels per 128-byte block of records or names. */
const SLOTS_PER_BLOCK = UVK1_BLOCK_SIZE / UVK1_CHANNEL_SIZE;

export class UVK1Protocol extends BaseAnalogProtocol {
  /** Settings are not handled by this driver yet. */
  readonly settingsWriteUnsupported = true;

  private conn: UVK1Connection | null = null;
  private port: UVK1SerialPort | null = null;
  private firmware = '';
  private font: UVK1FontId = 'unknown';
  /** 25Ja with names of up to 31 bytes (hello marker bit 0 and the 25ja font). */
  private longNames = false;
  /** Last image read. Bytes of blocks that were skipped stay 0xFF. */
  private image: Uint8Array | null = null;
  /** Start addresses of the blocks actually read into `image`. */
  private readBlocks = new Set<number>();
  /** Scan list names to write (index = list number - 1). Null: leave the radio's names alone. */
  private listNames: ReadonlyArray<string | undefined> | null = null;

  async connect(portOrOptions?: string | { forcePortSelection?: boolean; transport?: string }): Promise<void> {
    const opts = typeof portOrOptions === 'object' ? portOrOptions : {};
    this.port = await openUVK1Port(opts.forcePortSelection ?? false);
    const info = (this.port as { getInfo?: () => { usbVendorId?: number; usbProductId?: number } }).getInfo?.();
    plog.info(
      `serial port VID:PID ${info?.usbVendorId?.toString(16) ?? '?'}:${info?.usbProductId?.toString(16) ?? '?'}`,
      'UV-K1',
    );
    const conn = new UVK1Connection();
    this.onProgress?.(0, 'UV-K1: opening port');
    await conn.open(this.port);
    this.conn = conn;
    this.onProgress?.(0, 'UV-K1: waiting for the radio (hello)');
    try {
      this.firmware = await conn.hello();
    } catch (error) {
      await this.disconnect();
      throw error;
    }
    this.onProgress?.(0, 'UV-K1: identifying firmware');

    const first = UVK1_FONT_PROFILES[0];
    const v = await conn.probeSpi(UVK1_FONT_BASE + first.versionOffset);
    if (v === null) {
      await this.disconnect();
      throw new Error(
        `This radio ("${this.firmware}") did not answer the SPI flash read. ` +
        'This driver is for a UV-K1 / UV-K5 V3 running Dondji or 25ja firmware.',
      );
    }
    this.font = await identifyFont(conn, v);
    const flags = conn.helloFeatureFlags();
    this.longNames = this.font === '25ja' && flags !== null && (flags & UVK1_HELLO_MARKER.flagLongNames) !== 0;
    plog.info(`font ${this.font}, 25Ja flags ${flags === null ? 'none' : `0x${flags.toString(16)}`}, names up to ${this.maxNameBytes()} bytes`, 'UV-K1');
  }

  /** Longest name this radio stores, in bytes. */
  maxNameBytes(): number {
    return this.longNames ? UVK1_MAX_NAME_BYTES_LONG : UVK1_MAX_NAME_BYTES;
  }

  async disconnect(): Promise<void> {
    this.image = null;
    this.readBlocks = new Set();
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    this.port = null;
  }

  isConnected(): boolean {
    return this.conn !== null;
  }

  /** Which font the radio holds: '25ja', 'dondji' or 'unknown'. */
  getFontId(): UVK1FontId {
    return this.font;
  }

  async getRadioInfo(): Promise<RadioInfo> {
    const profile = UVK1_FONT_PROFILES.find((p) => p.id === this.font);
    return {
      model: 'UV-K1',
      firmware: `${this.firmware} / font: ${profile ? profile.label : 'unknown'} / names: ${this.maxNameBytes()} bytes`,
      buildDate: '',
      memoryLayout: { configStart: 0x0000, configEnd: UVK1_IMAGE_SIZE - 1 },
    };
  }

  /** Read the attributes, then the record and name blocks of used channels. */
  private async readImage(): Promise<Uint8Array> {
    const conn = this.conn;
    if (!conn) throw new Error('Not connected');
    const tStart = Date.now();
    const image = new Uint8Array(UVK1_IMAGE_SIZE).fill(0xff);
    const done = new Set<number>();

    const attrStart = UVK1_ADDR.CHANNEL_ATTR;
    const attrEnd = UVK1_ADDR.ATTR_AREA_END;
    const attrBlocks: number[] = [];
    for (let a = attrStart; a < attrEnd; a += UVK1_BLOCK_SIZE) attrBlocks.push(a);

    this.onProgress?.(0, 'Reading channel attributes');
    for (const a of attrBlocks) {
      const len = Math.min(UVK1_BLOCK_SIZE, attrEnd - a);
      image.set(await conn.readBlock(a, len), a);
      done.add(a);
    }

    const used = usedSlotsFromImage(image);
    const blocks = blocksForSlots(used);
    const total = attrBlocks.length + blocks.length;
    let count = attrBlocks.length;
    this.onProgress?.(count / total, `${used.length} channels in use`);

    for (const a of blocks) {
      image.set(await conn.readBlock(a, UVK1_BLOCK_SIZE), a);
      done.add(a);
      count++;
      this.onProgress?.(count / total, `Reading 0x${a.toString(16)}`);
    }

    // Second name slots, only for names that fill the first slot.
    if (this.longNames) {
      for (const first of extReadsForSlots(slotsNeedingExt(image, used))) {
        const bytes = EXT_SLOTS_PER_READ * UVK1_NAME_SIZE;
        const data = await conn.spiRead(UVK1_NAME_EXT_SPI + first * UVK1_NAME_SIZE, bytes);
        if (!data) throw new Error(`UV-K1: no answer reading long names at slot ${first + 1}`);
        image.set(data, UVK1_IMAGE_EXT_BASE + first * UVK1_NAME_SIZE);
        done.add(UVK1_IMAGE_EXT_BASE + first * UVK1_NAME_SIZE);
      }
    }
    // Scan list names (25ja only): 24 x 12 bytes at 0x8880. A radio that does not
    // answer leaves the area 0xFF (no names); the read goes on.
    if (this.font === '25ja') {
      const bytes = UVK1_SCAN_LISTS * UVK1_LIST_KANJI_SIZE;
      const part = 96;
      for (let off = 0; off < bytes; off += part) {
        const data = await conn.spiRead(UVK1_LIST_KANJI_BASE + off, Math.min(part, bytes - off));
        if (!data) {
          plog.warn(`scan list names: no answer at 0x${(UVK1_LIST_KANJI_BASE + off).toString(16)}, names not read`, 'UV-K1');
          image.fill(0xff, UVK1_LIST_KANJI_BASE, UVK1_LIST_KANJI_BASE + bytes);
          break;
        }
        image.set(data, UVK1_LIST_KANJI_BASE + off);
        done.add(UVK1_LIST_KANJI_BASE + off);
      }
    }
    plog.info(`read: ${done.size} block(s), ${used.length} channel(s) in use, ${Date.now() - tStart} ms`, 'UV-K1');
    this.onProgress?.(1, 'Read complete');
    this.image = image;
    this.readBlocks = done;
    return image;
  }

  async readChannels(): Promise<Channel[]> {
    const image = await this.readImage();
    return channelsFromImage(image, this.longNames);
  }

  /** Scan list names held by the radio (index = list number - 1; undefined = no name). Needs readChannels first. */
  readScanListNames(): (string | undefined)[] {
    const image = this.image;
    const out: (string | undefined)[] = [];
    for (let i = 0; i < UVK1_SCAN_LISTS; i++) {
      if (!image || this.font !== '25ja') { out.push(undefined); continue; }
      const at = UVK1_LIST_KANJI_BASE + i * UVK1_LIST_KANJI_SIZE;
      const name = decodeChannelName(image.subarray(at, at + UVK1_LIST_KANJI_SIZE), UVK1_LIST_KANJI_SIZE);
      out.push(name === '' ? undefined : name);
    }
    return out;
  }

  /** Whether this radio keeps scan list names (25ja font). */
  supportsScanListNames(): boolean {
    return this.font === '25ja';
  }

  /** Names for the next writeChannels (index = list number - 1; undefined = leave). Null clears. */
  setScanListNames(names: ReadonlyArray<string | undefined> | null): void {
    this.listNames = names;
  }

  /** The image read last, or null when nothing has been read yet. */
  getImage(): Uint8Array | null {
    return this.image;
  }

  /** Start addresses of the blocks read into the image. */
  getReadBlocks(): ReadonlySet<number> {
    return this.readBlocks;
  }

  /**
   * Write the channel list: the list is what the radio should hold afterwards.
   *
   * Nothing is sent until every channel passes validateChannels. The radio is
   * then read again (attributes, and records and names of channels in use), so
   * the comparison is against what the radio holds now, not an older read.
   * Only bytes that differ are written, then every written range is read back
   * and compared. The radio keeps channel data cached in RAM, so it has to be
   * switched off and on to show the new channels.
   */
  async writeChannels(channels: Channel[]): Promise<void> {
    const conn = this.conn;
    if (!conn) throw new Error('Not connected');

    const problems = validateChannels(channels, this.font, this.maxNameBytes());
    const listNames = this.font === '25ja' ? this.listNames : null;
    if (listNames) problems.push(...validateListNames(listNames, this.font));
    if (problems.length > 0) {
      const shown = problems.slice(0, 30).join('\n');
      const more = problems.length > 30 ? `\n... and ${problems.length - 30} more` : '';
      throw new Error(`Nothing was written to the UV-K1:\n${shown}${more}`);
    }

    const current = await this.readImage();
    const target = buildTarget(current, channels, this.longNames);
    if (listNames) applyListNames(target.image, listNames);
    const writes = [
      ...planWrites(current, target.image, target.touched, this.longNames),
      ...(listNames ? planListNameWrites(current, target.image) : []),
    ];
    const total = writes.length * 2;

    plog.info(
      `write plan: ${writes.length} write(s), ${writes.reduce((n, w) => n + w.data.length, 0)} bytes: ` +
        writes.map((w) => `0x${imageToSpiAddress(w.address).toString(16)}+${w.data.length}`).join(' '),
      'UV-K1',
    );
    if (writes.length === 0) {
      this.onProgress?.(1, 'No changes to write');
      return;
    }

    let step = 0;
    for (const w of writes) {
      assertWritable(w.address, w.data.length, this.longNames, true);
      const spi = imageToSpiAddress(w.address);
      await conn.spiWrite(spi, w.data);
      step++;
      this.onProgress?.(step / total, `Writing 0x${spi.toString(16)} (${w.data.length} bytes)`);
    }

    const tVerify = Date.now();
    for (const w of writes) {
      const tRead = Date.now();
      const spi = imageToSpiAddress(w.address);
      const back = await conn.spiRead(spi, w.data.length);
      plog.info(`verify 0x${spi.toString(16)} ${w.data.length} B: ${back ? `${Date.now() - tRead} ms` : 'no answer'}`, 'UV-K1');
      if (!back || back.some((b, i) => b !== w.data[i])) {
        throw new Error(`UV-K1: verify failed at 0x${spi.toString(16)}. Read the radio again before writing.`);
      }
      step++;
      this.onProgress?.(step / total, `Verifying 0x${spi.toString(16)}`);
    }

    plog.info(`verify done: ${writes.length} range(s) in ${Date.now() - tVerify} ms`, 'UV-K1');
    this.image = target.image;
    this.onProgress?.(1, `Wrote ${writes.length} block(s). Turn the radio off and on to see the changes.`);
  }
}

/** Font from the version byte at the 25ja offset, trying the Dondji offset next. */
async function identifyFont(conn: UVK1Connection, firstByte: number): Promise<UVK1FontId> {
  const [ja, dondji] = UVK1_FONT_PROFILES;
  if (firstByte === ja.version) return ja.id;
  const second = await conn.probeSpi(UVK1_FONT_BASE + dondji.versionOffset);
  if (second === dondji.version) return dondji.id;
  return 'unknown';
}

/** Zero-based slots whose attribute marks them as used. */
export function usedSlotsFromImage(image: Uint8Array): number[] {
  const used: number[] = [];
  for (let i = 0; i < UVK1_MAX_CHANNELS; i++) {
    const at = UVK1_ADDR.CHANNEL_ATTR + i * UVK1_ATTR_SIZE;
    if (!isUnusedAttribute(decodeAttribute(image[at], image[at + 1]))) used.push(i);
  }
  return used;
}

/** Record and name blocks (start addresses, ascending) that hold these slots. */
export function blocksForSlots(slots: number[]): number[] {
  const set = new Set<number>();
  for (const s of slots) {
    const blockIndex = Math.floor(s / SLOTS_PER_BLOCK);
    set.add(UVK1_ADDR.CHANNELS + blockIndex * UVK1_BLOCK_SIZE);
    set.add(UVK1_ADDR.CHANNEL_NAMES + blockIndex * UVK1_BLOCK_SIZE);
  }
  return [...set].sort((a, b) => a - b);
}

/** Used slots whose name fills the first slot (no 0x00 / 0xFF in it), so it goes on in the second. */
export function slotsNeedingExt(image: Uint8Array, used: number[]): number[] {
  return used.filter((slot) => {
    const at = UVK1_ADDR.CHANNEL_NAMES + slot * UVK1_NAME_SIZE;
    for (let i = 0; i < UVK1_NAME_SIZE; i++) {
      const b = image[at + i];
      if (b === 0x00 || b === 0xff) return false;
    }
    return true;
  });
}

/** First slots of the 4-slot SPI reads that cover these slots (ascending). */
export function extReadsForSlots(slots: number[]): number[] {
  return [...new Set(slots.map((s) => s - (s % EXT_SLOTS_PER_READ)))].sort((a, b) => a - b);
}

/** Every used channel in an image. */
export function channelsFromImage(image: Uint8Array, longNames = false): Channel[] {
  const channels: Channel[] = [];
  for (let i = 0; i < UVK1_MAX_CHANNELS; i++) {
    const recordAt = UVK1_ADDR.CHANNELS + i * UVK1_CHANNEL_SIZE;
    const nameAt = UVK1_ADDR.CHANNEL_NAMES + i * UVK1_NAME_SIZE;
    const attrAt = UVK1_ADDR.CHANNEL_ATTR + i * UVK1_ATTR_SIZE;
    let nameField = image.subarray(nameAt, nameAt + UVK1_NAME_SIZE);
    if (longNames) {
      const extAt = UVK1_IMAGE_EXT_BASE + i * UVK1_NAME_SIZE;
      nameField = new Uint8Array(UVK1_NAME_SIZE * 2);
      nameField.set(image.subarray(nameAt, nameAt + UVK1_NAME_SIZE));
      nameField.set(image.subarray(extAt, extAt + UVK1_NAME_SIZE), UVK1_NAME_SIZE);
    }
    const channel = parseChannel({
      number: i + 1,
      record: image.subarray(recordAt, recordAt + UVK1_CHANNEL_SIZE),
      attrLo: image[attrAt],
      attrHi: image[attrAt + 1],
      nameField,
      maxNameBytes: longNames ? UVK1_MAX_NAME_BYTES_LONG : UVK1_MAX_NAME_BYTES,
    });
    if (channel) channels.push(channel);
  }
  return channels;
}
