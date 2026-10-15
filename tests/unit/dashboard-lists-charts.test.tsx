import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildFeed, shortName, timeAgo, type AuditRow } from '@/lib/system/activity';
import { enrolmentByForm, sortBySize, type ClassSize } from '@/lib/system/charts';
import { EnrolmentBars } from '@/components/system/charts/EnrolmentChart';
import { ClassSizeBars } from '@/components/system/charts/ClassSizeChart';
import { QuickActions } from '@/components/system/QuickActions';

const NOW = new Date('2026-05-10T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const row = (id: string, action: string, who: string, when: Date, detail: string | null = null): AuditRow => ({ id, action, detail, entityType: 'X', createdAt: when, actor: { fullName: who } });

describe('activity sentences', () => {
  it('shortens names', () => {
    expect(shortName('Tendai Moyo')).toBe('T. Moyo');
    expect(shortName('Mary Jane van der Merwe')).toBe('M. Merwe');
    expect(shortName('Moyo')).toBe('Moyo');
    expect(shortName('  ')).toBe('Someone');
  });

  it('says how long ago', () => {
    expect(timeAgo(ago(10_000), NOW)).toBe('just now');
    expect(timeAgo(ago(MIN), NOW)).toBe('1 minute ago');
    expect(timeAgo(ago(7 * MIN), NOW)).toBe('7 minutes ago');
    expect(timeAgo(ago(2 * 3600_000), NOW)).toBe('2 hours ago');
    expect(timeAgo(ago(26 * 3600_000), NOW)).toBe('1 day ago');
    expect(timeAgo(ago(40 * 86400_000), NOW)).toBe('on 2026-03-31');
    expect(timeAgo(new Date(NOW.getTime() + 5000), NOW)).toBe('just now'); // clock skew never reads "in the future"
  });

  it('writes "who did what" and folds a bulk action into one line', () => {
    const imported = Array.from({ length: 42 }, (_, i) => row(`s${i}`, 'ADMIT_STUDENT', 'Tendai Moyo', ago(2 * 3600_000 + i * 1000)));
    const feed = buildFeed([...imported, row('u1', 'CREATE_USER', 'Rudo Chari', ago(5 * 3600_000), 'Sam Ncube (TEACHER)')]);
    expect(feed.map((f) => f.text)).toEqual(['T. Moyo added 42 students', 'R. Chari added a user: Sam Ncube (TEACHER)']);
    expect(feed[0].count).toBe(42);
  });

  it('keeps different people, different actions and far-apart times on separate lines', () => {
    const feed = buildFeed([
      row('1', 'RECORD_PAYMENT', 'A Moyo', ago(1 * MIN)),
      row('2', 'RECORD_PAYMENT', 'B Ncube', ago(2 * MIN)),
      row('3', 'VERIFY_PAYMENT', 'A Moyo', ago(3 * MIN)),
      row('4', 'RECORD_PAYMENT', 'A Moyo', ago(30 * MIN)),
    ]);
    expect(feed).toHaveLength(4);
  });

  it('shows at most ten lines, newest first, and copes with an action it has no sentence for', () => {
    const many = Array.from({ length: 15 }, (_, i) => row(`r${i}`, i % 2 ? 'CLOSE_TERM' : 'OPEN_TERM', 'A Moyo', ago((i + 1) * 60 * MIN)));
    const feed = buildFeed(many);
    expect(feed).toHaveLength(10);
    expect(feed[0].id).toBe('r0');
    expect(buildFeed([row('x', 'SET_PORTAL_PIN', 'A Moyo', ago(MIN))])[0].text).toBe('A. Moyo set portal pin');
  });

  it('leaves out long details', () => {
    expect(buildFeed([row('x', 'CREATE_USER', 'A Moyo', ago(MIN), 'x'.repeat(80))])[0].text).toBe('A. Moyo added a user');
  });
});

describe('chart data', () => {
  const c = (id: string, levelId: string, count: number, boys: number, girls: number, capacity = 40, name = id): ClassSize => ({ id, name, levelId, capacity, count, boys, girls });
  const levels = [{ id: 'l2', name: 'Form 2', order: 2 }, { id: 'l1', name: 'Form 1', order: 1 }, { id: 'l3', name: 'Form 3', order: 3 }];

  it('adds classes up per form, in form order, and skips forms with no class', () => {
    const forms = enrolmentByForm(levels, [c('a', 'l1', 30, 14, 15), c('b', 'l1', 20, 10, 10), c('d', 'l2', 5, 2, 3)]);
    expect(forms.map((f) => f.name)).toEqual(['Form 1', 'Form 2']);
    expect(forms[0]).toMatchObject({ boys: 24, girls: 25, unrecorded: 1, total: 50 });
    expect(forms[1]).toMatchObject({ boys: 2, girls: 3, unrecorded: 0, total: 5 });
  });

  it('sorts classes biggest first, then by name', () => {
    expect(sortBySize([c('a', 'l1', 10, 0, 0, 40, 'B'), c('b', 'l1', 30, 0, 0, 40, 'C'), c('c', 'l1', 10, 0, 0, 40, 'A')]).map((x) => x.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('chart drawing', () => {
  it('draws a stacked boys / girls bar per form with a legend, values and a table view', () => {
    const html = renderToStaticMarkup(<EnrolmentBars forms={[
      { levelId: 'l1', name: 'Form 1', order: 1, boys: 20, girls: 10, unrecorded: 0, total: 30 },
      { levelId: 'l2', name: 'Form 2', order: 2, boys: 5, girls: 5, unrecorded: 0, total: 10 },
    ]} />);
    expect(html).toContain('Boys');
    expect(html).toContain('Girls');
    expect(html).not.toContain('Not recorded');
    expect(html).toContain('Form 1: 30 students, 20 boys and 10 girls');
    expect(html).toContain('width:100%');           // the biggest form fills the track…
    expect(html).toContain('width:33.33');          // …and the others scale to it
    expect(html).toContain('View as table');
  });

  it('shows "Not recorded" in the legend only when some students have no gender', () => {
    const html = renderToStaticMarkup(<EnrolmentBars forms={[{ levelId: 'l1', name: 'Form 1', order: 1, boys: 1, girls: 1, unrecorded: 2, total: 4 }]} />);
    expect(html).toContain('Not recorded');
  });

  it('draws classes with a capacity line, and flags a class over capacity with text and an icon', () => {
    const html = renderToStaticMarkup(<ClassSizeBars classes={[
      { id: 'a', name: 'Form 1 North', levelId: 'l1', capacity: 40, count: 44, boys: 0, girls: 0 },
      { id: 'b', name: 'Form 1 South', levelId: 'l1', capacity: 40, count: 20, boys: 0, girls: 0 },
    ]} />);
    expect(html).toContain('Capacity');
    expect(html).toContain('▲ 4 over');
    expect(html).not.toContain('▲ 0 over');
    expect(html.match(/over/g)?.length).toBeGreaterThan(0);
    expect(html).toContain('Form 1 South: 20 students, capacity 40');
    expect(html).toContain('View as table');
  });
});

describe('quick actions', () => {
  const admin = { id: 'u', schoolId: 's', role: 'ADMIN' as const };
  it('offers the four actions to an administrator', () => {
    const html = renderToStaticMarkup(<QuickActions user={admin} />);
    for (const label of ['Add user', 'Import students', 'Add event', 'Open settings']) expect(html).toContain(label);
    expect(html).toContain('/system/users?new=1');
    expect(html).toContain('/system/calendar?new=1');
  });
  it('hides actions the person may not do, and everything when none', () => {
    expect(renderToStaticMarkup(<QuickActions user={{ ...admin, role: 'TEACHER' }} />)).toBe('');
    const some = renderToStaticMarkup(<QuickActions user={{ ...admin, role: 'HEAD', grants: ['system.settings.view'] }} />);
    expect(some).toContain('Open settings');
    expect(some).not.toContain('Add user');
  });
  it('hides Import students when the Student Information module is off', () => {
    const html = renderToStaticMarkup(<QuickActions user={{ ...admin, disabledModules: ['students'] }} />);
    expect(html).not.toContain('Import students');
    expect(html).toContain('Add user');
  });
});
