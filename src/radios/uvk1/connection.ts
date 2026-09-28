/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * Web Serial connection for the UV-K1 (USB port of the radio, or the K-type
 * programming cable).
 *
 * Built the way the 25ja / Dondji web tool talks to the radio (docs/js/flash.js),
 * which is known to work with it:
 *   - one read loop runs for the whole connection and appends to a buffer, so
 *     a timed-out wait never leaves a read behind that would swallow the next
 *     reply (BaseSerialConnection.readExact races reader.read() against a timer,
 *     and the losing read keeps the next chunk);
 *   - a pause after opening the port before the first command;
 *   - replies are found by scanning for AB CD, and packets that are not the
 *     awaited reply are skipped instead of ending the exchange.
 * Every wait has a time limit, writing and closing included, so nothing here
 * can hang without an error.
 *
 * Each step is logged through protocolLogger (context "UV-K1"): the browser
 * console and the Diagnostics tab log.
 */
import type { SerialLikePort } from '../shared/BaseSerialConnection';
import { requestSerialPort } from '../shared/serialPort';
import { log as plog } from '../../utils/protocolLogger';
import {
  buildFrame, payloadCommand, helloPayload, readMemPayload, firmwareFromHello,
  memoryFromReadReply, scramble, CMD,
} from '../uvk5/framing';
import {
  spiReadPayload, dataFromSpiReadReply, spiWritePayload, spiWriteAccepted,
  CMD_SPI_READ_REPLY, CMD_SPI_WRITE_REPLY,
} from './framing';
import { UVK1_BAUD_RATE, UVK1_BLOCK_SIZE, UVK1_SPI_READ_MAX, UVK1_SPI_WRITE_MAX } from './constants';

const TIMEOUT_MS = 5000;

/** A write may erase a 4 KB sector (about 300 ms) before programming it. */
const WRITE_TIMEOUT_MS = 5000;

/**
 * How long to wait for the SPI read that identifies the radio. A radio that
 * answers does so within a few milliseconds; the F4HWN firmwares never answer.
 */
const PROBE_TIMEOUT_MS = 1000;

/** Pause after opening the port, as the web tool does, before the first command. */
const SETTLE_MS = 500;

/** Limit for handing bytes to the port and for closing it. */
const PORT_OP_TIMEOUT_MS = 3000;

export type UVK1SerialPort = SerialLikePort;

const hex = (b: Uint8Array, max = 24) =>
  Array.from(b.subarray(0, max), (x) => x.toString(16).padStart(2, '0')).join(' ') + (b.length > max ? ' …' : '');

function log(message: string): void {
  plog.info(message, 'UV-K1');
}

/** Resolve with the promise, or reject after `ms` with `what` in the message. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${what} (${ms} ms)`)), ms);
    }),
  ]);
}

/**
 * Take one complete packet from the front of `buf`.
 * Returns the unscrambled payload and how many bytes were used, or null when
 * no complete packet is there yet. Bytes before AB CD are dropped.
 */
export function takePacket(buf: Uint8Array): { payload: Uint8Array | null; used: number } {
  let start = -1;
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xab && buf[i + 1] === 0xcd) { start = i; break; }
  }
  if (start < 0) return { payload: null, used: buf.length > 0 && buf[buf.length - 1] === 0xab ? buf.length - 1 : buf.length };
  if (buf.length - start < 8) return { payload: null, used: start };
  const len = buf[start + 2] | (buf[start + 3] << 8);
  const end = start + 4 + len + 2; // tail position
  if (buf.length < end + 2) return { payload: null, used: start };
  if (buf[end] !== 0xdc || buf[end + 1] !== 0xba) {
    // Not a packet after all: drop the AB CD and look again.
    return { payload: null, used: start + 2 };
  }
  const payload = scramble(buf.subarray(start + 4, start + 4 + len + 2)).subarray(0, len);
  return { payload, used: end + 2 };
}

/** Request / reuse a Web Serial port. */
export async function openUVK1Port(forceSelection = false): Promise<UVK1SerialPort> {
  return requestSerialPort(UVK1_BAUD_RATE, forceSelection);
}

export class UVK1Connection {
  private port: SerialLikePort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private buf = new Uint8Array(0);
  private reading = false;
  private loop: Promise<void> | null = null;
  private readError: Error | null = null;

  async open(port: UVK1SerialPort): Promise<void> {
    if (!port.readable || !port.writable) throw new Error('UV-K1: port streams unavailable');
    if (port.readable.locked || port.writable.locked) throw new Error('UV-K1: port already in use');
    this.port = port;
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.buf = new Uint8Array(0);
    this.readError = null;
    this.reading = true;
    this.loop = this.readLoop();
    log('port opened');
    await this.delay(SETTLE_MS);
    if (this.buf.length > 0) log(`${this.buf.length} byte(s) waiting before the first command: ${hex(this.buf)}`);
  }

