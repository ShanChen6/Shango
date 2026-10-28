# Backlog và trạng thái thực tế

Đây là foundation đầu tiên, không phải toàn bộ 72 task đã hoàn tất. Mã SG theo kế hoạch đã thống nhất trong chat.

| Task       | Trạng thái     | Phạm vi / còn thiếu                                                                                       |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| SG-001     | Một phần       | Có state machine sơ bộ; PO cần chốt ngoại lệ và phí                                                       |
| SG-002     | Một phần       | Migration users/sessions/driver locations/audit/outbox; order/ledger schema triển khai theo nghiệp vụ sau |
| SG-003     | Có code        | Hai app Expo, UI dùng chung, Admin và API client; chưa xác minh thiết bị thật                             |
| SG-004     | Một phần       | NestJS, compose, migration runner, CI; staging chưa provision                                             |
| SG-005     | Chưa làm       | Cần thành phố/provider và spike map Android/iOS                                                           |
| SG-006     | Một phần       | Test plan và integration fixtures tự dọn; chưa có ma trận thiết bị thực tế                                |
| SG-007     | Một phần       | OTP development, rate limit, phiên, refresh/logout; chưa SMS thật                                         |
| SG-008     | Có code        | Đăng nhập, secure storage, refresh; cần kiểm thử thiết bị và resend UX nâng cao                           |
| SG-009     | Một phần       | RBAC Admin/dispatcher và CLI bootstrap; UI kế toán/audit viewer chưa có                                   |
| SG-010     | Một phần       | Phương tiện và trạng thái; chưa upload giấy tờ/profile khách                                              |
| SG-011     | Một phần       | List/lọc/phân trang, review optimistic concurrency, audit; chưa xem giấy tờ                               |
| SG-012     | Chờ nghiệm thu | Chạy integration CI và QA thiết bị trước khi đóng gate                                                    |
| SG-013–072 | Chưa làm       | Theo lộ trình 24 tuần; không bật production trước release readiness                                       |

## Thứ tự tiếp theo

1. CI xanh, chạy hai app trên thiết bị; provision staging có quyền truy cập hạn chế.
2. SG-005 chọn map/provider bằng bộ địa chỉ thật; không đưa demo tile/geocoding vào production.
3. SMS provider thật, hồ sơ khách và private upload tài xế.
4. Hoàn thành gate nền tảng rồi SG-013–024: bản đồ, quote, đơn và dispatch.
