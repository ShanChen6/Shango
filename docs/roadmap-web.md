# Roadmap triển khai ShanGo — Web-only responsive

> 2026-10-28 · **Planning only**. Không có code ứng dụng được thay đổi bởi tài liệu này. Kế hoạch áp dụng thay cho các hạng mục native của roadmap cũ; mã SG và trạng thái lịch sử giữ nguyên.

## Mục tiêu phát hành

Một sản phẩm giao nhận phục vụ **Khách hàng, Tài xế, Quản trị viên** qua trình duyệt responsive. Pilot: **Hà Nội**. Giữ NestJS API, PostGIS/Redis và audit; không phát hành Android/iOS app. Khả năng realtime, GPS, thông báo trên web phải được kiểm chứng trước khi hứa parity mobile.

## Quyết định đã duyệt (28/10/2026)

- **Kiến trúc frontend:** 3 ứng dụng web độc lập Customer, Driver, Admin dùng React + Vite + TypeScript trong monorepo, triển khai độc lập, chia sẻ UI web, API Client, Contracts; giữ Admin hiện hữu. Chỉ thay Expo sau migration gate.
- **Driver:** Active Tracking + Connection Recovery bằng Web Geolocation khi browser cho phép + Socket.IO; không cam kết tracking khi khóa màn hình/chuyển tab. Reconnect lấy snapshot trạng thái đơn authoritative. Không tự hủy đơn đã nhận chỉ vì mất GPS.
- **Chính sách đề xuất để đo W1:** mục tiêu GPS 5–10s, stale sau 30s, loại tài xế rảnh khỏi matching sau 60s không có fix GPS mới; cần validation và PO duyệt trước production. Redis vị trí gần nhất/TTL; PostgreSQL giữ order/assignment.
- **Giới hạn MVP:** Web Push/PWA là tùy chọn, không phải workaround để đảm bảo GPS nền.

## Lộ trình theo gate (không gán ngày khi chưa ước lượng)

| Phase | Công việc / deliverable | Tiêu chí hoàn tất |
| --- | --- | --- |
| W0 — Baseline & audit | Lập inventory frontend Expo/Admin, shared packages, API/CI; đánh dấu các task native deprecated; lập feature parity theo vai trò | Có danh mục giữ/thay/loại và rủi ro |
| W1 — Browser feasibility | Spike Active Tracking + Connection Recovery: web geolocation trên Safari iOS/Chrome Android, tab nền/khóa màn hình, stale 30s/unavailable 60s, permission, reconnect/snapshot, map | PO chấp nhận limitation/fallback, đặc biệt Driver tracking |
| W2 — Architecture & UX | Triển khai thiết kế chi tiết kiến trúc **3 React/Vite frontend** đã chốt, auth web/cookie-CSRF, map renderer, navigation, responsive wireframes, shared tokens | Review luồng Customer/Driver/Admin tại mobile/tablet/desktop |
| W3 — Web foundation | Setup frontend web, routing, auth session, API client, role gates, responsive layout/components, CI browser | Login/logout/refresh/error handling, keyboard, unit/E2E baseline |
| W4 — Customer web | Hồ sơ, địa chỉ qua map, form tạo đơn/quote (khi API sẵn sàng), danh sách/chi tiết/tracking | Các luồng khách hoạt động mobile và desktop; không lẫn demo với production |
| W5 — Driver web | Hồ sơ/giấy tờ, trạng thái sẵn sàng, offer/nhận đơn, trạng thái giao, map; tab suspension policy | Không giả GPS nền; freshness/fallback đã được QA |
| W6 — Admin web | Responsive dashboard, xét duyệt giấy tờ, điều phối và audit; RBAC | Mobile-width, desktop, audit conflict QA |
| W7 — Business backend | Order/dispatch/outbox/realtime, ledger theo phạm vi PO đã phê duyệt, migration/test | Transaction, idempotency và quyền được nghiệm thu |
| W8 — Hardening & pilot | Cross-browser E2E, accessibility, perf, observability, security, storage/SMS/map provider production, Hanoi pilot | Release checklist và rollback được duyệt |