  async close(): Promise<void> {
    this.reading = false;
    const reader = this.reader;
    const writer = this.writer;
    const port = this.port;
    this.reader = null;
    this.writer = null;
    this.port = null;
    try { if (reader) await withTimeout(reader.cancel(), PORT_OP_TIMEOUT_MS, 'cancel read'); } catch { /* ignore */ }
    try { if (this.loop) await withTimeout(this.loop, PORT_OP_TIMEOUT_MS, 'end read loop'); } catch { /* ignore */ }
    this.loop = null;
    try { reader?.releaseLock(); } catch { /* ignore */ }
    try { if (writer) await withTimeout(writer.close(), PORT_OP_TIMEOUT_MS, 'close write'); } catch { /* ignore */ }
    try { writer?.releaseLock(); } catch { /* ignore */ }
    try { if (port) await withTimeout(port.close(), PORT_OP_TIMEOUT_MS, 'close port'); } catch { /* ignore */ }
    log('port closed');
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.reading && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
          const next = new Uint8Array(this.buf.length + value.length);
          next.set(this.buf);
          next.set(value, this.buf.length);
          this.buf = next;
        }
      }
    } catch (error) {
      if (this.reading) {
        this.readError = error instanceof Error ? error : new Error(String(error));
        log(`read error: ${this.readError.message}`);
      }
    }
  }

  /**
   * Send one command and return the payload of the first reply whose command
   * id is in `expect`. Other packets are logged and skipped.
   */
  private async exchange(payload: Uint8Array, expect: number[], timeoutMs = TIMEOUT_MS): Promise<Uint8Array> {
    if (!this.writer) throw new Error('Not connected');
    const frame = buildFrame(payload);
    await withTimeout(this.writer.write(frame), PORT_OP_TIMEOUT_MS, 'sending to the port');

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.readError) throw new Error(`UV-K1: serial read failed: ${this.readError.message}`);
      const { payload: reply, used } = takePacket(this.buf);
      if (used > 0) this.buf = this.buf.slice(used);
      if (reply) {
        const id = payloadCommand(reply);
        if (expect.includes(id)) return reply;
        log(`skipped packet 0x${id.toString(16)} (${reply.length} bytes) while waiting for ${expect.map((e) => `0x${e.toString(16)}`).join('/')}`);
        if (id === CMD.FLASH_MODE_REPLY) {
          throw new Error('UV-K1 is in flashing mode. Restart the radio normally and try again.');
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timeout: no reply to 0x${payloadCommand(payload).toString(16)} ` +
          `(${this.buf.length} byte(s) received${this.buf.length ? `: ${hex(this.buf)}` : ''})`,
        );
      }
      await this.delay(10);
    }
  }

  /**
   * Say hello and return the firmware string the radio reports.
   * Throws when the radio answers from its own flashing mode.
   */
  async hello(): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        log(`hello (attempt ${attempt})`);
        const reply = await this.exchange(helloPayload(), [CMD.HELLO_REPLY], 1500);
        const firmware = firmwareFromHello(reply);
        log(`hello reply: "${firmware}"`);
        if (firmware) return firmware;
      } catch (error) {
        if (error instanceof Error && error.message.includes('flashing mode')) throw error;
        lastError = error;
        log(`hello failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`UV-K1 did not answer${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
  }

  /** Read `length` bytes (at most one block) through the EEPROM command. */
  async readBlock(offset: number, length = UVK1_BLOCK_SIZE): Promise<Uint8Array> {
    const reply = await this.exchange(readMemPayload(offset, length), [CMD.READ_MEM_REPLY]);
    const at = reply.length >= 6 ? reply[4] | (reply[5] << 8) : -1;
    if (at !== offset) throw new Error(`UV-K1: read at 0x${offset.toString(16)} answered for 0x${at.toString(16)}`);
    const data = memoryFromReadReply(reply);
    if (data.length < length) {
      throw new Error(`UV-K1: short read at 0x${offset.toString(16)} (${data.length} of ${length})`);
    }
    return data.subarray(0, length);
  }

  /**
   * Read SPI flash directly (0x051F). Returns null when the radio does not
   * answer within `timeoutMs` — the F4HWN firmwares ignore this command.
   */
  async spiRead(address: number, length: number, timeoutMs = TIMEOUT_MS): Promise<Uint8Array | null> {
    if (length < 1 || length > UVK1_SPI_READ_MAX) throw new Error(`UV-K1: SPI read size ${length} out of range`);
    let reply: Uint8Array;
    try {
      reply = await this.exchange(spiReadPayload(address, length), [CMD_SPI_READ_REPLY], timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timeout: no reply')) return null;
      throw error;
    }
    const data = dataFromSpiReadReply(reply, address);
    if (data.length < length) {
      throw new Error(`UV-K1: short SPI read at 0x${address.toString(16)} (${data.length} of ${length})`);
    }
    return data.subarray(0, length);
  }

  /**
   * Write SPI flash directly (0x0521), at most 120 bytes. Throws when the radio
   * does not confirm the address. The caller decides what may be written; see
   * writePlan.ts for the address checks.
   */
  async spiWrite(address: number, data: Uint8Array): Promise<void> {
    if (data.length < 1 || data.length > UVK1_SPI_WRITE_MAX) {
      throw new Error(`UV-K1: SPI write size ${data.length} out of range`);
    }
    const reply = await this.exchange(spiWritePayload(address, data), [CMD_SPI_WRITE_REPLY], WRITE_TIMEOUT_MS);
    if (!spiWriteAccepted(reply, address)) {
      throw new Error(`UV-K1: write at 0x${address.toString(16)} was not confirmed`);
    }
  }

  /** SPI read with the short timeout used to identify the radio. */
  async probeSpi(address: number): Promise<number | null> {
    log(`SPI read 0x${address.toString(16)} (identifies Dondji / 25ja)`);
    const data = await this.spiRead(address, 1, PROBE_TIMEOUT_MS);
    log(data ? `SPI read answered: ${data[0]}` : 'SPI read: no answer');
    return data ? data[0] : null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
