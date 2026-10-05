/*
 * NeonPlugJA Ver.0.91 — UV-K1 (25Ja) scan list names
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import type { ScanList } from '../../models';
import { UVK1_SCAN_LISTS } from './constants';

/**
 * Names to send to the radio from the app's lists.
 * Index = list number - 1 (the list's slot, or its position when it has none).
 * Lists beyond the radio's 24 slots are ignored. A list without a name gives
 * undefined (the radio's entry is left alone).
 */
export function listNamesFromScanLists(scanLists: ReadonlyArray<ScanList>): (string | undefined)[] {
  const names: (string | undefined)[] = new Array(UVK1_SCAN_LISTS).fill(undefined);
  scanLists.forEach((list, position) => {
    const slot = list.slot ?? position;
    if (slot < 0 || slot >= UVK1_SCAN_LISTS) return;
    names[slot] = list.name.trim() === '' ? undefined : list.name;
  });
  return names;
}

/**
 * Merge the names read from the radio into the app's lists. The radio's name
 * wins where it has one; a list the app holds that the radio has no name for is
 * kept. Result sorted by slot.
 */
export function mergeRadioListNames(
  current: ReadonlyArray<ScanList>,
  radioNames: ReadonlyArray<string | undefined>,
): ScanList[] {
  const bySlot = new Map<number, ScanList>();
  current.forEach((list, position) => {
    const slot = list.slot ?? position;
    bySlot.set(slot, { ...list, slot });
  });
  radioNames.forEach((name, slot) => {
    if (name === undefined || slot >= UVK1_SCAN_LISTS) return;
    const existing = bySlot.get(slot);
    bySlot.set(slot, existing ? { ...existing, name } : { name, channels: [], ctcScanMode: 0, scanTxMode: 0, slot });
  });
  return [...bySlot.values()].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}
