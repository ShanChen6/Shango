# ADR-002 — Kiến trúc frontend web và phiên đăng nhập

- Ngày: 2026-10-28
- Trạng thái: **Proposed for review; không đổi runtime trong ADR này**
- Task: WEB-003
- Phụ thuộc: WEB-001 audit; WEB-002 harness (device evidence vẫn mở)

## Bối cảnh

ADR-001 đã chốt ba frontend React/Vite/TypeScript độc lập cho Customer, Driver và Admin.
Audit WEB-001 xác nhận Admin đã là Vite, còn Customer/Driver vẫn là Expo. API hiện trả
access token 15 phút và refresh token 30 ngày trong JSON; client gửi bearer token, mobile
lưu session bằng SecureStore, còn Admin chỉ giữ session trong memory.

Web không được mặc định chuyển refresh token sang `localStorage`/`sessionStorage`. Ba
frontend deploy độc lập cần dùng chung contract/client/UI nhưng vẫn có navigation, role
boundary và release riêng. API tiếp tục là nơi kiểm tra quyền; chia frontend không tạo ra
ranh giới bảo mật phía server.

## Quyết định

### 1. Ba ứng dụng độc lập, không tạo “super app” đa vai trò

| App | Workspace đích | Origin production tham chiếu | Route ownership ban đầu |
| --- | --- | --- | --- |
| Customer | `apps/customer` sau migration gate | `https://customer.<domain>` | `/login`, `/profile`, `/addresses`, `/orders/*` |
| Driver | `apps/driver` sau WEB-002 gate | `https://driver.<domain>` | `/login`, `/onboarding`, `/availability`, `/offers`, `/orders/*` |
| Admin | `apps/admin` hiện hữu | `https://admin.<domain>` | `/login`, `/drivers/*`, `/dispatch/*`, `/audit`, `/maps` |
| API/Socket | `apps/api` | `https://api.<domain>` | `/api/v1/*`, Socket.IO path do API sở hữu |

`<domain>` là placeholder cấu hình, không phải DNS đã provision. Production chỉ dùng
origin HTTPS explicit; không allowlist wildcard subdomain. Mỗi app có build/deploy và
runtime config riêng. Deep link phải hoạt động khi refresh; CDN/ingress fallback về
`index.html` chỉ áp dụng route frontend, không che lỗi `/api` hoặc asset.

### 2. Package boundaries

| Package | Sở hữu | Không được chứa |
| --- | --- | --- |
| `packages/contracts` | DTO/type dùng chung, error codes, runtime schemas tại trust boundary khi bổ sung | React, browser storage, app navigation |
| `packages/api-client` | HTTP transport, access token memory, refresh single-flight, CSRF bootstrap, typed methods | React hooks, router, `localStorage`, Expo APIs |
| `packages/ui` mới | Web design tokens và accessible primitives không chứa domain | API calls, role policy, React Native/Expo |
| App workspace | Router, page composition, query keys, role-specific state/UX | Import chéo source của app khác |
| `packages/mobile-ui` | Legacy evidence cho parity | Import từ frontend web mới |

React Router và TanStack Query được dùng ở app layer. Query cache không phải nguồn sự
thật và phải clear khi logout/role mismatch. Shared UI bắt đầu từ tokens/primitives; không
đưa toàn bộ page hoặc business flow vào package chung chỉ vì có giao diện tương tự.

Dependency direction:

```text
apps/customer ─┐
apps/driver ───┼─> packages/ui
apps/admin ────┘      │
       └────────────> packages/api-client ─> packages/contracts

apps/api ──────────────────────────────────> packages/contracts
```

Không package nào được import ngược từ app. `packages/ui` có thể dùng type presentation
thuần nhưng không phụ thuộc `api-client`.

### 3. Web auth: access token trong memory, refresh token trong cookie HttpOnly

Giữ JWT access token ngắn hạn và DB-backed session hiện hữu, nhưng bổ sung web transport:

