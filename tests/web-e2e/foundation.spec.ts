import { expect, test } from '@playwright/test';

const apps = [
  { name: 'Customer', url: 'http://127.0.0.1:4174', heading: 'Đăng nhập ShanGo' },
  { name: 'Driver', url: 'http://127.0.0.1:4175', heading: 'Đăng nhập tài xế' },
  { name: 'Admin', url: 'http://127.0.0.1:4176', heading: 'Đăng nhập quản trị' },
];

for (const app of apps) {
  test(`${app.name} shell exposes a usable login boundary`, async ({ page }) => {
    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: app.heading })).toBeVisible();
    await expect(page.getByLabel(/Số điện thoại/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Gửi mã/ })).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  });
}

for (const app of [
  { url: 'http://127.0.0.1:4174', home: 'Bạn muốn gửi hàng đi đâu?', role: 'customer' },
  { url: 'http://127.0.0.1:4175', home: 'Sẵn sàng khi GPS hợp lệ', role: 'driver' },
]) {
  test(`${app.role} bootstraps and logs out through cookie auth`, async ({ page }) => {
    await page.route('**/api/v1/auth/web/csrf', route => route.fulfill({ json: { csrfToken: 'csrf-e2e' } }));
    await page.route('**/api/v1/auth/web/refresh', route => route.fulfill({ json: {
      accessToken: 'access-e2e', csrfToken: 'csrf-e2e',
      user: { id: 'u-e2e', phone: '+84900000000', role: app.role, displayName: null },
    } }));
    await page.route('**/api/v1/auth/web/logout', route => route.fulfill({ status: 204 }));

    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: app.home })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page.getByRole('heading', { name: /Đăng nhập/ })).toBeVisible();
  });
}

test('Customer exposes a recoverable auth error', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', route => route.fulfill({ status: 401, json: { message: 'Chưa có phiên' } }));
  await page.route('**/api/v1/auth/web/otp/request', route => route.fulfill({ status: 503, json: { message: 'Dịch vụ tạm gián đoạn' } }));
  await page.goto('http://127.0.0.1:4174');
  await page.getByLabel('Số điện thoại').fill('+84900000000');
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByRole('alert')).toHaveText('Dịch vụ tạm gián đoạn');
});

test('Admin canary restores and logs out a cookie session', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', route => route.fulfill({ json: { csrfToken: 'csrf-admin' } }));
  await page.route('**/api/v1/auth/web/refresh', route => route.fulfill({ json: {
    accessToken: 'access-admin', csrfToken: 'csrf-admin',
    user: { id: 'admin-e2e', phone: '+84900000001', role: 'admin', displayName: 'Admin' },
  } }));
  await page.route('**/api/v1/auth/web/logout', route => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/admin/drivers**', route => route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }));

  await page.goto('http://127.0.0.1:4176');
  await expect(page.getByRole('heading', { name: 'Duyệt hồ sơ tài xế' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
});

test('Admin canary rejects a wrong-role restored session', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', route => route.fulfill({ json: { csrfToken: 'csrf-wrong' } }));
  await page.route('**/api/v1/auth/web/refresh', route => route.fulfill({ json: {
    accessToken: 'access-wrong', csrfToken: 'csrf-wrong',
    user: { id: 'customer-e2e', phone: '+84900000002', role: 'customer', displayName: null },
  } }));
  await page.goto('http://127.0.0.1:4176');
  await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Duyệt hồ sơ tài xế' })).not.toBeVisible();
});
