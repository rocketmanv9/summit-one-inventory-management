import { test, expect } from '@playwright/test';

/**
 * E2E Test: Receive Inventory
 *
 * Tests the complete flow of receiving inventory from a PO
 */

test.describe('Receive Inventory', () => {
  let poId: string;

  test.beforeEach(async ({ page }) => {
    // Create a PO first for testing receiving
    await test.step('Setup: Create PO to receive against', async () => {
      await page.goto('/inventory/purchasing/create');
      await page.waitForLoadState('networkidle');

      // Quick PO creation
      await page.click('button:has-text("Select Vendor")');
      await page.click('text=Acme Materials Supply');

      await page.click('button:has-text("Add Line Item")');
      await page.click('button:has-text("Select Item")');
      await page.click('text=Crushed Gravel');
      await page.fill('input[name="line_quantity"]', '50');
      await page.click('button:has-text("Add to Order")');

      await page.click('button:has-text("Create Purchase Order")');
      await page.waitForURL(/\/inventory\/purchasing/);

      // Get the PO number from the list
      const poNumber = await page.locator('table tbody tr:first-child td:first-child').textContent();
      poId = poNumber?.trim() || '';
    });
  });

  test('should create receipt from PO', async ({ page }) => {
    await page.goto('/inventory/receiving');
    await page.waitForLoadState('networkidle');

    await test.step('Create receipt', async () => {
      await page.click('button:has-text("Create Receipt")');

      // Select the PO we just created
      await page.click('button:has-text("Select Purchase Order")');
      await page.click(`text=${poId}`);

      // Set received date
      const today = new Date().toISOString().split('T')[0];
      await page.fill('input[type="date"]', today);

      // Select location
      await page.click('button:has-text("Select Location")');
      await page.click('text=Main Warehouse');

      await page.click('button:has-text("Next")');
    });

    await test.step('Set received quantities', async () => {
      // The line item should be pre-populated from PO
      await expect(page.locator('text=Crushed Gravel')).toBeVisible();
      await expect(page.locator('input[name="qty_received"]')).toHaveValue('50');

      // Set actual received quantity
      await page.fill('input[name="qty_received"]', '48'); // Received 2 less

      // Set condition
      await page.click('button:has-text("Good")'); // Default

      await page.click('button:has-text("Next")');
    });

    await test.step('Review and post', async () => {
      // Verify summary
      await expect(page.locator('text=48 TON')).toBeVisible();

      // Post receipt
      await page.click('button:has-text("Create Receipt")');

      await expect(page.locator('text=Receipt created')).toBeVisible({
        timeout: 10000,
      });
    });

    // Should redirect to receiving list
    await expect(page).toHaveURL(/\/inventory\/receiving/);

    // Verify receipt appears in list
    await expect(page.locator(`text=${poId}`)).toBeVisible();
  });

  test('should handle damaged items', async ({ page }) => {
    await page.goto('/inventory/receiving');
    await page.click('button:has-text("Create Receipt")');

    await page.click('button:has-text("Select Purchase Order")');
    await page.click(`text=${poId}`);

    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[type="date"]', today);
    await page.click('button:has-text("Select Location")');
    await page.click('text=Main Warehouse');
    await page.click('button:has-text("Next")');

    // Mark item as damaged
    await page.click('button:has-text("Good")');
    await page.click('text=Damaged');

    // Add damage notes
    await page.fill('textarea[name="notes"]', 'Boxes were wet during delivery');

    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Create Receipt")');

    await expect(page.locator('text=Receipt created')).toBeVisible({
      timeout: 10000,
    });

    // Damaged items should still be recorded
    await expect(page.locator('text=Damaged')).toBeVisible();
  });

  test('should reject items', async ({ page }) => {
    await page.goto('/inventory/receiving');
    await page.click('button:has-text("Create Receipt")');

    await page.click('button:has-text("Select Purchase Order")');
    await page.click(`text=${poId}`);

    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[type="date"]', today);
    await page.click('button:has-text("Select Location")');
    await page.click('text=Main Warehouse');
    await page.click('button:has-text("Next")');

    // Set condition to rejected
    await page.click('button:has-text("Good")');
    await page.click('text=Rejected');

    // Add rejection reason
    await page.fill('textarea[name="notes"]', 'Wrong material delivered');

    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Create Receipt")');

    await expect(page.locator('text=Receipt created')).toBeVisible({
      timeout: 10000,
    });

    // Rejected items should not increase inventory
    // This would need to be verified by checking stock levels
  });

  test('should validate over-receipt', async ({ page }) => {
    await page.goto('/inventory/receiving');
    await page.click('button:has-text("Create Receipt")');

    await page.click('button:has-text("Select Purchase Order")');
    await page.click(`text=${poId}`);

    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[type="date"]', today);
    await page.click('button:has-text("Select Location")');
    await page.click('text=Main Warehouse');
    await page.click('button:has-text("Next")');

    // Try to receive MORE than ordered (PO was for 50)
    await page.fill('input[name="qty_received"]', '60');

    await page.click('button:has-text("Next")');

    // Should show guardrail warning
    await expect(page.locator('text=exceeds PO quantity')).toBeVisible();
    await expect(page.locator('text=Override Reason')).toBeVisible();

    // Try to proceed without override reason
    await page.click('button:has-text("Create Receipt")');

    // Should fail
    await expect(page.locator('text=Override reason required')).toBeVisible();
  });
});
