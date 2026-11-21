import { expect, test, type Page, type Route } from '@playwright/test';

const DRIVER_URL = 'http://127.0.0.1:4175';
// 1×1 transparent PNG; synthetic test data, never a real document.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const REQUIRED = ['identity_front', 'identity_back', 'driver_license', 'vehicle_registration'];

type Profile = {
  userId: string;
  vehiclePlate: string;
  vehicleType: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  updatedAt: string;
};

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: 'driver-1',
    vehiclePlate: '29A-123.45',
    vehicleType: 'motorcycle',
    status: 'pending',
    rejectionReason: null,
    updatedAt: '2026-11-21T00:00:00.000Z',
    ...overrides,
  };
}
const doc = (kind: string) => ({
  id: `doc-${kind}`,
  driverId: 'driver-1',
  kind,
  contentType: 'image/jpeg',
  byteSize: 1024,
  createdAt: '2026-11-21T00:00:00.000Z',
});

async function mockDriverSession(page: Page) {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf-driver' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access-driver',
        csrfToken: 'csrf-driver',
        user: { id: 'driver-1', phone: '+84900000010', role: 'driver', displayName: 'Bình' },
      },
    }),
  );
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      json: {
        id: 'driver-1',
        phone: '+84900000010',
        role: 'driver',
        displayName: 'Bình',
        version: 1,
        updatedAt: '2026-11-21T00:00:00.000Z',
      },
    }),
  );
}

async function mockDriverData(
  page: Page,
  state: { profile: Profile | null; items: ReturnType<typeof doc>[] },
) {
  await page.route('**/api/v1/drivers/me', (route) => route.fulfill({ json: state.profile }));
  await page.route('**/api/v1/drivers/me/documents', (route: Route) => {
    if (route.request().method() === 'GET') {
      if (!state.profile)
        return route.fulfill({ status: 404, json: { message: 'Driver profile not found' } });
      return route.fulfill({
        json: {
          items: state.items,
          profile: state.profile,
          requiredKinds: REQUIRED,
          viewedIds: [],
        },
      });
    }
    return route.fallback();
  });
}

test('Driver submits a vehicle profile and uploads a document with revision check', async ({
  page,
}) => {
  await mockDriverSession(page);
  const state: { profile: Profile | null; items: ReturnType<typeof doc>[] } = {
    profile: null,
    items: [],
  };
  await mockDriverData(page, state);
  let submitted: unknown = null;
  await page.route('**/api/v1/drivers/me', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    submitted = route.request().postDataJSON();
    state.profile = makeProfile({
      vehiclePlate: '29A 123.45',
      updatedAt: '2026-11-21T01:00:00.000Z',
    });
    return route.fulfill({ json: state.profile });
  });
  let uploadBody = '';
  let uploads = 0;
  await page.route('**/api/v1/drivers/me/documents', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    uploads += 1;
    uploadBody = route.request().postDataBuffer()?.toString('latin1') ?? '';
    if (uploads === 1)
      return route.fulfill({
        status: 409,
        json: { message: 'Profile changed. Reload before uploading.' },
      });
    const document = doc('identity_front');
    state.items = [document];
    state.profile = makeProfile({ updatedAt: '2026-11-21T02:00:00.000Z' });
    return route.fulfill({ json: { document, profile: state.profile } });
  });

  await page.goto(DRIVER_URL);
  await expect(page.getByText('Gửi hồ sơ phương tiện trước')).toBeVisible();
  await page.goto(`${DRIVER_URL}/profile`);
  await page.getByLabel('Loại phương tiện').selectOption('motorcycle');
  await page.getByLabel('Biển số xe').fill('  29a   123.45 ');
  await page.getByRole('button', { name: 'Gửi hồ sơ phương tiện' }).click();
  await expect(page.getByText('Đã gửi hồ sơ phương tiện')).toBeVisible();
  expect(submitted).toEqual({ vehiclePlate: '29A 123.45', vehicleType: 'motorcycle' });

  await page.getByRole('link', { name: 'Giấy tờ' }).click();
  await expect(page.getByText('Còn thiếu 4/4')).toBeVisible();
  await page
    .getByLabel('Chọn ảnh CCCD mặt trước')
    .setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'Ảnh xem trước CCCD mặt trước' })).toBeVisible();
  await page.getByRole('button', { name: 'Nộp ảnh' }).click();
  await expect(page.getByRole('alert')).toContainText('ảnh đã chọn vẫn được giữ');
  await expect(page.getByRole('img', { name: 'Ảnh xem trước CCCD mặt trước' })).toBeVisible();
  expect(uploadBody).toContain('identity_front');
  expect(uploadBody).toContain('2026-11-21T01:00:00.000Z');

  await page.getByRole('button', { name: 'Tải lại hồ sơ' }).click();
  await page.getByRole('button', { name: 'Nộp ảnh' }).click();
  await expect(page.getByText('Đã nộp CCCD mặt trước')).toBeVisible();
  await expect(page.getByText('Còn thiếu 3/4')).toBeVisible();
  await expect(page.getByRole('img', { name: /Ảnh xem trước/ })).toHaveCount(0);
});