Các phase có thể chia nhỏ/triển khai song song sau W1–W2, nhưng không bỏ qua feasibility gate cho Driver. `W` là **wave**, không cam kết mỗi phase một tuần.

## Feature parity và ưu tiên

| Role | MVP | Sau MVP / phụ thuộc |
| --- | --- | --- |
| Customer | Login, hồ sơ, chọn địa chỉ, quote/đặt đơn khi API sẵn sàng, xem trạng thái | Push/offline/installability |
| Driver | Login, KYC, trạng thái thủ công, nhận đơn, cập nhật đơn, vị trí khi browser cho phép | Tracking nền liên tục **không cam kết** |
| Admin | Review tài xế, audit, bản đồ, danh sách và điều phối theo nghiệp vụ | Analytics/báo cáo nâng cao |
| Shared | API contracts, security, mapping, responsive components, test | PWA khi có bằng chứng nhu cầu và khả thi |

## QA / Definition of Done

- Viewports: 320, 360, 390, 768, 1024, 1280, 1440px; portrait/landscape khi cần. Không horizontal overflow và không mất thao tác trọng yếu.
- Browser matrix tối thiểu: Chrome/Edge desktop, Firefox desktop, Safari macOS; Chrome Android và Safari iOS (phiên bản hỗ trợ được chốt W1).
- Keyboard-only, focus, labels, contrast, screen reader smoke, zoom 200%, touch, reduced motion.
- Auth: session rotation/revoke, CSRF/CORS, role isolation, private documents, audit, secure errors.
- Network: slow/offline/reconnect, stale GPS, permission denied, background/foreground, duplicate click, double assignment.
- Maps: attribution, địa chỉ Hà Nội, errors, throttling, provider policy; không dùng public demo làm hạ tầng production.
- Order lifecycle + ledger: concurrency/idempotency được kiểm thử server-side trước pilot.
- CI target: frontend web typecheck/lint/unit/build + Playwright/E2E, API migration/integration; bỏ Expo bundle **sau khi chính thức migration**.
- Rollout có feature flags, staging, logs/metrics, backup/rollback và PO sign-off.

## Task chuyển tiếp (proposal)

- WEB-001: **Hoàn tất audit** — inventory/code & docs audit, dependency matrix; xem
  [baseline audit và task breakdown](web-001-audit.md). Không có migration code trong task này.
- WEB-002: đo Active Tracking + Connection Recovery, stale thresholds, browser limits và quy trình khi Driver mất GPS.
- WEB-003: **ADR đề xuất đang chờ review** — 3 React/Vite frontend + shared packages,
  route/deploy boundaries và web auth cookie-CSRF; xem [ADR-002](adr-web-architecture-auth.md).
  Không mở lại lựa chọn 1-vs-3 nếu PO chưa đổi quyết định.
- WEB-004: UX flows/wireframes và responsive design system.
- WEB-005: web foundation + CI/E2E.
- WEB-006: customer web parity.
- WEB-007: driver web parity.
- WEB-008: responsive Admin.
- WEB-009: API business flows + reconnect/snapshot.
- WEB-010: staging, security/performance/accessibility và pilot.
- WEB-011: deprecate Expo, mobile packages/scripts sau migration verified.

WEB-002–011 được tách thành deliverable, dependency và acceptance gate cụ thể trong
[WEB-001 baseline audit](web-001-audit.md). Trạng thái “hoàn tất audit” không đồng nghĩa
Customer/Driver đã được chuyển sang web.

Mã SG-001–072 trong `backlog.md` vẫn là lịch sử và phạm vi nghiệp vụ; không tự đánh dấu hoàn thành chỉ vì chuyển nền tảng.
