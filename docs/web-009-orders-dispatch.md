# WEB-009 — Đơn hàng, điều phối và realtime

- Ngày: 2026-11-21
- Trạng thái: **lát dọc đầu tiên có code + test; mặc định TẮT** (`ORDERS_ENABLED=false`)
- Quyết định của chủ dự án cho lát này (21/11/2026):
  1. **Giá:** bảng giá cấu hình theo loại xe (giá mở cửa + đơn giá/km), VND nguyên, ghi rõ
     "giá thử nghiệm". Đây **không** phải bảng giá PO đã duyệt.
  2. **Điều phối:** tự động offer lần lượt cho tài xế rảnh gần nhất có GPS mới.
  3. **Hủy/tiền:** tối giản. Khách hủy khi `SEARCHING`; điều phối viên hủy đến `AT_PICKUP`
     kèm lý do. Không phí hủy, không COD hàng hóa, không ledger; khách trả tiền mặt cho tài xế
     ngoài hệ thống.
  4. **Phạm vi:** backend + Customer/Driver/Admin web.

## Luồng

```text
Customer: chọn 2 điểm → POST /orders/quote → POST /orders {quoteId} → SEARCHING
Dispatch (mỗi DISPATCH_TICK_MS): offer tài xế gần nhất → 20s → hết hạn → tài xế kế tiếp
Driver: nhận → ASSIGNED → AT_PICKUP → PICKED_UP → IN_TRANSIT → DELIVERED
Hết DISPATCH_SEARCH_SECONDS không ai nhận → EXPIRED
```

## Backend (`apps/api`)

| Thành phần                          | Nội dung                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Migration `005_orders_dispatch.sql` | `order_quotes`, `orders`, `order_offers`, `order_events`; thêm `accuracy_m`, `recorded_at` cho `driver_locations` |
| `orders-policy.ts`                  | State machine, quyền hủy, bảng giá, kiểm tra điểm/liên hệ, kiểm tra fix GPS (thuần, có unit test)                 |
| `orders.ts`                         | Quote, tạo đơn, presence GPS, availability, offer, chuyển trạng thái, hủy, dispatch worker                        |
| `realtime.ts`                       | Socket.IO: xác thực JWT, kiểm tra Origin, room, subscribe kèm snapshot, publisher outbox                          |

### Bất biến được DB/transaction bảo đảm

- Tiền là `bigint` VND nguyên: `base + ceil(m × perKm / 1000)`, làm tròn lên 1.000 ₫.
  Quote lưu snapshot bảng giá, hết hạn sau 10 phút. Không có OSRM thì không báo giá; không dùng
  khoảng cách đường chim bay.
- Tạo đơn idempotent theo `quoteId` (`orders.quote_id UNIQUE`); tối đa 3 đơn mở/khách.
- Mỗi đơn tối đa 1 offer `pending`, mỗi tài xế tối đa 1 offer `pending` và 1 đơn đang chạy
  (unique partial index). Một tài xế không được offer lại cùng một đơn.
- Mọi đường ghi đều khóa `orders` trước `order_offers` để tránh deadlock. Nhận đơn kiểm tra offer
  còn hạn và đơn còn `SEARCHING` trong cùng transaction: hai lần nhận đồng thời chỉ một bên thành công.
- Chuyển trạng thái yêu cầu `expectedVersion`; mỗi lần đổi tăng `version`, ghi `order_events` và
  `outbox_events` trong cùng transaction.
- Matching chỉ dùng tài xế `approved`, user `active`, `is_available`, GPS < 30 giây, cùng loại
  xe, trong `DISPATCH_RADIUS_M` (`ST_DWithin` trên geography, sắp xếp theo `ST_Distance`).
- Mất GPS **không** hủy và không giải phóng đơn đã nhận. Tài xế rảnh có GPS > 30 giây tự rơi khỏi
  matching; tắt sẵn sàng sẽ rút offer đang chờ.

### GPS và quyền riêng tư

- Fix được nhận khi: tọa độ hợp lệ, sai số ≤ 200 m, không cũ quá 30 giây, không ở tương lai quá
  5 giây, và mới hơn fix đã lưu (so theo thời gian thiết bị vì sequence reset khi reload trang).
- Chỉ lưu **vị trí cuối** trong `driver_locations`. **Chưa lưu lịch sử GPS** vì PO chưa chốt
  retention. Vị trí trực tiếp gửi vào room của đơn, không đi qua outbox, không ghi log.
- Khách chỉ thấy vị trí tài xế của đơn của mình khi đơn đang chạy. Offer chỉ hiện địa chỉ, không
  hiện số điện thoại người liên hệ cho đến khi tài xế nhận đơn.

### Realtime

- Socket.IO path `/socket.io`; handshake `auth.token` là access token trong memory. Socket tự
  ngắt khi token hết hạn, client refresh rồi kết nối lại. Mọi hành động trên socket kiểm tra lại
  session trong DB.
- Origin phải nằm trong `CORS_ORIGINS` (nếu có header). Room `user:{id}`, `order:{id}`, `staff`
  do server cấp sau khi kiểm tra quyền.
