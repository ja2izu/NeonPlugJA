/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K1 / UV-K5 V3 (Dondji / 25ja firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import type { RadioDescriptor } from '../types';
import { UVK1Protocol } from './protocol';
import { UVK1_CAPS } from './capabilities';
import { UVK1_SETTINGS_PROFILE } from './settingsProfile';

/**
 * Quansheng UV-K1 / UV-K5 V3 with Dondji or 25ja firmware.
 * Reads and writes channels and (25Ja only) global settings — see protocol.ts / settings.ts.
 */
export const UVK1_DESCRIPTOR: RadioDescriptor = {
  modelIds: ['UV-K1', 'UV-K1 (25ja)'],
  label: 'UV-K1 (25Ja)',
  icon: '📻',
  group: 'Quansheng',
  supportsBle: false,
  status: 'alpha',
  protocolFactory: () => new UVK1Protocol(),
  capabilities: UVK1_CAPS,
  settingsProfile: UVK1_SETTINGS_PROFILE,
};
