# WEB-002 — Browser evidence: Active Tracking + Connection Recovery

- Trạng thái: **Harness hoàn tất; evidence thiết bị thật đang chờ thực thi**
- Prototype: `prototypes/web-002-tracking`
- Giả thuyết: GPS mục tiêu 5–10s khi foreground; stale ≥30s; unavailable ≥60s.

## Điều kiện nghiệm thu

WEB-002 chỉ được đánh dấu hoàn tất khi có kết quả Safari iOS và Chrome Android trên
thiết bị thật. Desktop/devtools chỉ smoke-test harness. Kết quả phải phân biệt rõ:

- Socket connected với vị trí fresh; hai trạng thái không tương đương.
- Driver rảnh: loại khỏi matching khi stale/unavailable; chỉ trở lại sau fix hợp lệ và
  availability hợp lệ.
- Driver đã nhận đơn: không tự hủy đơn khi mất GPS; hiển thị last-known + age + trạng
  thái kết nối, rồi áp dụng SOP liên hệ/escalation được PO duyệt.
- Reconnect: nhận snapshot authoritative trước, resubscribe và gửi fix mới; không replay
  mù quáng lệnh nghiệp vụ.

## Cách đo bằng app Driver (`/gps-lab`, bổ sung 2026-11-21)

Không cần chạy prototype riêng: mở app Driver trên điện thoại qua **HTTPS** (staging, hoặc máy dev
có chứng chỉ được thiết bị tin cậy), đăng nhập tài khoản tài xế thử nghiệm, vào **Trang chủ →
Công cụ đo GPS cho tester (WEB-002)**.

1. Nhập tên thiết bị và ghi chú (chế độ pin, mạng, ngoài trời/trong nhà); trang tự nhận diện OS/browser.
2. Chọn kịch bản, làm theo hướng dẫn hiện trên trang, bấm **Bắt đầu đo** rồi **Dừng đo**.
3. Bấm **Sao chép dòng** và thay dòng "Chưa chạy" tương ứng trong bảng dưới. Có thể **Tải JSON** để
   lưu nội bộ; file chỉ chứa thời điểm, sai số và sự kiện, **không có tọa độ**.

Công cụ không gửi gì lên server và không bật trạng thái sẵn sàng. Cột "Reconnect" đo từ lúc có mạng
lại đến khi socket kết nối lại (khi đó app tải lại snapshot).

**Rủi ro cần đo, ghi nhận 2026-11-21:** bản đầu gọi `getCurrentPosition` mỗi 10 giây để tài xế
đứng yên không bị coi là mất GPS. Với geolocation giả lập của Chromium, các lời gọi này **treo khi
tọa độ không đổi**. Đã đổi sang: quá 12 giây không có fix (kiểm tra mỗi 4 giây) thì **khởi động lại
`watchPosition`** (`maximumAge: 0`), để nền tảng trả một fix thật mới; không bao giờ tự tạo vị trí.
E2E "stationary driver GPS" kiểm chứng điều này trên Chromium, có mutation check. Trên thiết bị thật
vẫn phải đo: kịch bản "Foreground 15 phút" nên có một đoạn đứng yên. Nếu "Interval max" vượt 30 giây
khi đứng yên, hoặc pin tụt bất thường do restart, cần điều chỉnh trước pilot.

## Ma trận evidence

Điền một dòng cho mỗi scenario/thiết bị. Không ghi “pass” nếu thiếu evidence đã khử tọa
độ. Không commit raw log, latitude/longitude thật hoặc địa chỉ test cá nhân.

| Thiết bị | OS | Browser/version | Scenario | Thời lượng | Interval median/max | Accuracy median/max | Gap background/lock | Reconnect + snapshot | Battery trước/sau | Sanitized evidence / ghi chú |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| Chờ | iOS | Safari | Foreground 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | iOS | Safari | Background 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | iOS | Safari | Lock 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | iOS | Safari | Offline 45 giây | — | — | — | — | — | — | Chưa chạy |
| Chờ | iOS | Safari | Permission denied | — | — | — | — | — | — | Chưa chạy |
| Chờ | iOS | Safari | Foreground 15 phút / battery | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Foreground 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Background 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Lock 2 phút | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Offline 45 giây | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Permission denied | — | — | — | — | — | — | Chưa chạy |
| Chờ | Android | Chrome | Foreground 15 phút / battery | — | — | — | — | — | — | Chưa chạy |

## Smoke test harness — không thay thế thiết bị thật

Ngày 2026-10-28, harness đã được kiểm tra trên localhost:

- Static page và Socket.IO client được phục vụ thành công; Chrome headless tải trang với
  exit code 0.
- Client A gửi sample Hà Nội sequence `1`, server accept; Client B reconnect cùng
  driver id, resume room và nhận snapshot sequence `1` với đúng tọa độ. Client B sau đó
  gửi fix mới sequence `2` và được accept, xác nhận snapshot-first recovery.
- `server.mjs` qua syntax check; repository typecheck, 54 unit/component tests và
  API/Admin build đều thành công.

Smoke test chỉ xác nhận wiring và recovery model. Nó không cung cấp evidence về nhịp
GPS, background/lock suspension, accuracy hoặc battery trên iOS/Android.

## SOP đề xuất để PO duyệt sau khi đo

1. `fresh` khi vị trí gần nhất <30s; `stale` từ 30s; `unavailable` từ 60s.
2. Driver rảnh bị loại khỏi matching từ khi stale; trở lại pool chỉ sau fix GPS hợp lệ,
   profile approved và availability vẫn bật.
3. Driver có đơn không bị hủy/tự giải phóng assignment vì GPS. Customer/Admin xem
   last-known, age và connection state; UI hướng dẫn liên hệ khi unavailable kéo dài.
4. Khi reconnect, client lấy snapshot trạng thái đơn authoritative, resubscribe room,
   sau đó gửi fix mới với sequence tăng. Server bỏ sequence trùng/cũ và sample quá hạn.
5. Nếu browser bị suspend, UI phải nói rõ giới hạn và yêu cầu mở lại trang; không dùng
   PWA/Service Worker như cam kết GPS nền.

Các ngưỡng trên là hypothesis từ ADR, chưa được phê duyệt production trước khi ma trận
thiết bị thật và escalation policy được PO review.
