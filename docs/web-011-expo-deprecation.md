# WEB-011 — Gỡ Expo/React Native (kế hoạch và cổng duyệt)

- Ngày: 2026-11-21
- Quyết định của chủ dự án (21/11/2026): **chuẩn bị, chưa xóa**. Trên `develop` chỉ có kế hoạch,
  script kiểm tra gate và checklist. Các thay đổi xóa nằm ở nhánh riêng
  `chore/web-011-expo-removal` kèm **PR draft** vào `develop` để review. **Không merge** cho đến khi
  mọi gate bên dưới đóng và có reviewer độc lập duyệt.
- Kiểm tra trạng thái: `npm run gate:web011` (exit 1 khi còn gate mở). Script đọc trực tiếp ma trận
  evidence WEB-002, checklist parity WEB-006/007 và mục **Gate** của file này.

## Phạm vi sẽ gỡ (trong PR riêng)

| Hạng mục  | Chi tiết                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace | `apps/customer` (Expo 55, MapLibre native), `apps/driver` (Expo 55), `packages/mobile-ui`                                                                                                                  |
| Test | `apps/api/test/customer-draft.test.ts` (kiểm thử logic draft của app Expo; thay bằng `apps/customer-web/src/delivery-draft.test.ts` + Playwright) |
| Script    | `dev:customer`, `dev:driver` trong `package.json` gốc                                                                                                                                                      |
| CI        | Hai bước `npx expo export --platform android` trong job `foundation-checks`                                                                                                                                |
| Lockfile  | Dependency chỉ phục vụ Expo/React Native (`npm install` sau khi xóa workspace)                                                                                                                             |
| Tài liệu  | README phần chạy Expo/Android; tài liệu lịch sử SG (`customer-addresses.md`, `driver-documents.md` phần app) **giữ nguyên làm lịch sử**, chỉ thêm ghi chú "đã gỡ ở WEB-011"                                |
| Không đổi | API, `packages/contracts`, `packages/api-client` (`createApi` legacy bearer vẫn dùng cho Admin khi tắt cookie auth), endpoint `/auth/otp/*`/`/auth/refresh` (legacy transport do ADR-002 quyết định riêng) |

Gỡ endpoint auth legacy và refresh token JSON **không** thuộc PR này. Việc đó cần đánh giá riêng
sau khi không còn client nào dùng.

## Gate

Mỗi mục chỉ được đánh `[x]` kèm link evidence (run CI, biên bản, PR review). Không đánh dấu thay người
có thẩm quyền.

- [ ] Staging đã deploy theo [release checklist](release-checklist.md), smoke mục C đạt; ghi ngày, SHA và người thực hiện.
- [ ] PO duyệt kết quả WEB-002 trên thiết bị thật và chấp nhận giới hạn GPS nền của web (ghi biên bản).
- [ ] Không còn tester/người dùng nào cần bản Expo; đã thông báo ngày dừng build Expo.
- [ ] Đã xác nhận không có app ShanGo nào đã phát hành trên Google Play/App Store cần gỡ hoặc thông báo.
- [ ] CI xanh trên PR gỡ Expo (gồm `web-contract-e2e`, `docker-images`, `web011-gate`).
- [ ] Reviewer độc lập (không phải tác giả PR) đã approve PR gỡ Expo.
- [ ] Đã tạo và push tag archive `expo-legacy-final` trỏ tới commit cuối cùng còn Expo trên `develop`.

Ngoài mục Gate, script còn chặn khi:

- ma trận [WEB-002](web-002-browser-evidence.md) còn dòng "Chưa chạy";
- checklist [WEB-006](web-006-customer-parity.md) hoặc [WEB-007](web-007-driver-parity.md) còn mục mở.
  Hiện còn mở: tracking production (chờ WEB-002 + PO) và QA file picker/camera trên Safari iOS và
  Chrome Android.

## Archive và rollback

1. Ngay trước khi merge, trên commit cuối còn Expo của `develop`:

   ```bash
   git tag -a expo-legacy-final -m "Last develop commit with Expo apps (WEB-011)"
   git push origin expo-legacy-final
   ```

2. Merge PR bằng merge commit (không squash) để có một commit duy nhất có thể revert.
3. Rollback toàn bộ: `git revert -m 1 <merge-commit>` trên nhánh mới, PR vào `develop`, CI xanh rồi merge.
4. Chỉ cần tham khảo hoặc khôi phục một phần:
   `git checkout expo-legacy-final -- apps/customer apps/driver packages/mobile-ui`, sau đó chạy
   `npm install` để lockfile khớp.
5. Bundle Android cuối cùng có thể dựng lại từ tag bằng `npx expo export --platform android`
   (không phải native build, không phát hành store).

## Trạng thái tại 2026-11-21

- CI `develop` xanh đủ 4 job, gồm `web-contract-e2e` ([run #33](https://github.com/ShanChen6/Shango/actions/runs/44900111922)).
- `npm run gate:web011` → **chặn**: 12 dòng WEB-002 "Chưa chạy", 2 mục parity Driver mở, 7 mục Gate mở.
- Nhánh/PR gỡ Expo: xem phần "PR gỡ Expo" trong [roadmap](roadmap-web.md); PR ở trạng thái draft và
  có job CI `web011-gate` cố ý fail cho đến khi gate đóng.
