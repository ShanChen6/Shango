# Kết quả kiểm chứng — 28/10/2026

## SG-014 — Địa chỉ lấy/giao trên App Khách

- 85 test đạt: 33 unit API/domain (15 test mới cho draft địa chỉ), 21 UI/HTTP client và 31 integration hồi quy.
- TypeScript toàn workspace, API/Admin build và Android Hermes bundle App Khách đạt.
- Đã chạy Expo Android prebuild và `:app:assembleDebug` cho arm64-v8a, SDK 36, NDK 27.1; kết quả **BUILD SUCCESSFUL**. Đây là debug APK cần Metro trong development, không phải bản phát hành độc lập/store.
- Lượt native build đầu lỗi đường dẫn object C++ quá dài trên Windows. Plugin opt-in SHANGO_CMAKE_BUILD_DIR chuyển staging ra đường dẫn ngắn; lần build sau thành công. Native output và đường dẫn máy không commit.
- Không có thiết bị/emulator chạy để QA giao diện; chưa kiểm thử iOS. Không coi native compile hoặc test controller là bằng chứng bấm/kéo pin thực tế.
- SG-014: có code/test/build, chờ nghiệm thu thiết bị. Chưa thực hiện SG-015 polygon vùng phục vụ hoặc SG-016 báo giá.

## Đợt giấy tờ tài xế riêng tư

- TypeScript toàn workspace, build API/Admin và 70 test pass: 18 unit API, 21 test Admin/API client, 31 integration.
- Test giấy tờ dùng ảnh tổng hợp và storage tạm riêng; không dùng tài liệu cá nhân thật. Có kiểm thử MIME/signature, EXIF, file quá cỡ, quyền owner/reviewer, session bị khóa, superseded ID, upload đồng thời, rollback storage và hash integrity.
- Approval cần đủ bốn ảnh theo chính sách chủ dự án và lượt xem của chính reviewer trong revision hiện tại. Đổi phương tiện cũng hủy hiệu lực lượt xem cũ; integration đã kiểm chứng.
- Admin có thể mở lại approved với lý do để bổ sung giấy tờ: pending, tắt availability, audit và chống request stale; dispatcher bị từ chối. Integration đã kiểm chứng luồng hồ sơ cũ.
- Shared HTTP client hỗ trợ multipart đúng boundary và refresh token khi đọc binary/upload. Blob preview trên Web được thu hồi khi đóng/unmount; UI và transport đã kiểm thử.
- Native picker/upload/preview đã có code, chưa xác minh thiết bị. CI sẽ kiểm tra Android bundling sau push. Storage local chưa có object storage, encryption/backup/retention production.

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
