// Facilities & Operations: eight parts, each switched on or off for a school, behind the same can() as everything else; plus the scan
// codes the phone screens read.
import { describe, expect, it } from 'vitest';
import {
  can, disabledModulesFrom, facilityModuleKey, facilityPartOf, FACILITY_PARTS, MODULE_KEYS, MODULE_SWITCHES, PERMISSIONS, moduleOf, type AccessUser,
} from '@/lib/access-core';
import { buildNav } from '@/lib/nav';
import { PRESETS, presetModules } from '@/lib/platform/presets';
import { cleanScan, createDebouncer, expectScan, labelPayload, parseScan } from '@/lib/facilities/scan';
import { PERMISSION_KEYS } from '@/lib/access-core';

const user = (extra: Partial<AccessUser> = {}): AccessUser => ({ id: 'u1', schoolId: 's1', role: 'ADMIN', grants: [...PERMISSION_KEYS], ...extra });

/** The permission keys the brief lists, by part. */
const KEYS: Record<string, string[]> = {
  hostel: ['facilities.hostel.view', 'facilities.hostel.manage', 'facilities.hostel.allocate', 'facilities.hostel.rollcall', 'facilities.hostel.inspect'],
  exeats: ['facilities.exeats.request', 'facilities.exeats.approve', 'facilities.exeats.signout', 'facilities.visitors.log'],
  sickbay: ['facilities.sickbay.record', 'facilities.sickbay.view'],
  tuckshop: ['facilities.wallets.manage', 'facilities.wallets.view', 'facilities.tuckshop.sell', 'facilities.tuckshop.cashup'],
  library: ['facilities.library.manage', 'facilities.library.desk', 'facilities.library.waive', 'facilities.textbooks.issue', 'facilities.library.view'],
  transport: ['facilities.transport.manage', 'facilities.transport.trips', 'facilities.transport.assign'],
  inventory: ['facilities.inventory.manage', 'facilities.inventory.receive', 'facilities.inventory.issue', 'facilities.inventory.count', 'facilities.inventory.writeoff', 'facilities.inventory.view'],
  assets: ['facilities.assets.manage', 'facilities.assets.maintain', 'facilities.assets.dispose', 'facilities.assets.verify', 'facilities.assets.view'],
};

describe('Facilities permission keys', () => {
  it('every key of the brief exists, and belongs to the part it should', () => {
    for (const [part, keys] of Object.entries(KEYS)) {
      for (const k of keys) {
        expect(k in PERMISSIONS, k).toBe(true);
        expect(moduleOf(k)).toBe('facilities');
        expect(facilityPartOf(k), k).toBe(part);
      }
    }
  });

  it('no facilities key is left without a part', () => {
    for (const k of Object.keys(PERMISSIONS).filter((x) => moduleOf(x) === 'facilities')) expect(facilityPartOf(k), k).not.toBeNull();
    expect(facilityPartOf('finance.reports.view')).toBeNull();
  });
});

describe('the eight parts', () => {
  it('are listed with a switch each, under Facilities', () => {
    expect(FACILITY_PARTS.map((p) => p.key)).toEqual(['hostel', 'exeats', 'sickbay', 'tuckshop', 'library', 'transport', 'inventory', 'assets']);
    for (const p of FACILITY_PARTS) {
      expect(MODULE_KEYS).toContain(`facilities.${p.key}`);
      expect(MODULE_SWITCHES.map((s) => s.key)).toContain(`facilities.${p.key}`);
    }
    const keys = MODULE_SWITCHES.map((s) => s.key);
    expect(keys.indexOf('facilities.hostel')).toBe(keys.indexOf('facilities') + 1);
  });

  it('a part that is off refuses its own keys for everyone, even "*", and only its own', () => {
    for (const part of FACILITY_PARTS) {
      const u = user({ disabledModules: [facilityModuleKey(part.key)] });
      for (const [other, keys] of Object.entries(KEYS)) {
        for (const k of keys) expect(can(u, k), `${part.key} off, ${k}`).toBe(other !== part.key);
      }
    }
  });

  it('switching the whole of Facilities off refuses every part', () => {
    const u = user({ disabledModules: ['facilities'] });
    for (const keys of Object.values(KEYS)) for (const k of keys) expect(can(u, k), k).toBe(false);
  });

  it('with no switch row every part is on', () => {
    for (const keys of Object.values(KEYS)) for (const k of keys) expect(can(user(), k), k).toBe(true);
    expect(disabledModulesFrom([{ module: 'facilities.hostel', enabled: false }, { module: 'facilities.assets', enabled: true }])).toEqual(['facilities.hostel']);
  });

  it('a scoped role sees only the keys it was granted, in the parts that are on', () => {
    const matron = user({ role: 'TEACHER', grants: ['facilities.sickbay.record', 'facilities.hostel.view'] });
    expect(can(matron, 'facilities.sickbay.record')).toBe(true);
    expect(can(matron, 'facilities.sickbay.view')).toBe(false);
    expect(can(matron, 'facilities.assets.manage')).toBe(false);
    expect(can({ ...matron, disabledModules: ['facilities.sickbay'] }, 'facilities.sickbay.record')).toBe(false);
  });

  it('a support session or a suspended school can look but not change', () => {
    const ro = user({ readOnly: true });
    expect(can(ro, 'facilities.hostel.view')).toBe(true);
    expect(can(ro, 'facilities.wallets.view')).toBe(true);
    for (const k of ['facilities.hostel.rollcall', 'facilities.library.desk', 'facilities.inventory.receive', 'facilities.assets.dispose']) expect(can(ro, k), k).toBe(false);
  });

  it('the preset for a day school leaves the part switches for the console to set', () => {
    expect(PRESETS.GOVERNMENT_DAY.modulesOff).toContain('facilities');
    const states = presetModules('GOVERNMENT_DAY');
    expect(states.facilities).toBe(false);
    expect(Object.keys(states)).toEqual([...MODULE_KEYS]);
  });
});

