# ADR-001 — Web-only và responsive cho ShanGo

- Ngày quyết định: 2026-10-28
- Trạng thái: **Accepted — documentation only; chưa triển khai migration**
- Phạm vi: Customer, Driver, Admin trên trình duyệt; API giữ kiến trúc server hiện có.

## Bối cảnh và quyết định

ShanGo trước đây định hướng 2 ứng dụng Expo/React Native (Customer, Driver) và 1 Web Admin. Kế hoạch mới **không phát triển hoặc phát hành ứng dụng mobile native**. Thay vào đó cung cấp giao diện web responsive cho ba vai trò, dùng được trên desktop, tablet và mobile browser. Responsive không đồng nghĩa với native app; **PWA chỉ là tùy chọn sau khi đánh giá**, không phải cam kết MVP.

Đây là thay đổi chiến lược sản phẩm, **không phải tuyên bố code đã chuyển đổi**. Các thư mục `apps/customer` và `apps/driver` vẫn là Expo/React Native; chưa xóa, chuyển tên, thay package, sửa CI hay thay triển khai. Tài liệu cũ mô tả hành vi đã hiện thực của mobile được giữ lại như bằng chứng lịch sử đến khi web thay thế và được kiểm chứng.

## Quyết định kỹ thuật đã chốt — 28/10/2026

### Frontend: 3 ứng dụng React/Vite độc lập trong cùng monorepo

- `apps/customer`: web React + Vite + TypeScript; thay Expo sau khi hoàn thành migration và parity gate.
- `apps/driver`: web React + Vite + TypeScript; thay Expo sau khi hoàn thành migration và parity gate.
- `apps/admin`: **giữ** React/Vite đang có, cải tiến responsive.
- Dùng chung `packages/contracts`, `packages/api-client` sau audit và xây `packages/ui` dùng Tailwind CSS/design tokens theo hướng web; `packages/mobile-ui` là legacy, chỉ dọn sau migration.
- Các frontend deploy độc lập, có navigation/layout và role boundary riêng; **API kiểm tra quyền server-side**, frontend separation không thay thế RBAC.
- React Router và TanStack Query là lựa chọn triển khai dự kiến; mapping/security/auth cần thiết kế chi tiết. Không thêm Next.js vào MVP khi chưa phát sinh yêu cầu SSR/SEO.

### Driver tracking: Active Tracking + Connection Recovery

- Khi trang Driver đang hoạt động và được cấp quyền vị trí trên HTTPS, dùng `navigator.geolocation.watchPosition()` thu nhận dữ liệu; truyền mẫu hợp lệ qua Socket.IO/Gateway tới backend; nhịp mục tiêu **5–10 giây** chỉ là thông số spike, không đảm bảo browser phát điểm đúng chu kỳ.
- Backend xác minh JWT/driver approved/availability, timestamp, sequence, accuracy, tọa độ và freshness. Redis giữ last-known + TTL, PostGIS lưu history có chọn lọc; trạng thái đơn/assignment vẫn do PostgreSQL xác định.
- Nếu Socket ngắt: UI chuyển trạng thái reconnecting, giữ và gắn nhãn vị trí cuối cùng cùng timestamp; reconnect thì **lấy snapshot authoritative**, resubscribe room và gửi vị trí mới. Không phát lại lệnh nghiệp vụ mù quáng; dùng version/idempotency.
- Ngưỡng khởi tạo để kiểm thử: sau **30 giây** thiếu vị trí mới đánh dấu *stale*, sau **60 giây** thiếu tín hiệu đủ tin cậy thì **không phân phối đơn mới**; các ngưỡng là đề xuất cần đo và phê duyệt qua W1 trước production. Không coi Socket connected là bằng chứng vị trí còn tươi.
- Với tài xế **đã nhận đơn**: không tự huỷ đơn vì mất GPS; khách/Admin xem vị trí cuối cùng, độ mới, trạng thái kết nối; quy trình liên hệ/escalation khi mất tín hiệu dài cần PO chốt.
- Với tài xế **đang rảnh**: tự động loại khỏi matching khi stale; khi trở lại chỉ đưa vào pool sau khi có fix GPS hợp lệ và trạng thái availability hợp lệ.
- **Không cam kết GPS nền liên tục** khi tab không hoạt động, điện thoại khoá màn hình hoặc browser bị OS suspend. PWA/Service Worker **không** được coi là giải pháp đảm bảo GPS nền. Chỉ hỗ trợ vị trí khi trình duyệt và hệ điều hành cho phép.
- Phải kiểm chứng trên Safari iOS và Chrome Android: permission denied, foreground/background, khoá màn hình, mất mạng, reconnect, độ chính xác, battery. Nếu yêu cầu vận hành đòi GPS nền liên tục, phải điều chỉnh nghiệp vụ hoặc xem lại ràng buộc web-only trước khi nhận pilot.

