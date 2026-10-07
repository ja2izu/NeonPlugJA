import { describe, it, expect } from 'vitest';
import {
  UVK1_SETTINGS_BASE, UVK1_SETTINGS_SIZE, UVK1_WRITE_MASKS, assertSettingsWritable,
  decodeSettings, encodeSettings, planSettingsWrites,
} from '../../src/radios/uvk1/settings';
import { UVK1_SETTINGS_PROFILE } from '../../src/radios/uvk1/settingsProfile';

const at = (a: number) => a - UVK1_SETTINGS_BASE;
function blank(fill = 0x00): Uint8Array {
  return new Uint8Array(UVK1_SETTINGS_SIZE).fill(fill);
}
/** A region with distinctive bytes everywhere, so a stray write shows. */
function patterned(): Uint8Array {
  const r = blank();
  for (let i = 0; i < r.length; i++) r[i] = (i * 37 + 11) & 0xff;
  return r;
}
function change(region: Uint8Array, patch: Record<string, number>) {
  const base = decodeSettings(region);
  return encodeSettings(region, base, { ...base, ...patch });
}
function diffAddrs(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(UVK1_SETTINGS_BASE + i);
  return out;
}

describe('UV-K1 (25Ja) settings codec', () => {
  it('an unchanged settings object writes nothing', () => {
    const r = patterned();
    const base = decodeSettings(r);
    const out = encodeSettings(r, base, { ...base });
    expect(diffAddrs(r, out)).toEqual([]);
    expect(planSettingsWrites(r, out)).toEqual([]);
  });

  it('a plain byte field changes only its byte', () => {
    const r = patterned();
    const out = change(r, { squelch: 5 });
    expect(diffAddrs(r, out)).toEqual(r[at(0xa001)] === 5 ? [] : [0xa001]);
    expect(out[at(0xa001)]).toBe(5);
  });

  it('bit fields keep the other bits of the byte', () => {
    const r = blank(0xff);
    r[at(0xa008)] = 0x3a; // min 3, max 10
    const out = change(r, { backlightMin: 1 });
    expect(out[at(0xa008)]).toBe(0x1a);
    const out2 = change(r, { backlightMax: 9 });
    expect(out2[at(0xa008)]).toBe(0x39);
  });

  it('key lock state (0xA004 bit0) and other bits survive the nav-key change', () => {
    const r = blank();
    r[at(0xa004)] = 0b1010_0001;
    const out = change(r, { navKeys: 1 });
    expect(out[at(0xa004)]).toBe(0b1110_0001);
  });

  it('scan speed is stored inverted (stored 1 = NORMAL)', () => {
    const r = blank();
    r[at(0xa15f)] = 0b0110_0010; // stored 1 -> NORMAL
    expect(decodeSettings(r).scanFast).toBe(0);
    const out = change(r, { scanFast: 1 });
    expect(out[at(0xa15f)]).toBe(0b0110_0000);
    r[at(0xa15f)] = 0xff; // erased: NORMAL
    expect(decodeSettings(r).scanFast).toBe(0);
  });

  it('sleep timer is minutes in bits 7-1 and leaves bit0 (timer) alone', () => {
    const r = blank();
    r[at(0xa15c)] = 0x01;
    const out = change(r, { sleepMin: 120 });
    expect(out[at(0xa15c)]).toBe((120 << 1) | 1);
    expect(decodeSettings(out).sleepMin).toBe(120);
    expect(() => change(r, { sleepMin: 121 })).toThrow();
  });

  it('mic bar write clears bit5 of 0xA157 and keeps the other bits', () => {
    const r = blank();
    r[at(0xa157)] = 0b1110_1100;
    const out = change(r, { micBar: 1 });
    expect(out[at(0xa157)]).toBe(0b1101_1100);
  });

  it('contrast and lock range share 0xA15D without touching bits 7, 6, 4', () => {
    const r = blank();
    r[at(0xa15d)] = 0b1101_0101;
    const out = change(r, { contrast: 9, lockRange: 1 });
    expect(out[at(0xa15d)]).toBe(0b1111_1001);
    expect(() => change(r, { contrast: 0 })).toThrow();
  });

  it('receive mode and main VFO are composed from three bytes', () => {
    const r = blank();
    expect(decodeSettings(r).rxMode).toBe(0);
    let out = change(r, { rxMode: 3, txVfo: 1 });
    expect(out[at(0xa00c)]).toBe(2);
    expect(out[at(0xa00a)]).toBe(2);
    expect(out[at(0xa0c3)]).toBe(1);
    expect(decodeSettings(out).rxMode).toBe(3);
    out = change(r, { rxMode: 2 });
    expect(out[at(0xa00a)]).toBe(1);
    expect(out[at(0xa00c)]).toBe(0);
    out = change(r, { rxMode: 1 });
    expect(out[at(0xa00c)]).toBe(1);
    expect(out[at(0xa00a)]).toBe(0);
    expect(() => change(r, { rxMode: 4 })).toThrow();
    expect(() => change(r, { txVfo: 2 })).toThrow();
  });

  it('changing the main VFO alone keeps the receive mode', () => {
    const r = blank();
    r[at(0xa00a)] = 1;
    r[at(0xa00c)] = 1;
    const out = change(r, { txVfo: 1 });
    expect(out[at(0xa00a)]).toBe(2);
    expect(out[at(0xa00c)]).toBe(2);
    expect(decodeSettings(out).rxMode).toBe(3);
  });

  it('priority and call channels map 1024 and 0 and are 16 bit little endian', () => {
    const r = blank(0xff);
    expect(decodeSettings(r).priorityCh1).toBe(0);
    const out = change(r, { priorityCh1: 300, priorityCh2: 12, callCh: 1024 });
    expect(out[at(0xa131)] | (out[at(0xa132)] << 8)).toBe(299);
    expect(out[at(0xa133)] | (out[at(0xa134)] << 8)).toBe(11);
    expect(out[at(0xa135)] | (out[at(0xa136)] << 8)).toBe(1023);
    const none = change(out, { priorityCh1: 0 });
    expect(none[at(0xa131)] | (none[at(0xa132)] << 8)).toBe(1024);
    expect(() => change(r, { callCh: 1025 })).toThrow();
    expect(() => change(r, { priorityCh1: 1025 })).toThrow();
  });

  it('default scan group keeps the priority-scan bit, and 26 (MIX) is refused', () => {
    const r = blank();
    r[at(0xa130)] = 0x80 | 3;
    const out = change(r, { defaultList: 25 });
    expect(out[at(0xa130)]).toBe(0x80 | 25);
    expect(() => change(r, { defaultList: 26 })).toThrow();
    expect(() => change(r, { defaultList: 0 })).toThrow();
  });

  it('roger beep: 2 and 3 are shown as OFF, never offered, and not written back', () => {
    const r = blank();
    r[at(0xa0c1)] = 2;
    expect(decodeSettings(r).roger).toBe(0);
    expect(diffAddrs(r, change(r, {}))).toEqual([]);
    expect(() => change(r, { roger: 2 })).toThrow();
    expect(change(r, { roger: 4 })[at(0xa0c1)]).toBe(4);
  });

  it('key actions: only the Fusion IDs can be chosen; unknown values stay unless changed', () => {
    const r = blank();
    r[at(0xa0a9)] = 5; // not offered
    expect(diffAddrs(r, change(r, {}))).toEqual([]);
    expect(() => change(r, { keyPf1Long: 5 })).toThrow();
    expect(() => change(r, { keyPf1Short: 21 })).toThrow();
    expect(change(r, { keyPf1Short: 16 })[at(0xa0a9)]).toBe(16);
    r[at(0xa0a8)] = 0b0000_1001; // menu long 4, beep on
    const out = change(r, { keyMenuLong: 20 });
    expect(out[at(0xa0a8)]).toBe((20 << 1) | 1);
  });

  it('TX time-out is stored as (value+1)*5 s and seconds must be a multiple of 5', () => {
    const r = blank();
    expect(decodeSettings(r).txTimeoutSec).toBe(5);
    expect(change(r, { txTimeoutSec: 30 })[at(0xa002)]).toBe(5);
    expect(change(r, { txTimeoutSec: 900 })[at(0xa002)]).toBe(179);
    expect(() => change(r, { txTimeoutSec: 33 })).toThrow();
    expect(() => change(r, { txTimeoutSec: 25 })).toThrow();
  });

  it('auto key lock is a multiple of 15 s up to 600 s', () => {
    const r = blank();
    expect(change(r, { autoKeyLock: 600 })[at(0xa0ae)]).toBe(40);
    expect(() => change(r, { autoKeyLock: 20 })).toThrow();
  });

  it('F Lock 10 (UNLOCK ALL) and out-of-range values are refused', () => {
    const r = blank();
    expect(change(r, { fLock: 3 })[at(0xa150)]).toBe(3);
    expect(() => change(r, { fLock: 10 })).toThrow();
  });

  it('backlight minimum must be smaller than the maximum', () => {
    const r = blank();
    r[at(0xa008)] = 0x0a;
    expect(() => change(r, { backlightMin: 10 })).toThrow();
    expect(change(r, { backlightMin: 9 })[at(0xa008)]).toBe(0x9a);
  });

  it('never touches 0xA160-0xA177, the AES area, key-lock state or fixed-zero bits, whatever is changed', () => {
    const r = patterned();
    const base = decodeSettings(r);
    // Change every field to some valid, different value.
    const next = { ...base };
    const valid: Record<string, number> = {
      squelch: 4, txTimeoutSec: 60, batterySave: 2, micGain: 3, ste: 1 - base.ste, rpSte: 3, roger: 4,
      scanResume: 50, scanFast: 1 - base.scanFast, priorityScan: 1 - base.priorityScan, defaultList: 7,
      priorityCh1: 5, priorityCh2: 6, callCh: 7, chDisplay: 2, backlightTime: 12, backlightMin: 1,
      backlightMax: 8, backlightTxRx: 2, batteryText: 1, micBar: 1 - base.micBar, contrast: 8,
      keyBeep: 1 - base.keyBeep, lockRange: 1 - base.lockRange, autoKeyLock: 30, sleepMin: 10,
      timer: 1 - base.timer, navKeys: 1 - base.navKeys, batteryType: 2, fLock: 5, rx350: base.rx350 === 1 ? 0 : 1,
      keyMenuLong: 4, keyPf1Short: 3, keyPf1Long: 4, keyPf2Short: 9, keyPf2Long: 10,
      rxMode: 2, txVfo: 1,
    };
    Object.assign(next, valid);
    const out = encodeSettings(r, base, next);
    const forbidden = (a: number) =>
      (a >= 0xa160 && a <= 0xa177) || (a >= 0xa138 && a <= 0xa14f) || (a >= 0xa010 && a <= 0xa023) ||
      (a >= 0xa0c8 && a <= 0xa12f) || a === 0xa003 || a === 0xa00f;
    for (const a of diffAddrs(r, out)) expect(forbidden(a), `0x${a.toString(16)}`).toBe(false);
    // Key-lock state bit and fixed bits keep their value.
    expect(out[at(0xa004)] & 0xbf).toBe(r[at(0xa004)] & 0xbf);
    expect(out[at(0xa15f)] & 0xfd).toBe(r[at(0xa15f)] & 0xfd);
    expect(out[at(0xa00e)] & 0xfe).toBe(r[at(0xa00e)] & 0xfe);
    // Guard accepts the whole plan.
    for (const run of planSettingsWrites(r, out)) expect(() => assertSettingsWritable(r, run)).not.toThrow();
  });

  it('the write guard refuses any byte outside the mask table', () => {
    const r = patterned();
    for (const addr of [0xa003, 0xa00f, 0xa138, 0xa148, 0xa14b, 0xa160, 0xa170, 0xa171, 0xa174, 0xa10c]) {
      const bad = r.slice();
      bad[at(addr)] ^= 0xff;
      for (const run of planSettingsWrites(r, bad)) expect(() => assertSettingsWritable(r, run)).toThrow();
    }
    // A forbidden bit inside an allowed byte.
    const bad = r.slice();
    bad[at(0xa004)] ^= 0x01;
    expect(() => assertSettingsWritable(r, planSettingsWrites(r, bad)[0])).toThrow();
    expect(UVK1_WRITE_MASKS.get(0xa004)).toBe(0x40);
  });

  it('runs are at most 120 bytes and merge neighbours', () => {
    const a = blank(0x00);
    const b = blank(0xff);
    const runs = planSettingsWrites(a, b);
    expect(runs.every((r) => r.data.length <= 120)).toBe(true);
    expect(runs.reduce((n, r) => n + r.data.length, 0)).toBe(UVK1_SETTINGS_SIZE);
    const c = a.slice();
    c[at(0xa001)] = 1;
    c[at(0xa002)] = 1;
    expect(planSettingsWrites(a, c)).toEqual([{ address: 0xa001, data: new Uint8Array([1, 1]) }]);
  });

  it('every profile field is a field the codec knows, and every select offers valid values', () => {
    const keys = Object.keys(decodeSettings(blank()));
    for (const s of UVK1_SETTINGS_PROFILE.sections) {
      for (const f of s.fields) {
        const k = f.key.replace('radioSpecific.', '');
        expect(keys, f.key).toContain(k);
      }
    }
    // Selecting each non-"unknown" option of a select must be accepted by the codec.
    const r = blank();
    for (const s of UVK1_SETTINGS_PROFILE.sections) {
      for (const f of s.fields) {
        if (f.type !== 'select' || !f.options) continue;
        const k = f.key.replace('radioSpecific.', '');
        for (const o of f.options) {
          if (o.label.startsWith('不明')) continue;
          if (k === 'backlightMin' && o.value >= 10) continue; // needs max > min
          expect(() => change(r, { [k]: o.value, ...(k === 'backlightMin' ? { backlightMax: 10 } : {}) }), `${k}=${o.value}`).not.toThrow();
        }
      }
    }
  });
});