- Access token tiếp tục hết hạn sau 15 phút, trả trong JSON và **chỉ giữ trong memory**.
- Refresh token opaque 30 ngày được rotate như hiện tại nhưng web nhận qua cookie
  `__Host-shango-refresh`; cookie `Secure; HttpOnly; SameSite=Lax; Path=/`, không có
  `Domain`. Expiry cookie không vượt `auth_sessions.expires_at`.
- API không trả refresh token trong JSON cho web transport. Không ghi access/refresh,
  OTP hoặc CSRF token vào URL, analytics hay log.
- Request API bình thường gửi `Authorization: Bearer <access>`; cookie refresh chỉ được
  API sử dụng tại auth endpoints. Socket handshake dùng access token trong `auth`, sau đó
  gateway vẫn xác minh session/role/driver state server-side.
- Sau reload, app lấy CSRF token rồi gọi refresh để nhận access token/user mới. App không
  coi dữ liệu user cache trước đó là authenticated state.
- Logout thu hồi `auth_sessions` và clear cookie kể cả khi response lỗi sau khi server đã
  xử lý. Role mismatch clear memory/cache và đưa người dùng về đúng app; frontend không
  tự nâng/chuyển role.

Cookie là host-only trên API origin. Ba frontend dùng cùng một browser session/role; đây
là chủ ý vì một số điện thoại hiện có một role. Đăng xuất ở một frontend làm phiên đó hết
hiệu lực ở các frontend khác. Nếu sản phẩm sau này cần nhiều role đồng thời, phải có ADR
mới thay vì thêm cookie name động theo client input.

### 4. CSRF và CORS

`SameSite` chỉ là defense-in-depth, không thay thế CSRF control. Web transport dùng cả:

1. Allowlist **exact origin** cho Customer/Driver/Admin; không regex kiểu
   `*.example.com`, không `*`, không allow `Origin: null`.
2. `Access-Control-Allow-Credentials: true`; preflight chỉ cho methods/headers cần thiết.
   Client web dùng `credentials: 'include'`. Response có `Vary: Origin`.
3. Endpoint `GET /auth/web/csrf` xác thực refresh cookie và trả token HMAC gắn với session id
   (dùng secret riêng, không dùng JWT/OTP secret). Token không nằm trong cookie/URL;
   response đặt `Cache-Control: no-store`.
4. `POST /auth/web/refresh`, `POST /auth/web/logout` và mọi endpoint dựa vào cookie yêu cầu
   `X-CSRF-Token`, kiểm tra constant-time và kiểm tra `Origin` exact allowlist. Header tùy
   chỉnh buộc browser preflight với cross-origin request.
5. Không có state-changing GET. Nếu `Origin` thiếu/null ở protected browser flow thì từ
   chối; không fallback sang chấp nhận im lặng. Proxy headers chỉ tin sau khi ingress và
   `trust proxy` được cấu hình/kiểm thử rõ ràng.

Web OTP request/verify nằm dưới `/auth/web/*`, chưa có authenticated cookie nhưng vẫn bị
rate limit hiện hữu và phải kiểm tra exact Origin. Client chỉ gửi `app`, không gửi role:
server derive Customer → `customer`, Driver → `driver`; Admin chỉ cho account
`admin|dispatcher|accountant` đã tồn tại và **không bao giờ đăng ký account mới**. Response
request/verify không được làm lộ số có tồn tại/đủ quyền ngoài hành vi development đã bị
chặn production. Verify phải kiểm tra mapping **bên trong transaction và trước khi insert
`auth_sessions`/set cookie**; mismatch rollback toàn bộ user/session mutation. Chỉ sau đó
mới tạo session, set refresh cookie và trả access token, user, CSRF token. CSRF không chống
XSS; frontend vẫn cần CSP, output encoding, dependency review và không render HTML không
tin cậy.

### 5. API contract đích

