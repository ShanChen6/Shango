import { expect, test, type Page } from '@playwright/test';

// Admin canary build (VITE_WEB_AUTH_ENABLED=true) served on 4176; API mocked.
const ADMIN = 'http://127.0.0.1:4176';
const DRIVER_ID = '6cdf06f0-e000-4111-8111-00000000d001';
// 1×1 PNG, synthetic, never a real document.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const KINDS = ['identity_front', 'identity_back', 'driver_license', 'vehicle_registration'];
const LABELS = ['CCCD mặt trước', 'CCCD mặt sau', 'Giấy phép lái xe', 'Đăng ký xe'];

function profile(updatedAt: string, status = 'pending') {
  return {
    userId: DRIVER_ID,
    vehiclePlate: '29A-123.45',
    vehicleType: 'motorcycle',
    status,
    rejectionReason: null,
    updatedAt,
  };
}

async function staff(page: Page, role: string) {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf-staff' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access-staff',
        csrfToken: 'csrf-staff',
        user: { id: 'staff-1', phone: '+84900000111', role, displayName: 'Vận hành' },
      },
    }),
  );
  await page.route('**/api/v1/auth/web/logout', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/admin/orders**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/maps/config', (route) =>
    route.fulfill({
      json: {
        region: {
          id: 'hanoi-pilot',
          name: 'Hà Nội',
          bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
          center: { longitude: 105.8342, latitude: 21.0278 },
        },
        geocodingConfigured: false,
        routingConfigured: false,
        searchMode: 'submit-only',
        attribution: '© OpenStreetMap contributors',
        attributionUrl: 'https://www.openstreetmap.org/copyright',
        routingProfile: 'driving-unverified-for-motorcycles',
      },
    }),
  );
  await page.route('**/api/v1/admin/audit-logs**', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
}

