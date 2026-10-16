const fs = require('fs');
let p, s;
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing in ' + p + ': ' + a.slice(0, 60)); s = s.replace(a, () => b); };

p = 'lib/password-reset.ts'; s = fs.readFileSync(p, 'utf8');
rep("export const RESET_TTL_MS = 30 * 60 * 1000;", "export const RESET_TTL_MS = 30 * 60 * 1000;\n/** An invite to a new account stays valid for 72 hours. */\nexport const INVITE_TTL_MS = 72 * 60 * 60 * 1000;");
rep("export function resetUrl(token: string): string {\n  const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').replace(/\/$/, '');\n  return `${base}/reset-password/${token}`;\n}",
    "export function resetUrl(token: string, invite = false): string {\n  const base = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').replace(/\/$/, '');\n  // ?invite=1 only changes the wording of the page (\"Set your password\"); the token decides what happens.\n  return `${base}/reset-password/${token}${invite ? '?invite=1' : ''}`;\n}");
rep("export async function createResetToken(tx: Db, schoolId: string, actorId: string, userId: string, now = new Date()) {\n  const token = randomBytes(32).toString('base64url');\n  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);",
    "export async function createResetToken(\n  tx: Db,\n  schoolId: string,\n  actorId: string,\n  userId: string,\n  now = new Date(),\n  opts: { kind?: 'RESET' | 'INVITE'; audit?: boolean } = {},\n) {\n  const kind = opts.kind ?? 'RESET';\n  const token = randomBytes(32).toString('base64url');\n  const expiresAt = new Date(now.getTime() + (kind === 'INVITE' ? INVITE_TTL_MS : RESET_TTL_MS));");
rep("    data: { userId, tokenHash: hashResetToken(token), expiresAt, createdById: actorId } as never,\n  });\n  await logAudit(\n    { schoolId, actorId, action: 'CREATE_PASSWORD_RESET', entityType: 'User', entityId: userId, detail: `Reset link valid until ${expiresAt.toISOString()}` },\n    tx,\n  );",
    "    data: { userId, tokenHash: hashResetToken(token), expiresAt, createdById: actorId, kind } as never,\n  });\n  // An invite is logged by whoever sends it (INVITE_USER), with the person's name.\n  if (opts.audit !== false && kind === 'RESET') {\n    await logAudit(\n      { schoolId, actorId, action: 'CREATE_PASSWORD_RESET', entityType: 'User', entityId: userId, detail: `Reset link valid until ${expiresAt.toISOString()}` },\n      tx,\n    );\n  }");
rep("      data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, tokenVersion: { increment: 1 } },\n    });\n    await tx.auditLog.create({\n      data: { schoolId: row.schoolId, actorId: row.userId, action: 'USE_PASSWORD_RESET', entityType: 'User', entityId: row.userId, detail: 'Password reset with a reset link' },\n    });",
    "      // Choosing a password through a link also ends \"invited\": the person is now active.\n      data: { passwordHash, mustChangePassword: false, passwordChangedAt: now, invitePending: false, tokenVersion: { increment: 1 } },\n    });\n    const invite = row.kind === 'INVITE';\n    await tx.auditLog.create({\n      data: {\n        schoolId: row.schoolId, actorId: row.userId, action: invite ? 'ACCEPT_INVITE' : 'USE_PASSWORD_RESET', entityType: 'User', entityId: row.userId,\n        detail: invite ? 'Accepted the invite and chose a password' : 'Password reset with a reset link',\n      },\n    });");
fs.writeFileSync(p, s);

p = 'app/api/account/change-password/route.ts'; s = fs.readFileSync(p, 'utf8');
rep("        mustChangePassword: false,\n        passwordChangedAt: new Date(),", "        mustChangePassword: false,\n        invitePending: false,\n        passwordChangedAt: new Date(),");
fs.writeFileSync(p, s);

p = 'app/(auth)/reset-password/[token]/page.tsx'; s = fs.readFileSync(p, 'utf8');
rep("import { useParams, useRouter } from 'next/navigation';", "import { useParams, useRouter, useSearchParams } from 'next/navigation';");
rep("  const router = useRouter();\n  const [password", "  const router = useRouter();\n  const invite = useSearchParams().get('invite') === '1';\n  const [password");
rep("<h1 className=\"mb-1 text-3xl font-bold tracking-tight text-ink\">Password changed</h1>\n        <p className=\"text-sm text-muted\">You can now sign in with your new password. Taking you to the sign-in page…</p>", "<h1 className=\"mb-1 text-3xl font-bold tracking-tight text-ink\">{invite ? 'Password set' : 'Password changed'}</h1>\n        <p className=\"text-sm text-muted\">You can now sign in with your {invite ? 'password' : 'new password'}. Taking you to the sign-in page…</p>");
rep("<h1 className=\"mb-1 text-3xl font-bold tracking-tight text-ink\">Reset your password</h1>\n      <p className=\"mb-8 text-sm text-muted\">Choose a new password of at least {PASSWORD_MIN_LENGTH} characters.</p>", "<h1 className=\"mb-1 text-3xl font-bold tracking-tight text-ink\">{invite ? 'Welcome to Pfuma' : 'Reset your password'}</h1>\n      <p className=\"mb-8 text-sm text-muted\">{invite ? 'Choose a password to finish setting up your account.' : 'Choose a new password'} It needs at least {PASSWORD_MIN_LENGTH} characters.</p>");
fs.writeFileSync(p, s);
