import { test as setup, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * E2E Test Setup - Authentication
 *
 * This file handles authentication setup before E2E tests run.
 * It creates a test user session and stores it for use in tests.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:55321';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // For local dev, we'll use the seed data credentials
  const testEmail = 'admin@acme.test';
  const testPassword = 'password123';

  // In production E2E tests, you'd use Summit Core SSO flow
  // For local testing, we'll sign in directly with Supabase

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign in with test credentials
  const { data, error } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });

  if (error) {
    console.error('Auth setup failed:', error);
    throw AppError.internal(`Failed to authenticate: ${error.message}`);
  }

  expect(data.session).toBeTruthy();

  // Navigate to app with session
  await page.goto('/');

  // Set session in localStorage (for client-side auth)
  await page.evaluate((session) => {
    localStorage.setItem('supabase.auth.token', JSON.stringify(session));
  }, data.session);

  // Wait for app to load
  await page.waitForLoadState('networkidle');

  // Save authenticated state
  await page.context().storageState({ path: authFile });
});
