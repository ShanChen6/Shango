# WEB-001 — Baseline audit và dependency matrix

- Ngày audit: 2026-10-28
- Baseline: `develop` tại `516e948` (merge PR #7 — quyết định web-only)
- Trạng thái: **Hoàn tất audit; chưa migration code**

Tài liệu này là đầu ra của WEB-001. Mục tiêu là phân biệt rõ code đang chạy với kiến
trúc đích, xác định phần được giữ lại và chia các bước migration có cổng nghiệm thu.
Không có kết luận nào dưới đây cho phép xóa Expo, `packages/mobile-ui` hoặc các bước CI
mobile trước WEB-011.

## Kết luận ngắn

- Repository hiện là npm workspaces với một NestJS API, một React/Vite Admin, hai app
  Expo/React Native và ba shared packages.
- `apps/customer` và `apps/driver` **chưa phải web app**. Cả hai chỉ bọc giao diện dùng
  chung từ `packages/mobile-ui`; Customer có thêm address planner/MapLibre native.
- `apps/admin` là nền React/Vite có thể giữ lại, nhưng chưa có router, query layer hay
  E2E browser; phiên đăng nhập vẫn giữ access/refresh token trong memory.
- `packages/contracts` không phụ thuộc runtime và là ứng viên giữ lại tốt.
  `packages/api-client` dùng Web APIs (`fetch`, `FormData`, `Blob`, `URLSearchParams`)
  nhưng contract phiên hiện thiết kế cho bearer + refresh token phía client; cần tách
  transport/session policy trong WEB-003 trước khi dùng cho cookie auth.
- `packages/mobile-ui` phụ thuộc trực tiếp React Native, Expo SecureStore, Document
  Picker và FileSystem nên không thể tái sử dụng làm UI web. Chỉ tham khảo hành vi và
  giữ nguyên đến parity gate.
- API chưa có orders, dispatch, Socket.IO gateway, driver availability hoặc tracking
  persistence. Redis hiện phục vụ OTP/rate limit; PostGIS có schema vị trí nền nhưng
  chưa có luồng cập nhật realtime.
- CI hiện kiểm tra API/Admin và export hai bundle Expo. Chưa có lint web, Customer/Driver
  web build, Playwright hoặc browser compatibility checks.

## Xác minh baseline

Tại baseline audit, `npm run typecheck`, 54 unit/component tests (`33` API, `21` Admin)
và `npm run build` cho API/Admin đều thành công. Integration phụ thuộc PostgreSQL/PostGIS
và Redis không được chạy lại trong WEB-001 vì task không đổi runtime/schema. Máy audit
dùng Node 25 nên npm phát cảnh báo engine từ một số dependency; CI và hướng dẫn repository
dùng Node 24, là môi trường chuẩn để xác nhận PR.

## Inventory và quyết định migration

| Thành phần hiện tại | Trạng thái đã xác minh | Quyết định | Task chịu trách nhiệm |
| --- | --- | --- | --- |
| `apps/api` | NestJS modular monolith; auth/RBAC, profile, driver documents, maps; PostgreSQL/PostGIS + Redis | **Giữ**, mở rộng theo contract web và realtime; không đổi nguồn sự thật nghiệp vụ | WEB-003, WEB-009 |
| `apps/admin` | React 19 + Vite 7 + Tailwind 4; review/audit/map playground; Vitest component tests | **Giữ và cải tiến** responsive, routing/auth/query/E2E | WEB-003, WEB-004, WEB-005, WEB-008 |
| `apps/customer` | Expo 55/React Native; login/profile/address planner; MapLibre native | **Thay bằng React/Vite** chỉ sau khi ghi nhận parity và có rollback; giữ code legacy đến WEB-011 | WEB-003–006, WEB-011 |
| `apps/driver` | Expo 55/React Native; login/profile/documents; chưa có map/tracking/availability | **Thay bằng React/Vite** sau feasibility và parity; không coi native hiện tại là bằng chứng tracking | WEB-002–005, WEB-007, WEB-011 |
| `packages/contracts` | TypeScript types thuần; auth/profile/documents/maps và một `TrackingUpdate` sơ bộ | **Giữ**, version/mở rộng contract; thêm validation runtime khi boundary yêu cầu | WEB-003, WEB-009 |
| `packages/api-client` | Shared fetch client, bearer refresh single-flight, multipart upload; không phụ thuộc Expo | **Giữ có refactor**; tách auth transport và tránh mặc định lưu refresh token trong browser | WEB-003, WEB-005 |
| `packages/mobile-ui` | React Native UI + SecureStore + native file APIs | **Legacy**; không import từ web; dùng làm checklist hành vi rồi xóa sau parity | WEB-004, WEB-006, WEB-007, WEB-011 |
| Web UI dùng chung | Chưa có; Admin có component/theme cục bộ | Tạo `packages/ui` cho web tokens/primitives có accessibility; không kéo native dependency | WEB-003–005 |
| Map stack | Backend adapter Nominatim/OSRM; Admin Leaflet; Customer MapLibre native | Giữ gateway; chọn renderer web/provider production sau spike, luôn có attribution/fallback | WEB-002–004 |
| Realtime/tracking | Chưa có Socket.IO gateway; chỉ có type và schema vị trí nền | Xây Active Tracking + Connection Recovery sau browser spike; snapshot authoritative, TTL/freshness | WEB-002, WEB-009 |
| CI | Typecheck workspaces, API/Admin tests/build, DB integration, hai Expo exports | Giữ baseline cho đến migration; bổ sung web checks, chỉ bỏ Expo ở WEB-011 | WEB-005, WEB-011 |

## Dependency matrix

| Capability | Customer web | Driver web | Admin web | Shared/API dependency | Khoảng trống cần xử lý |
| --- | --- | --- | --- | --- | --- |
| OTP/login/logout/refresh | Có hành vi legacy | Có hành vi legacy | Có UI hiện tại | API auth + API client | Chốt cookie/CSRF/CORS và role boundary; không dùng `localStorage` mặc định |
| Hồ sơ tên | Có legacy | Có legacy | Audit xem thay đổi | Profile API/contracts | Port UI web, conflict/version UX |
| Hồ sơ/giấy tờ tài xế | Không áp dụng | Có legacy | Có review/view/reopen | Documents API, multipart client | Web file picker/preview, privacy, production storage |
| Chọn địa chỉ/bản đồ | Có legacy native | Chưa có | Có map playground | Map gateway/contracts | Renderer web, responsive UX, provider/fallback/attribution |
| Quote/order lifecycle | Chưa có | Chưa có | Chưa có | Chưa có schema/API | PO policy + WEB-009 trước khi UI có thể hoàn tất |
| Availability/offers | Không áp dụng | Chưa có | Chưa có | Chưa có API/state | Server authorization, concurrency/idempotency |
| Live tracking | Chỉ có type sơ bộ | Chưa có | Chưa có | PostGIS schema nền; chưa Socket/TTL | WEB-002 evidence rồi WEB-009 implementation |
| Responsive/a11y | Native layout, không phải web | Native layout, không phải web | Một số component responsive | Chưa có shared web UI | Design tokens, router shells, viewport/a11y/E2E matrix |

## Feature parity gate

Parity là parity về hành vi được duyệt, không phải port từng component React Native.
Mỗi vai trò phải có evidence trên web trước khi legacy tương ứng được gỡ.

| Vai trò | Baseline cần bảo toàn | Điều kiện parity tối thiểu |
| --- | --- | --- |
| Customer | OTP, session restore/logout, profile versioning, tìm/reverse/chọn pickup/dropoff và draft validation | Luồng web chạy ở 320px–1440px, keyboard/zoom 200%, error/offline; contract test với API; address/map fallback rõ ràng |
| Driver | OTP, profile, upload đủ bốn loại giấy tờ, trạng thái review/rejection | Luồng web tương đương cộng availability/tracking đúng giới hạn WEB-002; permission denied/stale/reconnect được kiểm thử |
| Admin | Login role gate, driver list/review/document view, audit filters, map lab | Không regression test hiện có; responsive mobile/desktop, private document lifecycle và stale review conflict qua E2E |
| Shared | Refresh single-flight, contracts, API errors | Session policy web được threat-model/review; không lộ token/tài liệu; package web không phụ thuộc Expo/React Native |

Trước WEB-011 phải có checklist theo từng dòng trên, CI xanh, staging smoke test và một
PR riêng chỉ cho deprecation. Nếu chưa đạt, Expo và mobile CI tiếp tục tồn tại dù web đã
được phát triển song song.

## Phạm vi native bị roadmap web thay thế

Không đổi trạng thái lịch sử của mã SG. Chỉ các phần implementation/QA native sau đây
không còn là target tương lai và được thay bằng WEB tasks; phần API/nghiệp vụ dùng chung
trong cùng mã SG vẫn giữ nguyên:

| Mã lịch sử | Phần native không tiếp tục | Task thay thế |
| --- | --- | --- |
| SG-003 | Hai app Expo và shared React Native UI làm frontend mục tiêu | WEB-003–005; parity theo WEB-006/007 |
| SG-005 | Chọn/QA native renderer Android/iOS | WEB-002–004 chọn renderer/provider web và browser matrix |
| SG-006 | Native device matrix/release evidence | WEB-002 browser-device evidence và WEB-010 cross-browser pilot |
| SG-008 | Expo login/session UI và SecureStore làm implementation mục tiêu | WEB-003 auth ADR, WEB-005 web session foundation |
| SG-010 | Expo driver profile/document picker UI | WEB-007 Driver web parity; API/storage hardening vẫn còn |
| SG-014 | MapLibre React Native customer address UI | WEB-006 Customer web parity; map gateway/contracts được giữ |

“Bị thay thế” không có nghĩa xóa code ngay hoặc phủ nhận code đã từng tồn tại. WEB-011
vẫn là cổng duy nhất để deprecate/xóa artifact Expo sau khi web parity được kiểm chứng.

## Rủi ro và quyết định còn thiếu

1. **Auth web:** API hiện trả access/refresh token trong JSON. WEB-003 phải chốt cookie
   HttpOnly/Secure/SameSite, CSRF, CORS, refresh rotation và cách chạy ba origin độc lập.
2. **Driver feasibility:** browser/OS có thể ngừng geolocation khi tab nền hoặc khóa màn
   hình. WEB-002 phải ghi bằng chứng thiết bị thật; không được “giải” bằng PWA giả định.
3. **Business backend:** chưa có order/dispatch/outbox realtime hoàn chỉnh. UI WEB-006/007
   phải dùng feature boundary rõ, không mock thành trạng thái production.
4. **Storage riêng tư:** driver documents đang ở filesystem phát triển. Không pilot trước
   khi có storage/retention/backup và authorization review.
5. **Map provider:** public Nominatim/OSRM/tile demo không phải production SLA. Cần quota,
   attribution, fallback và kiểm chứng địa chỉ Hà Nội.
6. **Test debt:** Customer/Driver chưa có component/E2E web tests; CI chưa chạy browser.
7. **Migration path:** thay nội dung ngay tại `apps/customer`/`apps/driver` làm khó so sánh
   parity. WEB-003 phải mô tả staging path/feature flag hoặc nhánh triển khai trước khi thay.

## Task breakdown sau WEB-001

| Task | Deliverable | Phụ thuộc | Acceptance gate |
| --- | --- | --- | --- |
| WEB-002 — Browser tracking feasibility | Test harness + ma trận Safari iOS/Chrome Android/desktop cho permission, foreground/background, lock, offline/reconnect, accuracy và battery; đo nhịp mục tiêu 5–10s, giả thuyết stale 30s/unavailable 60s; SOP tách tài xế rảnh khỏi tài xế đã nhận đơn | WEB-001 | Evidence thiết bị thật; PO duyệt limitation/fallback và ngưỡng trước pilot; xác nhận không tự hủy đơn đã nhận vì mất GPS và chỉ đưa tài xế rảnh trở lại matching sau fix hợp lệ |
| WEB-003 — Web architecture & auth ADR | Thiết kế 3 Vite apps, package boundaries, route/role model, deploy origins; cookie/CSRF/CORS/session migration ADR; skeleton migration strategy không xóa Expo | WEB-001; input từ WEB-002 cho Driver | Security review; contract và rollback plan được duyệt |
| WEB-004 — UX & design system | Flow/wireframe Customer/Driver/Admin; responsive states; `packages/ui` tokens/primitives proposal và accessibility criteria | WEB-001; kiến trúc WEB-003 | Review ở mobile/tablet/desktop; loading/empty/error/offline/freshness states đầy đủ |
| WEB-005 — Web foundation & CI | React/Vite shells, router/query/auth adapters, role gates, shared UI, unit + Playwright baseline và CI web | WEB-003, WEB-004 | Login/logout/refresh/error tests; typecheck/build/E2E xanh; Expo CI vẫn giữ |
| WEB-006 — Customer parity | Profile, address/map, draft; quote/order UI chỉ bật khi API authoritative có sẵn | WEB-005; map decision; một phần WEB-009 | Customer parity checklist + responsive/a11y/E2E evidence |
| WEB-007 — Driver parity | KYC/docs, availability, offers/order actions/map, active tracking/recovery UX | WEB-002, WEB-005, WEB-009 | Permission/stale/offline/reconnect tests; không tuyên bố background GPS |
| WEB-008 — Responsive Admin | Port Admin vào shared shell/tokens; review/audit/map/dispatch responsive | WEB-005; dispatch phụ thuộc WEB-009 | Không regression; RBAC/private document/conflict E2E; 320px–1440px |
| WEB-009 — Business & realtime API | Order/dispatch/outbox, Socket auth/rooms, snapshot/reconnect, GPS validation, Redis TTL + selected PostGIS history | WEB-002, WEB-003; PO policy | Transaction/idempotency/authorization/integration/load evidence |
| WEB-010 — Staging & pilot hardening | Cross-browser, security, accessibility, performance, observability, providers/storage/SMS production, rollback | WEB-006–009 | Release checklist và PO sign-off cho Hanoi pilot |
| WEB-011 — Expo deprecation | PR riêng xóa Expo/mobile package/scripts/docs/CI chỉ sau parity | WEB-010 + parity gate | Có evidence, rollback/archive plan và reviewer độc lập; không tự merge |

WEB-002 và phần không phụ thuộc auth của WEB-004 có thể chuẩn bị song song. WEB-009 có
thể triển khai theo lát dọc cùng WEB-006/007 sau khi contract WEB-003 được duyệt, nhưng
không được bỏ qua gate feasibility của Driver.

