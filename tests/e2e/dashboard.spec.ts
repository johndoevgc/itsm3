import { test, expect } from '@playwright/test';

/**
 * E2E: Dashboard basic rendering
 * Tests that the dashboard loads with expected structure.
 * WCAG: Validates semantic HTML and ARIA attributes.
 */
test.describe('Dashboard', () => {
  test('renders dashboard with heading', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /IT Service Management/i })).toBeVisible();
  });

  test('has accessible main landmark', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('shows summary cards', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: /Open Tickets/i })).toBeVisible();
    await expect(page.getByRole('region', { name: /P1 Active/i })).toBeVisible();
  });
});
