import { expect, test, type Page } from '@playwright/test';

const CUSTOMER = 'http://127.0.0.1:4174';
const DRIVER = 'http://127.0.0.1:4175';
const ADMIN = 'http://127.0.0.1:4176';
const ORDER_ID = '6cdf06f0-e000-4111-8111-00000000a001';
const stop = (address: string) => ({
  position: { longitude: 105.852, latitude: 21.028 },
  address,
  detail: '',
  contactName: 'Nguyễn An',
  contactPhone: '+84901234567',
  note: '',
});
const baseOrder = {
  id: ORDER_ID,
  status: 'SEARCHING',
  version: 1,
  vehicleType: 'motorcycle',
  stops: { pickup: stop('Hồ Hoàn Kiếm, Hà Nội'), dropoff: stop('Văn Miếu, Hà Nội') },
  distanceMeters: 3200,
  durationSeconds: 600,
  priceVnd: 31000,
  tariffVersion: 'pilot-unapproved',
  searchDeadline: new Date(Date.now() + 300_000).toISOString(),
  cancelReason: null,
  customerId: 'customer-1',
  driverId: null,
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
  driver: null,
  driverLocation: null,
};
const mapConfig = {
  region: {
    id: 'hanoi-pilot',
    name: 'Hà Nội',
    bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
    center: { longitude: 105.8342, latitude: 21.0278 },
  },
  geocodingConfigured: false,
  routingConfigured: true,
  searchMode: 'submit-only',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  routingProfile: 'driving-unverified-for-motorcycles',
};

async function session(page: Page, role: string, id: string) {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: `csrf-${role}` } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: `access-${role}`,
        csrfToken: `csrf-${role}`,
        user: { id, phone: '+84900000099', role, displayName: 'Tester' },
      },
    }),
  );
}

async function fillManualStop(page: Page, address: string, tab: RegExp) {
  // Switching tabs resets the coordinate inputs; wait for that before typing.
  await expect(page.getByLabel('Kinh độ')).toHaveValue('');
  await page.getByLabel('Kinh độ').fill('105.852');
  await page.getByLabel('Vĩ độ').fill('21.028');
  await page.getByRole('button', { name: 'Áp dụng tọa độ' }).click();
  await expect(page.getByLabel('Kinh độ')).toHaveValue('105.852');
  await page.getByLabel('Địa chỉ của điểm').fill(address);
  await page.getByLabel('Tên người liên hệ').fill('Nguyễn An');
  await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
  await page.getByRole('button', { name: 'Xác nhận điểm này' }).click();
  await expect(page.getByRole('button', { name: tab })).toContainText('✓');
}

test('Customer quotes, books idempotently by quote and cancels while searching', async ({
  page,
}) => {
  await session(page, 'customer', 'customer-1');
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: mapConfig }));
  let quoteBody: Record<string, unknown> | null = null;
  let createBody: unknown = null;
  let cancelBody: unknown = null;
  let current = { ...baseOrder };
  await page.route('**/api/v1/orders/quote', (route) => {
    quoteBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
        id: '6cdf06f0-e000-4111-8111-00000000b001',
        vehicleType: 'motorcycle',
        distanceMeters: 3200,
        durationSeconds: 600,
        priceVnd: 31000,
        tariffVersion: 'pilot-unapproved',
        pricingApproved: false,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        routeGeometry: { type: 'LineString', coordinates: [] },
      },
    });
  });
  await page.route('**/api/v1/orders', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    createBody = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: current });
  });
  await page.route(`**/api/v1/orders/${ORDER_ID}`, (route) => route.fulfill({ json: current }));
  await page.route(`**/api/v1/orders/${ORDER_ID}/cancel`, (route) => {
    cancelBody = route.request().postDataJSON();
    current = {
      ...current,
      status: 'CANCELLED',
      version: 2,
      cancelReason: 'Khách hàng hủy khi đang tìm tài xế',
    };
    return route.fulfill({ json: current });
  });

  await page.goto(`${CUSTOMER}/addresses`);
  await fillManualStop(page, 'Hồ Hoàn Kiếm, Hà Nội', /Điểm lấy/);
  await page.getByRole('button', { name: /Điểm giao/ }).click();
  await fillManualStop(page, 'Văn Miếu, Hà Nội', /Điểm giao/);
  await page.getByRole('button', { name: 'Nhận báo giá' }).click();
  await expect(page.getByText(/31\.000\s₫/).first()).toBeVisible();
  await expect(page.getByText(/Giá thử nghiệm/)).toBeVisible();
  expect(quoteBody).toMatchObject({
    vehicleType: 'motorcycle',
    pickup: {
      address: 'Hồ Hoàn Kiếm, Hà Nội',
      contactPhone: '+84901234567',
      position: { longitude: 105.852, latitude: 21.028 },
    },
  });
  expect(JSON.stringify(quoteBody)).not.toContain('confirmed');

  await page.getByRole('button', { name: /Đặt đơn/ }).click();
  await expect(page).toHaveURL(`${CUSTOMER}/orders/${ORDER_ID}`);
  expect(createBody).toEqual({ quoteId: '6cdf06f0-e000-4111-8111-00000000b001' });
  await expect(page.getByRole('heading', { name: 'Đang tìm tài xế', level: 1 })).toBeVisible();
  await expect(page.getByText('Chưa có tài xế nhận đơn.')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy đơn' }).click();
  await expect(page.getByRole('heading', { name: 'Đã hủy', level: 1 })).toBeVisible();
  expect(cancelBody).toEqual({ expectedVersion: 1 });
});

