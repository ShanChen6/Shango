# Hồ sơ người dùng và nhật ký Admin — SG-009 / SG-010

## Phạm vi

- Khách và tài xế chỉnh sửa tên hiển thị trong hai app; dùng chung ProfileEditor và API client.
- Tài khoản đang hoạt động chỉ chỉnh sửa hồ sơ của chính mình. Endpoint không cho đổi số điện thoại, vai trò hoặc trạng thái tài khoản.
- Tên được chuẩn hóa Unicode NFC/khoảng trắng, dài 2–80 ký tự và không chứa ký tự điều khiển.
- Version hồ sơ chống ghi đè: cùng một version chỉ một cập nhật khác nội dung được commit. Nội dung không đổi không tạo version hoặc audit thừa.
- Admin có tab Nhật ký thao tác với lọc action, actor, entity và khoảng ngày. Dispatcher/accountant không có quyền vào endpoint này.
- Nhật ký của các thao tác mới không lưu giá trị tên cũ/mới; chỉ ghi trường thay đổi và version. Payload trả về được lọc theo schema của từng action, không trả metadata lạ.

## Chạy và nâng cấp

```sh
npm run db:migrate
npm run dev:api
npm run dev:admin
```

Migration `002_profiles_and_audit.sql` thêm version/timestamp vào users và index phục vụ lọc audit, không xóa dữ liệu. Readiness yêu cầu migration này; chạy migration trước khi nâng API. Không rollback bằng cách xóa cột khi còn phiên bản API mới đang chạy.

Mở hai app như README, đăng nhập và dùng khối **Thông tin cá nhân**. Khi nhận lỗi xung đột, bản nháp tên được giữ lại; **Tải lại hồ sơ** sẽ lấy bản server và thay nội dung nhập. Số điện thoại chỉ đọc.

Web Admin: đăng nhập bằng admin rồi chọn **Nhật ký thao tác**. Khoảng ngày theo UTC+07; ngày kết thúc được bao gồm trên UI và được đổi thành mốc đầu ngày kế tiếp (exclusive) khi gọi API.

## Contract

| Endpoint              | Quyền                        | Input / output                                                                             |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| GET /users/me         | Phiên active                 | User + version + updatedAt                                                                 |
| PATCH /users/me       | Phiên active, chỉ chính mình | displayName, expectedVersion → hồ sơ mới                                                   |
| GET /admin/audit-logs | Admin                        | limit 1–50 (mặc định 20), cursor, actorId, entityId, action, from, to → items + nextCursor |

Prefix chung: `/api/v1`. Các field body/query không được khai báo bị từ chối.

- PATCH trả 409 khi version cũ; GET lại trước khi lưu.
- GET audit dùng cursor ID bigint dưới dạng **string**, không chuyển sang JS Number. Thứ tự id giảm dần; sự kiện mới không làm trùng trang đang phân trang.
- `from` bao gồm, `to` không bao gồm; API nhận timestamp ISO có timezone. Người gọi phải gửi lại cùng bộ lọc khi dùng cursor.
- Tên người thực hiện trên audit là tên tài khoản hiện tại, không phải snapshot tên lịch sử. Sự kiện gốc vẫn xác định bằng actorId.
- Không có API sửa/xóa nhật ký. Quyền DB và retention production cần được thiết kế riêng; đây không phải cam kết lưu trữ chống sửa bởi người có quyền DB.

## Kiểm thử

- Unit: chuẩn hóa tên Việt, ký tự điều khiển, cursor bigint, khoảng ngày, whitelist metadata.
- Integration: chỉnh đúng user, chặn nâng quyền qua body, concurrency/version, thay đổi không tác dụng phụ, RBAC/blocked account, cursor ổn định khi có sự kiện mới và ranh giới ngày Việt Nam.
- Admin: lọc/reset cursor, phân trang, khoảng ngày sai, loading/error/empty/retry.
- Native UI hiện được typecheck và đóng gói trong CI; chưa chạy kiểm thử thiết bị Android/iOS ở đợt này.

Giấy tờ tài xế, upload private và kiểm chứng SMS thật vẫn chưa triển khai. Không coi màn chỉnh tên là hoàn tất toàn bộ SG-010 hoặc gate nền tảng.
