# Giấy tờ tài xế riêng tư — SG-010 / SG-011

## Chính sách thử nghiệm đã được chủ dự án chọn

Tài xế phải nộp **CCCD mặt trước, CCCD mặt sau, GPLX và đăng ký xe**. Đây là cấu hình nghiệp vụ pilot, không phải kết luận pháp lý hoặc quy trình KYC đã được kiểm định.

- Chỉ nhận ảnh JPEG/PNG, tối đa 5 MiB/file; không nhận PDF/SVG/HTML.
- Server đối chiếu MIME và chữ ký file, decode ảnh (tối đa 20 triệu pixel, tối thiểu 32×32), xuất lại JPEG bỏ metadata nguồn, kiểm tra lại giới hạn 5 MiB.
- Tài xế chỉ nộp/thay ảnh khi hồ sơ chưa approved. Thay ảnh đưa hồ sơ về pending và tạo revision mới.
- Mọi upload cần expectedUpdatedAt hiện hành; upload/duyệt dùng cùng khóa row driver_profiles và timestamp tăng đơn điệu ít nhất 1 ms để tránh ghi đè đồng thời.
- Admin/dispatcher phải mở đủ bốn ảnh **của revision hiện tại** trước khi duyệt. Acknowledgement chỉ áp dụng cho chính người đã mở; thay giấy tờ hoặc phương tiện làm mất hiệu lực lượt xem trước đó.
- Thiếu tài liệu, thiếu lượt xem hoặc revision cũ đều bị server từ chối approval, không chỉ khóa nút ở UI.

`DRIVER_REQUIRED_DOCUMENTS` có thể đổi ở server sang tập con hợp lệ trong tương lai; mặc định vẫn giữ bốn loại đã xác nhận. Một thay đổi chính sách cần được đội vận hành review.

## Storage local private

```dotenv
PRIVATE_DOCUMENTS_DIR=.private-documents
DRIVER_REQUIRED_DOCUMENTS=identity_front,identity_back,driver_license,vehicle_registration
```

