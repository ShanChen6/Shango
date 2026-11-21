# Web cookie auth phía server — `/auth/web/*`

- Ngày: 2026-11-21
- Thiết kế: [ADR-002](adr-web-architecture-auth.md) (vẫn ở trạng thái chờ review; tài liệu này
  mô tả implementation theo ADR, không tự đóng các quyết định còn mở)
- Trạng thái: **có code + integration test; mặc định TẮT** (`WEB_AUTH_ENABLED=false`)
- Legacy Expo (`/auth/otp/*`, `/auth/refresh`, `/auth/logout`) giữ nguyên hành vi

## Endpoint

| Endpoint                                           | Yêu cầu                                     | Kết quả                                             |
| -------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| `POST /auth/web/otp/request` `{ phone, app }`      | Origin exact allowlist                      | Challenge (devCode chỉ ở provider development)      |
| `POST /auth/web/otp/verify` `{ phone, code, app }` | Origin                                      | `{ accessToken, csrfToken, user }` + cookie refresh |
| `GET /auth/web/csrf`                               | Cookie; Origin nếu có phải hợp lệ           | `{ csrfToken }`, `Cache-Control: no-store`          |
| `POST /auth/web/refresh`                           | Cookie + Origin + `X-CSRF-Token`, body rỗng | Access token mới + cookie đã rotate                 |
| `POST /auth/web/logout`                            | Origin; CSRF nếu session còn sống           | 204 + clear cookie                                  |

`app` ∈ `customer | driver | admin`. Server derive role: Customer → `customer`, Driver →
`driver`. Admin chỉ chấp nhận account `admin | dispatcher | accountant` **đã tồn tại** và không
bao giờ tạo account. Mọi thất bại verify (OTP sai, sai app/role, account bị khóa) trả cùng một
thông báo 401 để không lộ số điện thoại/role. Kiểm tra app/role chạy trong transaction trước
khi insert `auth_sessions`, nên sai app thì không có session hay cookie nào được tạo.

## Cookie, CSRF, CORS

- Cookie `__Host-shango-refresh=<opaque>; Max-Age=<đến expires_at>; Path=/; Secure; HttpOnly;
SameSite=Lax`, không có `Domain`. Clear dùng đúng các attribute đó với `Max-Age=0`. Cookie
  trùng tên hoặc sai định dạng bị coi như không có.
- Refresh token không bao giờ nằm trong JSON. DB chỉ lưu SHA-256 của token.
- CSRF token = HMAC-SHA256(`CSRF_SECRET`, session id), so sánh constant-time. Secret riêng,
  config từ chối nếu trùng JWT/OTP secret.
- Refresh rotate trong transaction `SELECT … FOR UPDATE`: hai request đồng thời cùng cookie chỉ
  một bên thắng. Bên thua nhận 401 **không** kèm clear-cookie để không xóa cookie mới của bên
  thắng (tab đó sẽ về màn đăng nhập; reload sẽ khôi phục bằng cookie mới).
- Logout: nếu session còn sống, CSRF sai → 403, không revoke, không clear. Cookie không có hoặc
  đã chết → 204 + clear idempotent.
- CORS: `CORS_ORIGINS` phải là danh sách origin exact. Startup fail khi có `*`, `null`,
  path/query, trùng lặp hoặc HTTP ngoài `localhost/127.0.0.1/[::1]`.
  `credentials: true`, methods `GET/POST/PATCH`, headers `Authorization/Content-Type/X-CSRF-Token`.
- Request state-changing bắt buộc có header `Origin` thuộc allowlist. `GET /auth/web/csrf`
  chấp nhận không có Origin (GET same-origin), nhưng Origin lạ thì bị 403.

## Tách transport (dual transport)

- Migration `004_web_auth_sessions.sql` (additive): `auth_sessions.transport` (`legacy|web`,
  mặc định `legacy`) và `app`. Readiness yêu cầu migration 004.
- Legacy `/auth/refresh` chỉ rotate session `legacy`; web refresh chỉ rotate session `web`.
- Challenge OTP lưu marker `web:<app>` cho web, role thường cho legacy: challenge web không
  dùng được ở `/auth/otp/verify` và ngược lại.
- Mixed credential bị 400: web refresh/logout có header `Authorization` hoặc body; legacy
  refresh/logout có cookie web.
- Access token (JWT 15 phút) dùng chung `AccessGuard`, nên mọi endpoint nghiệp vụ hiện có hoạt
  động với cả hai transport; quyền vẫn kiểm tra server-side.

## Bật ở local

`apps/api/.env`:

```dotenv
WEB_AUTH_ENABLED=true
CSRF_SECRET=<ít nhất 32 ký tự ngẫu nhiên, khác JWT/OTP>
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175
```

Chạy `npm run db:migrate`, `npm run dev:api`, rồi `npm run dev:customer-web`,
`npm run dev:driver-web` hoặc Admin với `VITE_WEB_AUTH_ENABLED=true` (bỏ `VITE_API_URL` để
dùng proxy `/api`). Frontend phải gọi API **same-site** qua proxy Vite; gọi thẳng
`http://localhost:3000` từ `http://127.0.0.1:*` là cross-site nên cookie `SameSite=Lax` không
được gửi. Safari không lưu cookie `Secure` trên HTTP localhost; dùng Chrome/Firefox hoặc HTTPS
local khi cần thử Safari.

## Kiểm thử

- Unit `apps/api/test/web-auth.test.ts`: config/origin allowlist, cookie, CSRF, app/role.
- Integration `apps/api/test/web-auth.integration.test.ts` (Postgres/PostGIS + Redis thật):
  attribute cookie, không có refresh token trong JSON, rotate + race, CSRF thiếu/của session khác,
  logout không side effect khi CSRF sai, Origin exact (null, subdomain, gần giống, sai scheme),
  preflight CORS, mixed credential, cô lập challenge legacy/web, sai app không tạo session,
  Admin không đăng ký account và không enumeration, account bị khóa, flag tắt → 503 + clear.
- Smoke thủ công local 2026-11-21 (Chromium, Vite dev proxy, API + DB thật): Customer, Driver và
  Admin canary đăng nhập OTP → reload giữ phiên → đăng xuất. Cookie HttpOnly/Secure/Lax, không có
  gì trong `localStorage/sessionStorage`. Driver gửi được hồ sơ phương tiện qua phiên cookie.

## Chưa làm / rủi ro còn mở

- CI chưa có job E2E browser chạy với API + DB thật (hiện Playwright dùng API mock).
- Chưa phát hiện tái sử dụng refresh token đã rotate (replay detection → revoke cả session).
- Chưa có metric tách `transport=web|legacy` và chưa có `BroadcastChannel` báo logout giữa tab.
- `trust proxy` chưa cấu hình: rate limit theo IP chỉ đúng khi API nhận kết nối trực tiếp.
- Socket.IO handshake thuộc WEB-009. CSP/domain production thuộc WEB-010.
- SMS thật vẫn chưa có; API vẫn từ chối chạy `NODE_ENV=production`.
