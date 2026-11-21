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
    await page.route('**/api/v1/auth/web/csrf', (route) =>
      route.fulfill({ json: { csrfToken: 'csrf-e2e' } }),
    );
    await page.route('**/api/v1/auth/web/refresh', (route) =>
      route.fulfill({
        json: {
          accessToken: 'access-e2e',
          csrfToken: 'csrf-e2e',
          user: { id: 'u-e2e', phone: '+84900000000', role: app.role, displayName: null },
        },
      }),
    );
    await page.route('**/api/v1/auth/web/logout', (route) => route.fulfill({ status: 204 }));

    await page.goto(app.url);
    await expect(page.getByRole('heading', { name: app.home })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng xuất' }).click();
    await expect(page.getByRole('heading', { name: /Đăng nhập/ })).toBeVisible();
  });
}

test('Customer exposes a recoverable auth error', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ status: 401, json: { message: 'Chưa có phiên' } }),
  );
  await page.route('**/api/v1/auth/web/otp/request', (route) =>
    route.fulfill({ status: 503, json: { message: 'Dịch vụ tạm gián đoạn' } }),
  );
  await page.goto('http://127.0.0.1:4174');
  await page.getByLabel('Số điện thoại').fill('+84900000000');
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByRole('alert')).toHaveText('Dịch vụ tạm gián đoạn');
});

test('Admin canary restores and logs out a cookie session', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf-admin' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access-admin',
        csrfToken: 'csrf-admin',
        user: { id: 'admin-e2e', phone: '+84900000001', role: 'admin', displayName: 'Admin' },
      },
    }),
  );
  await page.route('**/api/v1/auth/web/logout', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/admin/drivers**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );

  await page.goto('http://127.0.0.1:4176');
  await expect(page.getByRole('heading', { name: 'Duyệt hồ sơ tài xế' })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
});

test('Admin canary rejects a wrong-role restored session', async ({ page }) => {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf-wrong' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access-wrong',
        csrfToken: 'csrf-wrong',
        user: { id: 'customer-e2e', phone: '+84900000002', role: 'customer', displayName: null },
      },
    }),
  );
  await page.goto('http://127.0.0.1:4176');
  await expect(page.getByRole('heading', { name: 'Đăng nhập quản trị' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Duyệt hồ sơ tài xế' })).not.toBeVisible();
});

async function mockCustomerSession(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf-customer' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access-customer',
        csrfToken: 'csrf-customer',
        user: { id: 'customer-1', phone: '+84900000003', role: 'customer', displayName: 'An' },
      },
    }),
  );
}

test('Customer profile preserves edits on version conflict', async ({ page }) => {
  await mockCustomerSession(page);
  let getCount = 0;
  let patchCount = 0;
  let secondPatchBody: { displayName: string; expectedVersion: number } | null = null;
  await page.route('**/api/v1/users/me', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchCount += 1;
      if (patchCount === 1)
        return route.fulfill({ status: 409, json: { message: 'Profile changed' } });
      secondPatchBody = route.request().postDataJSON();
      return route.fulfill({
        json: {
          id: 'customer-1',
          phone: '+84900000003',
          role: 'customer',
          displayName: secondPatchBody?.displayName,
          version: 5,
          updatedAt: '2026-11-21T00:00:00.000Z',
        },
      });
    }
    getCount += 1;
    return route.fulfill({
      json: {
        id: 'customer-1',
        phone: '+84900000003',
        role: 'customer',
        displayName: getCount === 1 ? 'An' : 'An từ máy khác',
        version: getCount === 1 ? 3 : 4,
        updatedAt: '2026-11-21T00:00:00.000Z',
      },
    });
  });
  await page.goto('http://127.0.0.1:4174/profile');
  await page.getByLabel('Tên hiển thị').fill('Nguyễn An');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByRole('status')).toContainText('Hồ sơ đã thay đổi');
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Nguyễn An');
  await page.getByRole('button', { name: 'Tải phiên bản mới' }).click();
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('An từ máy khác');
  await page.getByLabel('Tên hiển thị').fill('Nguyễn An mới');
  await page.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(page.getByLabel('Tên hiển thị')).toHaveValue('Nguyễn An mới');
  expect(secondPatchBody).toEqual({ displayName: 'Nguyễn An mới', expectedVersion: 4 });
});

