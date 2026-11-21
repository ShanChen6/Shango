# WEB-007 — Driver web parity

- Ngày bắt đầu: 2026-11-21
- Base: `develop` sau WEB-005 (PR #15) và WEB-006 (PR #16)
- Trạng thái: **lát 1 — onboarding/KYC + kiểm tra GPS foreground đã có code; availability,
  offer và thao tác đơn đã có ở WEB-009 lát 1 (sau cờ `ORDERS_ENABLED`); tracking production vẫn chờ
  evidence thiết bị WEB-002**
- Expo Driver (`apps/driver`) và `packages/mobile-ui` vẫn được giữ đến WEB-011

## Phạm vi đã triển khai (`apps/driver-web`)

| Route        | Hành vi                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`          | Checklist hồ sơ (phương tiện → giấy tờ → xét duyệt), thẻ Nhận đơn luôn ngoại tuyến, kiểm tra vị trí foreground                             |
| `/profile`   | Gửi/cập nhật hồ sơ phương tiện (`POST /drivers/me`), trạng thái + lý do từ chối, khóa khi đã duyệt; sửa tên hiển thị với `expectedVersion` |
| `/documents` | Danh sách giấy tờ theo `requiredKinds` của server, chọn ảnh → xem trước → nộp; xem ảnh đã nộp của chính mình                               |
| `/offers`    | Đề nghị hiện tại có đếm ngược, nhận/từ chối (WEB-009); `/order` cho đơn đang chạy                                                                        |

### Giấy tờ riêng tư

- Client chỉ kiểm tra sơ bộ JPEG/PNG, không rỗng, ≤ 5 MiB; server vẫn là nơi quyết định
  (MIME + chữ ký, decode, bỏ metadata).
- Upload gửi `kind`, `expectedUpdatedAt` của profile revision hiện tại và file. Upload **không**
  tự replay sau 401 (guardrail WEB-005).
- 409 (revision cũ/đã duyệt) giữ ảnh đã chọn và hiện nút **Tải lại hồ sơ**; 413/429/400 có
  thông báo riêng, kèm request ID nếu có.
- Ảnh xem trước và ảnh tải về chỉ là object URL trong bộ nhớ; bị thu hồi khi thay, hủy, đóng,
  unmount, và ảnh đã nộp bị đóng khi tab chuyển nền. Không dùng URL public hoặc token trên URL.
- Hồ sơ đã duyệt: chỉ xem, không có nút thay ảnh.

### Kiểm tra vị trí foreground

- Chỉ chạy khi tài xế bấm **Kiểm tra vị trí** và trang đang mở (`watchPosition`, high accuracy).
- Tọa độ **không** được gửi lên API, không lưu, không log, không hiển thị; chỉ hiện tuổi fix và
  sai số.
- Phân loại theo giả thuyết WEB-002: fresh < 30 giây, stale ≥ 30 giây, unavailable ≥ 60 giây; cùng
  các trạng thái waiting/denied/unsupported. Ngưỡng này **chưa phải chính sách production**.
- Khi tab quay lại sau ≥ 5 giây ở nền, hiện cảnh báo rằng GPS có thể đã ngừng cập nhật.
- Nút **Bật sẵn sàng** luôn disabled: server hiện chỉ cho phép offline (SG-018) và chưa có
  presence/dispatch.

## Parity checklist

- [x] Login/bootstrap/logout và role gate: WEB-005.
- [x] Hồ sơ phương tiện: gửi, cập nhật, pending/approved/rejected + lý do, khóa khi đã duyệt.
- [x] Tên hiển thị với version conflict.
- [x] Đủ bốn loại giấy tờ theo `requiredKinds`, preview, hủy, nộp, 409 giữ lựa chọn.
- [x] Xem ảnh riêng tư bằng bearer + blob URL, thu hồi khi đóng.
- [x] Permission denied/unsupported/stale/unavailable UX cho GPS foreground.
- [x] Responsive 320/768/1440px cho `/`, `/documents`, `/profile`; control ≥ 44px, label cho input.
- [x] Unit (`driver-policy.test.ts`) + Playwright (`tests/web-e2e/driver.spec.ts`) với API mock.
- [ ] Contract E2E tự động với `/auth/web/*` server thật trong CI. Backend đã có
  ([web auth server](web-auth-server.md)) và đã smoke thủ công local; còn thiếu job CI có DB.
- [x] Availability/presence, offer, nhận đơn, cập nhật trạng thái giao: WEB-009 lát 1
  ([WEB-009](web-009-orders-dispatch.md)). Bản đồ dẫn đường cho tài xế chưa có.
- [ ] Tracking production + reconnect/snapshot — phụ thuộc evidence thiết bị thật WEB-002 và PO.
- [ ] QA Safari iOS/Chrome Android thật cho file picker và camera capture.

## Thay đổi dùng chung

- `packages/ui`: `.sg-field` và input co theo container (`width: 100%`, `min-width: 0`) để không
  tràn ngang ở 320px. Sửa đồng thời lỗi tràn của màn Customer `/addresses`.

WEB-007 lát này không cho phép xóa `apps/driver`, `packages/mobile-ui` hoặc bước Expo export trong
CI. Deprecation vẫn thuộc WEB-011 sau parity gate.