```text
POST /auth/web/otp/request  { phone, app }       -> challenge
POST /auth/web/otp/verify   { phone, code, app } -> { accessToken, user, csrfToken }
                                                  + Set-Cookie refresh
GET  /auth/web/csrf         refresh cookie       -> { csrfToken }
POST /auth/web/refresh      cookie + CSRF header -> { accessToken, user, csrfToken? }
POST /auth/web/logout       cookie + CSRF header -> 204 + clear cookie
GET  /auth/me               bearer              -> user
```

Trường `app` là enum server-validated (`customer|driver|admin`) dùng cho audit và derive
role policy trên; nó không tự quyết định/cấp quyền. Admin vẫn đăng nhập bằng account role
đã cấp; public OTP không được tạo admin. Web logout không yêu cầu bearer: nó xác định
session bằng refresh cookie. Nếu session còn hiệu lực, server phải kiểm tra Origin + CSRF
**trước** revoke/clear; CSRF sai bị từ chối và không clear cookie. Chỉ sau validation thành
công mới revoke và trả clear-cookie cùng attributes. Cookie absent/hết hạn/không map tới
session sống có thể được clear idempotently vì không còn server state để thay đổi.

Legacy Expo giữ nguyên `/auth/otp/*`, `/auth/refresh` body-token và bearer logout trong
giai đoạn migration. Legacy handler **không bao giờ đọc cookie**; web handler không nhận
`refreshToken` trong body. Request chứa đồng thời/mix hai loại credential bị từ chối, và
server không chọn transport dựa trên trường `app` do client gửi.

### 6. Client lifecycle

```text
page load
  -> GET /auth/web/csrf (credentials include)
  -> POST /auth/web/refresh + X-CSRF-Token
  -> store access token/user/CSRF in memory
  -> verify expected role
  -> render protected routes

API 401
  -> one refresh in flight for the whole client instance
  -> retry each request at most once
  -> on refresh 401/403: clear memory + query cache -> /login
```

Không retry tự động mutation không-idempotent sau lỗi không xác định. Refresh chỉ xử lý
401 auth; 403 role/CSRF không được biến thành refresh loop. Tab khác không chia sẻ token
qua persistent browser storage trong MVP; mỗi tab bootstrap session qua cookie và có
access token memory riêng. Có thể dùng `BroadcastChannel` chỉ để phát tín hiệu logout,
không truyền token.

### 7. Local development và deploy

- Vite dev server proxy `/api` và `/socket.io` về API để giảm sai khác cookie/CORS khi
  phát triển. Integration/E2E vẫn phải có suite chạy với origin tách biệt và credentials.
- Production đặt frontend/API trên các host HTTPS cùng registrable domain do dự án kiểm
  soát, không chạy auth trực tiếp qua vendor preview domains. Không phụ thuộc third-party
  cookie; các host tham chiếu cùng site, nhưng CSRF vẫn kiểm tra theo origin.
- Config tách `CORS_ORIGINS` thành danh sách parse/validate; startup fail khi wildcard,
  credentialed origin không phải HTTPS (trừ localhost test) hoặc duplicate/invalid origin.
- Cookie secure là bắt buộc ngoài localhost. Không thêm bypass “tạm thời” cho staging HTTP.

## Migration không làm gián đoạn Expo

1. **API dual transport:** feature flag/config cho `/auth/web/*`; giữ legacy bearer +
   refresh body trên endpoint cũ cho Expo. Contract test bảo đảm hai route không đọc/trộn
   credential của nhau và mixed credential bị từ chối.
2. **Admin canary:** chuyển Admin sang web adapter, cookie/CSRF và router trước; giữ rollback
   về client cũ trong staging.
3. **Customer/Driver web:** dùng cùng adapter sau WEB-005. Driver production tracking chỉ
   bật khi WEB-002 device gate được duyệt.
4. **Parity/staging:** test revoke/rotation, concurrent refresh, CSRF/CORS, wrong app/role,
   private documents và Socket reconnect trên origin thật.
5. **Legacy removal:** chỉ WEB-011 được bỏ refresh token JSON, Expo code/mobile CI và
   `packages/mobile-ui` sau evidence parity và reviewer độc lập.

