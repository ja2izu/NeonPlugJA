/*
 * NeonPlugJA Ver.0.94 — Quansheng UV-K1 (25Ja firmware) global settings
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * 25Ja (UV-K1) global settings: the area 0xA000–0xA17F of the SPI / EEPROM
 * command space.
 *
 * Source of the layout: the 25Ja firmware source (Fusion build) as read by the
 * firmware担当, cross-checked with CHIRP's F4HWN driver v6.1.0. NOT verified on
 * a real radio (実機未確認).
 *
 * Rules kept here:
 *  - Only the bits listed in WRITE_MASKS can ever be written. Everything else in
 *    the area (key-lock state, bytes the radio writes itself, 0xA160–0xA177
 *    which 25Ja uses for language / boot hint / boot sound and which CHIRP uses
 *    for MIX scan, calibration, AES and so on) is never touched.
 *  - A value is checked only when the user changed it. A value the radio holds
 *    that this table does not know (key action 5, roger beep 2 ...) is shown as
 *    it is and is never written back unless the user picks another one.
 *  - The radio loads these settings once at start-up, so it has to be switched
 *    off and on after a write.
 */

export const UVK1_SETTINGS_BASE = 0xa000;
export const UVK1_SETTINGS_SIZE = 0x180;

/** Settings values by key; all numbers (check boxes use 0 / 1). */
export type Uvk1Settings = Record<string, number>;

interface FieldDef {
  key: string;
  addr: number;
  /** 1 = one byte (bit field), 2 = little-endian 16 bit. */
  width: 1 | 2;
  /** Bit mask inside the byte (width 1). Ignored for width 2. */
  mask: number;
  shift: number;
  /** Stored value → value shown. */
  toUi: (raw: number) => number;
  /** Value shown → stored value. */
  toRaw: (ui: number) => number;
  /** Whether a value shown may be written. */
  valid: (ui: number) => boolean;
  /** Extra bits cleared whenever this field is written (addr → mask). */
  alsoClear?: { addr: number; mask: number };
}

const same = (n: number) => n;
const range = (lo: number, hi: number) => (v: number) => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = (list: readonly number[]) => (v: number) => list.includes(v);

/** Key action IDs of 25Ja that the Fusion menu offers (CHIRP's numbers differ). */
export const UVK1_KEY_ACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0, 'NONE'], [1, 'FLASHLIGHT'], [2, 'POWER'], [3, 'MONITOR'], [4, 'SCAN'], [7, 'FM RADIO'],
  [9, 'LOCK KEYPAD'], [10, 'VFO A/B'], [11, 'VFO/MEM'], [12, 'MODE'], [14, 'RX MODE'],
  [15, 'MAIN ONLY'], [16, 'PTT'], [17, 'WIDE/NARROW'], [19, 'MUTE'], [20, 'RxA'],
];
const KEY_ACTION_IDS = UVK1_KEY_ACTIONS.map(([id]) => id);

/** Roger beep values that work in Fusion (2 = MDC and 3 = Yan ID do not). */
export const UVK1_ROGER_VALUES = [0, 1, 4, 5, 6] as const;

const PRIORITY_NONE_RAW = 1024;
/** Channel number shown (0 = none) ↔ stored index (1024 = none). */
const priorityToUi = (raw: number) => (raw >= 0 && raw < PRIORITY_NONE_RAW ? raw + 1 : 0);
const priorityToRaw = (ui: number) => (ui === 0 ? PRIORITY_NONE_RAW : ui - 1);
const callToUi = (raw: number) => (raw >= 0 && raw < PRIORITY_NONE_RAW ? raw + 1 : 0);

function bits(key: string, addr: number, mask: number, valid: (v: number) => boolean, extra?: Partial<FieldDef>): FieldDef {
  let shift = 0;
  while (((mask >> shift) & 1) === 0) shift++;
  return { key, addr, width: 1, mask, shift, toUi: same, toRaw: same, valid, ...extra };
}

