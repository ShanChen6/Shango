# Nhánh và review

## Đã xác minh trên GitHub ngày 28/10/2026

- `main` được khởi tạo tại baseline README `5632561b391c8545ee286c9425b7f7468297784f` sau khi chủ repo cho phép riêng.
- Code ứng dụng nằm trên `develop`; chưa merge sang `main`.
- Branch protection `main` đã bật và đọc lại qua GitHub API: yêu cầu 1 approval, dismiss stale reviews, approval cho lần push cuối, resolve conversations và status check `foundation-checks` với strict=true.
- Enforcement áp dụng cả Admin; force push và xóa nhánh không được phép.
- Đây là trạng thái tại thời điểm xác minh; phải kiểm tra lại settings nếu có thay đổi quyền/quy trình.

- `develop`: nhánh làm việc và nhận cập nhật mới theo yêu cầu chủ repo.
- `main`: chỉ nhận thay đổi qua Pull Request đã review. Không direct push implementation, force push hoặc auto-merge.
- Foundation được triển khai trên `develop`. Không tạo một main chứa foundation rồi coi đó là merge đã review.
- Repo ban đầu rỗng; `main` cần được khởi tạo bằng baseline được chủ repo cho phép riêng. Trạng thái remote thực tế phải kiểm tra trước khi nói đã thiết lập xong.

## Bảo vệ main cần cấu hình tại GitHub

GitHub Settings → Rules → Rulesets hoặc Branch protection:

1. Target `main`; yêu cầu Pull Request trước merge.
2. Ít nhất 1 approval độc lập, dismiss stale approvals và yêu cầu resolve conversations.
3. Required status check `foundation-checks` sau khi workflow đã chạy lần đầu.
4. Chặn force push và xóa nhánh; hạn chế bypass theo quyền tổ chức/repo.
5. Chủ repo thêm reviewer thật vào CODEOWNERS khi xác nhận được tài khoản.

File này và PR template chỉ ghi quy trình; chúng không tự bật branch protection trên GitHub. Không tự nhận workflow đã được cưỡng chế nếu chưa kiểm chứng settings.

## Quy trình phát hành

Push develop → CI → PR develop → main → reviewer xem code/migration/quyền → sửa trên develop → CI lại → reviewer chấp thuận → người được phép merge. Bản foundation chưa sẵn sàng production.
