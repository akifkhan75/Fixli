import { expect, test } from '@playwright/test';

const ADMIN = { email: 'maestro-admin@fixli.test', password: 'Maestro-pass-42' };

test.describe.configure({ mode: 'serial' });

test('wrong password is refused with a plain message', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/not right|wrong/i);
});

test('staff approve a professional, resolve a dispute, and both show up in the audit log', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // 1. Verification: both documents of the waiting professional are approved.
  await page.getByRole('link', { name: 'Verifications' }).click();
  await expect(page.getByText('Pending Pro Pending').first()).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await page.getByText('Pending Pro Pending').first().click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeHidden();
  }
  await expect(page.getByText('Nothing waiting for review')).toBeVisible();

  // 2. Dispute: open it, write the decision, resolve.
  await page.getByRole('link', { name: 'Disputes' }).click();
  await page.getByText('Left a mess after the repair').click();
  await page.getByPlaceholder('What was decided (both sides see this)').fill('The professional came back and cleaned up. Closing.');
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('The professional came back and cleaned up. Closing.')).toBeVisible();

  // 3. Audit log: both decisions were written down, with who did it.
  await page.getByRole('link', { name: 'Audit log' }).click();
  await page.getByPlaceholder('Action, e.g. user.suspended').fill('verification.approved');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('cell', { name: 'verification.approved' }).first()).toBeVisible();
  await page.getByPlaceholder('Action, e.g. user.suspended').fill('dispute.updated');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('cell', { name: 'dispute.updated' }).first()).toBeVisible();
});

test('a menu link a role does not have is not offered (Finance cannot see documents)', async ({ page, request }) => {
  // Staff with only the Finance role.
  const api = process.env.API_URL ?? 'http://localhost:3002/api';
  const login = await request.post(`${api}/auth/admin/login`, { data: { email: ADMIN.email, password: ADMIN.password, deviceId: 'playwright-device-01' } });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  const created = await request.post(`${api}/admin/v1/staff`, { headers: { Authorization: `Bearer ${token}` }, data: { email: `finance-${Date.now()}@fixli.test`, name: 'Finance Only', roles: ['Finance'] } });
  expect(created.ok()).toBeTruthy();
  const { temporaryPassword, email } = await created.json().then((b) => ({ ...b, email: b.email }));

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(temporaryPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Finance' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Verifications' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Staff' })).toHaveCount(0);
});