const FIELDS: FieldDef[] = [
  // 基本
  bits('squelch', 0xa001, 0xff, range(0, 9)),
  bits('txTimeoutSec', 0xa002, 0xff, (v) => Number.isInteger(v) && v >= 30 && v <= 900 && v % 5 === 0, {
    toUi: (r) => (r + 1) * 5, toRaw: (u) => u / 5 - 1,
  }),
  bits('batterySave', 0xa00b, 0xff, range(0, 5)),
  bits('micGain', 0xa007, 0xff, range(0, 8)),
  bits('ste', 0xa00e, 0x01, range(0, 1)),
  bits('rpSte', 0xa0c2, 0xff, range(0, 10)),
  bits('roger', 0xa0c1, 0xff, oneOf(UVK1_ROGER_VALUES), { toUi: (r) => (r === 2 || r === 3 ? 0 : r) }),
  bits('scanResume', 0xa0ad, 0xff, range(0, 104)),
  // 0xA15F bit1 is stored inverted: 1 = NORMAL, 0 = FAST. Shown: 0 = NORMAL, 1 = FAST.
  bits('scanFast', 0xa15f, 0x02, range(0, 1), { toUi: (r) => (r ? 0 : 1), toRaw: (u) => (u ? 0 : 1) }),
  bits('priorityScan', 0xa130, 0x80, range(0, 1)),
  bits('defaultList', 0xa130, 0x7f, range(1, 25)),
  { key: 'priorityCh1', addr: 0xa131, width: 2, mask: 0xffff, shift: 0, toUi: priorityToUi, toRaw: priorityToRaw, valid: range(0, 1024) },
  { key: 'priorityCh2', addr: 0xa133, width: 2, mask: 0xffff, shift: 0, toUi: priorityToUi, toRaw: priorityToRaw, valid: range(0, 1024) },
  { key: 'callCh', addr: 0xa135, width: 2, mask: 0xffff, shift: 0, toUi: callToUi, toRaw: (u) => u - 1, valid: range(1, 1024) },
  // 表示・音・バックライト
  bits('chDisplay', 0xa009, 0xff, range(0, 3)),
  bits('backlightTime', 0xa00d, 0xff, range(0, 61)),
  bits('backlightMin', 0xa008, 0xf0, range(0, 10)),
  bits('backlightMax', 0xa008, 0x0f, range(0, 10)),
  bits('backlightTxRx', 0xa157, 0xc0, range(0, 3)),
  bits('batteryText', 0xa157, 0x0c, range(0, 2)),
  // bit5 of 0xA157 is always written as 0 (firmware recommendation).
  bits('micBar', 0xa157, 0x10, range(0, 1), { alsoClear: { addr: 0xa157, mask: 0x20 } }),
  bits('contrast', 0xa15d, 0x0f, range(1, 15)),
  bits('keyBeep', 0xa0a8, 0x01, range(0, 1)),
  // 動作
  bits('lockRange', 0xa15d, 0x20, range(0, 1)),
  bits('autoKeyLock', 0xa0ae, 0xff, (v) => Number.isInteger(v) && v >= 0 && v <= 600 && v % 15 === 0, {
    toUi: (r) => r * 15, toRaw: (u) => u / 15,
  }),
  bits('sleepMin', 0xa15c, 0xfe, range(0, 120)),
  bits('timer', 0xa15c, 0x01, range(0, 1)),
  bits('navKeys', 0xa004, 0x40, range(0, 1)),
  bits('batteryType', 0xa0c4, 0xff, range(0, 4)),
  bits('fLock', 0xa150, 0xff, range(0, 9)),
  bits('rx350', 0xa155, 0xff, range(0, 1)),
  // キー割当（bits 7-1 of 0xA0A8 = MENU 長押し）
  bits('keyMenuLong', 0xa0a8, 0xfe, oneOf(KEY_ACTION_IDS)),
  bits('keyPf1Short', 0xa0a9, 0xff, oneOf(KEY_ACTION_IDS)),
  bits('keyPf1Long', 0xa0aa, 0xff, oneOf(KEY_ACTION_IDS)),
  bits('keyPf2Short', 0xa0ab, 0xff, oneOf(KEY_ACTION_IDS)),
  bits('keyPf2Long', 0xa0ac, 0xff, oneOf(KEY_ACTION_IDS)),
];

/** Receive mode: stored in two bytes together with the main VFO (see decode / encode). */
const ADDR_CROSSBAND = 0xa00a;
const ADDR_DUAL_WATCH = 0xa00c;
const ADDR_TX_VFO = 0xa0c3;

/** Bits that may ever change, by address. The write guard checks against this. */
export const UVK1_WRITE_MASKS: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  const add = (addr: number, mask: number) => m.set(addr, (m.get(addr) ?? 0) | mask);
  for (const f of FIELDS) {
    if (f.width === 2) { add(f.addr, 0xff); add(f.addr + 1, 0xff); } else add(f.addr, f.mask);
    if (f.alsoClear) add(f.alsoClear.addr, f.alsoClear.mask);
  }
  add(ADDR_CROSSBAND, 0xff);
  add(ADDR_DUAL_WATCH, 0xff);
  add(ADDR_TX_VFO, 0xff);
  return m;
})();

function rawOf(region: Uint8Array, f: FieldDef): number {
  const o = f.addr - UVK1_SETTINGS_BASE;
  if (f.width === 2) return region[o] | (region[o + 1] << 8);
  return (region[o] & f.mask) >> f.shift;
}