test('Customer sees a clear message when pricing is not configured', async ({ page }) => {
  await session(page, 'customer', 'customer-1');
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: mapConfig }));
  await page.route('**/api/v1/orders/quote', (route) =>
    route.fulfill({
      status: 503,
      json: { message: 'Bảng giá chưa được cấu hình cho loại xe này' },
    }),
  );
  await page.goto(`${CUSTOMER}/addresses`);
  await fillManualStop(page, 'Hồ Hoàn Kiếm, Hà Nội', /Điểm lấy/);
  await page.getByRole('button', { name: /Điểm giao/ }).click();
  await fillManualStop(page, 'Văn Miếu, Hà Nội', /Điểm giao/);
  await page.getByLabel('Loại xe').selectOption('car');
  await page.getByRole('button', { name: 'Nhận báo giá' }).click();
  await expect(page.getByRole('alert')).toHaveText('Bảng giá chưa được cấu hình cho loại xe này');
  await expect(page.getByRole('button', { name: /Đặt đơn/ })).toHaveCount(0);
});

test.describe('driver work flow', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { longitude: 105.853, latitude: 21.029, accuracy: 15 },
  });

  test('Driver sends a fix before going online, accepts an offer and advances with versions', async ({
    page,
  }) => {
    await session(page, 'driver', 'driver-1');
    const profile = {
      userId: 'driver-1',
      vehiclePlate: '29A-123.45',
      vehicleType: 'motorcycle',
      status: 'approved',
      rejectionReason: null,
      updatedAt: '2026-11-21T00:00:00.000Z',
    };
    await page.route('**/api/v1/drivers/me', (route) => route.fulfill({ json: profile }));
    await page.route('**/api/v1/drivers/me/documents', (route) =>
      route.fulfill({ json: { items: [], profile, requiredKinds: [], viewedIds: [] } }),
    );
    const calls: string[] = [];
    let available = false;
    let offer: Record<string, unknown> | null = null;
    let current: Record<string, unknown> | null = null;
    const statusBodies: unknown[] = [];
    await page.route('**/api/v1/drivers/me/presence', (route) =>
      route.fulfill({
        json: { available, lastSeenAt: new Date().toISOString(), accuracy: 15, fresh: available },
      }),
    );
    await page.route('**/api/v1/drivers/me/location', (route) => {
      calls.push('location');
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        longitude: 105.853,
        latitude: 21.029,
        accuracy: 15,
        sequence: expect.any(Number),
      });
      return route.fulfill({ json: { accepted: true } });
    });
    await page.route('**/api/v1/drivers/me/availability', (route) => {
      calls.push(`availability:${route.request().postDataJSON().available}`);
      available = route.request().postDataJSON().available;
      return route.fulfill({ json: { available } });
    });
    await page.route('**/api/v1/drivers/me/offers/current', (route) =>
      route.fulfill({ json: { offer } }),
    );
    await page.route('**/api/v1/drivers/me/orders/current', (route) =>
      route.fulfill({ json: { order: current } }),
    );
    await page.route('**/api/v1/drivers/me/offers/*/accept', (route) => {
      current = { ...baseOrder, status: 'ASSIGNED', version: 2, driverId: 'driver-1' };
      offer = null;
      return route.fulfill({ json: current });
    });
    await page.route(`**/api/v1/drivers/me/orders/${ORDER_ID}/status`, (route) => {
      const body = route.request().postDataJSON();
      statusBodies.push(body);
      current = { ...current!, status: body.status, version: body.expectedVersion + 1 };
      return route.fulfill({ json: current });
    });

    await page.goto(DRIVER);
    await page.getByRole('button', { name: 'Bật sẵn sàng' }).click();
    await expect(page.getByRole('button', { name: 'Tắt sẵn sàng' })).toBeVisible();
    expect(calls.slice(0, 2)).toEqual(['location', 'availability:true']);

    offer = {
      id: '6cdf06f0-e000-4111-8111-00000000c001',
      orderId: ORDER_ID,
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
      pickupDistanceMeters: 150,
      vehicleType: 'motorcycle',
      distanceMeters: 3200,
      durationSeconds: 600,
      priceVnd: 31000,
      pickup: { address: 'Hồ Hoàn Kiếm, Hà Nội' },
      dropoff: { address: 'Văn Miếu, Hà Nội' },
    };
    await page.getByRole('link', { name: 'Đề nghị' }).click();
    await expect(page.getByText(/Còn \d+ giây/)).toBeVisible();
    await expect(page.getByText(/0901234567|\+84901234567/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Nhận đơn' }).click();
    await expect(page).toHaveURL(`${DRIVER}/order`);
    await expect(page.getByRole('link', { name: '+84901234567' })).toHaveAttribute(
      'href',
      'tel:+84901234567',
    );
    await page.getByRole('button', { name: 'Đã đến điểm lấy' }).click();
    await expect(page.getByRole('button', { name: 'Đã lấy hàng' })).toBeVisible();
    expect(statusBodies).toEqual([{ status: 'AT_PICKUP', expectedVersion: 2 }]);
  });
});