test('Driver rejects unsupported files before any upload', async ({ page }) => {
  await mockDriverSession(page);
  await mockDriverData(page, { profile: makeProfile(), items: [] });
  let uploads = 0;
  await page.route('**/api/v1/drivers/me/documents', (route) => {
    if (route.request().method() === 'POST') uploads += 1;
    return route.fallback();
  });
  await page.goto(`${DRIVER_URL}/documents`);
  await page.getByLabel('Chọn ảnh Giấy phép lái xe').setInputFiles({
    name: 'license.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  await expect(page.getByRole('alert')).toHaveText('Chỉ nhận ảnh JPEG hoặc PNG.');
  await expect(page.getByRole('button', { name: 'Nộp ảnh' })).toHaveCount(0);
  expect(uploads).toBe(0);
});

test('Approved driver views private documents read-only and may go online', async ({ page }) => {
  await mockDriverSession(page);
  await mockDriverData(page, {
    profile: makeProfile({ status: 'approved' }),
    items: REQUIRED.map(doc),
  });
  let authHeader: string | undefined;
  await page.route('**/api/v1/driver-documents/*/content', (route) => {
    authHeader = route.request().headers().authorization;
    return route.fulfill({
      body: PNG,
      contentType: 'image/png',
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
  await page.goto(`${DRIVER_URL}/documents`);
  await expect(page.getByText('Đã nộp đủ')).toBeVisible();
  await expect(page.getByLabel(/Thay ảnh/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Xem ảnh Đăng ký xe' }).click();
  const image = page.getByRole('img', { name: 'Ảnh đã nộp: Đăng ký xe' });
  await expect(image).toBeVisible();
  expect(await image.getAttribute('src')).toMatch(/^blob:/);
  expect(authHeader).toBe('Bearer access-driver');
  await page.getByRole('button', { name: 'Đóng ảnh' }).click();
  await expect(image).toHaveCount(0);

  await page.getByRole('link', { name: 'Trang chủ' }).click();
  await expect(page.getByRole('button', { name: 'Bật sẵn sàng' })).toBeEnabled();
});

test('Rejected driver sees the reason and the profile form stays editable', async ({ page }) => {
  await mockDriverSession(page);
  await mockDriverData(page, {
    profile: makeProfile({ status: 'rejected', rejectionReason: 'Ảnh GPLX bị mờ' }),
    items: [],
  });
  await page.goto(`${DRIVER_URL}/profile`);
  await expect(page.getByText('Ảnh GPLX bị mờ')).toBeVisible();
  await expect(page.getByLabel('Biển số xe')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cập nhật hồ sơ' })).toBeEnabled();
});

test.describe('foreground location check', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { longitude: 105.852, latitude: 21.028, accuracy: 12 },
  });
  test('reports a fresh fix without sending coordinates to the API', async ({ page }) => {
    await mockDriverSession(page);
    await mockDriverData(page, {
      profile: makeProfile({ status: 'approved' }),
      items: REQUIRED.map(doc),
    });
    const apiPaths: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/'))
        apiPaths.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.goto(DRIVER_URL);
    await page.getByRole('button', { name: 'Kiểm tra vị trí' }).click();
    await expect(page.getByText('Vị trí mới')).toBeVisible();
    await expect(page.getByText(/sai số ~12 m/)).toBeVisible();
    await page.getByRole('button', { name: 'Dừng kiểm tra' }).click();
    expect(
      apiPaths.filter((path) => !path.startsWith('GET ') && !path.includes('/auth/web/')),
    ).toEqual([]);
    expect(apiPaths.some((path) => /location|tracking|availability/.test(path))).toBe(false);
  });
});

test('Driver location check explains a denied permission', async ({
  page,
  context,
  browserName,
}) => {
  // Firefox automation leaves an unanswered prompt instead of denying; covered by the stubs below.
  test.skip(browserName === 'firefox', 'Firefox does not auto-deny geolocation under automation');
  await context.clearPermissions();
  await mockDriverSession(page);
  await mockDriverData(page, { profile: makeProfile(), items: [] });
  await page.goto(DRIVER_URL);
  await page.getByRole('button', { name: 'Kiểm tra vị trí' }).click();
  await expect(page.getByText('Bị chặn quyền vị trí')).toBeVisible();
  await expect(page.getByText(/cho phép Vị trí/)).toBeVisible();
});

/** Replaces geolocation/permissions so every browser engine follows the same scenario. */
async function stubGeolocation(
  page: import('@playwright/test').Page,
  permission: 'prompt' | 'denied',
) {
  await page.addInitScript((state) => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: () => 1,
        clearWatch: () => undefined,
        getCurrentPosition: () => undefined,
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state, onchange: null }) },
    });
  }, permission);
}

