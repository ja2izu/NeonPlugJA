/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * Web Serial connection for the UV-K5 programming cable.
 *
 * One exchange is: send a framed command, read the 4-byte header, then the
 * announced body plus its CRC and end marker. See framing.ts for the packet
 * shape. The radio answers every command, so there is no echo to skip.
 */
import { BaseSerialConnection, type SerialLikePort } from '../shared/BaseSerialConnection';
import { requestSerialPort } from '../shared/serialPort';
import { UVK5_BAUD_RATE, UVK5_BLOCK_SIZE, UVK5_FIRMWARE_MARKER } from './constants';
import {
  buildFrame, frameBodyLength, readFrameBody, payloadCommand, helloPayload,
  readMemPayload, writeMemPayload, firmwareFromHello, memoryFromReadReply,
  writeAccepted, CMD,
} from './framing';

const TIMEOUT_MS = 5000;

export type UVK5SerialPort = SerialLikePort;

/** Request / reuse a Web Serial port and open it at 38400 baud. */
export async function openUVK5Port(forceSelection = false): Promise<UVK5SerialPort> {
  return requestSerialPort(UVK5_BAUD_RATE, forceSelection);
}

export class UVK5Connection extends BaseSerialConnection {
  async open(port: UVK5SerialPort): Promise<void> {
    await super.openPort(port);
    this.buf = new Uint8Array(0);
  }

  async close(): Promise<void> {
    await super.closeStreams();
  }

  /** Send one command and return the payload of the reply. */
  private async exchange(payload: Uint8Array, timeoutMs = TIMEOUT_MS): Promise<Uint8Array> {
    await this.write(buildFrame(payload));
    const header = await this.readExact(4, timeoutMs);
    const length = frameBodyLength(header);
    const body = await this.readExact(length + 4, timeoutMs);
    return readFrameBody(body, length);
  }

  /**
   * Say hello and return the firmware string the radio reports.
   * Throws when the radio answers from its own flashing mode.
   */
  async hello(): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const reply = await this.exchange(helloPayload(), 1500);
        if (payloadCommand(reply) === CMD.FLASH_MODE_REPLY) {
          throw new Error('UV-K5 is in flashing mode. Restart the radio normally and try again.');
        }
        const firmware = firmwareFromHello(reply);
        if (firmware) return firmware;
      } catch (error) {
        if (error instanceof Error && error.message.includes('flashing mode')) throw error;
        lastError = error;
        this.buf = new Uint8Array(0);
        await this.delay(100);
      }
    }
    throw new Error(`UV-K5 did not answer${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
  }

  /** True when this firmware string is one this driver supports. */
  static isSupportedFirmware(firmware: string): boolean {
    return firmware.toUpperCase().includes(UVK5_FIRMWARE_MARKER);
  }

  /** Read `length` bytes (at most one block) from `offset`. */
  async readBlock(offset: number, length = UVK5_BLOCK_SIZE): Promise<Uint8Array> {
    const reply = await this.exchange(readMemPayload(offset, length));
    if (payloadCommand(reply) !== CMD.READ_MEM_REPLY) {
      throw new Error(`UV-K5: unexpected reply to read at 0x${offset.toString(16)}`);
    }
    const data = memoryFromReadReply(reply);
    if (data.length < length) {
      throw new Error(`UV-K5: short read at 0x${offset.toString(16)} (${data.length} of ${length})`);
    }
    return data.subarray(0, length);
  }

  /** Write one block. Throws when the radio does not confirm the offset. */
  async writeBlock(offset: number, data: Uint8Array): Promise<void> {
    const reply = await this.exchange(writeMemPayload(offset, data));
    if (!writeAccepted(reply, offset)) {
      throw new Error(`UV-K5: write at 0x${offset.toString(16)} was not confirmed`);
    }
  }
}