## Giữ lại và thay đổi

| Thành phần | Quyết định | Ghi chú |
| --- | --- | --- |
| `apps/api` NestJS, Postgres/PostGIS, Redis, RBAC, audit | Giữ và rà soát các giả định mobile | Không đổi state machine, tiền, phân quyền |
| `apps/admin` React/Vite | Giữ, mở rộng responsive | Dùng chung design tokens khi phù hợp |
| `apps/customer` Expo | **Dừng phát triển native**, lên kế hoạch xây web | Tái sử dụng domain/contract, không giả định TSX React Native chạy trên web |
| `apps/driver` Expo | **Dừng phát triển native**, lên kế hoạch xây web | Đánh giá GPS/browser trước khi chốt nghiệp vụ |
| `packages/contracts`, `packages/api-client` | Ưu tiên giữ sau audit | Kiểm tra phụ thuộc storage/native |
| `packages/mobile-ui` | Legacy; audit trước khi thay | Không xóa khi chưa có phương án thay thế |
| CI Expo bundles, native build, store release | Loại khỏi **target CI** trong giai đoạn triển khai | CI hiện tại vẫn chưa chỉnh |
| Maps API và Admin Leaflet lab | Giữ, tái sử dụng cho web | Production providers/attribution vẫn cần chốt |

## Tiêu chí thiết kế web

- Thiết kế mobile-first nhưng **không co desktop thành khung điện thoại**: desktop tận dụng không gian, tablet cân nhắc split-view, mobile ưu tiên tác vụ và nút thao tác dễ chạm.
- Breakpoint tham chiếu để bắt đầu thiết kế: 360–767px mobile, 768–1023px tablet, ≥1024px desktop; đây là **mốc đề xuất, không ràng buộc cứng**. Kiểm thử ở 320px và zoom 200% để tránh tràn màn hình.
- Điều hướng rõ từng vai trò; biểu mẫu địa chỉ, bản đồ, đơn hàng và theo dõi đơn phải có trạng thái loading/empty/error/offline.
- WCAG 2.2 AA làm mục tiêu; keyboard, screen reader, focus, touch targets và reduced motion.
- Chỉ truy cập qua HTTPS khi triển khai; lựa chọn phiên bằng cookie HttpOnly/Secure/SameSite và bảo vệ CSRF cần được phân tích cùng API; **không chuyển token native secure storage sang localStorage mặc định**.
- Web Geolocation cần permission, HTTPS, trang đang hoạt động và có thể bị browser/OS giới hạn. Không hứa GPS liên tục khi khóa màn hình/đóng tab. Web Push, service workers, offline, installability đều phải qua compatibility + permission spike trước khi nhận cam kết.
- Realtime: trạng thái đơn authoritative phía server; khi web mất kết nối dùng reconnect/snapshot. Vị trí tài xế phải có freshness TTL, fallback/manual check-in và chính sách online/offline khi tab ngủ; thực hiện Active Tracking + Connection Recovery như quyết định trên.

## Quyết định còn mở trước khi code

1. **Đã chốt**: 3 frontend web React/Vite độc lập trong cùng monorepo, dùng shared packages; tracking Active Tracking + Connection Recovery, không cam kết GPS nền.
2. **Cần kiểm chứng**: đo hành vi Geolocation trên trình duyệt/thiết bị và hiệu chỉnh ngưỡng stale 30s / unavailable 60s; PO chốt escalations cho đơn đang giao.
3. Chốt auth cookie/CSRF, route separation, CORS, storage và migration phiên đăng nhập.
4. Chốt lựa chọn bản đồ web, routing provider Hà Nội, attribution, fallback và chi phí.
5. Chốt thông báo: in-app/reconnect trước; Web Push và PWA chỉ nếu được chấp thuận.
6. Chốt browser support matrix, ngân sách performance và các tiêu chí staging/production.

## Quy tắc chuyển đổi

Không xóa app Expo, mobile documentation hoặc CI trước khi có migration plan, checklist parity và cổng nghiệm thu riêng. Mọi thay đổi code thực hiện ở PR sau. Docs hiện có về native là **as-built legacy**, không phải hướng dẫn triển khai tương lai.