describe('the sidebar', () => {
  const names = (u: AccessUser) => buildNav(u).find((g) => g.module === 'facilities')?.items.map((i) => i.label) ?? [];

  it('shows an item per part to a person who holds a key of that part', () => {
    expect(names(user())).toEqual(['Hostel', 'Exeats', 'Sick bay', 'Tuck shop', 'Library', 'Transport', 'Inventory', 'Assets']);
  });

  it('hides the item of a part that is switched off, and the whole group when Facilities is off', () => {
    expect(names(user({ disabledModules: ['facilities.sickbay', 'facilities.transport'] }))).toEqual(['Hostel', 'Exeats', 'Tuck shop', 'Library', 'Inventory', 'Assets']);
    expect(buildNav(user({ disabledModules: ['facilities'] })).map((g) => g.module)).not.toContain('facilities');
  });

  it('shows only the parts a scoped role was granted', () => {
    expect(names(user({ grants: ['facilities.library.desk', 'facilities.textbooks.issue'] }))).toEqual(['Library']);
    expect(names(user({ grants: ['facilities.hostel.rollcall'] }))).toEqual(['Hostel']);
    expect(names(user({ grants: ['facilities.exeats.signout'] }))).toEqual(['Exeats']);
    expect(names(user({ grants: ['system.dashboard.view'] }))).toEqual([]);
  });
});

describe('scan codes', () => {
  it('reads a Pfuma label, a bare value and an asset tag', () => {
    expect(parseScan('PF:student:STU20260042')).toEqual({ raw: 'PF:student:STU20260042', value: 'STU20260042', kind: 'student' });
    expect(parseScan('pf:COPY:ACC-0071')).toMatchObject({ kind: 'copy', value: 'ACC-0071' });
    expect(parseScan('ast-00412')).toMatchObject({ kind: 'asset', value: 'AST-00412' });
    expect(parseScan('9780521123456')).toMatchObject({ kind: 'unknown', value: '9780521123456' });
    expect(parseScan('PF:banana:1')).toMatchObject({ kind: 'unknown' });
  });

  it('strips what a keyboard-wedge scanner adds', () => {
    expect(cleanScan('  ACC-1\r\n')).toBe('ACC-1');
    expect(cleanScan('A\tB')).toBe('AB');
  });

  it('prints and reads back the same label', () => {
    expect(parseScan(labelPayload('item', 'RICE-50KG'))).toMatchObject({ kind: 'item', value: 'RICE-50KG' });
  });

  it('refuses a label of the wrong kind but takes a bare value', () => {
    expect(expectScan('PF:copy:ACC-1', 'student')).toEqual({ ok: false, reason: 'That is a copy label, but a student is needed here.' });
    expect(expectScan('STU20260042', 'student')).toEqual({ ok: true, value: 'STU20260042' });
    expect(expectScan('PF:student:STU1', 'student')).toEqual({ ok: true, value: 'STU1' });
    expect(expectScan('  \n', 'student').ok).toBe(false);
  });

  it('ignores the same code seen again within the window, not a different one or a later one', () => {
    let t = 0;
    const take = createDebouncer(1000, () => t);
    expect(take('A')).toBe(true);
    t = 500;
    expect(take('A')).toBe(false);
    expect(take('B')).toBe(true);
    t = 1700;
    expect(take('B')).toBe(true);
  });
});
