/*
 * NeonPlugJA Ver.0.91 — Quansheng UV-K5 (F4HWN firmware) support
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import type { RadioDescriptor } from '../types';
import { UVK5Protocol } from './protocol';
import { UVK5_CAPS } from './capabilities';

/**
 * Quansheng UV-K5 with F4HWN firmware.
 * Reading only for now — see protocol.ts.
 */
export const UVK5_DESCRIPTOR: RadioDescriptor = {
  modelIds: ['UV-K5', 'UV-K5 (F4HWN)'],
  label: 'UV-K5 (F4HWN)',
  icon: '📻',
  group: 'Quansheng',
  supportsBle: false,
  status: 'alpha',
  protocolFactory: () => new UVK5Protocol(),
  capabilities: UVK5_CAPS,
};
