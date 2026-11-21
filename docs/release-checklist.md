# Release checklist & runbook — staging/pilot Hà Nội

Dùng cho mỗi lần đưa một `IMAGE_TAG` (git SHA trên `develop` đã có CI xanh) lên staging, và là
cổng PO sign-off trước pilot. Không deploy production; API hiện từ chối `NODE_ENV=production`.

## A. Trước khi deploy

- [ ] CI xanh cho SHA: `foundation-checks`, `web-foundation-checks`, `web-contract-e2e`, `docker-images`.
- [ ] Migration mới chỉ **thêm** (không drop/rename cột đang dùng); rollback image cũ vẫn chạy với schema mới.
- [ ] `deploy/staging.env` có đủ secret riêng cho staging; không dùng lại secret dev/CI.
- [ ] `STAGING_ALLOWED_CIDRS` chỉ gồm mạng văn phòng/VPN; `OTP_DEV_PHONE_ALLOWLIST` chỉ gồm số tester.
- [ ] `ORDERS_ENABLED` và bảng giá thử nghiệm đúng phạm vi thử; ghi rõ "giá chưa duyệt" với tester.
- [ ] Backup mới nhất < 24 giờ, đã kiểm checksum: `deploy/backup.sh`.

## B. Deploy

```bash
git checkout <sha>
docker build -f deploy/api.Dockerfile -t shango/api:<sha> .
docker build -f deploy/web.Dockerfile -t shango/web:<sha> .
deploy/backup.sh
IMAGE_TAG=<sha> docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d
```

`migrate` chạy trước `api`. Nếu migrate lỗi thì `api` không khởi động; xem log
`docker compose … logs migrate`.

## C. Smoke sau deploy (≤ 15 phút)

- [ ] `https://customer.<domain>/api/v1/health/ready` → 200 (từ mạng được phép); từ mạng khác → 403.
- [ ] `/api/v1/health/metrics` qua edge → 404; scrape nội bộ có token → 200.
- [ ] Customer/Driver/Admin đăng nhập OTP, reload vẫn giữ phiên, đăng xuất.
- [ ] Driver: kiểm tra vị trí; bật sẵn sàng (khi `ORDERS_ENABLED=true`).
- [ ] Một đơn trọn vòng giữa hai thiết bị: đặt → nhận → giao; khách thấy cập nhật trực tiếp.
- [ ] Admin: duyệt hồ sơ cần mở đủ ảnh; điều phối viên không thấy Nhật ký.
- [ ] DevTools console không có lỗi CSP.

## D. Rollback

Điều kiện kích hoạt: smoke C thất bại; tỉ lệ 5xx hoặc lỗi đăng nhập tăng đột biến; sai quyền
truy cập hoặc lộ dữ liệu; double assignment; outbox pending tăng liên tục.

1. `IMAGE_TAG=<sha-trước> docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d`
   (schema giữ nguyên vì migration chỉ thêm).
2. Chỉ tắt tính năng mà không đổi image: `ORDERS_ENABLED=false` hoặc `WEB_AUTH_ENABLED=false`
   (web auth tắt → endpoint trả 503 và xóa cookie), rồi `up -d api`.
3. Hỏng dữ liệu: dừng traffic, `deploy/restore.sh deploy/backups/<stamp>` (thao tác phá hủy, cần
   xác nhận), ghi lại khoảng dữ liệu bị mất.
4. Ghi sự cố (thời gian, SHA, triệu chứng, quyết định); sửa bằng PR mới. Không nới CORS/CSP, không
   tắt CSRF để "chữa nhanh".

## E. Theo dõi

| Metric                                                        | Cảnh báo gợi ý                                    |
| ------------------------------------------------------------- | ------------------------------------------------- |
| `shango_outbox_oldest_pending_seconds`                        | > 30 giây trong 5 phút                            |
| `shango_http_requests_total{status="5xx"}`                    | > 1% trong 10 phút                                |
| `shango_orders_searching` vs `shango_drivers_available_fresh` | Đơn tìm > 0 trong khi tài xế sẵn sàng = 0 kéo dài |
| `shango_http_request_duration_seconds` p95                    | > 1 giây                                          |

## F. PO sign-off trước pilot (chặn)

- [ ] Bảng giá chính thức, phí hủy, COD/ledger, bằng chứng giao hàng và workflow giao thất bại.
- [ ] SMS OTP thật, chính sách thời gian lưu GPS/ảnh, storage giấy tờ ngoài máy chủ + backup offsite.
- [ ] Evidence WEB-002 trên Safari iOS/Chrome Android; chấp nhận giới hạn GPS nền.
- [ ] Ma trận trình duyệt (Chrome, Edge, Firefox, Safari, Chrome Android, Safari iOS) đã QA.
- [ ] Accessibility: bàn phím, screen reader smoke, zoom 200% trên thiết bị thật.
- [ ] Pentest/security review, DPIA/điều khoản và quy trình xóa dữ liệu.
- [ ] Người trực vận hành, kênh liên lạc tài xế/khách khi sự cố, kịch bản rollback đã diễn tập.
