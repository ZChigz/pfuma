// Creates (or resets the password of) a Pfuma staff account for the /platform console.
//   node scripts/create-platform-admin.mjs "Full Name" email@pfuma.co.zw "a password of 10+ characters"
// Run it against the production database with DATABASE_URL set. There is no sign-up page: this is the only way in.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const [fullName, rawEmail, password] = process.argv.slice(2);
if (!fullName || !rawEmail || !password) {
  console.error('Usage: node scripts/create-platform-admin.mjs "Full Name" email password');
  process.exit(1);
}
if (password.length < 10) {
  console.error('The password needs at least 10 characters.');
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    // A new password ends every console session (tokenVersion).
    await prisma.platformAdmin.update({ where: { email }, data: { fullName, passwordHash, active: true, tokenVersion: { increment: 1 } } });
    console.log(`Updated ${email} (password changed, sessions ended).`);
  } else {
    await prisma.platformAdmin.create({ data: { fullName, email, passwordHash } });
    console.log(`Created ${email}. Sign in at /platform/login.`);
  }
} finally {
  await prisma.$disconnect();
}
