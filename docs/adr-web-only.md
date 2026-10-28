# ADR-001 — Web-only và responsive cho ShanGo

- Ngày quyết định: 2026-10-28
- Trạng thái: **Accepted — documentation only; chưa triển khai migration**
- Phạm vi: Customer, Driver, Admin trên trình duyệt; API giữ kiến trúc server hiện có.

## Bối cảnh và quyết định

ShanGo trước đây định hướng 2 ứng dụng Expo/React Native (Customer, Driver) và 1 Web Admin. Kế hoạch mới **không phát triển hoặc phát hành ứng dụng mobile native**. Thay vào đó cung cấp giao diện web responsive cho ba vai trò, dùng được trên desktop, tablet và mobile browser. Responsive không đồng nghĩa với native app; **PWA chỉ là tùy chọn sau khi đánh giá**, không phải cam kết MVP.

Đây là thay đổi chiến lược sản phẩm, **không phải tuyên bố code đã chuyển đổi**. Các thư mục `apps/customer` và `apps/driver` vẫn là Expo/React Native; chưa xóa, chuyển tên, thay package, sửa CI hay thay triển khai. Tài liệu cũ mô tả hành vi đã hiện thực của mobile được giữ lại như bằng chứng lịch sử đến khi web thay thế và được kiểm chứng.

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
- Realtime: trạng thái đơn authoritative phía server; khi web mất kết nối dùng reconnect/snapshot. Vị trí tài xế phải có freshness TTL, fallback/manual check-in và chính sách online/offline khi tab ngủ; chưa chốt phương án vận hành tracking nền.

## Quyết định còn mở trước khi code

1. Chọn một web app đa vai trò hay ba frontend web độc lập; mặc định **đánh giá reuse với Admin Vite hiện có trước** khi chọn Next.js hoặc Vite.
2. Chốt quy tắc phục vụ đơn khi tài xế tắt màn hình, khóa điện thoại, chuyển tab hoặc browser bị giới hạn vị trí nền; không làm tính năng phụ thuộc liên tục vào web background tracking nếu không khả thi.
3. Chốt auth cookie/CSRF, route separation, CORS, storage và migration phiên đăng nhập.
4. Chốt lựa chọn bản đồ web, routing provider Hà Nội, attribution, fallback và chi phí.
5. Chốt thông báo: in-app/reconnect trước; Web Push và PWA chỉ nếu được chấp thuận.
6. Chốt browser support matrix, ngân sách performance và các tiêu chí staging/production.

## Quy tắc chuyển đổi

Không xóa app Expo, mobile documentation hoặc CI trước khi có migration plan, checklist parity và cổng nghiệm thu riêng. Mọi thay đổi code thực hiện ở PR sau. Docs hiện có về native là **as-built legacy**, không phải hướng dẫn triển khai tương lai.