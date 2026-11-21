import { expect, test, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import pg from 'pg';

// Real API + DB contract: cookie auth for three apps, live order lifecycle over Socket.IO.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const phones: string[] = [];
const newPhone = () => {
  const phone = `+849${randomInt(10000000, 99999999)}`;
  phones.push(phone);
  return phone;
};

test.afterAll(async () => {
  const ids = (
    await db.query<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1)', [phones])
  ).rows.map((r) => r.id);
  if (ids.length) {
    const orders = (
      await db.query<{ id: string }>(
        'SELECT id FROM orders WHERE customer_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])',
        [ids],
      )
    ).rows.map((r) => r.id);
    const offers = (
      await db.query<{ id: string }>(
        'SELECT id FROM order_offers WHERE order_id = ANY($1::uuid[])',
        [orders],
      )
    ).rows.map((r) => r.id);
    await db.query('DELETE FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])', [
      [...orders, ...offers],
    ]);
    await db.query('DELETE FROM order_offers WHERE id = ANY($1::uuid[])', [offers]);
    await db.query('DELETE FROM order_events WHERE order_id = ANY($1::uuid[])', [orders]);
    await db.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [orders]);
    await db.query('DELETE FROM order_quotes WHERE customer_id = ANY($1::uuid[])', [ids]);
    await db.query(
      'DELETE FROM audit_logs WHERE actor_id = ANY($1::uuid[]) OR entity_id = ANY($1::uuid[])',
      [ids],
    );
    await db.query('DELETE FROM driver_locations WHERE driver_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM driver_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM auth_sessions WHERE user_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  }
  await db.end();
});

async function login(page: Page, url: string, phone: string, home: RegExp) {
  await page.goto(url);
  await page.getByLabel(/Số điện thoại/).fill(phone);
  const challenge = page.waitForResponse('**/auth/web/otp/request');
  await page.getByRole('button', { name: /Gửi mã/ }).click();
  const { devCode } = await (await challenge).json();
  await page.getByLabel(/Mã/).fill(devCode);
  await page.getByRole('button', { name: /Đăng nhập/ }).click();
  await expect(page.getByRole('heading', { name: home, level: 1 })).toBeVisible();
}

async function stopFill(page: Page, address: string, tab: RegExp) {
  await expect(page.getByLabel('Kinh độ')).toHaveValue('');
  await page.getByLabel('Kinh độ').fill('105.852');
  await page.getByLabel('Vĩ độ').fill('21.028');
  await page.getByRole('button', { name: 'Áp dụng tọa độ' }).click();
  await page.getByLabel('Địa chỉ của điểm').fill(address);
  await page.getByLabel('Tên người liên hệ').fill('Nguyễn An');
  await page.getByLabel('Số điện thoại liên hệ').fill('0901234567');
  await page.getByRole('button', { name: 'Xác nhận điểm này' }).click();
  await expect(page.getByRole('button', { name: tab })).toContainText('✓');
}

test('customer, driver and admin complete a live order against the real API', async ({
  browser,
}) => {
  const driverPhone = newPhone();
  const customerPhone = newPhone();
  const adminPhone = newPhone();

  const driverContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { longitude: 105.853, latitude: 21.029, accuracy: 15 },
  });
  const driver = await driverContext.newPage();
  await login(driver, 'http://127.0.0.1:4175', driverPhone, /Sẵn sàng khi GPS/);
  const refresh = (await driverContext.cookies()).find(
    (cookie) => cookie.name === '__Host-shango-refresh',
  );
  expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' });
  await driver.goto('http://127.0.0.1:4175/profile');
  await driver.getByLabel('Loại phương tiện').selectOption('motorcycle');
  await driver.getByLabel('Biển số xe').fill('29A-555.55');
  await driver.getByRole('button', { name: 'Gửi hồ sơ phương tiện' }).click();
  await expect(driver.getByText('Đã gửi hồ sơ phương tiện')).toBeVisible();
  await db.query(
    `UPDATE driver_profiles SET status = 'approved' WHERE user_id = (SELECT id FROM users WHERE phone = $1)`,
    [driverPhone],
  );
  await driver.goto('http://127.0.0.1:4175/');
  await driver.getByRole('button', { name: 'Bật sẵn sàng' }).click();
  await expect(driver.getByRole('button', { name: 'Tắt sẵn sàng' })).toBeVisible({
    timeout: 15_000,
  });

  const customer = await (await browser.newContext()).newPage();
  await login(customer, 'http://127.0.0.1:4174', customerPhone, /Bạn muốn gửi hàng/);
  await customer.goto('http://127.0.0.1:4174/addresses');
  await stopFill(customer, 'Hồ Hoàn Kiếm, Hà Nội', /Điểm lấy/);
  await customer.getByRole('button', { name: /Điểm giao/ }).click();
  await stopFill(customer, 'Văn Miếu, Hà Nội', /Điểm giao/);
  await customer.getByRole('button', { name: 'Nhận báo giá' }).click();
  await customer.getByRole('button', { name: /Đặt đơn 31\.000/ }).click();
  await expect(customer.getByRole('heading', { name: 'Đang tìm tài xế', level: 1 })).toBeVisible();
  await expect(customer.getByText('Đang cập nhật trực tiếp')).toBeVisible();

  await expect(driver.getByText('Có đề nghị giao hàng mới.')).toBeVisible({ timeout: 20_000 });
  await driver.getByRole('link', { name: 'Xem đề nghị' }).click();
  await driver.getByRole('button', { name: 'Nhận đơn' }).click();
  await expect(driver).toHaveURL('http://127.0.0.1:4175/order');
  await expect(
    customer.getByRole('heading', { name: 'Tài xế đang đến điểm lấy', level: 1 }),
  ).toBeVisible({ timeout: 15_000 });
  for (const step of ['Đã đến điểm lấy', 'Đã lấy hàng', 'Bắt đầu giao', 'Đã giao hàng']) {
    await driver.getByRole('button', { name: step }).click();
    await expect(driver.getByRole('button', { name: step })).toHaveCount(0);
  }
  await expect(customer.getByRole('heading', { name: 'Đã giao', level: 1 })).toBeVisible({
    timeout: 15_000,
  });

  await db.query(`INSERT INTO users (phone, role) VALUES ($1, 'dispatcher')`, [adminPhone]);
  const admin = await (await browser.newContext()).newPage();
  await login(admin, 'http://127.0.0.1:4176', adminPhone, /Duyệt hồ sơ tài xế/);
  await admin.getByRole('link', { name: 'Đơn hàng' }).click();
  await admin.getByLabel('Trạng thái').selectOption('DELIVERED');
  await expect(admin.getByText('Hồ Hoàn Kiếm, Hà Nội → Văn Miếu, Hà Nội').first()).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Nhật ký thao tác' })).toHaveCount(0);

  const history = await db.query<{ statuses: string }>(
    `SELECT string_agg(e.status, ',' ORDER BY e.version) AS statuses FROM order_events e
     JOIN orders o ON o.id = e.order_id JOIN users u ON u.id = o.customer_id WHERE u.phone = $1`,
    [customerPhone],
  );
  expect(history.rows[0]!.statuses).toBe(
    'SEARCHING,ASSIGNED,AT_PICKUP,PICKED_UP,IN_TRANSIT,DELIVERED',
  );
});
