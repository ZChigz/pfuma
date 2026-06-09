import { test, expect } from '@playwright/test';

// ─── Redirect behaviour for unauthenticated users ────────────────────────────

test('Unauthenticated user visiting / is redirected to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('Unauthenticated user visiting a protected route is redirected to /login', async ({ page }) => {
  await page.goto('/accounting');
  await expect(page).toHaveURL(/\/login/);
});

test('Unauthenticated user visiting the dashboard is redirected to /login', async ({ page }) => {
  await page.goto('/accounting/students');
  await expect(page).toHaveURL(/\/login/);
});

// ─── Login page — form validation ────────────────────────────────────────────

test('Submitting with wrong password shows an error alert', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'director@ruvimbo.co.zw');
  await page.fill('#password', 'WrongPassword1!');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
});

test('Submitting with wrong email shows an error alert', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'nobody@ruvimbo.co.zw');
  await page.fill('#password', 'School@2026');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
});

// ─── Successful login ─────────────────────────────────────────────────────────

test('Director signs in and lands on /accounting', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'director@ruvimbo.co.zw');
  await page.fill('#password', 'School@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/accounting**');
  await expect(page).toHaveURL(/\/accounting/);
});

test('Head user signs in successfully', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'head@ruvimbo.co.zw');
  await page.fill('#password', 'School@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/accounting**');
  await expect(page).toHaveURL(/\/accounting/);
});

test('Bursar signs in successfully', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'bursar@ruvimbo.co.zw');
  await page.fill('#password', 'School@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/accounting**');
  await expect(page).toHaveURL(/\/accounting/);
});

// ─── Already-authenticated user ───────────────────────────────────────────────

test('Authenticated user visiting /login is redirected away from it', async ({ page }) => {
  // Establish a session first
  await page.goto('/login');
  await page.fill('#email', 'head@ruvimbo.co.zw');
  await page.fill('#password', 'School@2026');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/accounting**');

  // Now navigate back to /login — should be redirected
  await page.goto('/login');
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).toHaveURL(/\/accounting/);
});
