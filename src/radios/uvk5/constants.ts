/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 *
 * The EEPROM layout and the framing below are facts about the radio, taken
 * from the addresses and bit positions documented by the UV-K5 community
 * (sq5bpf's reverse engineering and the CHIRP drivers derived from it) and
 * to be confirmed against dumps from a real radio. No code was copied from
 * those GPL-licensed drivers; this implementation is written from scratch.
 */

/** Programming speed of the UV-K5 cable. */
export const UVK5_BAUD_RATE = 38400;

/** Whole EEPROM: 8 KB. */
export const UVK5_EEPROM_SIZE = 0x2000;

/** Read/write unit. */
export const UVK5_BLOCK_SIZE = 0x80;

/** Addresses inside the EEPROM. */
export const UVK5_ADDR = {
  /** 16 bytes per channel */
  CHANNELS: 0x0000,
  /** 1 byte per channel: scan list, compander, band */
  CHANNEL_ATTR: 0x0d60,
  /** FM broadcast presets */
  FM_PRESETS: 0x0e40,
  /** Radio settings (squelch, display, key assignments, ...) */
  SETTINGS: 0x0e70,
  /** 16 bytes per channel name */
  CHANNEL_NAMES: 0x0f50,
  /** DTMF contacts */
  DTMF_CONTACTS: 0x1c00,
  /** Normal writes stop here */
  PROG_END: 0x1d00,
  /** Calibration — never written by this driver */
  CALIBRATION: 0x1e00,
  /** Build-time feature flags of the running firmware */
  BUILD_OPTIONS: 0x1ff0,
  /** F4HWN-specific settings — not written by this driver */
  F4HWN_SETTINGS: 0x1ff2,
} as const;

export const UVK5_CHANNEL_SIZE = 16;
export const UVK5_NAME_SIZE = 16;

/**
 * Channels this driver handles. The channel array has room for 214 records and
 * the attribute array for 207, but only 1-200 are user memories; the records
 * above that hold the VFO and band presets, which this driver leaves alone.
 */
export const UVK5_MAX_CHANNELS = 200;

/**
 * Name length the radio uses. The field is 16 bytes, but the firmware reads only
 * the first 10 and stops at the first byte below 0x20 or above 0x7E
 * (SETTINGS_FetchChannelName in the F4HWN source, reading 0x0F50 + channel*16).
 * So this is a byte count, not a character count, and anything above 0x7E ends
 * the name: the radio's fonts are ASCII-only tables and its drawing routine
 * skips bytes outside 0x21-0x7E, so no two-byte character can be shown.
 */
export const UVK5_MAX_NAME_LENGTH = 10;

/** An unused channel has 0xFF in every byte of its record. */
export const UVK5_EMPTY_BYTE = 0xff;

/** Firmware string prefix this driver supports. */
export const UVK5_FIRMWARE_MARKER = 'F4HWN';