Đường dẫn tương đối tính từ working directory API (npm workspace mặc định apps/api). Không mount thư mục này vào static/public route hoặc commit lên Git. Vite dev cũng chặn mẫu **/.private-documents/**. Nếu đặt tên/thư mục khác, người vận hành phải bảo đảm nó nằm ngoài mọi web root và cấu hình truy cập phù hợp.

File có storage key UUID ngẫu nhiên riêng, không dùng tên nguồn; API không trả storage key, đường dẫn, hash hay tên file gốc. Unix tạo directory 0700/file 0600; Windows cần quyền NTFS phù hợp. Chưa có mã hóa ứng dụng, object storage, antivirus riêng hoặc bảo đảm production.

Sau khi file ghi xong, metadata/hash và audit được commit trong transaction. Storage lỗi thì rollback hồ sơ; lỗi transaction được kiểm tra lại tham chiếu DB trước khi xóa file mới để tránh xóa nhầm sau một COMMIT có kết quả không rõ. Nếu DB không kiểm tra được thì giữ file cho đối soát; tiến trình chết đột ngột có thể để lại orphan.

Ảnh superseded không còn đọc qua API nhưng file/bản ghi được giữ lại; chưa tự xóa do retention chưa được chốt. Cần thiết kế backup/restore đồng bộ DB và file, retention, đối soát orphan và volume dùng chung/object storage trước khi mở production hoặc chạy nhiều API instance.

## API

Prefix `/api/v1`, Bearer token bắt buộc:

| Endpoint                          | Quyền / hành vi                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| GET /drivers/me/documents         | Driver; trả items hiện tại, profile, requiredKinds và viewedIds rỗng                   |
| POST /drivers/me/documents        | Driver; multipart gồm kind, expectedUpdatedAt và file; trả document + profile mới      |
| GET /admin/drivers/:id/documents  | Admin/dispatcher; snapshot profile + ảnh hiện hành + ID đã xem trong revision hiện tại |
| GET /driver-documents/:id/content | Driver sở hữu hoặc Admin/dispatcher; nội dung JPEG riêng tư                            |

Content trả `Cache-Control: private, no-store`, `nosniff`, tên tải xuống theo loại giấy tờ. Không tạo URL public hoặc đặt token lên URL. Mỗi lần đọc thành công được audit theo documentId/kind/profile revision, không ghi nội dung ảnh.

- 400: file/body không hợp lệ; 401: thiếu/thu hồi phiên; 403: sai vai trò upload/list.
- 404: content không tồn tại, superseded hoặc không có quyền (không tiết lộ file của người khác).
- 409: revision cũ, chưa có hồ sơ phương tiện, hồ sơ đã duyệt, thiếu ảnh/lượt xem khi approval.
- 413: file upload vượt giới hạn; 429: quota/capacity; 503: storage hoặc hash integrity lỗi.
- Quota: tối đa 20 lần upload/user/giờ và 60 lần đọc content/user/phút; upload đang xử lý tối đa 2/request pipeline mỗi API process, gồm giai đoạn nhận multipart/chuẩn hóa.

## Giao diện

App Tài xế: gửi hồ sơ phương tiện → chọn ảnh từ file picker → kiểm tra preview → bấm Nộp ảnh. Ảnh lỗi/409 giữ lựa chọn để người dùng tải lại hồ sơ và thử lại. Có nút hủy ảnh đã chọn; bản copy trong cache được xóa sau thành công/hủy/thay chọn/unmount. Chỉ xóa URI nằm trong cache của app, không xóa file gốc người dùng. Ảnh mở từ API chỉ giữ trong bộ nhớ, đóng khi app vào nền; native device QA vẫn cần thực hiện.

Web Admin: Xem xét hồ sơ → mở từng ảnh → Duyệt hồ sơ. Binary được lấy bằng API có token rồi tạo blob URL trong bộ nhớ; thu hồi URL khi đóng/chuyển màn. Không bấm duyệt được nếu chưa mở đủ ảnh hiện hành; server kiểm tra lại nên client không thể bỏ qua bằng cách sửa nút.

## Migration và kiểm thử

Admin có thể dùng `POST /api/v1/admin/drivers/:id/reopen` với reason và expectedUpdatedAt để chuyển approved thành pending. UI: lọc Đã duyệt → Mở lại hồ sơ → nhập lý do. Thao tác có version/audit, tắt availability và vô hiệu lượt xem cũ; dispatcher không được mở lại. Luồng này cho phép tài xế được duyệt trước migration bổ sung giấy tờ mà không sửa trực tiếp DB.

Chạy `npm run db:migrate` trước khi nâng API. Migration 003 thêm driver_documents và unique partial index cho mỗi loại ảnh hiện hành; readiness yêu cầu migration này. Không xóa dữ liệu driver cũ; driver pending cần nộp đủ ảnh mới được duyệt. Driver approved trước migration chưa bị tự thu hồi phê duyệt; cần vận hành rà soát trước mở dịch vụ thật.

Test dùng ảnh tổng hợp và thư mục tạm riêng, không tài liệu thật: MIME giả, ảnh hỏng/quá cỡ, EXIF, RBAC, revoked account, superseded ID, cập nhật đồng thời, rollback storage, hash bị sửa và hiệu lực lượt xem theo revision. Test UI kiểm tra khóa approval và vòng đời blob URL. CI kiểm tra bundle Android; chưa thay thế native build/thiết bị.

Nguồn tham khảo: [Nest file upload](https://docs.nestjs.com/techniques/file-upload), [sharp constructor](https://sharp.pixelplumbing.com/api-constructor/), [Expo DocumentPicker](https://docs.expo.dev/versions/v55.0.0/sdk/document-picker/).
