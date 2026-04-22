import { test, expect } from '@playwright/test';

/**
 * E2E Test: Create Item Wizard
 *
 * Tests the complete flow of creating a new inventory item
 * using the guided wizard interface.
 */

test.describe('Create Item Wizard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to create item wizard
    await page.goto('/inventory/items/new');
    await page.waitForLoadState('networkidle');
  });

  test('should create item with all steps', async ({ page }) => {
    // Step 1: Basics
    await test.step('Fill in basic information', async () => {
      await expect(page.locator('h1')).toContainText('Add New Item');

      // Fill in item name
      await page.fill('input[name="name"]', 'Test Item E2E');

      // Fill in description
      await page.fill('textarea[name="description"]', 'Created by E2E test');

      // Select category (or create new if needed)
      await page.click('button:has-text("Select Category")');
      await page.click('text=Asphalt'); // From seed data

      // Set UOM
      await page.click('button:has-text("Select UOM")');
      await page.click('text=TON');

      // Set tracking mode
      await page.click('button:has-text("Simple")');

      // Set reorder point
      await page.fill('input[name="reorder_point"]', '50');

      // Next step
      await page.click('button:has-text("Next")');
    });

    // Step 2: Vendor (optional)
    await test.step('Add vendor information', async () => {
      await page.waitForTimeout(500);

      // Select existing vendor
      await page.click('button:has-text("Select Vendor")');
      await page.click('text=Acme Materials Supply'); // From seed data

      // Set vendor SKU
      await page.fill('input[name="vendor_sku"]', 'TEST-E2E-001');

      // Set unit cost
      await page.fill('input[name="unit_cost"]', '100.00');

      // Next step
      await page.click('button:has-text("Next")');
    });

    // Step 3: Starting Stock (optional)
    await test.step('Add initial stock', async () => {
      await page.waitForTimeout(500);

      // Select location
      await page.click('button:has-text("Select Location")');
      await page.click('text=Main Warehouse'); // From seed data

      // Set quantity
      await page.fill('input[name="initial_quantity"]', '100');

      // Set unit cost
      await page.fill('input[name="stock_unit_cost"]', '95.00');

      // Next step
      await page.click('button:has-text("Next")');
    });

    // Step 4: Review & Create
    await test.step('Review and create item', async () => {
      await page.waitForTimeout(500);

      // Verify summary shows correct data
      await expect(page.locator('text=Test Item E2E')).toBeVisible();
      await expect(page.locator('text=100 TON')).toBeVisible();

      // Create item
      await page.click('button:has-text("Create Item")');

      // Wait for success
      await expect(page.locator('text=Item created successfully')).toBeVisible({
        timeout: 10000,
      });
    });

    // Verify redirect to items list
    await expect(page).toHaveURL(/\/inventory\/items/);

    // Verify item appears in list
    await expect(page.locator('text=Test Item E2E')).toBeVisible();
  });

  test('should create item with minimal data', async ({ page }) => {
    // Only fill required fields
    await page.fill('input[name="name"]', 'Minimal Item E2E');
    await page.click('button:has-text("Select Category")');
    await page.click('text=Asphalt');
    await page.click('button:has-text("Select UOM")');
    await page.click('text=EA');

    // Skip to review (click Next multiple times)
    await page.click('button:has-text("Next")');
    await page.click('button:has-text("Skip")'); // Skip vendor
    await page.click('button:has-text("Skip")'); // Skip stock

    // Create
    await page.click('button:has-text("Create Item")');

    await expect(page.locator('text=Item created successfully')).toBeVisible({
      timeout: 10000,
    });
  });

  test('should show validation errors for missing required fields', async ({ page }) => {
    // Try to proceed without filling anything
    await page.click('button:has-text("Next")');

    // Should show validation errors
    await expect(page.locator('text=Item name is required')).toBeVisible();
    await expect(page.locator('text=Category is required')).toBeVisible();
  });

  test('should allow inline category creation', async ({ page }) => {
    await page.fill('input[name="name"]', 'Test Item with New Category');

    // Click create new category
    await page.click('button:has-text("Create New Category")');

    // Fill in category modal
    await page.fill('input[name="category_name"]', 'E2E Test Category');
    await page.fill('input[name="category_code"]', 'E2E');
    await page.fill('input[name="category_prefix"]', 'E2E');

    await page.click('button:has-text("Create Category")');

    // Category should be selected
    await expect(page.locator('text=E2E Test Category')).toBeVisible();
  });
});
