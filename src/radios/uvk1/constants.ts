/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 *
 * Addresses and bit positions are facts about the firmware, read from the
 * Dondji v5.2.8 source (EthanYan6/Dondji 9f6263c, Apache-2.0) and the 25ja
 * patches 0001-0007 on top of it:
 *   App/driver/eeprom_compat.c  EEPROM address -> SPI flash address table
 *   App/app/uart.c              commands 0x0514 / 0x051B / 0x051D / 0x051F / 0x0521
 *   App/misc.h                  ChannelAttributes_t, MR_CHANNELS_MAX, MR_CHANNELS_LIST
 *   App/settings.c              SETTINGS_FetchChannelName / SETTINGS_SaveChannelName
 *   App/settings.h              CN_FONT_* (font location and version byte)
 * No code was copied; this is written from scratch.
 */

/** Serial speed. The radio also answers over its own USB port, where the speed is ignored. */
export const UVK1_BAUD_RATE = 38400;

/** Largest read the radio answers with command 0x051B (the size field is one byte; reply buffer holds 128). */
export const UVK1_BLOCK_SIZE = 0x80;

/** Largest read the radio answers with command 0x051F (SPI_FLASH_READ_SIZE). */
export const UVK1_SPI_READ_MAX = 120;

/**
 * Memory channels. MR_CHANNELS_MAX in App/misc.h. The radio numbers them 1-1024.
 */
export const UVK1_MAX_CHANNELS = 1024;

/** Scan lists (MR_CHANNELS_LIST). Attribute scanlist: 0 = none, 1-24 = that list, 25 = all lists. */
export const UVK1_SCAN_LISTS = 24;

/**
 * Addresses as seen through the EEPROM commands (0x051B / 0x051D).
 * eeprom_compat.c maps each of these 1:1 onto the SPI flash.
 */
export const UVK1_ADDR = {
  /** 16 bytes per channel, 1024 channels: 0x0000-0x3FFF */
  CHANNELS: 0x0000,
  /** 16 bytes per channel name, 1024 names: 0x4000-0x7FFF */
  CHANNEL_NAMES: 0x4000,
  /** 2 bytes per channel: 1024 MR + 7 VFO attributes, 0x8000-0x880D */
  CHANNEL_ATTR: 0x8000,
  /** Scan list names, 24 x 4 bytes, 0x880E-0x886D */
  LIST_NAMES: 0x880e,
  /** End of the mapped attribute area (exclusive) */
  ATTR_AREA_END: 0x886e,
  /** VFO records */
  VFO: 0x9000,
  /** Settings */
  SETTINGS: 0xa000,
  /** Calibration (maps to SPI 0x010000). Never written by this driver. */
  CALIBRATION: 0xb000,
} as const;

export const UVK1_CHANNEL_SIZE = 16;
export const UVK1_NAME_SIZE = 16;
export const UVK1_ATTR_SIZE = 2;
export const UVK1_LIST_NAME_SIZE = 4;

/**
 * Longest name in bytes (CHANNEL_NAME_MAX_BYTES). The name is UTF-8, so this is
 * 15 ASCII characters or 5 kanji / kana (3 bytes each).
 */
export const UVK1_MAX_NAME_BYTES = 15;

/** Attribute band value of an unused slot (band > BAND7_470MHz means empty). */
export const UVK1_BAND_EMPTY = 7;

/** Where the font starts in the SPI flash (CN_FONT_FLASH_BASE). */
export const UVK1_FONT_BASE = 0x024000;

/**
 * Font version byte. Each font build puts its version at the end of the font,
 * so the byte sits at a different place per build.
 */
export const UVK1_FONT_PROFILES = [
  /** 25ja: Shinonome 12 dot, JIS X 0208 (6647 characters), version 4 */
  { id: '25ja', label: '25ja (Shinonome JIS X 0208)', versionOffset: 186116, version: 4 },
  /** Dondji official: WenQuanYi, GB2312 (6766 characters), version 2 */
  { id: 'dondji', label: 'Dondji (WenQuanYi GB2312)', versionOffset: 205366, version: 2 },
] as const;

export type UVK1FontId = (typeof UVK1_FONT_PROFILES)[number]['id'] | 'unknown';