test('Driver sees "blocked" from the Permissions API even when the browser never answers', async ({
  page,
}) => {
  await stubGeolocation(page, 'denied');
  await mockDriverSession(page);
  await mockDriverData(page, { profile: makeProfile(), items: [] });
  await page.goto(DRIVER_URL);
  await page.getByRole('button', { name: 'Kiểm tra vị trí' }).click();
  await expect(page.getByText('Bị chặn quyền vị trí')).toBeVisible();
  await expect(page.getByText(/cho phép Vị trí/)).toBeVisible();
});

test('Driver gets guidance when a location prompt stays unanswered', async ({ page }) => {
  await page.clock.install();
  await stubGeolocation(page, 'prompt');
  await mockDriverSession(page);
  await mockDriverData(page, { profile: makeProfile(), items: [] });
  await page.goto(DRIVER_URL);
  await page.getByRole('button', { name: 'Kiểm tra vị trí' }).click();
  await expect(page.getByText('Đang chờ vị trí')).toBeVisible();
  await expect(page.getByText(/Nếu trình duyệt đang hỏi quyền/)).toHaveCount(0);
  await page.clock.fastForward(11_000);
  await expect(page.getByText(/Nếu trình duyệt đang hỏi quyền/)).toBeVisible();
});

test('Driver documents screen fits supported viewport widths', async ({ page }) => {
  await mockDriverSession(page);
  await mockDriverData(page, { profile: makeProfile(), items: [doc('identity_front')] });
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/documents', '/profile']) {
      await page.goto(`${DRIVER_URL}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => !element.classList.contains('visually-hidden'))
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

test.describe('WEB-002 gps lab', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: { longitude: 105.852, latitude: 21.028, accuracy: 14 },
  });
  test('records timing and accuracy only and exports a coordinate-free evidence row', async ({
    page,
  }) => {
    await mockDriverSession(page);
    await mockDriverData(page, { profile: makeProfile(), items: [] });
    const apiCalls: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'GET' &&
        request.url().includes('/api/v1/') &&
        !request.url().includes('/auth/web/')
      )
        apiCalls.push(request.url());
    });
    await page.goto(`${DRIVER_URL}/gps-lab`);
    await expect(page.getByRole('heading', { name: 'Đo GPS trình duyệt', level: 1 })).toBeVisible();
    await page.getByLabel(/Tên thiết bị/).fill('Pixel 8 | lab');
    await page.getByLabel('Kịch bản').selectOption('foreground-2m');
    await page.getByRole('button', { name: 'Bắt đầu đo' }).click();
    await expect(page.getByText(/[1-9]\d* fix/).first()).toBeVisible();
    // Emulated GPS only reports on movement, so move the device twice (real phones also poll).
    await page.context().setGeolocation({ longitude: 105.853, latitude: 21.029, accuracy: 14 });
    await expect(page.getByText(/· 2 fix ·/)).toBeVisible();
    await page.waitForTimeout(1100);
    await page.context().setGeolocation({ longitude: 105.854, latitude: 21.03, accuracy: 14 });
    await expect(page.getByText(/· 3 fix ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Dừng đo' }).click();
    await expect(page.getByText(/Khoảng cách fix median\/max: \d/)).toBeVisible();
    const row = await page.getByLabel('Dòng cho docs/web-002-browser-evidence.md').inputValue();
    expect(row.split(' | ')).toHaveLength(11);
    expect(row).toContain('Pixel 8 / lab');
    expect(row).toContain('Foreground 2 phút');
    expect(row).toMatch(/\| 14\/14 m \|/);
    expect(row).not.toContain('105.85');
    expect(row).not.toMatch(/21\.0[23]/);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải JSON (không có tọa độ)' }).click();
    const file = await (await download).path();
    const json = (await import('node:fs')).readFileSync(file!, 'utf8');
    expect(json).toContain('shango-gps-lab');
    expect(json).not.toMatch(/latitude|longitude|105\.85|21\.0[23]/);
    expect(apiCalls).toEqual([]);
  });
});
