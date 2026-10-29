# WEB-004 — UX flows, responsive wireframes và web design system

- Ngày: 2026-10-29
- Trạng thái: **Prototype sẵn sàng review; chưa chọn winning variant**
- Prototype: `prototypes/web-004-ux`
- Phụ thuộc: WEB-001 inventory, WEB-003 architecture/auth ADR; Driver rollout vẫn phụ
  thuộc WEB-002 device evidence.

## Câu hỏi prototype

Ở mobile, tablet và desktop, ShanGo nên ưu tiên tác vụ, bản đồ hay tiến trình như thế nào
cho mỗi vai trò mà vẫn giữ navigation riêng, trạng thái mạng/GPS rõ ràng và thao tác quan
trọng dùng được bằng keyboard/touch?

Ba variant cố ý khác cấu trúc:

| Variant | Cấu trúc | Giả thuyết phù hợp | Rủi ro cần review |
| --- | --- | --- | --- |
| A — Task-first | Hero action + bước tiếp theo + recent activity; bottom nav ở mobile | Customer tạo đơn, Driver nhận offer nhanh | Bản đồ/ngữ cảnh không gian có thể bị giấu quá sâu |
| B — Map-first split | Map chiếm ưu thế, action panel bên cạnh/overlay mobile | Address selection, live order/dispatch | Map có thể lấn át error/empty và accessibility fallback |
| C — Timeline console | Progress timeline + context panel; rail desktop | Driver delivery state, Admin exception handling | Quá dày cho Customer hoặc mobile nhỏ |

Không bắt buộc chọn một variant cho cả ba role. Dự kiến A làm shell Customer, A/C cho
Driver tùy trạng thái, B/C cho Admin map/dispatch. Review phải xác nhận bằng flow, không
chỉ dựa trên sở thích hình ảnh.

## Flow theo vai trò

### Customer

```text
Unauthenticated -> OTP -> bootstrap web session -> Home
Home -> chọn pickup -> search/reverse/pin confirm -> chọn dropoff
     -> review route/quote -> submit idempotent order -> order detail
Order detail -> searching -> assigned -> pickup -> in transit -> delivered
Offline/error -> giữ draft trong memory -> retry có chủ ý; không giả đơn đã tạo
```

MVP screen: login, home/create order, address picker, review, orders list/detail, profile.
Quote/order controls chỉ bật khi API authoritative có sẵn; map demo/provider lỗi phải có
manual address summary và retry.

### Driver

```text
Unauthenticated -> OTP -> profile/KYC gate -> Driver home
Home offline/not-approved -> remediation, không cho availability
Home approved -> permission explanation -> GPS fix -> availability on
Offer -> view facts -> accept idempotently -> authoritative snapshot
Assigned -> at pickup -> picked up -> in transit -> delivered
Connection loss -> last-known + age + reconnecting -> snapshot-first recovery
```

UI luôn tách `socket connected` và `GPS fresh`. Driver rảnh stale bị loại matching; Driver
có đơn không tự hủy. Background/lock limitation phải hiện bằng ngôn ngữ vận hành rõ ràng,
không hứa GPS nền.

### Admin

```text
Unauthenticated -> OTP existing ops account -> role gate -> Dashboard
Dashboard -> driver review | dispatch map | audit
Review -> private document view -> decision with expected version -> audit result
Dispatch -> filter exception -> inspect freshness/order -> approved intervention
Conflict/stale review -> reload authoritative entity, không ghi đè im lặng
```

Mobile Admin ưu tiên triage/approve-safe actions; bảng rộng chuyển thành cards/list-detail.
Desktop tận dụng split view, không co thành khung điện thoại.

## State matrix bắt buộc

Mỗi screen production phải chỉ rõ các state sau trước implementation:

| State | Customer | Driver | Admin |
| --- | --- | --- | --- |
| Loading | Skeleton giữ layout, không disable back | Giữ freshness cũ kèm timestamp | Giữ filter, skeleton list/detail |
| Empty | CTA tạo đơn | Không có offer/đơn; trạng thái availability rõ | Không có hồ sơ/cảnh báo trong filter |
| Error | Message + request ID + retry | Phân biệt GPS, permission, network, server | Không làm mất selection/reason khi retry an toàn |
| Offline | Không xác nhận mutation chưa gửi | Last-known + age; disable online/accept khi không authoritative | Read-only cached context có nhãn; disable review/dispatch |
| Stale/conflict | Quote/order version đổi -> review lại | Snapshot/sequence/freshness | Reload version trước decision |
| Permission denied | Map manual fallback khi phù hợp | Không bật availability; hướng dẫn settings | Không áp dụng trừ browser features cụ thể |

## Responsive behavior

- 320–767px: một cột, primary action gần thumb zone nhưng không che content; bottom nav
  tối đa 3–5 mục; map có alternative text/summary và sheet không khóa keyboard.
- 768–1023px: list-detail hoặc map-action split khi đủ chiều ngang; portrait vẫn cho phép
  stack; không hard-code theo device name.
- ≥1024px: sidebar/rail và split view; giữ line length hợp lý; bảng có sticky header khi
  cần nhưng thao tác row vẫn keyboard accessible.
- Viewport test: 320, 360, 390, 768, 1024, 1280, 1440px; portrait/landscape liên quan;
  zoom 200% không horizontal scroll cho tác vụ chính.
- Touch target tối thiểu 44×44px; focus visible; source order khớp visual order; reduced
  motion không làm mất thông tin.

## `packages/ui` proposal

WEB-004 chỉ đề xuất contract; tạo package thật ở WEB-005 sau khi variant/pattern được duyệt.

### Tokens

- Color semantic: `surface`, `surface-muted`, `text`, `text-muted`, `brand`, `danger`,
  `warning`, `success`, `focus`; không export tên màu gắn role.
- Spacing: 4/8/12/16/24/32/48; radius 8/12/18/full; shadow chỉ 2 mức.
- Typography: display/title/body/label/caption; dùng `rem`, không khóa pixel font size.
- Breakpoint là layout hint, component ưu tiên container/content constraints.

### Primitives đầu tiên

`Button`, `IconButton`, `TextField`, `Select`, `Card`, `Badge`, `InlineAlert`, `Skeleton`,
`Dialog`, `Sheet`, `Tabs`, `AppShell`, `PageHeader`, `ListDetail`, `FreshnessBadge`.

Primitives chịu trách nhiệm focus/disabled/error semantics; app chịu copy, role policy,
data fetching và navigation. `FreshnessBadge` nhận status + timestamp đã tính từ domain,
không tự suy ra “online” từ Socket.

## Review checklist và quyết định

- [ ] Customer: tạo đơn/address flow review tại mobile và desktop.
- [ ] Driver: permission, stale, unavailable, reconnect/snapshot states được hiểu đúng.
- [ ] Admin: review conflict/private document và dispatch exception dùng được mobile/desktop.
- [ ] Keyboard order, focus, labels, contrast, zoom 200%, screen-reader smoke.
- [ ] Loading/empty/error/offline không đổi layout hoặc che mất recovery action.
- [ ] Map attribution/fallback hiện diện; prototype không bị hiểu là production provider.
- [ ] Chọn winning pattern theo từng role/screen và ghi rationale.
- [ ] Chốt tokens/primitives đủ cho WEB-005, tránh đưa domain component vào shared UI.

Chỉ sau checklist review mới chuyển winning patterns vào WEB-005. Prototype còn lại được
giữ trên nhánh throwaway làm nguồn tham chiếu, không merge vào production bundle.
