import type { Prisma } from '@prisma/client';

export async function generateRequestNumber(
  schoolId: string,
  tx: Prisma.TransactionClient,
): Promise<string> {
  const year = new Date().getFullYear();
  const count = await tx.expenseRequest.count({
    where: { schoolId },
  });
  const seq = String(count + 1).padStart(3, '0');
  return `REQ-${year}-${seq}`;
}
