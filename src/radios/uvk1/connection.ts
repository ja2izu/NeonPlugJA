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
import { UVK1_BAUD_RATE, UVK1_BLOCK_SIZE, UVK1_HELLO_MARKER, UVK1_HELLO_VERSION, UVK1_SPI_READ_MAX, UVK1_SPI_WRITE_MAX } from './constants';

/** "0.4" / "0.4.1" from the two version bytes ((major << 4) | minor, patch); null for 00 00 = no version. */
export function formatFirmwareVersion(majorMinor: number, patch: number): string | null {
  if (majorMinor === 0 && patch === 0) return null;
  const base = `${majorMinor >> 4}.${majorMinor & 0x0f}`;
  return patch === 0 ? base : `${base}.${patch}`;
}

const TIMEOUT_MS = 5000;

/** A write may erase a 4 KB sector (about 300 ms) before programming it. */
/**
 * Wait per write attempt. Measured on hardware 2026-09-28: a write that is
 * answered is answered in 26-992 ms (the slow ones erase a 4 KB sector), and
 * about one write in nine is never answered at all; sent again, it is answered
 * in ~35 ms. So a short wait and more resends beat one long wait (the web tool
 * waits 15 s, which made each lost command cost 15 s).
 *
 * A lost command is consistent with a receive-ring bug in the firmware
 * (usbd_cdc_acm_bulk_out leaves the write pointer at 256; the parser then
 * skips byte 0 of the next command), reproduced in a simulation of that code,
 * though the simulation loses fewer commands than the radio did.
 */
const WRITE_TIMEOUT_MS = 3000;

/** Wait per read attempt, and attempts per read. Reads are answered in ~15-40 ms. */
const READ_TIMEOUT_MS = 2000;
const READ_ATTEMPTS = 3;

/** Sends per write, and the pause before a resend (the web tool pauses 150 ms). */
const WRITE_ATTEMPTS = 5;
const WRITE_RETRY_PAUSE_MS = 150;

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

/**
 * Reads must ask for an EVEN number of bytes.
 *
 * Over USB the firmware builds each reply in one buffer and puts the 4-byte
 * footer right after the data (SendReply_VCP in App/app/uart.c):
 *     Footer_t *pFooter = (Footer_t *)(VCP_ReplyBuf + sizeof(Header_t) + Size);
 *     pFooter->ID = 0xBADC;   // 16-bit store
 * With an odd reply size that store lands on an odd address, which the
 * Cortex-M0+ (PY32F071) does not allow: HardFault, and the radio stops
 * answering until it is switched off and on. A 1-byte SPI read (reply size 13)
 * did exactly that on hardware 2026-09-28. Read replies are the data plus 12
 * (0x051F) or plus 8 (0x051B), so an even length keeps the reply size even.
 * Write replies have a fixed size (8 or 4) and are not affected.
 */
function assertEvenReadLength(what: string, length: number): void {
  if (length % 2 !== 0) {
    throw new Error(`UV-K1: refusing ${what} of ${length} bytes — an odd-sized reply stops the radio`);
  }
}

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
  private helloReply: Uint8Array | null = null;

  /**
   * 25Ja feature bits from the last hello reply, or null when the reply does
   * not carry the 25Ja marker (Version[13..15] = 0x25 'J' flags). Older 25ja
   * builds, Dondji and F4HWN leave those bytes as whatever was on the stack,
   * so both tag bytes have to match.
   */
  helloFeatureFlags(): number | null {
    const r = this.helloReply;
    const { offset, tag } = UVK1_HELLO_MARKER;
    if (!r || r.length < offset + 3) return null;
    if (r[offset] !== tag[0] || r[offset + 1] !== tag[1]) return null;
    return r[offset + 2];
  }

  /**
   * 25Ja firmware version from the last hello reply, as "0.4" (or "0.4.1" when patch is not 0),
   * or null when the reply has no 25Ja marker, is too short, or carries 00 00 (older builds).
   */
  helloFirmwareVersion(): string | null {
    const r = this.helloReply;
    if (!r || this.helloFeatureFlags() === null) return null;
    const at = UVK1_HELLO_VERSION.offset;
    if (r.length < at + 2) return null;
    return formatFirmwareVersion(r[at], r[at + 1]);
  }

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
        this.helloReply = reply.slice();
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
  /**
   * Run `op` up to READ_ATTEMPTS times when it times out with no reply. Reads
   * change nothing on the radio, so asking again is always safe. See
   * WRITE_TIMEOUT_MS for why commands go unanswered now and then.
   */
  private async retryRead<T>(what: string, op: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
      if (attempt > 1) await this.delay(WRITE_RETRY_PAUSE_MS);
      try {
        const result = await op();
        if (attempt > 1) log(`${what}: answered on attempt ${attempt}`);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('Timeout: no reply')) throw error;
        lastError = error;
        log(`${what}: no reply (attempt ${attempt})`);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`UV-K1: ${what}: no reply`);
  }

  async readBlock(offset: number, length = UVK1_BLOCK_SIZE): Promise<Uint8Array> {
    assertEvenReadLength('an EEPROM read', length);
    const reply = await this.retryRead(`read 0x${offset.toString(16)}`, () =>
      this.exchange(readMemPayload(offset, length), [CMD.READ_MEM_REPLY], READ_TIMEOUT_MS));
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
  async spiRead(address: number, length: number, timeoutMs = READ_TIMEOUT_MS, attempts = READ_ATTEMPTS): Promise<Uint8Array | null> {
    if (length < 1 || length > UVK1_SPI_READ_MAX) throw new Error(`UV-K1: SPI read size ${length} out of range`);
    assertEvenReadLength('an SPI read', length);
    let reply: Uint8Array;
    try {
      const once = () => this.exchange(spiReadPayload(address, length), [CMD_SPI_READ_REPLY], timeoutMs);
      reply = attempts > 1 ? await this.retryRead(`SPI read 0x${address.toString(16)}`, once) : await once();
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
    // Resending the same bytes to the same address is harmless: the radio
    // compares with what is there and only rewrites a sector that differs.
    let lastError: unknown;
    for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
      if (attempt > 1) await this.delay(WRITE_RETRY_PAUSE_MS);
      const t0 = Date.now();
      try {
        const reply = await this.exchange(spiWritePayload(address, data), [CMD_SPI_WRITE_REPLY], WRITE_TIMEOUT_MS);
        if (!spiWriteAccepted(reply, address)) {
          throw new Error(`write at 0x${address.toString(16)} was not confirmed`);
        }
        log(`write 0x${address.toString(16)} ${data.length} B: ${Date.now() - t0} ms${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
        return;
      } catch (error) {
        lastError = error;
        log(`write 0x${address.toString(16)} ${data.length} B attempt ${attempt} failed after ${Date.now() - t0} ms: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`UV-K1: write at 0x${address.toString(16)} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  /** SPI read with the short timeout used to identify the radio. */
  async probeSpi(address: number): Promise<number | null> {
    log(`SPI read 0x${address.toString(16)} (identifies Dondji / 25ja)`);
    // 2 bytes, not 1: see assertEvenReadLength. The version byte is the first.
    // One attempt only: the F4HWN firmwares never answer, and they are what
    // this probe exists to turn away quickly.
    const data = await this.spiRead(address, 2, PROBE_TIMEOUT_MS, 1);
    log(data ? `SPI read answered: ${data[0]}` : 'SPI read: no answer');
    return data ? data[0] : null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
