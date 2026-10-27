import { can, type AccessUser } from '@/lib/access-core';
import { omit, type Row } from './mask';

/**
 * A mark sheet or result before it is published is for the teachers whose sheet it is, and for those who hold exams.results.view at a
 * scope that reaches it (the caller has checked that with scopeWhere; pass reachedByResultsView: false when it did not).
 * Anyone else gets the sheet without its marks.
 */
export function serializeMarkSheet(
  user: AccessUser,
  sheet: Row,
  opts: { published: boolean; teacherIds: readonly (string | null | undefined)[]; reachedByResultsView?: boolean },
): Row {
  const mine = opts.teacherIds.includes(user.id);
  const mayRead = opts.published || mine || (can(user, 'exams.results.view') && opts.reachedByResultsView !== false);
  return mayRead ? { ...sheet } : omit(sheet, ['marks', 'rows', 'entries', 'average', 'results', 'scores']);
}