/** One pending driver with all four documents; viewing records views like the server. */
async function reviewFixture(page: Page) {
  let updatedAt = '2026-11-21T01:00:00.000Z';
  const viewed = new Set<string>();
  const state = { reviewCalls: [] as unknown[], conflictOnce: false };
  await page.route('**/api/v1/admin/drivers?**', (route) =>
    route.fulfill({
      json: {
        items: [{ ...profile(updatedAt), phone: '+84900000222', displayName: 'Trần Bình' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    }),
  );
  await page.route(`**/api/v1/admin/drivers/${DRIVER_ID}/documents`, (route) =>
    route.fulfill({
      json: {
        items: KINDS.map((kind) => ({
          id: `${kind}-${updatedAt}`,
          driverId: DRIVER_ID,
          kind,
          contentType: 'image/jpeg',
          byteSize: 100,
          createdAt: updatedAt,
        })),
        profile: profile(updatedAt),
        requiredKinds: KINDS,
        viewedIds: [...viewed].filter((id) => id.endsWith(updatedAt)),
      },
    }),
  );
  await page.route('**/api/v1/driver-documents/*/content', (route) => {
    viewed.add(decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!));
    return route.fulfill({
      body: PNG,
      contentType: 'image/png',
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
  await page.route(`**/api/v1/admin/drivers/${DRIVER_ID}/review`, (route) => {
    const body = route.request().postDataJSON();
    state.reviewCalls.push(body);
    if (state.conflictOnce) {
      state.conflictOnce = false;
      // Driver re-uploaded meanwhile: new revision, previous views no longer count.
      updatedAt = '2026-11-21T02:00:00.000Z';
      return route.fulfill({ status: 409, json: { message: 'Profile changed' } });
    }
    return route.fulfill({ json: profile(updatedAt, body.status) });
  });
  return state;
}

async function openAllDocuments(page: Page) {
  for (const label of LABELS) {
    await page.getByRole('button', { name: new RegExp(`Xem.*${label}`) }).click();
    await expect(page.getByRole('img', { name: new RegExp(label) })).toBeVisible();
  }
}

test('Admin deep links survive reload and the nav reflects the current route', async ({ page }) => {
  await staff(page, 'admin');
  await page.route('**/api/v1/admin/drivers?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.goto(`${ADMIN}/orders`);
  await expect(page.getByRole('heading', { name: 'Đơn hàng', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Đơn hàng' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Đơn hàng', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Nhật ký thao tác' }).click();
  await expect(page).toHaveURL(`${ADMIN}/audit`);
  await page.goto(ADMIN);
  await expect(page).toHaveURL(/\/drivers$/);
  await page.goto(`${ADMIN}/khong-ton-tai`);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  await page.goto(`${ADMIN}/drivers?status=approved`);
  await expect(page.getByLabel('Trạng thái')).toHaveValue('approved');
});

test('Dispatcher cannot reach the audit log even by URL', async ({ page }) => {
  await staff(page, 'dispatcher');
  await page.route('**/api/v1/admin/drivers?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  let auditCalls = 0;
  await page.route('**/api/v1/admin/audit-logs**', (route) => {
    auditCalls += 1;
    return route.fulfill({ status: 403, json: { message: 'Forbidden' } });
  });
  await page.goto(`${ADMIN}/audit`);
  await expect(page.getByRole('heading', { name: 'Không có quyền truy cập' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Nhật ký thao tác' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Hồ sơ tài xế' })).toBeVisible();
  expect(auditCalls).toBe(0);
});

test('Accountant gets an explicit no-feature screen instead of broken pages', async ({ page }) => {
  await staff(page, 'accountant');
  await page.goto(ADMIN);
  await expect(
    page.getByRole('heading', { name: /Chưa có chức năng cho vai trò Kế toán/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Điều hướng quản trị' }).getByRole('link'),
  ).toHaveCount(0);
});

test('Approval requires viewing every private document of the current revision', async ({
  page,
}) => {
  await staff(page, 'dispatcher');
  const state = await reviewFixture(page);
  await page.goto(`${ADMIN}/drivers`);
  await page.getByRole('link', { name: /Xem xét/ }).click();
  await expect(page).toHaveURL(new RegExp(`/drivers/${DRIVER_ID}`));
  const approve = page.getByRole('button', { name: 'Duyệt hồ sơ' });
  await expect(approve).toBeDisabled();
  await openAllDocuments(page);
  expect(await page.getByRole('img', { name: /Đăng ký xe/ }).getAttribute('src')).toMatch(/^blob:/);
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã duyệt hồ sơ.' })).toBeVisible();
  expect(state.reviewCalls).toEqual([
    { status: 'approved', expectedUpdatedAt: '2026-11-21T01:00:00.000Z' },
  ]);
  await expect(page).toHaveURL(/\/drivers\?status=pending&page=1$/);
});

test('A stale review reloads the new revision and keeps the typed reason', async ({ page }) => {
  await staff(page, 'admin');
  const state = await reviewFixture(page);
  state.conflictOnce = true;
  await page.goto(`${ADMIN}/drivers/${DRIVER_ID}?status=pending&page=1`);
  await page.getByLabel('Lý do từ chối').fill('Ảnh GPLX bị mờ');
  await page.getByRole('button', { name: 'Từ chối' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Hồ sơ vừa thay đổi' })).toBeVisible();
  await expect(page.getByLabel('Lý do từ chối')).toHaveValue('Ảnh GPLX bị mờ');
  // Views of the old revision no longer count: approval is locked until re-viewed.
  await expect(page.getByRole('button', { name: 'Duyệt hồ sơ' })).toBeDisabled();
  await page.getByRole('button', { name: 'Từ chối' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã từ chối hồ sơ.' })).toBeVisible();
  expect(state.reviewCalls).toEqual([
    { status: 'rejected', expectedUpdatedAt: '2026-11-21T01:00:00.000Z', reason: 'Ảnh GPLX bị mờ' },
    { status: 'rejected', expectedUpdatedAt: '2026-11-21T02:00:00.000Z', reason: 'Ảnh GPLX bị mờ' },
  ]);
});

test('Offline locks review decisions but keeps loaded context readable', async ({
  page,
  context,
}) => {
  await staff(page, 'admin');
  await reviewFixture(page);
  await page.goto(`${ADMIN}/drivers/${DRIVER_ID}`);
  await openAllDocuments(page);
  await expect(page.getByRole('button', { name: 'Duyệt hồ sơ' })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole('status').filter({ hasText: 'Mất kết nối mạng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duyệt hồ sơ' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: /Xem xét: 29A-123.45/ })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Duyệt hồ sơ' })).toBeEnabled();
});

test('Admin screens fit 320–1440px without horizontal overflow', async ({ page }) => {
  await staff(page, 'admin');
  await reviewFixture(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/drivers', `/drivers/${DRIVER_ID}`, '/orders', '/maps', '/audit']) {
      await page.goto(`${ADMIN}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => !element.closest('.sr-only, .skip-link, .leaflet-container'))
          .filter(
            (element) =>
              element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
          )
          .map((element) => `${element.tagName}.${element.className}`.slice(0, 80)),
      );
      expect(overflow, `${path} at ${width}px`).toEqual([]);
    }
  }
  // List-detail: below desktop the detail replaces the list and offers a way back.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${ADMIN}/drivers/${DRIVER_ID}`);
  await expect(page.getByRole('heading', { name: 'Danh sách hồ sơ' })).toBeHidden();
  await page.getByRole('link', { name: '← Danh sách hồ sơ' }).click();
  await expect(page.getByRole('heading', { name: 'Danh sách hồ sơ' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/drivers/${DRIVER_ID}`);
  await expect(page.getByRole('heading', { name: 'Danh sách hồ sơ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Xem xét/ })).toBeVisible();
});

test('Keyboard users can skip navigation to the main content', async ({ page }) => {
  await staff(page, 'admin');
  await page.route('**/api/v1/admin/drivers?**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  await page.goto(`${ADMIN}/drivers`);
  // Wait for session restore to finish so focus is not lost to a re-render.
  await expect(page.getByRole('heading', { name: 'Duyệt hồ sơ tài xế', level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Bỏ qua điều hướng' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});
