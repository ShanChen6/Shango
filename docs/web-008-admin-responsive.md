# WEB-008 — Responsive Admin

- Ngày: 2026-11-21
- Trạng thái: **lát 1 có code + test** (route, phân quyền theo vai trò, list-detail responsive,
  conflict/offline). Admin vẫn dùng chung bộ token Tailwind `shango-theme` hiện có; chưa gộp vào
  `packages/ui` (xem phần còn mở).

## Thay đổi

| Hạng mục        | Trước                                   | Sau                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Điều hướng      | `useState` view, F5 về trang đầu        | React Router: `/drivers`, `/drivers/:id`, `/orders`, `/maps`, `/audit`; reload giữ trang; `/` về trang mặc định của vai trò; route lạ hiện "Không tìm thấy"                                                                                |
| Bộ lọc hồ sơ    | Trong state                             | Trên URL `?status=&page=`, chia sẻ/khôi phục được                                                                                                                                                                                          |
| Phân quyền      | Ẩn nút Nhật ký với dispatcher           | Bảng `lib/navigation.ts` theo vai trò: admin (4 mục), dispatcher (không có Nhật ký), accountant (màn hình "chưa có chức năng"). Mở thẳng URL không đúng quyền hiện "Không có quyền" và **không gọi API**. Server vẫn kiểm tra mọi endpoint |
| Danh sách hồ sơ | Bảng tràn ngang trên mobile             | Dạng hàng/thẻ: 4 cột ở ≥ 768px, xếp chồng ở mobile                                                                                                                                                                                         |
| Xem xét hồ sơ   | Thẻ dưới danh sách                      | List-detail: desktop ≥ 1200px chia đôi; nhỏ hơn thì chi tiết thay danh sách, có link "← Danh sách hồ sơ"                                                                                                                                   |
| Conflict        | Hiện message server tiếng Anh, đóng thẻ | 409 → báo "Hồ sơ vừa thay đổi", tải lại giấy tờ/revision mới, **giữ lý do đang nhập**, phải xem lại ảnh của revision mới mới duyệt được                                                                                                    |
| Lỗi             | `e.message`                             | Thông điệp tiếng Việt theo 401/403/429/mạng, không làm mất lựa chọn và lý do                                                                                                                                                               |
| Offline         | Không xử lý                             | Banner "Mất kết nối mạng"; khóa Duyệt/Từ chối/Mở lại/Hủy đơn; vẫn xem được dữ liệu đã tải                                                                                                                                                  |
| Mobile shell    | Menu bị ẩn (WEB-009 sửa tạm)            | Menu ngang tự xuống dòng ≤ 1024px; `aria-current` cho mục hiện tại                                                                                                                                                                         |
| A11y            | —                                       | Skip link "Bỏ qua điều hướng", `main` nhận focus, nút/link ≥ 44px, focus ring rõ, `document.title` theo trang                                                                                                                              |

`main.tsx` chỉ còn khởi tạo API (legacy bearer hoặc cookie auth theo `VITE_WEB_AUTH_ENABLED`);
giao diện nằm trong `admin-app.tsx`. Cả hai transport dùng cùng một giao diện.

## Điều phối ngoại lệ (bổ sung 2026-11-21)

Tab Đơn hàng có đếm và lọc **"Chỉ hiện ngoại lệ"** (`lib/dispatch.ts`, có unit test):

- Đơn `SEARCHING` quá 2 phút, hoặc còn ≤ 60 giây trước khi hết hạn tìm.
- Đơn đang chạy mà GPS tài xế cũ ≥ 60 giây hoặc chưa có GPS. Chỉ cảnh báo để điều phối viên liên hệ;
  **không** tự hủy hay gán lại.

Ngưỡng là giả thuyết vận hành (WEB-002), chưa phải chính sách PO. Bộ lọc chạy trên 100 đơn gần nhất
mà API trả về.

## Kiểm thử

- Unit: `src/lib/navigation.test.ts` (vai trò → mục, deep link, đọc status lỗi). Vitest Admin
  giờ chạy cả file `.test.ts` (trước chỉ `.test.tsx`).
- Playwright `tests/web-e2e/admin.spec.ts` (API mock, bản build cookie auth):
  - Deep link + reload, `aria-current`, `/` → `/drivers`, route lạ, bộ lọc từ URL.
  - Dispatcher mở `/audit` → "Không có quyền", không có request audit; accountant → màn hình riêng.
  - Duyệt chỉ bật sau khi mở đủ 4 ảnh (blob URL); request gửi `expectedUpdatedAt` hiện hành.
  - 409 → tải revision mới, giữ lý do, nút Duyệt khóa lại; lần gửi sau dùng revision mới.
  - Offline khóa quyết định, online mở lại.
  - Không tràn ngang ở 320/390/768/1024/1440px cho cả 5 route; list-detail ở mobile và desktop.
  - Bàn phím: Tab đầu tiên vào skip link, Enter chuyển focus vào nội dung.
- Mutation check: bỏ guard phân quyền hoặc bỏ khóa offline đều làm test fail.

## Còn mở

- Gộp style Admin (Tailwind `shango-theme` + `style.css`) với `packages/ui` thành một bộ token
  chung; hiện hai bộ màu gần nhau nhưng tách biệt.
- Màn hình kế toán/đối soát (cần PO chốt ledger).
- Điều phối nâng cao: bản đồ đơn/tài xế trực tiếp, gán tay, lọc ngoại lệ (GPS cũ, đơn tìm lâu).
- Bảng Nhật ký và Bản đồ chỉ được kiểm tra không tràn ngang; chưa thiết kế lại riêng cho mobile.
- Screen reader smoke thủ công và zoom 200% trên trình duyệt thật.
