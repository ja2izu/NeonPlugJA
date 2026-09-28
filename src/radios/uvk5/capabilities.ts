/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import type { RadioCapabilities, MemoryRegionSpec } from '../../types/radioCapabilities';
import {
  UVK5_ADDR, UVK5_CHANNEL_SIZE, UVK5_EEPROM_SIZE, UVK5_MAX_CHANNELS,
  UVK5_MAX_NAME_LENGTH, UVK5_NAME_SIZE,
} from './constants';

/** Map of the 8 KB EEPROM, for the Diagnostics image viewer. */
const UVK5_MEMORY_REGIONS: MemoryRegionSpec[] = [
  {
    label: 'Channels',
    start: UVK5_ADDR.CHANNELS,
    length: 214 * UVK5_CHANNEL_SIZE,
    notes: `${UVK5_MAX_CHANNELS} memories; the records above those hold VFO and band presets.`,
  },
  {
    label: 'Channel attributes',
    start: UVK5_ADDR.CHANNEL_ATTR,
    length: 207,
    notes: '1 byte each: scan lists (bits 7-5), compander (4-3), band (2-0).',
  },
  { label: 'FM presets', start: UVK5_ADDR.FM_PRESETS, length: 40 },
  { label: 'Settings', start: UVK5_ADDR.SETTINGS, length: UVK5_ADDR.CHANNEL_NAMES - UVK5_ADDR.SETTINGS },
  {
    label: 'Channel names',
    start: UVK5_ADDR.CHANNEL_NAMES,
    length: UVK5_MAX_CHANNELS * UVK5_NAME_SIZE,
    notes: `${UVK5_NAME_SIZE} bytes each; the radio shows ${UVK5_MAX_NAME_LENGTH}.`,
  },
  { label: 'DTMF contacts', start: UVK5_ADDR.DTMF_CONTACTS, length: 16 * 16 },
  {
    label: 'Calibration',
    start: UVK5_ADDR.CALIBRATION,
    length: UVK5_ADDR.BUILD_OPTIONS - UVK5_ADDR.CALIBRATION,
    notes: 'Never written by this driver. Losing it needs a factory alignment to restore.',
  },
  { label: 'Build options', start: UVK5_ADDR.BUILD_OPTIONS, length: 2, notes: 'Features compiled into the running firmware.' },
  {
    label: 'F4HWN settings',
    start: UVK5_ADDR.F4HWN_SETTINGS,
    length: UVK5_EEPROM_SIZE - UVK5_ADDR.F4HWN_SETTINGS,
    notes: 'Firmware-specific; not written by this driver.',
  },
];

export const UVK5_CAPS: RadioCapabilities = {
  memoryRegions: UVK5_MEMORY_REGIONS,
  // Wide receive, transmit limited by the firmware itself.
  bandLimits: { vhfMin: 18, vhfMax: 174, uhfMin: 350, uhfMax: 1300 },
  writeValidations: { channelsMustBeInZones: false },
  maxChannels: UVK5_MAX_CHANNELS,
  maxChannelNameLength: UVK5_MAX_NAME_LENGTH,
  channelDeleteKeepsNumbers: true,
  supportsZones: false,
  supportsScanLists: false,
  supportsContacts: false,
  analogOnly: true,
  supportsBle: false,
  preferredTransport: 'serial',
  supportsBulkRead: false,
};
