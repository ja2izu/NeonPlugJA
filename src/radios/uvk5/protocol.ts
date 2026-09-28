/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UVK5Protocol — Quansheng UV-K5 running F4HWN firmware.
 *
 * Stage 1: connect, read the EEPROM, show channels.
 * Writing is not implemented yet; writeChannels throws rather than sending
 * anything, so a half-written codeplug cannot happen by accident.
 *
 * The whole 8 KB EEPROM is read in one pass and kept, because channels are
 * spread over three areas and the untouched fields of each record have to
 * survive a later write.
 */
import type { RadioInfo } from '../../types/radio';
import type { Channel } from '../../models';
import { BaseAnalogProtocol } from '../shared/BaseProtocols';
import { UVK5Connection, openUVK5Port, type UVK5SerialPort } from './connection';
import {
  UVK5_ADDR, UVK5_BLOCK_SIZE, UVK5_CHANNEL_SIZE, UVK5_EEPROM_SIZE,
  UVK5_MAX_CHANNELS, UVK5_NAME_SIZE,
} from './constants';
import { parseChannel } from './structures';

export class UVK5Protocol extends BaseAnalogProtocol {
  private conn: UVK5Connection | null = null;
  private port: UVK5SerialPort | null = null;
  private firmware = '';
  /** Last image read from the radio. Kept for stage 2, where a write has to
   *  carry over the fields this app does not model. */
  private image: Uint8Array | null = null;


  async connect(portOrOptions?: string | { forcePortSelection?: boolean; transport?: string }): Promise<void> {
    const opts = typeof portOrOptions === 'object' ? portOrOptions : {};
    this.port = await openUVK5Port(opts.forcePortSelection ?? false);
    const conn = new UVK5Connection();
    await conn.open(this.port);
    this.conn = conn;
    this.firmware = await conn.hello();
    if (!UVK5Connection.isSupportedFirmware(this.firmware)) {
      await this.disconnect();
      throw new Error(`Unsupported firmware "${this.firmware}". This build supports F4HWN firmware only.`);
    }
  }

  async disconnect(): Promise<void> {
    this.image = null;
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    this.port = null;
  }

  isConnected(): boolean {
    return this.conn !== null;
  }

  async getRadioInfo(): Promise<RadioInfo> {
    return {
      model: 'UV-K5',
      firmware: this.firmware,
      buildDate: '',
      memoryLayout: { configStart: 0x0000, configEnd: UVK5_EEPROM_SIZE - 1 },
    };
  }

  /** Read the whole EEPROM, keeping it for later writes. */
  private async readImage(): Promise<Uint8Array> {
    if (!this.conn) throw new Error('Not connected');
    const image = new Uint8Array(UVK5_EEPROM_SIZE);
    for (let offset = 0; offset < UVK5_EEPROM_SIZE; offset += UVK5_BLOCK_SIZE) {
      image.set(await this.conn.readBlock(offset, UVK5_BLOCK_SIZE), offset);
      this.onProgress?.(offset / UVK5_EEPROM_SIZE, `Reading 0x${offset.toString(16)}`);
    }
    this.onProgress?.(1, 'Read complete');
    this.image = image;
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

  async writeChannels(channels: Channel[]): Promise<void> {
    throw new Error(
      `Writing to the UV-K5 is not implemented yet in this build (${channels.length} channels not sent).`,
    );
  }
}

/** Every used channel in an 8 KB EEPROM image. */
export function channelsFromImage(image: Uint8Array): Channel[] {
  const channels: Channel[] = [];
  for (let i = 0; i < UVK5_MAX_CHANNELS; i++) {
    const recordAt = UVK5_ADDR.CHANNELS + i * UVK5_CHANNEL_SIZE;
    const nameAt = UVK5_ADDR.CHANNEL_NAMES + i * UVK5_NAME_SIZE;
    const channel = parseChannel({
      number: i + 1,
      record: image.subarray(recordAt, recordAt + UVK5_CHANNEL_SIZE),
      attribute: image[UVK5_ADDR.CHANNEL_ATTR + i],
      nameField: image.subarray(nameAt, nameAt + UVK5_NAME_SIZE),
    });
    if (channel) channels.push(channel);
  }
  return channels;
}