test('Admin canary lists orders and cancels with a reason', async ({ page }) => {
  await session(page, 'admin', 'admin-1');
  await page.route('**/api/v1/admin/drivers**', (route) =>
    route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } }),
  );
  let cancelBody: unknown = null;
  let item = {
    ...baseOrder,
    status: 'ASSIGNED',
    version: 2,
    driverId: 'driver-1',
    driver: {
      id: 'driver-1',
      displayName: 'Bình',
      vehiclePlate: '29A-123.45',
      vehicleType: 'motorcycle',
    },
  };
  await page.route('**/api/v1/admin/orders', (route) => route.fulfill({ json: { items: [item] } }));
  await page.route(`**/api/v1/admin/orders/${ORDER_ID}/cancel`, (route) => {
    cancelBody = route.request().postDataJSON();
    item = { ...item, status: 'CANCELLED', version: 3, cancelReason: 'Khách gọi hủy' };
    return route.fulfill({ json: item });
  });
  await page.goto(ADMIN);
  await page.getByRole('button', { name: 'Đơn hàng' }).click();
  await expect(page.getByText('Bình · 29A-123.45')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy đơn' }).click();
  await page.getByLabel('Lý do hủy').fill('Khách gọi hủy');
  await page.getByRole('button', { name: 'Xác nhận hủy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã hủy đơn' })).toBeVisible();
  expect(cancelBody).toEqual({ expectedVersion: 2, reason: 'Khách gọi hủy' });
});

test('Order screens fit supported viewport widths', async ({ page }) => {
  await session(page, 'customer', 'customer-1');
  await page.route('**/api/v1/orders', (route) => route.fulfill({ json: { items: [baseOrder] } }));
  await page.route(`**/api/v1/orders/${ORDER_ID}`, (route) => route.fulfill({ json: baseOrder }));
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/orders', `/orders/${ORDER_ID}`]) {
      await page.goto(`${CUSTOMER}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(
            (element) =>
              element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
          )
          .map((element) => `${element.tagName}.${element.className}`),
      );
      expect(overflow, `${path} at ${width}px`).toEqual([]);
    }
  }
});
