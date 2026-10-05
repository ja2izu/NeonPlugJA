/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import type { RadioCapabilities, MemoryRegionSpec } from '../../types/radioCapabilities';
import {
  UVK1_ADDR, UVK1_ATTR_SIZE, UVK1_CHANNEL_SIZE, UVK1_IMAGE_EXT_BASE, UVK1_LIST_NAME_SIZE, UVK1_MAX_CHANNELS,
  UVK1_MAX_NAME_BYTES, UVK1_MAX_NAME_BYTES_LONG, UVK1_NAME_SIZE, UVK1_SCAN_LISTS,
} from './constants';

/** Map of the image this driver reads, for the Diagnostics image viewer. */
const UVK1_MEMORY_REGIONS: MemoryRegionSpec[] = [
  {
    label: 'Channels',
    start: UVK1_ADDR.CHANNELS,
    length: UVK1_MAX_CHANNELS * UVK1_CHANNEL_SIZE,
    notes: `${UVK1_MAX_CHANNELS} memories, 16 bytes each. Blocks without a used channel are not read (shown as FF).`,
  },
  {
    label: 'Channel names',
    start: UVK1_ADDR.CHANNEL_NAMES,
    length: UVK1_MAX_CHANNELS * UVK1_NAME_SIZE,
    notes: `UTF-8, at most ${UVK1_MAX_NAME_BYTES} bytes (5 kanji / kana), rest 0. On 25Ja with long names all 16 bytes are used and the name goes on in the second slot.`,
  },
  {
    label: 'Channel names, second slot (25Ja long names)',
    start: UVK1_IMAGE_EXT_BASE,
    length: UVK1_MAX_CHANNELS * UVK1_NAME_SIZE,
    notes: `SPI 0x020000 + 16*n on the radio. Bytes 17-${UVK1_MAX_NAME_BYTES_LONG} of names that fill the first slot; read only for those.`,
  },
  {
    label: 'Channel attributes',
    start: UVK1_ADDR.CHANNEL_ATTR,
    length: UVK1_ADDR.LIST_NAMES - UVK1_ADDR.CHANNEL_ATTR,
    notes: `${UVK1_ATTR_SIZE} bytes each (1024 memories + 7 VFO): band 2-0 (7 = unused), compander 4-3, exclude 7, scan list 15-8.`,
  },
  {
    label: 'Scan list names',
    start: UVK1_ADDR.LIST_NAMES,
    length: UVK1_SCAN_LISTS * UVK1_LIST_NAME_SIZE,
    notes: `${UVK1_SCAN_LISTS} names, ${UVK1_LIST_NAME_SIZE} bytes each.`,
  },
];

export const UVK1_CAPS: RadioCapabilities = {
  memoryRegions: UVK1_MEMORY_REGIONS,
  // The radio stores anything from 18 to 1300 MHz (ENABLE_WIDE_RX); transmit is
  // limited by the firmware itself (F Lock). Contiguous on purpose: the app
  // drops channels outside these limits before a write, and a dropped channel
  // would be deleted from the radio.
  bandLimits: { vhfMin: 18, vhfMax: 350, uhfMin: 350, uhfMax: 1300 },
  writeValidations: { channelsMustBeInZones: false },
  maxChannels: UVK1_MAX_CHANNELS,
  // Characters the editor accepts. The radio counts bytes (UTF-8): 15 on 25ja /
  // Dondji, 31 on 25Ja with long names; the write checks bytes per radio.
  maxChannelNameLength: UVK1_MAX_NAME_BYTES_LONG,
  // The limit is in UTF-8 bytes (kanji / kana 3 each): the editor cuts the name
  // at 31 bytes while typing. A radio without long names (15) is still checked at write.
  channelNameUtf8Bytes: true,
  channelDeleteKeepsNumbers: true,
  supportsZones: false,
  // Scan lists: 24 slots, a channel holds a number (0 none, 1-24, 25 all). The radio's
  // 25ja holds list names (UTF-8, 12 bytes at SPI 0x8880): written and read back.
  supportsScanLists: true,
  maxScanLists: UVK1_SCAN_LISTS,
  maxScanListNameLength: 12,
  scanListNameUtf8Bytes: true,
  scanListsBySlot: true,
  scanListAllValue: UVK1_SCAN_LISTS + 1,
  scanListNamesAppSideOnly: true,
  scanExcludeEditable: true,
  scanListFields: [],
  supportsContacts: false,
  analogOnly: true,
  noTxContactColumn: true,
  // Seven steps (Dondji OUTPUT_POWER_LOW1..HIGH; the channel stores 1-7).
  powerLevels: ['Low1', 'Low2', 'Low3', 'Low4', 'Low5', 'Medium', 'High'],
  supportsBle: false,
  preferredTransport: 'serial',
  supportsBulkRead: false,
  // Names are UTF-8 on the radio, so a CSV may carry kanji / kana: always BOM.
  csvExportUtf8Bom: true,
};
