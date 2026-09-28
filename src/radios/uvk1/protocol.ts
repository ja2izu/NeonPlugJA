/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UVK1Protocol — Quansheng UV-K1 / UV-K5 V3 running Dondji or 25ja.
 *
 * Stage 1: connect, identify the firmware, read channels.
 * Writing is not implemented yet; writeChannels throws before sending anything.
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
import { UVK1Connection, openUVK1Port, type UVK1SerialPort } from './connection';
import {
  UVK1_ADDR, UVK1_ATTR_SIZE, UVK1_BLOCK_SIZE, UVK1_CHANNEL_SIZE, UVK1_FONT_BASE,
  UVK1_FONT_PROFILES, UVK1_MAX_CHANNELS, UVK1_NAME_SIZE, type UVK1FontId,
} from './constants';
import { decodeAttribute, isUnusedAttribute, parseChannel } from './structures';

/** Size of the image this driver keeps: channels, names, attributes and list names. */
export const UVK1_IMAGE_SIZE = UVK1_ADDR.ATTR_AREA_END;

/** Channels per 128-byte block of records or names. */
const SLOTS_PER_BLOCK = UVK1_BLOCK_SIZE / UVK1_CHANNEL_SIZE;

export class UVK1Protocol extends BaseAnalogProtocol {
  /** Settings are not handled by this driver yet. */
  readonly settingsWriteUnsupported = true;

  private conn: UVK1Connection | null = null;
  private port: UVK1SerialPort | null = null;
  private firmware = '';
  private font: UVK1FontId = 'unknown';
  /** Last image read. Bytes of blocks that were skipped stay 0xFF. */
  private image: Uint8Array | null = null;
  /** Start addresses of the blocks actually read into `image`. */
  private readBlocks = new Set<number>();

  async connect(portOrOptions?: string | { forcePortSelection?: boolean; transport?: string }): Promise<void> {
    const opts = typeof portOrOptions === 'object' ? portOrOptions : {};
    this.port = await openUVK1Port(opts.forcePortSelection ?? false);
    const conn = new UVK1Connection();
    await conn.open(this.port);
    this.conn = conn;
    this.firmware = await conn.hello();

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
      firmware: `${this.firmware} / font: ${profile ? profile.label : 'unknown'}`,
      buildDate: '',
      memoryLayout: { configStart: 0x0000, configEnd: UVK1_IMAGE_SIZE - 1 },
    };
  }

  /** Read the attributes, then the record and name blocks of used channels. */
  private async readImage(): Promise<Uint8Array> {
    const conn = this.conn;
    if (!conn) throw new Error('Not connected');
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
    this.onProgress?.(1, 'Read complete');
    this.image = image;
    this.readBlocks = done;
    return image;
  }

  async readChannels(): Promise<Channel[]> {
    const image = await this.readImage();
    return channelsFromImage(image);
  }

  /** The image read last, or null when nothing has been read yet. */
  getImage(): Uint8Array | null {
    return this.image;
  }

  /** Start addresses of the blocks read into the image. */
  getReadBlocks(): ReadonlySet<number> {
    return this.readBlocks;
  }

  async writeChannels(channels: Channel[]): Promise<void> {
    throw new Error(
      `Writing to the UV-K1 is not implemented yet in this build (${channels.length} channels not sent).`,
    );
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

/** Every used channel in an image. */
export function channelsFromImage(image: Uint8Array): Channel[] {
  const channels: Channel[] = [];
  for (let i = 0; i < UVK1_MAX_CHANNELS; i++) {
    const recordAt = UVK1_ADDR.CHANNELS + i * UVK1_CHANNEL_SIZE;
    const nameAt = UVK1_ADDR.CHANNEL_NAMES + i * UVK1_NAME_SIZE;
    const attrAt = UVK1_ADDR.CHANNEL_ATTR + i * UVK1_ATTR_SIZE;
    const channel = parseChannel({
      number: i + 1,
      record: image.subarray(recordAt, recordAt + UVK1_CHANNEL_SIZE),
      attrLo: image[attrAt],
      attrHi: image[attrAt + 1],
      nameField: image.subarray(nameAt, nameAt + UVK1_NAME_SIZE),
    });
    if (channel) channels.push(channel);
  }
  return channels;
}
