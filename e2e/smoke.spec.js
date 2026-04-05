import { test, expect } from '@playwright/test';

test.describe('shell', () => {
  test('html lang, dir, and document title', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.app-layout', { timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', /^(en|zh-CN)$/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page).toHaveTitle(/AgentBoard/);
  });
});
