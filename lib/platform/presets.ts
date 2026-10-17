// Ready-made starting points for a new school: which modules are on, and the kind of school it is.
// The console applies one when a school is created (or later, to reset the modules); every switch can
// still be changed afterwards.
import type { SchoolBoarding, SchoolType } from '@prisma/client';
import { MODULE_KEYS } from '@/lib/access-core';

export const PRESETS = {
  GOVERNMENT_DAY: {
    label: 'Government day school',
    schoolType: 'GOVERNMENT' as SchoolType,
    boarding: 'DAY' as SchoolBoarding,
    // No boarding or hostel operations; everything else a government day school uses.
    modulesOff: ['facilities'],
  },
  GOVERNMENT_BOARDING: {
    label: 'Government boarding school',
    schoolType: 'GOVERNMENT' as SchoolType,
    boarding: 'BOARDING' as SchoolBoarding,
    modulesOff: [] as string[],
  },
  PRIVATE: {
    label: 'Private school',
    schoolType: 'PRIVATE' as SchoolType,
    boarding: 'DAY_AND_BOARDING' as SchoolBoarding,
    modulesOff: [] as string[],
  },
} as const;

export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as [PresetKey, ...PresetKey[]];

/** Every module with its state under a preset. */
export function presetModules(key: PresetKey): Record<string, boolean> {
  const off = new Set<string>(PRESETS[key].modulesOff);
  return Object.fromEntries(MODULE_KEYS.map((m) => [m, !off.has(m)]));
}