/** Decode the settings area into values shown. */
export function decodeSettings(region: Uint8Array): Uvk1Settings {
  if (region.length < UVK1_SETTINGS_SIZE) throw new Error('UV-K1: settings area too short');
  const out: Uvk1Settings = {};
  for (const f of FIELDS) out[f.key] = f.toUi(rawOf(region, f));
  const cb = region[ADDR_CROSSBAND - UVK1_SETTINGS_BASE];
  const dw = region[ADDR_DUAL_WATCH - UVK1_SETTINGS_BASE];
  out.rxMode = (dw !== 0 ? 1 : 0) + (cb !== 0 ? 2 : 0);
  out.txVfo = region[ADDR_TX_VFO - UVK1_SETTINGS_BASE];
  return out;
}

/**
 * New settings area: `region` with every field that differs between `base` and
 * `next` written in. Throws, naming the field, when a changed value is not
 * allowed. Bytes of fields that did not change stay exactly as they are.
 */
export function encodeSettings(region: Uint8Array, base: Uvk1Settings, next: Uvk1Settings): Uint8Array {
  if (region.length < UVK1_SETTINGS_SIZE) throw new Error('UV-K1: settings area too short');
  const out = region.slice();
  const changed = (key: string) => next[key] !== undefined && next[key] !== base[key];

  for (const f of FIELDS) {
    if (!changed(f.key)) continue;
    const ui = next[f.key];
    if (!f.valid(ui)) throw new Error(`UV-K1: value ${ui} is not allowed for "${f.key}". Nothing was written.`);
    const raw = f.toRaw(ui);
    const o = f.addr - UVK1_SETTINGS_BASE;
    if (f.width === 2) {
      out[o] = raw & 0xff;
      out[o + 1] = (raw >> 8) & 0xff;
    } else {
      out[o] = (out[o] & ~f.mask & 0xff) | ((raw << f.shift) & f.mask);
    }
    if (f.alsoClear) out[f.alsoClear.addr - UVK1_SETTINGS_BASE] &= ~f.alsoClear.mask & 0xff;
  }

  if (changed('backlightMin') || changed('backlightMax')) {
    const lo = next.backlightMin ?? base.backlightMin;
    const hi = next.backlightMax ?? base.backlightMax;
    if (!(lo < hi)) throw new Error('UV-K1: backlight minimum must be smaller than the maximum. Nothing was written.');
  }

  if (changed('rxMode') || changed('txVfo')) {
    const mode = next.rxMode ?? base.rxMode;
    const vfo = next.txVfo ?? base.txVfo;
    if (!oneOf([0, 1, 2, 3])(mode)) throw new Error(`UV-K1: value ${mode} is not allowed for "rxMode". Nothing was written.`);
    if (vfo !== 0 && vfo !== 1) throw new Error(`UV-K1: value ${vfo} is not allowed for "txVfo". Nothing was written.`);
    const main = vfo + 1;
    out[ADDR_DUAL_WATCH - UVK1_SETTINGS_BASE] = mode & 1 ? main : 0;
    out[ADDR_CROSSBAND - UVK1_SETTINGS_BASE] = mode & 2 ? main : 0;
    out[ADDR_TX_VFO - UVK1_SETTINGS_BASE] = vfo;
  }
  return out;
}

export interface SettingsWriteRun {
  /** SPI address. */
  address: number;
  data: Uint8Array;
}

const MAX_RUN = 120;

/** Runs of bytes that differ between two settings areas (each at most 120 bytes). */
export function planSettingsWrites(oldRegion: Uint8Array, newRegion: Uint8Array): SettingsWriteRun[] {
  const runs: SettingsWriteRun[] = [];
  let i = 0;
  while (i < UVK1_SETTINGS_SIZE) {
    if (oldRegion[i] === newRegion[i]) { i++; continue; }
    let j = i;
    while (j < UVK1_SETTINGS_SIZE && oldRegion[j] !== newRegion[j] && j - i < MAX_RUN) j++;
    runs.push({ address: UVK1_SETTINGS_BASE + i, data: newRegion.slice(i, j) });
    i = j;
  }
  return runs;
}

/** Throws unless the write touches only bits listed in UVK1_WRITE_MASKS. */
export function assertSettingsWritable(oldRegion: Uint8Array, run: SettingsWriteRun): void {
  for (let k = 0; k < run.data.length; k++) {
    const addr = run.address + k;
    const o = addr - UVK1_SETTINGS_BASE;
    const mask = UVK1_WRITE_MASKS.get(addr) ?? 0;
    if (((oldRegion[o] ^ run.data[k]) & ~mask & 0xff) !== 0) {
      throw new Error(`UV-K1: refusing to write 0x${addr.toString(16)} (not a settings byte this driver may change).`);
    }
  }
}
