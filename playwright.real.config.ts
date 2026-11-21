import { defineConfig, devices } from '@playwright/test';

// Contract E2E: real API + PostgreSQL/PostGIS + Redis + Socket.IO behind the Vite preview proxy.
// Requires DATABASE_URL/REDIS_URL of a dedicated, migrated test database (see CI job web-e2e-real).
const apiEnv = [
  'NODE_ENV=test',
  'PORT=3000',
  'WEB_AUTH_ENABLED=true',
  'CSRF_SECRET=ci-only-csrf-secret-not-for-production-777777',
  'ORDERS_ENABLED=true',
  'DISPATCH_TICK_MS=1000',
  'OSRM_BASE_URL=http://127.0.0.1:5999',
  'TARIFF_MOTORCYCLE_BASE_VND=15000',
  'TARIFF_MOTORCYCLE_PER_KM_VND=5000',
  'CORS_ORIGINS=http://127.0.0.1:4174,http://127.0.0.1:4175,http://127.0.0.1:4176',
  'PRIVATE_DOCUMENTS_DIR=/tmp/shango-e2e-private-documents',
].join(' ');

export default defineConfig({
  testDir: './tests/web-e2e-real',
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node tests/web-e2e-real/osrm-stub.mjs',
      port: 5999,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `env ${apiEnv} npm run start -w @shango/api`,
      url: 'http://127.0.0.1:3000/api/v1/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run preview -w @shango/customer-web -- --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run preview -w @shango/driver-web -- --port 4175',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'VITE_WEB_AUTH_ENABLED=true npm run build -w @shango/admin && npm run preview -w @shango/admin -- --port 4176',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