- `order:subscribe` join room **rồi** trả snapshot. Sự kiện `order.updated`/`offer.updated` chỉ là
  gợi ý: client đọc lại snapshot và bỏ snapshot cũ hơn theo `version`. Outbox giao ít nhất một lần.
- Giới hạn hiện tại: chạy **một instance** API. Nhiều instance cần Redis adapter + sticky session
  (WEB-010).

## API

| Endpoint                                                     | Vai trò                        | Ghi chú                                                      |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------ |
| `POST /orders/quote`                                         | customer                       | 422 ngoài vùng Hà Nội; 503 khi tắt, thiếu bảng giá hoặc OSRM |
| `POST /orders` `{quoteId}`                                   | customer                       | 201; gọi lại cùng quote trả cùng đơn; 409 quote hết hạn      |
| `GET /orders`, `GET /orders/:id`                             | customer/driver được gán/staff | 404 nếu không có quyền                                       |
| `POST /orders/:id/cancel` `{expectedVersion}`                | customer                       | Chỉ khi `SEARCHING`                                          |
| `POST /drivers/me/location`                                  | driver                         | Cũng có qua socket `driver:location`                         |
| `GET /drivers/me/presence`, `PATCH /drivers/me/availability` | driver                         | Bật cần GPS < 30 giây                                        |
| `GET /drivers/me/offers/current`, `POST …/offers/:id/accept  | decline`                       | driver                                                       |     |
| `GET /drivers/me/orders/current`, `POST …/orders/:id/status` | driver                         | Mỗi lần một bước                                             |
| `GET /admin/orders?status=`, `POST /admin/orders/:id/cancel` | admin/dispatcher               | Hủy cần lý do, có audit                                      |

## Frontend

- **Customer:** báo giá/đặt đơn ngay trên màn chọn địa chỉ, danh sách đơn, chi tiết đơn với tiến
  trình, tài xế, tuổi vị trí, trạng thái kết nối, và nút hủy khi đang tìm.
- **Driver:** bật/tắt sẵn sàng (gửi fix trước rồi mới bật), gửi GPS khi trang mở (tối đa 1 fix/5
  giây, lấy fix thật mỗi 10 giây khi đứng yên), đề nghị có đếm ngược, đơn hiện tại có số liên hệ
  `tel:` và nút bước tiếp theo.
- **Admin:** tab Đơn hàng có lọc trạng thái, tự làm mới 5 giây, hủy kèm lý do. Menu Admin trên
  mobile giờ hiển thị thay vì bị ẩn.

## Bật ở local

```dotenv
ORDERS_ENABLED=true
OSRM_BASE_URL=http://127.0.0.1:5000
TARIFF_MOTORCYCLE_BASE_VND=15000
TARIFF_MOTORCYCLE_PER_KM_VND=5000
```

Kết hợp với cookie auth ([web auth server](web-auth-server.md)). Vite proxy cả `/api` và
`/socket.io` (`ws: true`).

## Kiểm thử

- Unit: `apps/api/test/orders-policy.test.ts`, `apps/customer-web/src/order-format.test.ts`,
  `apps/admin/src/components/orders-board.test.tsx`.
- Integration (`apps/api/test/orders.integration.test.ts`, Postgres/PostGIS/Redis thật, OSRM
  stub): giá VND, vùng, bảng giá thiếu, idempotent, quote hết hạn, quyền xem, kiểm tra fix GPS,
  availability cần GPS mới, offer người gần nhất, từ chối → người kế tiếp, nhận đồng thời, socket
  nhận sự kiện và vị trí, sai version/nhảy bước, staff hủy có audit, hết hạn tìm, xác thực socket,
  Origin lạ, subscribe trái quyền, cờ tắt. Đã thử cố ý làm hỏng state machine và kiểm tra Origin:
  test bắt được.
- Playwright (`tests/web-e2e/orders.spec.ts`, API mock): đặt đơn/hủy, lỗi bảng giá, tài xế gửi
  fix trước khi bật, nhận đơn, chuyển bước có version, Admin hủy, responsive 320/768/1440.
- Smoke thật local 2026-11-21 (API + DB + Redis + Socket.IO thật, OSRM stub, Chromium): tài xế
  bật sẵn sàng → khách đặt đơn → tài xế nhận đề nghị qua socket → đi hết 4 bước → trang khách tự
  cập nhật tới "Đã giao" không cần reload; `order_events` đủ 6 trạng thái.

## Chưa làm / cần PO

- Bảng giá chính thức, phụ phí, phí hủy, COD hàng hóa, ledger/hoa hồng, đối soát.
- Bằng chứng giao hàng (ảnh/OTP người nhận) và workflow giao thất bại/trả hàng sau `PICKED_UP`.
- Retention và lịch sử GPS; bản đồ trực tiếp cho khách (hiện chỉ hiện tuổi/sai số vị trí).
- Polygon vùng phục vụ (SG-015) thay cho khung chữ nhật Hà Nội.
- Evidence thiết bị thật WEB-002 trước khi bật cho tài xế thật. Ngưỡng 30/60 giây vẫn là giả thuyết.
- Nhiều instance API (Redis adapter), metric/alert cho dispatch và outbox, dọn outbox đã publish.
