/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * UV-K5 framing: every packet on the wire looks like
 *
 *   AB CD | length (2 bytes, little endian) | scrambled(payload + CRC16) | DC BA
 *
 * The CRC is CRC-16/XMODEM over the payload only, appended before scrambling.
 * Scrambling is a byte-wise XOR against a fixed 16-byte pattern that repeats.
 * Replies from the radio carry a CRC placeholder rather than a real checksum,
 * so only the framing and the length are checked when unpacking one.
 */

/** Repeating XOR pattern used in both directions. */
const SCRAMBLE = Uint8Array.of(
  0x16, 0x6c, 0x14, 0xe6, 0x2e, 0x91, 0x0d, 0x40,
  0x21, 0x35, 0xd5, 0x40, 0x13, 0x03, 0xe9, 0x80,
);

const HEAD = Uint8Array.of(0xab, 0xcd);
const TAIL = Uint8Array.of(0xdc, 0xba);

/** Fixed 4-byte value every command carries after its arguments. */
export const SESSION = Uint8Array.of(0x6a, 0x39, 0x57, 0x64);

/** Command ids used by this driver. */
export const CMD = {
  HELLO: 0x0514,
  HELLO_REPLY: 0x0515,
  /** The radio is sitting in its own flashing mode and cannot be programmed. */
  FLASH_MODE_REPLY: 0x0518,
  READ_MEM: 0x051b,
  READ_MEM_REPLY: 0x051c,
  WRITE_MEM: 0x051d,
  WRITE_MEM_REPLY: 0x051e,
} as const;

/** XOR against the repeating pattern. Applying it twice returns the input. */
export function scramble(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ SCRAMBLE[i % SCRAMBLE.length];
  return out;
}

/** CRC-16/XMODEM (polynomial 0x1021, initial value 0). */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** Wrap a payload into a packet ready to send. */
export function buildFrame(payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(payload.length + 2);
  body.set(payload);
  const crc = crc16(payload);
  body[payload.length] = crc & 0xff;
  body[payload.length + 1] = (crc >> 8) & 0xff;

  const scrambled = scramble(body);
  const frame = new Uint8Array(4 + scrambled.length + 2);
  frame.set(HEAD, 0);
  frame[2] = payload.length & 0xff;
  frame[3] = (payload.length >> 8) & 0xff;
  frame.set(scrambled, 4);
  frame.set(TAIL, 4 + scrambled.length);
  return frame;
}

/** True when these are the first bytes of a packet. */
export function hasFrameHead(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === HEAD[0] && data[1] === HEAD[1];
}

/** Payload length announced by a packet header (the 4 bytes read first). */
export function frameBodyLength(header: Uint8Array): number {
  if (!hasFrameHead(header) || header.length < 4) throw new Error('UV-K5: bad packet header');
  return header[2] | (header[3] << 8);
}

/**
 * Unscramble the body of a reply. `body` is everything after the 4-byte header:
 * the scrambled payload, its 2 CRC bytes and the 2 tail bytes.
 */
export function readFrameBody(body: Uint8Array, payloadLength: number): Uint8Array {
  if (body.length < payloadLength + 4) throw new Error('UV-K5: reply shorter than announced');
  const tail = body.subarray(payloadLength + 2, payloadLength + 4);
  if (tail[0] !== TAIL[0] || tail[1] !== TAIL[1]) throw new Error('UV-K5: bad packet end');
  return scramble(body.subarray(0, payloadLength + 2)).subarray(0, payloadLength);
}

/** Command id of a payload (first two bytes, little endian). */
export function payloadCommand(payload: Uint8Array): number {
  return payload.length >= 2 ? payload[0] | (payload[1] << 8) : -1;
}

/** Payload of the hello command; its reply carries the firmware string. */
export function helloPayload(): Uint8Array {
  return Uint8Array.of(0x14, 0x05, 0x04, 0x00, ...SESSION);
}

/** Payload asking for `length` bytes at `offset`. */
export function readMemPayload(offset: number, length: number): Uint8Array {
  return Uint8Array.of(
    0x1b, 0x05, 0x08, 0x00,
    offset & 0xff, (offset >> 8) & 0xff, length & 0xff, 0x00,
    ...SESSION,
  );
}

/** Payload writing `data` at `offset`. */
export function writeMemPayload(offset: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + SESSION.length + data.length);
  out.set([0x1d, 0x05, data.length + 8, 0x00, offset & 0xff, (offset >> 8) & 0xff, data.length, 0x01]);
  out.set(SESSION, 8);
  out.set(data, 8 + SESSION.length);
  return out;
}

/** Firmware string carried by a hello reply: bytes 4 onwards, up to the first non-printable byte. */
export function firmwareFromHello(payload: Uint8Array): string {
  const raw = payload.subarray(4, 24);
  let end = 0;
  while (end < raw.length && raw[end] >= 0x20 && raw[end] <= 0x7e) end++;
  return String.fromCharCode(...raw.subarray(0, end)).trim();
}

/** Memory contents carried by a read reply (the 8-byte answer header is dropped). */
export function memoryFromReadReply(payload: Uint8Array): Uint8Array {
  if (payload.length < 8) throw new Error('UV-K5: short read reply');
  return payload.subarray(8);
}

/** True when a write reply confirms the offset that was asked for. */
export function writeAccepted(payload: Uint8Array, offset: number): boolean {
  return (
    payloadCommand(payload) === CMD.WRITE_MEM_REPLY &&
    payload.length >= 6 &&
    payload[4] === (offset & 0xff) &&
    payload[5] === ((offset >> 8) & 0xff)
  );
}
