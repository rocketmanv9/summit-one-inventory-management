import { test, expect } from '@playwright/test';

/**
 * E2E Test: Create Purchase Order
 *
 * Tests the complete flow of creating a purchase order
 */

test.describe('Create Purchase Order', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/inventory/purchasing/create');
    await page.waitForLoadState('networkidle');
  });

  test('should create PO with single line item', async ({ page }) => {
    await test.step('Fill PO header', async () => {
      // Select vendor
      await page.click('button:has-text("Select Vendor")');
      await page.click('text=Acme Materials Supply');

      // Set delivery method
      await page.click('button:has-text("Select Delivery Method")');
      await page.click('text=Ship');

      // Select delivery location
      await page.click('button:has-text("Select Location")');
      await page.click('text=Main Warehouse');

      // Add notes
      await page.fill('textarea[name="notes"]', 'E2E test purchase order');
    });

    await test.step('Add line item', async () => {
      await page.click('button:has-text("Add Line Item")');

      // Select item
      await page.click('button:has-text("Select Item")');
      await page.click('text=Hot Mix Asphalt'); // From seed data

      // Set quantity
      await page.fill('input[name="line_quantity"]', '50');

      // Unit cost should auto-fill from vendor item
      await expect(page.locator('input[name="line_unit_cost"]')).toHaveValue('75.00');

      // Save line item
      await page.click('button:has-text("Add to Order")');
    });

    await test.step('Review and submit', async () => {
      // Verify line item appears
      await expect(page.locator('text=Hot Mix Asphalt')).toBeVisible();
      await expect(page.locator('text=50')).toBeVisible();
      await expect(page.locator('text=$3,750.00')).toBeVisible(); // 50 * 75

      // Submit PO
      await page.click('button:has-text("Create Purchase Order")');

      // Wait for success
      await expect(page.locator('text=Purchase order created')).toBeVisible({
        timeout: 10000,
      });
    });

    // Should redirect to PO list
    await expect(page).toHaveURL(/\/inventory\/purchasing/);
  });

  test('should create PO with multiple line items', async ({ page }) => {
    // Select vendor
    await page.click('button:has-text("Select Vendor")');
    await page.click('text=Acme Materials Supply');

    // Add first line item
    await page.click('button:has-text("Add Line Item")');
    await page.click('button:has-text("Select Item")');
    await page.click('text=Hot Mix Asphalt');
    await page.fill('input[name="line_quantity"]', '30');
    await page.click('button:has-text("Add to Order")');

    // Add second line item
    await page.click('button:has-text("Add Line Item")');
    await page.click('button:has-text("Select Item")');
    await page.click('text=Crushed Gravel');
    await page.fill('input[name="line_quantity"]', '100');
    await page.click('button:has-text("Add to Order")');

    // Verify total
    const total = 30 * 75 + 100 * 25; // From seed data costs
    await expect(page.locator(`text=$${total.toLocaleString()}`)).toBeVisible();

    // Submit
    await page.click('button:has-text("Create Purchase Order")');
    await expect(page.locator('text=Purchase order created')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should validate required fields', async ({ page }) => {
    // Try to submit without vendor
    await page.click('button:has-text("Create Purchase Order")');

    await expect(page.locator('text=Vendor is required')).toBeVisible();
    await expect(page.locator('text=At least one line item required')).toBeVisible();
  });

  test('should allow removing line items', async ({ page }) => {
    await page.click('button:has-text("Select Vendor")');
    await page.click('text=Acme Materials Supply');

    // Add line item
    await page.click('button:has-text("Add Line Item")');
    await page.click('button:has-text("Select Item")');
    await page.click('text=Hot Mix Asphalt');
    await page.fill('input[name="line_quantity"]', '50');
    await page.click('button:has-text("Add to Order")');

    // Verify it's added
    await expect(page.locator('text=Hot Mix Asphalt')).toBeVisible();

    // Remove it
    await page.click('button[aria-label="Remove line item"]');

    // Should be gone
    await expect(page.locator('text=Hot Mix Asphalt')).not.toBeVisible();
  });
});
