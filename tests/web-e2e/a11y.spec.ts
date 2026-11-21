import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Automated WCAG 2.1 A/AA smoke on key screens (API mocked). Fails on serious/critical issues.
// Not a substitute for keyboard/screen-reader/zoom checks on real devices (release checklist).
const ORDER_ID = '6cdf06f0-e000-4111-8111-00000000e001';
const DRIVER_ID = '6cdf06f0-e000-4111-8111-00000000e002';
const stop = (address: string) => ({
  position: { longitude: 105.852, latitude: 21.028 },
  address,
  detail: '',
  contactName: 'Nguyễn An',
  contactPhone: '+84901234567',
  note: '',
});
const order = {
  id: ORDER_ID,
  status: 'ASSIGNED',
  version: 2,
  vehicleType: 'motorcycle',
  stops: { pickup: stop('Hồ Hoàn Kiếm, Hà Nội'), dropoff: stop('Văn Miếu, Hà Nội') },
  distanceMeters: 3200,
  durationSeconds: 600,
  priceVnd: 31000,
  tariffVersion: 'pilot-unapproved',
  searchDeadline: new Date(Date.now() + 300_000).toISOString(),
  cancelReason: null,
  customerId: 'c-1',
  driverId: DRIVER_ID,
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
  driver: {
    id: DRIVER_ID,
    displayName: 'Bình',
    vehiclePlate: '29A-123.45',
    vehicleType: 'motorcycle',
  },
  driverLocation: {
    longitude: 105.853,
    latitude: 21.029,
    accuracy: 12,
    recordedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  },
};
const mapConfig = {
  region: {
    id: 'hanoi-pilot',
    name: 'Hà Nội',
    bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
    center: { longitude: 105.8342, latitude: 21.0278 },
  },
  geocodingConfigured: true,
  routingConfigured: true,
  searchMode: 'submit-only',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  routingProfile: 'driving-unverified-for-motorcycles',
};
const profile = {
  userId: DRIVER_ID,
  vehiclePlate: '29A-123.45',
  vehicleType: 'motorcycle',
  status: 'pending',
  rejectionReason: null,
  updatedAt: '2026-11-21T00:00:00.000Z',
};

async function signedIn(page: Page, role: string) {
  await page.route('**/api/v1/auth/web/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'csrf' } }),
  );
  await page.route('**/api/v1/auth/web/refresh', (route) =>
    route.fulfill({
      json: {
        accessToken: 'access',
        csrfToken: 'csrf',
        user: { id: 'u-1', phone: '+84900000001', role, displayName: 'Tester' },
      },
    }),
  );
  await page.route('**/api/v1/maps/config', (route) => route.fulfill({ json: mapConfig }));
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      json: {
        id: 'u-1',
        phone: '+84900000001',
        role,
        displayName: 'Tester',
        version: 1,
        updatedAt: '2026-11-21T00:00:00.000Z',
      },
    }),
  );
  await page.route('**/api/v1/orders', (route) => route.fulfill({ json: { items: [order] } }));
  await page.route(`**/api/v1/orders/${ORDER_ID}`, (route) => route.fulfill({ json: order }));
  await page.route('**/api/v1/drivers/me', (route) => route.fulfill({ json: profile }));
  await page.route('**/api/v1/drivers/me/documents', (route) =>
    route.fulfill({
      json: {
        items: [],
        profile,
        requiredKinds: [
          'identity_front',
          'identity_back',
          'driver_license',
          'vehicle_registration',
        ],
        viewedIds: [],
      },
    }),
  );
  await page.route('**/api/v1/drivers/me/presence', (route) =>
    route.fulfill({ json: { available: false, lastSeenAt: null, accuracy: null, fresh: false } }),
  );
  await page.route('**/api/v1/drivers/me/offers/current', (route) =>
    route.fulfill({ json: { offer: null } }),
  );
  await page.route('**/api/v1/drivers/me/orders/current', (route) =>
    route.fulfill({ json: { order: null } }),
  );
  await page.route('**/api/v1/admin/orders**', (route) =>
    route.fulfill({ json: { items: [order] } }),
  );
  await page.route('**/api/v1/admin/drivers?**', (route) =>
    route.fulfill({
      json: {
        items: [{ ...profile, phone: '+84900000222', displayName: 'Trần Bình' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    }),
  );
  await page.route(`**/api/v1/admin/drivers/${DRIVER_ID}/documents`, (route) =>
    route.fulfill({
      json: { items: [], profile, requiredKinds: ['identity_front'], viewedIds: [] },
    }),
  );
}

const screens = [
  { name: 'Customer login', url: 'http://127.0.0.1:4174/', role: null },
  { name: 'Customer address planner', url: 'http://127.0.0.1:4174/addresses', role: 'customer' },
  {
    name: 'Customer order detail',
    url: `http://127.0.0.1:4174/orders/${ORDER_ID}`,
    role: 'customer',
  },
  { name: 'Driver home', url: 'http://127.0.0.1:4175/', role: 'driver' },
  { name: 'Driver documents', url: 'http://127.0.0.1:4175/documents', role: 'driver' },
  { name: 'Driver profile', url: 'http://127.0.0.1:4175/profile', role: 'driver' },
  { name: 'Admin login', url: 'http://127.0.0.1:4176/', role: null },
  { name: 'Admin driver review', url: `http://127.0.0.1:4176/drivers/${DRIVER_ID}`, role: 'admin' },
  { name: 'Admin orders', url: 'http://127.0.0.1:4176/orders', role: 'admin' },
];

for (const screen of screens) {
  test(`a11y: ${screen.name}`, async ({ page }) => {
    if (screen.role) await signedIn(page, screen.role);
    else
      await page.route('**/api/v1/auth/web/csrf', (route) =>
        route.fulfill({ status: 401, json: { message: 'no session' } }),
      );
    await page.goto(screen.url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.leaflet-container')
      .analyze();
    const blocking = results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes
            .map((node) => node.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      );
    expect(blocking, screen.name).toEqual([]);
  });
}
