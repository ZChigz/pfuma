import type { Page } from '@playwright/test';

/**
 * Log in as the given user and wait for the accounting dashboard to load.
 * Default password matches the seed data for all test users.
 */
export async function loginAs(page: Page, email: string, password = 'School@2026') {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/accounting**');
}
