import { describe, it, expect } from 'vitest';
import { getRadioPickerOptions, getMigrationTargetModels, createProtocolForModel } from '../../src/radios';

describe('radio picker', () => {
  it('does not offer the UV-K5 driver, but the driver stays registered', () => {
    const ids = getRadioPickerOptions().map((o) => o.modelId);
    expect(ids).not.toContain('UV-K5');
    expect(getMigrationTargetModels()).not.toContain('UV-K5');
    expect(createProtocolForModel('UV-K5')).not.toBeNull();
  });
  it('still offers the UV-K1 and the DM-32UV', () => {
    const ids = getRadioPickerOptions().map((o) => o.modelId);
    expect(ids).toContain('UV-K1');
    expect(ids).toContain('DM-32UV');
  });
});