Không thay trực tiếp nội dung Expo bằng Vite trước khi có staging path/rollback. Có thể tạo
web workspace tạm rõ tên trong implementation PR hoặc dùng worktree/branch dài hạn; việc
đổi đường dẫn cuối cùng phải là PR migration riêng, giữ lịch sử Git và checklist parity.

### Rollback vận hành

- API flag `WEB_AUTH_ENABLED` bật/tắt toàn bộ `/auth/web/*` mà không ảnh hưởng legacy
  endpoints. Frontend Admin có release flag độc lập để chọn web adapter hoặc client bearer
  hiện tại; Customer/Driver web chưa được rollout khi flag API tắt.
- Migration DB/config cho web auth chỉ được additive và backward-compatible; rollback
  không drop column/table/index. Legacy mobile session tiếp tục hợp lệ.
- Khi tắt web auth, endpoint web trả trạng thái unavailable thống nhất và clear
  `__Host-shango-refresh`; access token memory tự mất khi reload. Session DB có thể revoke
  theo batch có audit nếu incident yêu cầu, không xóa hàng không kiểm soát.
- Trigger rollback: tăng đột biến login/refresh failure, CSRF/CORS false-positive trên
  browser support matrix, cookie rotation/revoke sai, hoặc private data/role isolation
  regression. Dashboard tách metric theo `transport=web|legacy`, app và error code.
- Sau rollback, điều tra trên staging, sửa bằng PR mới và chạy lại contract/security/E2E;
  không nới CORS, bỏ CSRF hoặc đưa refresh token vào web storage để “khôi phục nhanh”.

## Security acceptance tests bắt buộc

- Cookie có đúng `Secure`, `HttpOnly`, `SameSite`, `Path`, không `Domain`; clear dùng cùng
  attributes; refresh token không xuất hiện trong JSON/web storage/log.
- Exact CORS origin cho ba app, credentials + preflight; evil sibling subdomain, wildcard,
  `Origin: null` và origin gần giống bị từ chối.
- Thiếu/sai CSRF, token của session khác, logout/refresh cross-origin bị từ chối; session
  sống không bị revoke hoặc clear-cookie khi CSRF/Origin validation thất bại.
- Legacy route không đọc cookie; web route không đọc body refresh token; mixed credential
  bị từ chối. Wrong-app role bị chặn trước insert session/set-cookie.
- Customer/Driver registration role được derive từ `app`; Admin app không tạo account mới
  và response không enumeration account/role trong production.
- Refresh rotation atomic; request đồng thời chỉ một refresh trong client; revoked/expired/
  replayed token không tạo access token mới.
- Server role guard kiểm tra mọi protected endpoint; wrong-role frontend không đọc được
  dữ liệu dù sửa JS/router.
- Socket handshake access token hết hạn/revoked/wrong role bị từ chối; reconnect lấy
  snapshot trước khi gửi/nhận domain events.
- XSS smoke/CSP, private document cache headers, logout cache clear và browser back button.

## Hệ quả

Ưu điểm: refresh credential không đọc được bằng JavaScript, giữ được session rotation DB,
ba app tái sử dụng transport mà không trộn UI/domain, và migration Expo diễn ra song song.

Chi phí: thêm CSRF/origin logic, cookie-aware integration/E2E, local proxy và dual transport
tạm thời. Một XSS vẫn có thể hành động trong phiên hiện tại, nên cookie không thay thế CSP
và secure rendering. Host sibling bị compromise vẫn là rủi ro same-site; exact CORS + CSRF
session-bound giảm rủi ro nhưng DNS/deployment hygiene vẫn bắt buộc.

## Nguồn bảo mật

- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)

## Quyết định chưa đóng bởi ADR này

- Domain/DNS/vendor deploy thực tế và CSP allowlist cuối cùng.
- Map renderer/provider, notification/PWA.
- WEB-002 browser/device thresholds và SOP escalation cuối cùng.
- Nhiều role trong một account hoặc nhiều session app đồng thời.

