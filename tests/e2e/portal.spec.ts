import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

let portalToken: string;
let studentFullName: string;

// Fetch the seed student's portal token directly from the database so the
// test does not depend on a hard-coded token value.
test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    const student = await prisma.student.findUnique({
      where:  { id: 'seed-stu-tanaka' },
      select: { portalToken: true, fullName: true },
    });
    if (!student) {
      throw new Error(
        'Seed student "seed-stu-tanaka" not found — run npm run db:seed first.',
      );
    }
    portalToken     = student.portalToken;
    studentFullName = student.fullName;
  } finally {
    await prisma.$disconnect();
  }
});

// ─── Invalid token ────────────────────────────────────────────────────────────

test('Invalid portal token shows the "Link not found" error page', async ({ page }) => {
  await page.goto('/portal/this-token-definitely-does-not-exist-xyz');
  await expect(
    page.getByRole('heading', { name: /link not found/i }),
  ).toBeVisible();
  await expect(page.getByText(/contact the school office/i)).toBeVisible();
});

// ─── Valid token ──────────────────────────────────────────────────────────────

test('Valid portal token shows the student name', async ({ page }) => {
  await page.goto(`/portal/${portalToken}`);
  await expect(page.getByText(studentFullName)).toBeVisible();
});

test('Valid portal token shows the Fee Balance section', async ({ page }) => {
  await page.goto(`/portal/${portalToken}`);
  await expect(page.getByRole('heading', { name: /fee balance/i })).toBeVisible();
});

test('Portal page shows USD and ZiG currency rows in the balance table', async ({ page }) => {
  await page.goto(`/portal/${portalToken}`);
  // The balance table always renders a USD row and a ZiG row
  await expect(page.getByRole('cell', { name: 'USD' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ZiG' })).toBeVisible();
});

// ─── No login link and no sidebar ────────────────────────────────────────────

test('Portal page has no sidebar and no navigation menu', async ({ page }) => {
  await page.goto(`/portal/${portalToken}`);
  // The portal is a stand-alone page with no dashboard nav
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.locator('[role="navigation"]')).toHaveCount(0);
});

test('Portal page has no Sign-in link', async ({ page }) => {
  await page.goto(`/portal/${portalToken}`);
  // There must be no link pointing to /login
  await expect(page.locator('a[href="/login"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /sign in/i })).toHaveCount(0);
});

test('Invalid portal page also has no sidebar or login link', async ({ page }) => {
  await page.goto('/portal/invalid-token-xyz');
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.locator('a[href="/login"]')).toHaveCount(0);
});