test('Customer confirms a memory-only address draft with provider search', async ({ page }) => {
  await mockCustomerSession(page);
  const config = {
    region: {
      id: 'hanoi-pilot',
      name: 'Hà Nội',
      bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
      center: { longitude: 105.8342, latitude: 21.0278 },
    },
    geocodingConfigured: true,
    routingConfigured: false,
    searchMode: 'submit-only',
    attribution: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
    routingProfile: 'driving-unverified-for-motorcycles',
  };
  let searchCount = 0;
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: config }));
  await page.route('**/api/v1/maps/search?**', (route) => {
    searchCount += 1;
    return route.fulfill({
      json: {
        provider: 'nominatim',
        items: [
          {
            id: String(searchCount),
            label: searchCount === 1 ? 'Hồ Hoàn Kiếm, Hà Nội' : 'Văn Miếu, Hà Nội',
            position: { longitude: 105.852, latitude: 21.028 },
          },
        ],
      },
    });
  });
  await page.goto('http://127.0.0.1:4174/addresses');
  const fillStop = async (query: string, result: string) => {
    await page.getByLabel('Tìm địa chỉ tại Hà Nội').fill(query);
    await page.getByRole('button', { name: 'Tìm địa chỉ' }).click();
    await page.getByRole('button', { name: result }).click();
    await page.getByLabel('Tên người liên hệ').fill('Nguyễn An');
    await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
    await page.getByRole('button', { name: 'Xác nhận điểm này' }).click();
  };
  await fillStop('Hoàn Kiếm', 'Hồ Hoàn Kiếm, Hà Nội');
  await page.getByRole('button', { name: /Điểm giao/ }).click();
  await fillStop('Văn Miếu', 'Văn Miếu, Hà Nội');
  await expect(page.getByText('Draft hợp lệ')).toBeVisible();
  await expect(page.getByText('Routing chưa cấu hình')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nhận báo giá' })).toBeDisabled();
  await expect(page.getByText(/chưa thể báo giá/i)).toBeVisible();
});

test('Customer can use and clear the manual address fallback', async ({ page }) => {
  await mockCustomerSession(page);
  const config = {
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
  };
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: config }));
  await page.goto('http://127.0.0.1:4174/addresses');
  await page.getByLabel('Kinh độ').fill('105.852');
  await page.getByLabel('Vĩ độ').fill('21.028');
  await page.getByRole('button', { name: 'Áp dụng tọa độ' }).click();
  await page.getByLabel('Địa chỉ của điểm').fill('Nhập thủ công, Hà Nội');
  await page.getByLabel('Tên người liên hệ').fill('Nguyễn An');
  await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
  await page.getByRole('button', { name: 'Xác nhận điểm này' }).click();
  await expect(page.getByRole('button', { name: /Điểm lấy/ })).toContainText('✓');
  await page.getByRole('button', { name: 'Xóa thông tin giao nhận' }).click();
  await expect(page.getByLabel('Địa chỉ của điểm')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Điểm lấy/ })).not.toContainText('✓');
});

test('Customer ignores a stale address search response', async ({ page }) => {
  await mockCustomerSession(page);
  const config = {
    region: {
      id: 'hanoi-pilot',
      name: 'Hà Nội',
      bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
      center: { longitude: 105.8342, latitude: 21.0278 },
    },
    geocodingConfigured: true,
    routingConfigured: false,
    searchMode: 'submit-only',
    attribution: '© OpenStreetMap contributors',
    attributionUrl: 'https://www.openstreetmap.org/copyright',
    routingProfile: 'driving-unverified-for-motorcycles',
  };
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: config }));
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/v1/maps/search?**', async (route) => {
    await responseReleased;
    await route.fulfill({
      json: {
        provider: 'nominatim',
        items: [
          { id: 'stale', label: 'Kết quả cũ', position: { longitude: 105.852, latitude: 21.028 } },
        ],
      },
    });
  });
  await page.goto('http://127.0.0.1:4174/addresses');
  await page.getByLabel('Tìm địa chỉ tại Hà Nội').fill('Hoàn Kiếm');
  await page.getByRole('button', { name: 'Tìm địa chỉ' }).click();
  await page.getByLabel('Tìm địa chỉ tại Hà Nội').fill('Văn Miếu');
  releaseResponse();
  await expect(page.getByRole('button', { name: 'Tìm địa chỉ' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Kết quả cũ' })).not.toBeVisible();
});

test('Customer address screen fits supported viewport widths', async ({ page }) => {
  await mockCustomerSession(page);
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
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4174/addresses');
    await expect(page.getByRole('heading', { name: 'Chọn điểm lấy và điểm giao' })).toBeVisible();
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('body *')]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
        )
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: element.getBoundingClientRect().right,
        })),
    );
    expect(overflow).toEqual([]);
  }
});
