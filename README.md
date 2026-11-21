# ShanGo

> **Định hướng sản phẩm từ 28/10/2026:** ShanGo chuyển sang **web-only responsive** cho Khách hàng, Tài xế và Admin. Customer/Driver/Admin đều là React/Vite web; app Expo/React Native đã được gỡ ở WEB-011 (bản cuối lưu ở tag `expo-legacy-final`). Xem [quyết định chuyển nền tảng](docs/adr-web-only.md), [roadmap web](docs/roadmap-web.md) và [WEB-011](docs/web-011-expo-deprecation.md).

Hệ thống giao nhận kết nối Khách hàng, Tài xế và Quản trị viên.

**Nhánh phát triển: `develop`. `main` chỉ nhận code sau Pull Request đã review.**

## Phạm vi bản nền tảng

- NestJS API: OTP development, rate limit, access/refresh, logout và RBAC.
- PostgreSQL/PostGIS migrations; Redis; liveness/readiness và request ID.
- Web Customer/Driver (React + Vite): đăng nhập cookie, hồ sơ, giấy tờ, địa chỉ, đơn hàng.
- React Admin: đăng nhập, lọc/phân trang hồ sơ, duyệt/từ chối có audit và chống review stale.
- CI cho typecheck, test, DB migration, integration, build, Playwright E2E (mock và API thật) và Docker image.

Đặt đơn/điều phối/Socket.IO (WEB-009) có lát thử nghiệm sau cờ `ORDERS_ENABLED`, giá thử nghiệm chưa duyệt; xem [WEB-009](docs/web-009-orders-dispatch.md). Chưa có ví, ledger hoặc SMS thật. Giấy tờ tài xế được upload vào filesystem riêng tư cho môi trường phát triển, cần hoàn thiện vận hành lưu trữ trước production. API chủ động từ chối khởi động ở production với OTP development.

Đợt tiếp theo bổ sung Map Gateway cho **Hà Nội**: search/reverse qua Nominatim và routing qua OSRM, kèm tab **Bản đồ Hà Nội** trong Admin. Provider/tile cần được cấu hình; chưa xác minh native map hoặc tuyến xe máy. Xem [thiết lập bản đồ Hà Nội](docs/maps-hanoi.md).

## Cấu trúc

```text
apps/api          NestJS + pg + Redis
apps/admin        React + Vite
apps/customer-web React + Vite (Khách hàng)
apps/driver-web   React + Vite (Tài xế)
packages/contracts    Kiểu dữ liệu dùng chung
packages/api-client   HTTP client + refresh single-flight
packages/ui           Token + component web dùng chung
docs/             Kiến trúc, backlog, review, kiểm thử
```

## Chạy local

Yêu cầu Node 24, npm 11 và Docker Desktop đang chạy.

1. Checkout `develop`, chạy `npm ci` tại thư mục gốc.
2. Copy `.env.example` thành `.env` tại gốc và đặt `POSTGRES_PASSWORD` riêng.
3. Copy `apps/api/.env.example` thành `apps/api/.env`. Cập nhật DATABASE_URL theo password ở bước 2, đặt JWT_SECRET và OTP_SECRET khác nhau, mỗi giá trị ít nhất 32 ký tự ngẫu nhiên.
4. Chạy `docker compose up -d --wait` tại gốc.
5. Chạy `npm run db:migrate`, sau đó `npm run dev:api`.
6. Terminal khác: `npm run dev:admin` → http://localhost:5173.
7. Chạy `npm run dev:customer-web` (http://127.0.0.1:5174) hoặc `npm run dev:driver-web` (http://127.0.0.1:5175); cần bật cookie auth ở API, xem phần bên dưới.

API: http://localhost:3000/api/v1. Liveness `/health/live`; readiness `/health/ready` kiểm tra PostGIS, migration và Redis.

Thử trên điện thoại thật: mở web qua HTTPS (staging) vì Geolocation và cookie `Secure` cần secure context; URL HTTP chỉ dùng cho localhost.

### Đăng nhập Admin local

Nhập số E.164 trong Admin và xác thực bằng `devCode` chỉ hiện ở môi trường phát triển. Lần đầu tài khoản chưa có quyền và UI sẽ từ chối truy cập. Tại máy có quyền DB:

```sh
npm run admin:grant -w @shango/api -- +84901234567
```

Đăng nhập lại sau khi cấp quyền. Lệnh chỉ nâng một tài khoản customer active đã tồn tại và tạo audit. Không có tài khoản Admin mặc định. Không dùng bản OTP development ở môi trường truy cập công khai.

### Web Customer/Driver/Admin với cookie auth

Đặt `WEB_AUTH_ENABLED=true`, `CSRF_SECRET` (≥ 32 ký tự, khác JWT/OTP) và `CORS_ORIGINS` exact
origin trong `apps/api/.env`, chạy `npm run db:migrate` rồi `npm run dev:customer-web`,
`npm run dev:driver-web` hoặc Admin với `VITE_WEB_AUTH_ENABLED=true`. Xem
[web auth server](docs/web-auth-server.md).

### Staging (Docker Compose)

Xem [WEB-010](docs/web-010-staging-hardening.md) và [release checklist](docs/release-checklist.md). Không deploy production.

### Kiểm thử

```sh
npm run typecheck
npm test
npm run build
```

Integration cần database **riêng** đã migrate và Redis DB riêng. Đặt NODE_ENV=test, DATABASE_URL, REDIS_URL, JWT_SECRET, OTP_SECRET, OTP_PROVIDER=development và CORS_ORIGINS qua môi trường shell/CI; sau đó:

```sh
npm run db:migrate
npm run test:integration
```

Integration tự dọn các fixture do nó tạo; không chạy trên DB có dữ liệu thật. Xem `.github/workflows/ci.yml` để có cấu hình tái lập đầy đủ.

E2E: `npm run test:web:e2e` (API mock) và `npm run test:web:e2e:real` (API + DB thật, xem CI job `web-contract-e2e`).

## Tài liệu

- [Kiến trúc và quyết định còn mở](docs/architecture.md)
- [WEB-001: baseline audit, dependency matrix và task breakdown](docs/web-001-audit.md)
- [ADR-002: ba frontend web và auth cookie-CSRF](docs/adr-web-architecture-auth.md)
- [WEB-004: UX flows, responsive variants và design-system proposal](docs/web-004-ux-flows.md)
- [Backlog và phạm vi đã thực hiện](docs/backlog.md)
- [Nhánh và review](docs/branch-policy.md)
- [Kế hoạch kiểm thử](docs/test-plan.md)
- [Hồ sơ người dùng và nhật ký Admin](docs/profiles-and-audit.md)
- [Upload và duyệt giấy tờ tài xế](docs/driver-documents.md)
- [SG-014: Chọn địa chỉ trên App Khách](docs/customer-addresses.md) — tài liệu lịch sử của app Expo đã gỡ ở WEB-011
- [Button, Input, Card và theme Khách/Xế/Admin](docs/components.md) — xem mẫu tại `/components` trong Web Admin
- [API contract](docs/openapi.yaml)

Không coi file quy trình là bằng chứng đã bật branch protection trên GitHub. Chủ repo cần xác minh ruleset và reviewer độc lập trước khi merge vào main.
