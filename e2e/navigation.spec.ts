import { test, expect } from '@playwright/test';

/**
 * E2E Test: Navigation & Core UI
 *
 * Tests basic navigation and core UI functionality
 */

test.describe('Navigation', () => {
  test('should navigate to all main sections', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard
    await page.click('text=Dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Inventory
    await page.click('text=Inventory');
    await expect(page.locator('text=Items')).toBeVisible();

    await page.click('text=Items');
    await expect(page).toHaveURL(/\/inventory\/items/);

    await page.click('text=Locations');
    await expect(page).toHaveURL(/\/inventory\/locations/);

    await page.click('text=Stock');
    await expect(page).toHaveURL(/\/inventory\/stock/);

    // Purchasing
    await page.click('text=Purchasing');
    await expect(page).toHaveURL(/\/inventory\/purchasing/);

    // Settings
    await page.click('text=Settings');
    await expect(page).toHaveURL(/\/settings/);
  });

  test('should show user menu', async ({ page }) => {
    await page.goto('/');

    // Click user avatar/menu
    await page.click('[aria-label="User menu"]');

    // Should show user options
    await expect(page.locator('text=Admin User')).toBeVisible();
    await expect(page.locator('text=Logout')).toBeVisible();
  });

  test('should open command palette with keyboard shortcut', async ({ page }) => {
    await page.goto('/');

    // Press Cmd+K (or Ctrl+K on Windows)
    await page.keyboard.press('Control+K');

    // Command palette should open
    await expect(page.locator('[placeholder*="Search"]')).toBeVisible();
  });

  test('should search for items', async ({ page }) => {
    await page.goto('/inventory/items');
    await page.waitForLoadState('networkidle');

    // Use search bar
    await page.fill('input[placeholder*="Search"]', 'Asphalt');

    // Results should filter
    await expect(page.locator('text=Hot Mix Asphalt')).toBeVisible();
  });
});

test.describe('Dashboard', () => {
  test('should display dashboard widgets', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Check for key metrics
    await expect(page.locator('text=Total Items')).toBeVisible();
    await expect(page.locator('text=Total Value')).toBeVisible();
    await expect(page.locator('text=Low Stock Alerts')).toBeVisible();
  });

  test('should allow dashboard customization', async ({ page }) => {
    await page.goto('/dashboard');

    // Click customize button
    await page.click('button:has-text("Customize")');

    // Should show widget picker
    await expect(page.locator('text=Add Widget')).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('should show error boundary on error', async ({ page }) => {
    // This test would need a page that throws an error
    // For now, we'll test navigation to error page
    await page.goto('/error');

    await expect(page.locator('text=Something went wrong')).toBeVisible();
  });

  test('should handle 404 pages', async ({ page }) => {
    await page.goto('/nonexistent-page');

    // Should show 404 or redirect to home
    const is404 = await page.locator('text=404').isVisible().catch(() => false);
    const isHome = page.url().includes('/dashboard');

    expect(is404 || isHome).toBeTruthy();
  });
});
