# Backlog và trạng thái thực tế

> **Roadmap mới:** [Web-only responsive](roadmap-web.md); [ADR](adr-web-only.md). Bảng SG bên dưới giữ nguyên **trạng thái lịch sử**; các công việc Expo/native được thay bằng WEB-001–011 trong roadmap. Không diễn giải “có code” Expo thành “web đã hoàn thành”.

Phần native bị thay thế trong SG-003/005/006/008/010/014 được ánh xạ cụ thể tại
[WEB-001 baseline audit](web-001-audit.md#phạm-vi-native-bị-roadmap-web-thay-thế).
Các trạng thái bên dưới vẫn là bằng chứng lịch sử, không phải target triển khai mới.

Đây là foundation đầu tiên, không phải toàn bộ 72 task đã hoàn tất. Mã SG theo kế hoạch đã thống nhất trong chat.

| Task       | Trạng thái                             | Phạm vi / còn thiếu                                                                                       |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| SG-001     | Một phần                               | Có state machine sơ bộ; PO cần chốt ngoại lệ và phí                                                       |
| SG-002     | Một phần                               | Migration users/sessions/driver locations/audit/outbox; order/ledger schema triển khai theo nghiệp vụ sau |
| SG-003     | Có code                                | Hai app Expo, UI dùng chung, Admin và API client; chưa xác minh thiết bị thật                             |
| SG-004     | Một phần                               | NestJS, compose, migration runner, CI; staging chưa provision                                             |
| SG-005     | Một phần                               | Đã chọn Hà Nội; có Web map lab và adapter, còn chốt provider/tile và spike native Android/iOS             |
| SG-006     | Một phần                               | Test plan và integration fixtures tự dọn; chưa có ma trận thiết bị thực tế                                |
| SG-007     | Một phần                               | OTP development, rate limit, phiên, refresh/logout; chưa SMS thật                                         |
| SG-008     | Có code                                | Đăng nhập, secure storage, refresh; cần kiểm thử thiết bị và resend UX nâng cao                           |
| SG-009     | Một phần                               | Có RBAC, CLI bootstrap và audit viewer chỉ dành Admin; UI kế toán chưa có                                 |
| SG-010     | Có code, chờ QA thiết bị               | Có hồ sơ tên/phương tiện và upload JPEG/PNG riêng tư; storage local, còn retention/backup/production      |
| SG-011     | Có code, chờ nghiệm thu                | List/lọc, xem bốn ảnh theo quyền và revision; server yêu cầu đủ tài liệu/lượt xem trước approval          |
| SG-012     | Chờ nghiệm thu                         | Chạy integration CI và QA thiết bị trước khi đóng gate                                                    |
| SG-013     | Có code, chưa nghiệm thu provider thật | Search/reverse/routing adapter, cache/rate limit, shared client và Admin map lab; xem maps-hanoi.md       |
| SG-014     | Có code/test logic, chờ native QA      | App Khách chọn điểm/tọa độ, MapLibre, liên hệ/ghi chú, xác nhận và tóm tắt; xem customer-addresses.md     |
| SG-015–072 | Chưa làm                               | Tiếp theo: polygon PostGIS vùng phục vụ; chưa báo giá/đặt đơn                                             |

## Thứ tự tiếp theo

1. CI xanh, chạy hai app trên thiết bị; provision staging có quyền truy cập hạn chế.
2. SG-005 chọn map/provider bằng bộ địa chỉ thật; không đưa demo tile/geocoding vào production.
3. SMS provider thật, hồ sơ khách và private upload tài xế.
4. Hoàn thành gate nền tảng rồi SG-013–024: bản đồ, quote, đơn và dispatch.
