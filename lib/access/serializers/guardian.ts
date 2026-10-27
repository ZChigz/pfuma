import { can, type AccessUser } from '@/lib/access-core';
import { maskTail, type Row } from './mask';

/** A guardian as the person may see them: the ID number shows in full only with students.guardians.view_ids, else its last 3 characters. */
export function serializeGuardian(user: AccessUser, guardian: Row): Row {
  const out: Row = { ...guardian };
  if ('nationalId' in out && !can(user, 'students.guardians.view_ids')) out.nationalId = maskTail(out.nationalId, 3);
  return out;
}

/** Contact only: what a subject teacher gets of a learner's guardian. */
export function guardianContact(guardian: Row): Row {
  return {
    id: guardian.id, fullName: guardian.fullName, phone: guardian.phone, altPhone: guardian.altPhone ?? null,
    relationship: guardian.relationship ?? null, isPrimary: guardian.isPrimary ?? false,
  };
}
