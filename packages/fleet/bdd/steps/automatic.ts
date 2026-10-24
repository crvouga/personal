import { expect } from '@playwright/test';
import { Given, When, Then } from '../fixtures';
import { startWizard } from '../wizard';

Given(
  'I open the USB wizard on {string} with {string} hardware',
  async ({ page, world }, os: string, arch: string) => {
    world.wizard = await startWizard(true, { os, arch });
    world.cleanup.push(world.wizard.stop);
    await page.goto(world.wizard.url);
  }
);

When('I review the automatically selected USB', async ({ page }) => {
  await page.getByRole('button', { name: /Make an install USB/ }).click();
  await expect(page.locator('input[name="usb"]')).toBeChecked();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('#ack')).not.toBeChecked();
  await expect(page.locator('.erase')).toContainText('BDD Test USB');
});

When('I reload the installer page', async ({ page }) => {
  await page.reload();
});

When('I choose the CI runner role', async ({ page }) => {
  await page.getByRole('button', { name: /Turn THIS computer/ }).click();
  await page.locator('input[name="role"][value="ci"]').check();
});

Then(
  'SSH key and manual enrollment fields stay out of the normal flow',
  async ({ page }) => {
    await expect(page.locator('#ssh-key')).toBeHidden();
    await expect(page.locator('#token')).toBeHidden();
    await expect(page.getByText(/Enrollment is automatic/)).toBeVisible();
  }
);
