import { describe, expect, it } from 'vitest';
import { checklistVisible, evaluateSetup, summarize, type SetupFacts } from '@/lib/system/setup-checklist';
import { SchoolDefaultsSchema } from '@/lib/validations/system';

const ready: SetupFacts = {
  profile: { name: 'Chinhoyi High', logoUrl: 'https://utfs.io/f/a.png', schoolType: 'GOVERNMENT', province: 'Mashonaland West', zimsecCentreNumber: '140123' },
  termsInYear: 3, hasOpenTerm: true, activeClasses: 6, gradeBoundaries: 9, defaultCurrency: 'USD', exchangeRates: 0,
  receiptPrefix: 'RCT', activeUsers: 4, students: 120, termEvents: 3,
};
const step = (f: SetupFacts, key: string) => evaluateSetup(f).find((s) => s.key === key)!;

describe('setup checklist', () => {
  it('has the eight steps in the required order', () => {
    expect(evaluateSetup(ready).map((s) => s.label)).toEqual([
      'School profile filled in',
      'Academic year and terms created, one term open',
      'Forms and streams set up, classes created',
      'Grading scale chosen',
      'Currencies and receipt numbering set',
      'Staff users added (at least one besides the admin)',
      'Students imported',
      "Calendar has this term's key dates",
    ]);
  });

  it('counts a finished school as complete, and hides the list', () => {
    const s = summarize(evaluateSetup(ready));
    expect(s).toEqual({ done: 8, total: 8, complete: true });
    expect(checklistVisible(s.complete, false)).toBe(false);
    expect(checklistVisible(s.complete, true)).toBe(true);   // pinned from Settings
    expect(checklistVisible(false, false)).toBe(true);
  });

  it('counts a brand-new school as 0 of 8', () => {
    const empty: SetupFacts = {
      profile: { name: 'New', logoUrl: null, schoolType: 'GOVERNMENT', province: null, zimsecCentreNumber: null },
      termsInYear: 0, hasOpenTerm: false, activeClasses: 0, gradeBoundaries: 0, defaultCurrency: 'USD', exchangeRates: 0,
      receiptPrefix: null, activeUsers: 1, students: 0, termEvents: null,
    };
    expect(summarize(evaluateSetup(empty))).toMatchObject({ done: 0, complete: false });
  });

  it('needs every profile field, and says which is missing', () => {
    for (const [field, label] of [['logoUrl', 'logo'], ['province', 'province'], ['zimsecCentreNumber', 'ZIMSEC centre number'], ['name', 'name']] as const) {
      const s = step({ ...ready, profile: { ...ready.profile, [field]: '  ' } }, 'profile');
      expect(s.done, field).toBe(false);
      expect(s.hint).toContain(label);
    }
  });

  it('needs three terms and one open term', () => {
    expect(step({ ...ready, termsInYear: 2 }, 'terms')).toMatchObject({ done: false, hint: '2 of 3 terms created' });
    expect(step({ ...ready, hasOpenTerm: false }, 'terms')).toMatchObject({ done: false, hint: 'No term is open' });
  });

  it('needs a class, a grading scale, a second user, a student', () => {
    expect(step({ ...ready, activeClasses: 0 }, 'classes').done).toBe(false);
    expect(step({ ...ready, gradeBoundaries: 0 }, 'grading').done).toBe(false);
    expect(step({ ...ready, activeUsers: 1 }, 'staff').done).toBe(false);
    expect(step({ ...ready, students: 0 }, 'students').done).toBe(false);
  });

  it('needs a receipt prefix, and a rate when the school works in ZiG', () => {
    expect(step({ ...ready, receiptPrefix: null }, 'money').done).toBe(false);
    expect(step({ ...ready, defaultCurrency: 'ZIG' }, 'money')).toMatchObject({ done: false, hint: 'Missing: an exchange rate' });
    expect(step({ ...ready, defaultCurrency: 'ZIG', exchangeRates: 1 }, 'money').done).toBe(true);
  });

  it('needs a calendar event inside the term, and handles having no term', () => {
    expect(step({ ...ready, termEvents: 0 }, 'calendar').done).toBe(false);
    expect(step({ ...ready, termEvents: null }, 'calendar')).toMatchObject({ done: false, hint: 'No term to put dates in' });
  });
});

describe('defaults settings fields', () => {
  const base = { defaultCurrency: 'USD', maxClassSize: 45 };
  it('accepts valid values and tidies them', () => {
    expect(SchoolDefaultsSchema.parse({ ...base, receiptPrefix: 'rct', receiptNextNumber: 50, setupChecklistPinned: true })).toMatchObject({ receiptPrefix: 'RCT', receiptNextNumber: 50, setupChecklistPinned: true });
    expect(SchoolDefaultsSchema.parse({ ...base, receiptPrefix: '' }).receiptPrefix).toBeNull();
  });
  it('rejects bad values', () => {
    for (const bad of [{ defaultCurrency: 'EUR' }, { maxClassSize: 0 }, { maxClassSize: 201 }, { maxClassSize: 40.5 }, { receiptPrefix: 'TOO-LONG-PREFIX' }, { receiptPrefix: 'a b' }, { receiptNextNumber: 0 }, { receiptNextNumber: 1.5 }, { setupChecklistPinned: 'yes' }]) {
      expect(SchoolDefaultsSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
