# Kết quả kiểm chứng — 28/10/2026

## Đợt hồ sơ người dùng và nhật ký Admin

- TypeScript toàn workspace và build API/Admin pass.
- 14 unit test API, 15 test tương tác/accessibility Admin và 22 integration test pass (tổng 51).
- Migration 002 đã áp dụng thành công trên database test và local development; database CI sẽ được dựng mới và migrate tuần tự.
- Bao phủ update đồng thời, chống sửa role/phone/id qua body, bản ghi không thay đổi, quyền Admin, tài khoản khóa, cursor không mất precision, phân trang khi có event mới và mốc ngày Việt Nam.
- UI native được bổ sung ProfileEditor dùng chung; cần QA thiết bị. CI sẽ đóng gói Android của cả hai app sau khi push; chưa coi đây là native APK/IPA build.
- Quy trình nhánh được cập nhật đúng quyết định mới: main mặc định, develop làm việc; PR + CI + review trong chat, không yêu cầu approval GitHub độc lập và agent không tự merge.

## Đợt Map Gateway Hà Nội

- TypeScript toàn workspace và build API/Admin pass.
- 9 unit test API, 11 test tương tác/accessibility Admin và 16 integration test pass (tổng 36).
- Integration maps sử dụng Redis/PostgreSQL thật và Nominatim/OSRM HTTP fixture local; bao phủ cache, concurrency, bbox, bảo toàn pin reverse, NoRoute, lỗi upstream, timeout và giới hạn response.
- Đã gọi một truy vấn địa danh thật Hồ Hoàn Kiếm qua Nominatim với opt-in development, nhận một kết quả trong Hà Nội. Chưa benchmark bộ địa chỉ hoặc tuyến đường thật.
- Chưa có OSRM graph Hà Nội, tile provider được chốt hay native map/device QA. Backend và UI báo rõ chức năng chưa cấu hình, không trả tuyến/giá giả.
- GitHub CI của foundation trước đó đã đạt; kết quả CI commit mới cần đọc theo Actions sau khi push.

## Đợt foundation ban đầu

Commit triển khai: `a79ba6935d4b5d689050d71790208223c38f0bce` trên `develop`.

- TypeScript: toàn bộ API, Admin, Customer và Driver pass.
- Unit API: 5/5 pass.
- Component tương tác/accessibility: 8/8 pass.
- Integration PostgreSQL/PostGIS + Redis thật: 6/6 pass, bao gồm refresh đồng thời và review đồng thời.
- API/Admin build pass.
- Expo Android Hermes bundle cho cả hai app pass; dependency check Expo pass.
- GitHub Actions của commit triển khai: success, https://github.com/ShanChen6/Shango/actions/runs/40660415453 . Workflow chạy trên Linux và gồm migration, integration, build và mobile bundling.
- Main protection đã được bật và đọc lại qua API; xem branch-policy.md.

Không đồng nghĩa đã build native APK/IPA, chạy thiết bị Android/iOS hoặc nghiệm thu toàn bộ giai đoạn 1. Chưa provision staging/production, map provider, SMS thật, tải giấy tờ, đơn hàng, tracking hoặc ledger.

`npm audit` từng báo lỗi ở Vitest cũ; đã nâng Vitest 5.0.5 và chạy lại test. Chuỗi công cụ Expo SDK 55 còn cảnh báo phụ thuộc gián tiếp, cần đánh giá/nâng SDK có kiểm thử trước release. Không tự dùng audit fix --force vì đề xuất có thể hạ SDK và phá tương thích native.
