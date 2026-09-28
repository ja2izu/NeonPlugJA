/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * Web Serial connection for the UV-K1 (USB port of the radio, or the K-type
 * programming cable). Same exchange as the UV-K5: send a framed command, read
 * the 4-byte header, then the body, CRC and tail.
 */
import { BaseSerialConnection, type SerialLikePort } from '../shared/BaseSerialConnection';
import { requestSerialPort } from '../shared/serialPort';
import {
  buildFrame, frameBodyLength, readFrameBody, payloadCommand, helloPayload,
  readMemPayload, firmwareFromHello, memoryFromReadReply, CMD,
} from '../uvk5/framing';
import { spiReadPayload, dataFromSpiReadReply } from './framing';
import { UVK1_BAUD_RATE, UVK1_BLOCK_SIZE, UVK1_SPI_READ_MAX } from './constants';

const TIMEOUT_MS = 5000;

/**
 * How long to wait for the SPI read that identifies the radio. A radio that
 * answers does so within a few milliseconds; the F4HWN firmwares never answer.
 */
const PROBE_TIMEOUT_MS = 1000;

export type UVK1SerialPort = SerialLikePort;

/** Request / reuse a Web Serial port. */
export async function openUVK1Port(forceSelection = false): Promise<UVK1SerialPort> {
  return requestSerialPort(UVK1_BAUD_RATE, forceSelection);
}

export class UVK1Connection extends BaseSerialConnection {
  async open(port: UVK1SerialPort): Promise<void> {
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
          throw new Error('UV-K1 is in flashing mode. Restart the radio normally and try again.');
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
    throw new Error(`UV-K1 did not answer${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
  }

  /** Read `length` bytes (at most one block) through the EEPROM command. */
  async readBlock(offset: number, length = UVK1_BLOCK_SIZE): Promise<Uint8Array> {
    const reply = await this.exchange(readMemPayload(offset, length));
    if (payloadCommand(reply) !== CMD.READ_MEM_REPLY) {
      throw new Error(`UV-K1: unexpected reply to read at 0x${offset.toString(16)}`);
    }
    const data = memoryFromReadReply(reply);
    if (data.length < length) {
      throw new Error(`UV-K1: short read at 0x${offset.toString(16)} (${data.length} of ${length})`);
    }
    return data.subarray(0, length);
  }

  /**
   * Read SPI flash directly (0x051F). Returns null when the radio does not
   * answer within `timeoutMs` — the F4HWN firmwares ignore this command.
   *
   * After a timeout the connection must be closed: the pending serial read left
   * behind by the timeout would take the first bytes of the next reply.
   */
  async spiRead(address: number, length: number, timeoutMs = TIMEOUT_MS): Promise<Uint8Array | null> {
    if (length < 1 || length > UVK1_SPI_READ_MAX) throw new Error(`UV-K1: SPI read size ${length} out of range`);
    let reply: Uint8Array;
    try {
      reply = await this.exchange(spiReadPayload(address, length), timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timeout')) return null;
      throw error;
    }
    const data = dataFromSpiReadReply(reply, address);
    if (data.length < length) {
      throw new Error(`UV-K1: short SPI read at 0x${address.toString(16)} (${data.length} of ${length})`);
    }
    return data.subarray(0, length);
  }

  /** SPI read with the short timeout used to identify the radio. */
  async probeSpi(address: number): Promise<number | null> {
    const data = await this.spiRead(address, 1, PROBE_TIMEOUT_MS);
    return data ? data[0] : null;
  }
}
