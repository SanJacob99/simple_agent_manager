import { test, expect } from '@playwright/test';

test.describe('App Settings Workspace E2E', () => {
  test('can navigate to settings, switch sections, and return to canvas', async ({ page }) => {
    await page.goto('/');

    // Click Settings button
    await page.locator('[title="Settings"]').click();

    // Verify we are in the settings workspace
    const header = page.locator('h2', { hasText: 'Providers & API Keys' });
    await expect(header).toBeVisible();

    // Navigate to Defaults section
    await page.getByRole('button', { name: /Defaults/ }).click();
    await expect(page.locator('h2', { hasText: 'Defaults' })).toBeVisible();

    // Return to canvas
    await page.getByRole('button', { name: 'Return to Canvas' }).click();

    // Verify we are back to canvas mode (settings button is visible again)
    await expect(page.locator('[title="Settings"]')).toBeVisible();
  });
});
