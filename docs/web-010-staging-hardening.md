# WEB-010 — Staging & hardening

- Ngày: 2026-11-21
- Quyết định (21/11/2026): **chỉ hardening trong repo**; staging chạy **Docker Compose trên một
  VPS**; **chưa làm SMS thật** và chưa đổi storage giấy tờ.
- Trạng thái: cấu hình, image, script và test **đã có và đã chạy thử local**. **Chưa provision
  VPS/DNS, chưa deploy.** Pilot vẫn cần các mục chặn ở [release checklist](release-checklist.md).

## Kiến trúc staging

```text
Internet ──443──> Caddy (image shango/web) ── /api, /socket.io ──> api:3000 (không publish)
                   │  customer.<domain>  /srv/customer          │
                   │  driver.<domain>    /srv/driver            ├─> postgres (PostGIS 16)
                   │  admin.<domain>     /srv/admin             └─> redis 7 (AOF)
                   └─ TLS tự động (ACME), header bảo mật, CSP, chặn IP ngoài danh sách
migrate (one-shot, cùng image API) chạy trước api; rollback = đổi IMAGE_TAG
```

- Mỗi frontend gọi API **cùng origin** qua `/api` (Caddy proxy). Cookie refresh vì vậy là
  host-only trên từng host frontend; trình duyệt không cần CORS. Đây là cách triển khai cụ thể
  của ADR-002 §7 cho staging. ADR vẫn ghi "API origin riêng", nên cần reviewer xác nhận khi duyệt
  ADR.
- `NODE_ENV=development` là bắt buộc vì API từ chối `production` khi chưa có SMS thật. Bù lại,
  staging **không public**: Caddy chặn IP ngoài `STAGING_ALLOWED_CIDRS`, và API chỉ gửi OTP
  development cho số trong `OTP_DEV_PHONE_ALLOWLIST`.

## Thay đổi trong code

| Hạng mục       | Nội dung                                                                                                                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust proxy    | `TRUST_PROXY_HOPS` (mặc định 0). Staging = 1 (Caddy). Rate limit theo IP dùng IP thật, không tin `X-Forwarded-For` giả                                                                                                                                                                                                      |
| Metrics        | `GET /api/v1/health/metrics` dạng Prometheus, cần `Authorization: Bearer $METRICS_TOKEN`; tắt nếu không đặt token; Caddy trả 404 ở edge. Có HTTP theo method/status, histogram latency, dispatch, outbox (pending, tuổi cũ nhất), đơn đang tìm/đang chạy, tài xế sẵn sàng, số socket. Không có id, số điện thoại hay tọa độ |
| Outbox         | Xóa bản ghi đã publish quá `OUTBOX_RETENTION_HOURS` (mặc định 72 giờ), mỗi giờ một lần, tối đa 5.000 dòng/lần                                                                                                                                                                                                               |
| Nhiều instance | `SOCKET_REDIS_ADAPTER=true` bật `@socket.io/redis-adapter`. Dispatch/outbox vốn đã an toàn nhiều instance nhờ `FOR UPDATE SKIP LOCKED`                                                                                                                                                                                      |
| OTP staging    | `OTP_DEV_PHONE_ALLOWLIST`: số ngoài danh sách nhận 403, không có `devCode`                                                                                                                                                                                                                                                  |
| Config         | Biến rỗng trong env file (`OSRM_BASE_URL=`) được coi là chưa đặt                                                                                                                                                                                                                                                            |
| Admin          | Thêm `@types/node` (trước chỉ chạy nhờ hoist từ workspace API); sửa độ tương phản chữ phụ theo WCAG AA                                                                                                                                                                                                                      |

## Image và deploy (`deploy/`)

