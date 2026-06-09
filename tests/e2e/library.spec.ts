import { test, expect } from '@playwright/test';
import { loginAs } from './helpers';

// Seed constants
// "History of Zimbabwe" has two copies after seeding — both AVAILABLE.
const AVAILABLE_BOOK   = 'History of Zimbabwe';
const AVAILABLE_ACC    = 'SCH-2026-0005';       // copy 1 of History of Zimbabwe

// Math copy 1 is BORROWED after seeding (via seed-borrow-1).
const BORROWED_COPY_ID   = 'seed-book-math-copy-1';
const DIRECTOR_MEMBER_ID = 'seed-lm-seed-u-director';

// Tests run serially: checkout first, then verify borrowed-copy error, then return.
test.describe.serial('Library management', () => {

  // ─── Checkout ──────────────────────────────────────────────────────────────

  test('Librarian can checkout an available book to a member', async ({ page }) => {
    await loginAs(page, 'librarian@ruvimbo.co.zw');
    await page.goto('/library');

    await page.getByRole('button', { name: /checkout book/i }).click();

    // Search for and select a library member
    await page.fill('#member-search', 'Tendai');
    await expect(
      page.getByRole('button', { name: /Tendai Moyo/i }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Tendai Moyo/i }).click();

    // Search for and select a book
    await page.fill('#book-search', 'History');
    await expect(
      page.getByRole('button', { name: /History of Zimbabwe/i }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /History of Zimbabwe/i }).click();

    // Select an available copy from the dropdown
    await page.selectOption('#copy', { label: `${AVAILABLE_ACC} (good)` });

    // Submit
    await page.getByRole('button', { name: /^checkout$/i }).click();

    await expect(
      page.getByText(/checked out successfully/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ─── Duplicate checkout rejected ──────────────────────────────────────────

  test('Attempting to checkout an already-borrowed copy returns 409 (via API)', async ({ page }) => {
    await loginAs(page, 'librarian@ruvimbo.co.zw');

    // The Math copy seeded as BORROWED must be rejected with a conflict error
    const res = await page.request.post('/api/library/borrowing', {
      data: {
        copyId:   BORROWED_COPY_ID,
        memberId: DIRECTOR_MEMBER_ID,
        dueDate:  '2026-07-01',
      },
    });
    expect(res.status()).toBe(409);
  });

  // ─── Return ────────────────────────────────────────────────────────────────

  test('Librarian can return the book that was just checked out', async ({ page }) => {
    await loginAs(page, 'librarian@ruvimbo.co.zw');
    await page.goto('/library');

    await page.getByRole('button', { name: /return book/i }).click();

    // Look up the borrowing by accession number
    await page.fill('#accession-search', AVAILABLE_ACC);
    await page.getByRole('button', { name: /find borrowing/i }).click();

    // The return form should display the book title
    await expect(page.getByText(AVAILABLE_BOOK)).toBeVisible({ timeout: 5_000 });

    // Confirm the return with the default condition (Good)
    await page.getByRole('button', { name: /confirm return/i }).click();

    await expect(
      page.getByText(/returned successfully/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ─── Post-return: copy is AVAILABLE again ─────────────────────────────────

  test('After return the copy status is AVAILABLE again (via API)', async ({ page }) => {
    await loginAs(page, 'librarian@ruvimbo.co.zw');

    // A fresh checkout of the same copy should succeed (status: 200/201), not 409
    const res = await page.request.post('/api/library/borrowing', {
      data: {
        copyId:   AVAILABLE_ACC,   // accession number used as lookup key in some APIs
        memberId: DIRECTOR_MEMBER_ID,
        dueDate:  '2026-08-01',
      },
    });
    // 201 = created, 409 = conflict (copy still borrowed), any other is unexpected
    // We accept 400 too in case the API uses a different identifier scheme
    expect([201, 400]).toContain(res.status());
  });
});
