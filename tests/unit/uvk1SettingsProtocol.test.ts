import { describe, it, expect } from 'vitest';
import { UVK1Protocol } from '../../src/radios/uvk1/protocol';
import { UVK1_SETTINGS_BASE, UVK1_SETTINGS_SIZE } from '../../src/radios/uvk1/settings';
import type { RadioSettings } from '../../src/models/RadioSettings';

/** A fake radio: a byte array behind spiRead / spiWrite. */
function fakeRadio(font: string, flash: Uint8Array) {
  const writes: Array<{ address: number; data: Uint8Array }> = [];
  const conn = {
    spiRead: async (address: number, length: number) => {
      if (length % 2 !== 0) throw new Error('odd-sized SPI read');
      return flash.slice(address - UVK1_SETTINGS_BASE, address - UVK1_SETTINGS_BASE + length);
    },
    spiReadOld: async (address: number, length: number) => flash.slice(address - UVK1_SETTINGS_BASE, address - UVK1_SETTINGS_BASE + length),
    spiWrite: async (address: number, data: Uint8Array) => {
      if (data.length % 2 !== 0 || address % 2 !== 0) throw new Error('odd SPI write');
      writes.push({ address, data: data.slice() });
      flash.set(data, address - UVK1_SETTINGS_BASE);
    },
  };
  const p = new UVK1Protocol() as unknown as Record<string, unknown>;
  p.conn = conn;
  p.font = font;
  return { proto: p as unknown as UVK1Protocol, writes };
}

describe('UV-K1 settings through the protocol', () => {
  it('reads, changes one value, writes only that byte, verifies and keeps other bytes', async () => {
    const flash = new Uint8Array(UVK1_SETTINGS_SIZE);
    for (let i = 0; i < flash.length; i++) flash[i] = (i * 13 + 5) & 0xff;
    const before = flash.slice();
    const { proto, writes } = fakeRadio('25ja', flash);
    expect(proto.settingsWriteUnsupported).toBe(false);
    const s = (await proto.readRadioSettings()) as unknown as { radioSpecific: Record<string, number> };
    const next = { ...s, radioSpecific: { ...s.radioSpecific, squelch: s.radioSpecific.squelch === 3 ? 4 : 3 } };
    await proto.writeRadioSettings(next as unknown as RadioSettings, { changedFields: ['radioSpecific'] });
    expect(writes).toHaveLength(1);
    expect(writes[0].address).toBe(0xa000);
    expect(writes[0].data.length).toBe(2);
    flash.forEach((b, i) => { if (i !== 1) expect(b).toBe(before[i]); });
    expect(flash[1]).not.toBe(before[1]);
  });

  it('writes nothing when nothing changed', async () => {
    const flash = new Uint8Array(UVK1_SETTINGS_SIZE).fill(0x11);
    const { proto, writes } = fakeRadio('25ja', flash);
    const s = await proto.readRadioSettings();
    await proto.writeRadioSettings(s as RadioSettings, { changedFields: ['radioSpecific'] });
    expect(writes).toHaveLength(0);
  });

  it('refuses a value that is not allowed, before any write', async () => {
    const flash = new Uint8Array(UVK1_SETTINGS_SIZE).fill(0x00);
    const { proto, writes } = fakeRadio('25ja', flash);
    const s = (await proto.readRadioSettings()) as unknown as { radioSpecific: Record<string, number> };
    const bad = { radioSpecific: { ...s.radioSpecific, fLock: 10 } };
    await expect(proto.writeRadioSettings(bad as unknown as RadioSettings)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('a failed read-back is reported', async () => {
    const flash = new Uint8Array(UVK1_SETTINGS_SIZE).fill(0x00);
    const { proto } = fakeRadio('25ja', flash);
    const conn = (proto as unknown as { conn: { spiWrite: (a: number, d: Uint8Array) => Promise<void> } }).conn;
    conn.spiWrite = async () => {}; // radio ignores the write
    const s = (await proto.readRadioSettings()) as unknown as { radioSpecific: Record<string, number> };
    const next = { radioSpecific: { ...s.radioSpecific, micGain: 5 } };
    await expect(proto.writeRadioSettings(next as unknown as RadioSettings)).rejects.toThrow(/verify/);
  });

  it('other fonts: no settings, write refused', async () => {
    const { proto } = fakeRadio('dondji', new Uint8Array(UVK1_SETTINGS_SIZE));
    expect(proto.settingsWriteUnsupported).toBe(true);
    expect(await proto.readRadioSettings()).toBeNull();
    await expect(proto.writeRadioSettings({ radioSpecific: {} } as unknown as RadioSettings)).rejects.toThrow();
  });
});
