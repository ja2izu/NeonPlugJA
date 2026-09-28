/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * The UV-K1 uses the same packets as the UV-K5 (see ../uvk5/framing.ts):
 * header AB CD, scrambled payload + CRC, tail DC BA, and the same hello,
 * EEPROM read and EEPROM write commands. Those are imported from there.
 *
 * Added here: the SPI flash read (0x051F) that Dondji and 25ja answer and the
 * F4HWN firmwares for the UV-K5 and UV-K1 do not (they list 0x051F as
 * "Not implementing non-authentic command" and send nothing back). It is what
 * tells this radio apart, since all of them report "F4HWN ..." to hello.
 *
 *   command  1F 05 | 0C 00 | address u32 | size u16 | padding u16 | session u32
 *   reply    20 05 | size+8 u16 | address u32 | size u16 | padding u16 | data
 */
import { SESSION } from '../uvk5/framing';

export const CMD_SPI_READ = 0x051f;
export const CMD_SPI_READ_REPLY = 0x0520;

/** Payload asking for `length` bytes of SPI flash at `address`. */
export function spiReadPayload(address: number, length: number): Uint8Array {
  return Uint8Array.of(
    0x1f, 0x05, 0x0c, 0x00,
    address & 0xff, (address >>> 8) & 0xff, (address >>> 16) & 0xff, (address >>> 24) & 0xff,
    length & 0xff, (length >>> 8) & 0xff, 0x00, 0x00,
    ...SESSION,
  );
}

/** Data carried by an SPI flash read reply, checked against the address asked for. */
export function dataFromSpiReadReply(payload: Uint8Array, address: number): Uint8Array {
  if (payload.length < 12) throw new Error('UV-K1: short SPI read reply');
  const id = payload[0] | (payload[1] << 8);
  if (id !== CMD_SPI_READ_REPLY) throw new Error(`UV-K1: unexpected reply 0x${id.toString(16)} to SPI read`);
  const at = (payload[4] | (payload[5] << 8) | (payload[6] << 16) | (payload[7] << 24)) >>> 0;
  if (at !== address >>> 0) throw new Error(`UV-K1: SPI read answered for 0x${at.toString(16)}, asked 0x${address.toString(16)}`);
  const size = payload[8] | (payload[9] << 8);
  return payload.subarray(12, 12 + size);
}