| File                       | Vai trò                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.Dockerfile`           | Multi-stage `node:24-bookworm-slim`, chỉ deps production, user `node`, healthcheck, giấy tờ ở volume `/data/private-documents` (0700)                                                                  |
| `web.Dockerfile`           | Build 3 app (Admin bật cookie auth, `VITE_API_URL=/api/v1`) rồi đóng gói vào `caddy:2.10-alpine`                                                                                                       |
| `Caddyfile`                | HTTPS, HSTS, CSP chặt (`script-src 'self'`, không inline), `Permissions-Policy` (chỉ Driver được geolocation), chặn IP, ẩn metrics, cache `immutable` cho `/assets`, `no-cache` cho HTML, fallback SPA |
| `compose.staging.yaml`     | postgres, redis, migrate, api, web; secrets lấy từ `deploy/staging.env` (gitignored)                                                                                                                   |
| `staging.env.example`      | Mẫu biến; secret tạo bằng `openssl rand -base64 48`                                                                                                                                                    |
| `backup.sh` / `restore.sh` | `pg_dump -Fc` + tar giấy tờ + SHA256SUMS (umask 077); restore kiểm tra checksum, hỏi xác nhận, dừng api/web                                                                                            |

Build sau proxy kiểm tra TLS: `--secret id=npm_ca,src=<ca.crt>`. CA chỉ dùng khi build, không nằm
trong layer nào.

## Kiểm chứng đã chạy (2026-11-21, trong container phát triển)

- **API:** unit 55/55; integration 50/50 với Postgres/PostGIS + Redis thật. Có 5 test hardening:
  - metrics cần token và không chứa số điện thoại;
  - `X-Forwarded-For` chỉ được tin khi đã cấu hình hop;
  - allowlist OTP;
  - dọn outbox chỉ xóa bản đã publish và đủ cũ;
  - **2 instance API dùng chung Redis**: emit ở instance A tới được socket ở instance B.
- **Playwright (API mock):** 84/84, gồm 18 kiểm tra axe WCAG 2.1 AA trên 9 màn hình × 2 viewport.
  axe đã tìm ra lỗi tương phản thật ở Admin, đã sửa.
- **Contract E2E với API thật** (`npm run test:web:e2e:real`):
  - tài xế đăng nhập bằng cookie, gửi hồ sơ, bật sẵn sàng;
  - khách đặt đơn; tài xế nhận đơn qua socket và đi hết 4 bước;
  - trang khách tự cập nhật tới "Đã giao";
  - dispatcher thấy đơn đã giao và không thấy Nhật ký.
- **Staging stack bằng Docker** (Caddy `local_certs`, `*.localhost:8443`):
  - migrate áp dụng 001–005, API healthy, `/health/ready` 200 qua edge;
  - header CSP/HSTS/Permissions-Policy đúng;
  - metrics qua edge trả 404, deep link SPA trả 200;
  - IP ngoài danh sách nhận 403 cho cả API lẫn trang tĩnh;
  - Chromium qua HTTPS: số ngoài allowlist bị từ chối; cookie `__Host-` Secure/HttpOnly/Lax đúng
    host; Socket.IO kết nối qua Caddy; Admin đăng nhập/đăng xuất; **0 vi phạm CSP**.
- **Backup → xóa dữ liệu → restore:** user và file giấy tờ quay lại, readiness 200.
- Hai lỗi chỉ lộ ra khi chạy stack thật, đã sửa:
  - `respond` của Caddy bị `handle` vượt thứ tự (metrics và chặn IP không có tác dụng), nay dùng `route`;
  - `CORS_ORIGINS` thiếu cổng khi HTTPS không chạy trên 443, nay có `ORIGIN_PORT_SUFFIX`.

## CI mới

- `web-contract-e2e`: Postgres/Redis service, migrate, build, Playwright với API thật.
- `docker-images`: build 2 image, `caddy validate`, `docker compose config`.
- Chưa chạy trên GitHub tại thời điểm viết; xem kết quả Actions sau khi push.

## Chưa làm / chặn pilot

- Provision VPS, DNS, firewall và người vận hành; deploy staging thật (cần quyết định và quyền).
- SMS OTP thật; object storage/mã hóa/retention giấy tờ; backup ra ngoài máy (offsite) và lịch backup.
- Cross-browser (Firefox, WebKit/Safari iOS, Chrome Android): CI và container này mới có Chromium.
- Thu thập metrics/log tập trung và alert (chưa có Prometheus/Grafana); log JSON hiện chỉ có
  requestId/method/status/thời gian.
- Load test dispatch/socket; pentest; DPIA/quy trình dữ liệu cá nhân.
- Evidence thiết bị thật WEB-002 và PO duyệt bảng giá, phí, ledger, bằng chứng giao hàng.
