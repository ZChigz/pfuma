// Roles that apply to one class or one department (CLASS_TEACHER, HOD): UserRole rows with a scope. The tables that
// hold the fact (ClassTeacher, Department.hodUserId) stay the truth; these rows only make the role show on the person.
import type { RoleScopeType } from '@prisma/client';
import type { Db } from '@/lib/scoped-db';

async function roleId(tx: Db, schoolId: string, key: string): Promise<string | null> {
  const r = await tx.roleDefinition.findFirst({ where: { schoolId, key }, select: { id: true } });
  return r?.id ?? null;
}

export async function grantScopedRole(tx: Db, schoolId: string, userId: string, roleKey: string, scopeType: RoleScopeType, scopeId: string) {
  const id = await roleId(tx, schoolId, roleKey);
  if (!id) return;
  await tx.userRole.upsert({
    where: { userId_roleId_scopeType_scopeId: { userId, roleId: id, scopeType, scopeId } },
    update: {},
    create: { schoolId, userId, roleId: id, scopeType, scopeId },
  });
}

export async function revokeScopedRole(tx: Db, schoolId: string, userId: string, roleKey: string, scopeType: RoleScopeType, scopeId: string) {
  const id = await roleId(tx, schoolId, roleKey);
  if (!id) return;
  await tx.userRole.deleteMany({ where: { userId, roleId: id, scopeType, scopeId } });
}
