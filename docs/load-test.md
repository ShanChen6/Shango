# Load test điều phối và realtime (WEB-010)

- Ngày chạy: 2026-11-21, trong container phát triển (1 instance API, PostgreSQL 16 + PostGIS,
  Redis 7, OSRM stub cố định 3,2 km). **Không phải số đo trên máy chủ staging.**
- Script: `tests/load/dispatch-load.mjs` (`npm run test:load -- --drivers N --orders M [--spacing ms]`).

## Cách script hoạt động

- Tạo N tài xế (đã duyệt) và M/3 khách **trực tiếp trong DB test** (số `+8491999…`), ký access
  token bằng `JWT_SECRET` của môi trường test, để không bị rate limit OTP. Script từ chối chạy khi
  `NODE_ENV` khác `test`, và tự xóa toàn bộ dữ liệu đã tạo khi kết thúc.
- Mỗi tài xế: kết nối Socket.IO, gửi GPS mỗi 5 giây trong bán kính khoảng 3 km quanh trung tâm Hà
  Nội, bật sẵn sàng; nhận `offer.updated` thì gọi accept rồi đi đủ 4 bước giao (cách nhau 200 ms).
- Khách: báo giá rồi tạo đơn, giãn cách `--spacing` ms (mặc định 100 ms; `0` là dồn tất cả cùng lúc).
- Đo: độ trễ REST, ack GPS, thời gian từ tạo đơn đến khi tài xế nhận sự kiện offer, đến `ASSIGNED`,
  đến `DELIVERED`. Kiểm tra bất biến: **không tài xế nào có hơn 1 đơn đang chạy**. Exit 1 nếu thiếu
  đơn giao xong hoặc vi phạm.

API chạy với `ORDERS_ENABLED=true`, `DISPATCH_TICK_MS=500`, offer 20 giây.

## Kết quả

| Kịch bản                                               | Giao xong | Vi phạm 1 đơn/tài xế | REST p50/p95 | Ack GPS p50/p95 | Tạo → ASSIGNED p50/p95 | Lỗi                |
| ------------------------------------------------------ | --------- | -------------------- | ------------ | --------------- | ---------------------- | ------------------ |
| 50 tài xế, 30 đơn, giãn 100 ms                         | 30/30     | 0                    | 12/26 ms     | 5/8 ms          | 790/989 ms             | 0                  |
| 300 tài xế, 150 đơn, giãn 100 ms                       | 150/150   | 0                    | 12/23 ms     | 4/10 ms         | 811/1013 ms            | 1 ack GPS timeout* |
| 300 tài xế, 200 đơn **cùng lúc**, trước khi sửa        | 200/200   | 0                    | 65/846 ms    | 4/60 ms         | 3756/6189 ms           | 0                  |
| 300 tài xế, 200 đơn cùng lúc, sau khi sửa (2 lần chạy) | 200/200   | 0                    | ~100/~940 ms | 4–5/160–236 ms  | ~2200/5100–5600 ms     | 0                  |

\* Một lần trong 1.287 ack, rơi vào lúc script ngắt kết nối khi dọn dẹp.

**Sửa sau lần chạy dồn dập:** bộ điều phối trước chỉ xét 20 đơn mỗi chu kỳ 500 ms. Nay nó xét theo
lô 50 đơn, lặp tới khi hết đơn chờ hoặc hết ngân sách 1 giây mỗi chu kỳ (đơn đã xét trong chu kỳ
được bỏ qua để vòng lặp luôn dừng). Kết quả: p50 ghép đơn giảm khoảng 40%.

## Đánh giá và giới hạn

- Với tải đều (vài đơn mỗi giây), ghép đơn khoảng 1 giây, chủ yếu do chu kỳ điều phối 500 ms; API
  và socket còn dư tải.
- Khi dồn 200 đơn trong 1 giây, nút thắt là **pool PostgreSQL 10 kết nối** và việc mời tài xế tuần
  tự mỗi đơn một transaction. Hướng xử lý nếu số liệu pilot cần: cấu hình kích thước pool, xử lý
  song song có giới hạn, hoặc tách worker điều phối. Chưa làm vì tải này vượt xa pilot Hà Nội.
- Chưa đo: nhiều instance API với Redis adapter dưới tải, mạng di động thật, máy chủ staging.
  Cần chạy lại script trên staging (DB test riêng) trước pilot và ghi kết quả vào đây.
