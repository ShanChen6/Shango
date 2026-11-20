import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web-e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    { command: 'npm run preview -w @shango/customer-web -- --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: !process.env.CI },
    { command: 'npm run preview -w @shango/driver-web -- --port 4175', url: 'http://127.0.0.1:4175', reuseExistingServer: !process.env.CI },
    { command: 'VITE_WEB_AUTH_ENABLED=true npm run build -w @shango/admin && npm run preview -w @shango/admin -- --port 4176', url: 'http://127.0.0.1:4176', reuseExistingServer: !process.env.CI },
  ],
});
