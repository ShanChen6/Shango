# WEB-006 — Customer web parity

- Ngày bắt đầu: 2026-11-20
- Base: WEB-005 web foundation (stacked khi PR nền tảng chưa merge)
- Trạng thái: code parity đang review; Expo Customer vẫn được giữ

## Phạm vi triển khai

- OTP/session/logout dùng web auth adapter từ WEB-005.
- Hồ sơ tên hiển thị với `expectedVersion`; conflict 409 yêu cầu tải bản authoritative.
- Chọn pickup/dropoff bằng tìm kiếm submit-only, click bản đồ hoặc nhập tọa độ.
- Reverse geocode chỉ khi người dùng bấm nút; provider lỗi vẫn cho nhập địa chỉ thủ công.
- Mỗi điểm cần tọa độ Hà Nội, địa chỉ và contact hợp lệ, rồi xác nhận riêng.
- Sửa pin/địa chỉ/contact làm mất xác nhận; draft chỉ nằm trong React memory.
- Route chỉ gọi khi provider được cấu hình. Attribution luôn hiện; không vẽ tuyến giả.
- Quote/tạo đơn/danh sách/tracking bị khóa và ghi rõ dependency WEB-009.

## Parity checklist

- [x] Login/bootstrap/logout và role gate: WEB-005 unit + E2E.
- [x] Profile load/update/version-conflict UX.
- [x] Search/reverse/manual coordinate/manual address fallback.
- [x] Pickup/dropoff validation và explicit confirmation.
- [x] Provider/offline/error copy không làm mất draft đang nhập.
- [x] Responsive Task-first + Map-first screen ở 320px, 768px và 1440px.
- [x] Native keyboard controls, labels, 44px controls, attribution và text alternative cho map.
- [x] Unit + Playwright evidence với API mock.
- [ ] Contract E2E với `/auth/web/*` server thật — phụ thuộc additive backend slice.
- [ ] Quote/order/list/detail/tracking — phụ thuộc WEB-009.

WEB-006 không phải lý do để xóa `apps/customer`, `packages/mobile-ui` hoặc Expo CI. Parity
chỉ hoàn tất đầy đủ sau backend contract/staging evidence; deprecation vẫn thuộc WEB-011.
