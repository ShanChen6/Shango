# ShanGo

Hệ thống giao nhận kết nối Khách hàng, Tài xế và Quản trị viên.

**Nhánh phát triển: `develop`. `main` chỉ nhận code sau Pull Request đã review.**

## Phạm vi bản nền tảng

- NestJS API: OTP development, rate limit, access/refresh, logout và RBAC.
- PostgreSQL/PostGIS migrations; Redis; liveness/readiness và request ID.
- Hai app Expo/React Native: đăng nhập, secure storage, hồ sơ phương tiện tài xế.
- React Admin: đăng nhập, lọc/phân trang hồ sơ, duyệt/từ chối có audit và chống review stale.
- CI cho typecheck, test, DB migration, integration, build API/Admin và mobile JS bundles.

Chưa có đặt đơn, Socket tracking, ví, upload giấy tờ hoặc SMS thật. Đây là môi trường phát triển; API chủ động từ chối khởi động ở production với OTP development.

## Cấu trúc

```text
apps/api          NestJS + pg + Redis
apps/admin        React + Vite
apps/customer     React Native / Expo
apps/driver       React Native / Expo
packages/contracts    Kiểu dữ liệu dùng chung
packages/api-client   HTTP client + refresh single-flight
packages/mobile-ui    UI dùng chung + SecureStore
docs/             Kiến trúc, backlog, review, kiểm thử
```

## Chạy local

Yêu cầu Node 24, npm 11 và Docker Desktop đang chạy. macOS + Xcode cần thiết để build iOS native; Windows có thể chuẩn bị JS bundle và chạy Android khi đã có Android SDK.

1. Checkout `develop`, chạy `npm ci` tại thư mục gốc.
2. Copy `.env.example` thành `.env` tại gốc và đặt `POSTGRES_PASSWORD` riêng.
3. Copy `apps/api/.env.example` thành `apps/api/.env`. Cập nhật DATABASE_URL theo password ở bước 2, đặt JWT_SECRET và OTP_SECRET khác nhau, mỗi giá trị ít nhất 32 ký tự ngẫu nhiên.
4. Chạy `docker compose up -d --wait` tại gốc.
5. Chạy `npm run db:migrate`, sau đó `npm run dev:api`.
6. Terminal khác: `npm run dev:admin` → http://localhost:5173.
7. Copy `.env.example` của hai app thành `.env`; chạy `npm run dev:customer` hoặc `npm run dev:driver`.

API: http://localhost:3000/api/v1. Liveness `/health/live`; readiness `/health/ready` kiểm tra PostGIS, migration và Redis.

Android emulator dùng `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1`; thiết bị thật dùng IP LAN của máy phát triển. Cấu hình firewall/phạm vi LAN có kiểm soát. URL HTTP chỉ phục vụ dev; build công khai phải dùng HTTPS và cấu hình network phù hợp.

### Đăng nhập Admin local

Nhập số E.164 trong Admin và xác thực bằng `devCode` chỉ hiện ở môi trường phát triển. Lần đầu tài khoản chưa có quyền và UI sẽ từ chối truy cập. Tại máy có quyền DB:

```sh
npm run admin:grant -w @shango/api -- +84901234567
```

Đăng nhập lại sau khi cấp quyền. Lệnh chỉ nâng một tài khoản customer active đã tồn tại và tạo audit. Không có tài khoản Admin mặc định. Không dùng bản OTP development ở môi trường truy cập công khai.

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

JS bundling (không phải native build/store release):

```sh
npx expo export --platform android --output-dir dist-ci
```

Chạy từ từng thư mục app. Phải kiểm chứng thêm Android/iOS native trên thiết bị trước nghiệm thu.

## Tài liệu

- [Kiến trúc và quyết định còn mở](docs/architecture.md)
- [Backlog và phạm vi đã thực hiện](docs/backlog.md)
- [Nhánh và review](docs/branch-policy.md)
- [Kế hoạch kiểm thử](docs/test-plan.md)
- [Button, Input, Card và theme Khách/Xế/Admin](docs/components.md) — xem mẫu tại `/components` trong Web Admin
- [API contract](docs/openapi.yaml)

Không coi file quy trình là bằng chứng đã bật branch protection trên GitHub. Chủ repo cần xác minh ruleset và reviewer độc lập trước khi merge vào main.
