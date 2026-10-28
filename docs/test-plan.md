# Kiểm thử foundation

## Tự động

- Unit: cấm OTP dev ở production, tách secret, canonical E.164, lỗi cấu hình không lộ secret.
- Component: button không submit ngoài ý muốn, loading/disabled, disabled Slot chặn handler của child, label/hint/error accessibility và phục hồi validation.
- Maps: input trong/ngoài Hà Nội, chuẩn hóa/cache truy vấn, admission geocoder dùng Redis, dữ liệu upstream sai, NoRoute, cấu hình thiếu và bảo toàn pin khi reverse. HTTP provider fixture chạy cục bộ; test tự động không gọi bản đồ công cộng.
- Integration trên DB/Redis riêng: readiness, OTP dùng một lần/giới hạn đoán/cooldown; rotate refresh đồng thời; logout thu hồi access và refresh; chặn đăng ký admin; RBAC; review đồng thời chỉ một kết quả; audit; ST_DWithin theo mét.
- CI: typecheck toàn workspace, unit, migration, integration, API/Admin build và Android JS bundle cho hai app.
- Fixtures tạo số điện thoại riêng và tự xóa user/profile/session/audit liên quan; không FLUSHDB hoặc TRUNCATE dữ liệu dùng chung.
- Không chạy integration trên DB production hoặc DB có dữ liệu thật.

## Thủ công trước đóng gate

1. Khách login, mở lại app, hết access token, logout rồi token cũ bị từ chối.
2. Tài xế gửi phương tiện; Admin duyệt/từ chối; tài xế refresh thấy kết quả.
3. Hai Admin mở cùng hồ sơ và review: người thứ hai nhận xung đột.
4. Customer gọi admin API hoặc driver API: 403; tài xế pending bật online: 403.
5. Mất mạng khi OTP/refresh, API chậm và Redis không sẵn sàng: không báo thành công giả.
6. Hai app chạy Android/iOS thiết bị thật; kiểm tra secure storage và bàn phím OTP.
7. Admin mobile-width, loading/empty/error và phân trang.

## Chưa được chứng minh ở foundation

Native Android/iOS build/signing, vị trí nền, bản đồ, dispatch, ledger, tải mục tiêu, staging/production, backup/PITR. Không dùng unit test xanh để kết luận những phần này đã hoàn tất.
