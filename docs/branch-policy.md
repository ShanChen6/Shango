# Nhánh và review

## Đã xác minh trên GitHub ngày 28/10/2026

- `main` được khởi tạo tại baseline README `5632561b391c8545ee286c9425b7f7468297784f` sau khi chủ repo cho phép riêng.
- `main` là nhánh mặc định; `develop` là nhánh làm việc chính. Chủ repo đã merge PR #1 vào main và đồng bộ main về develop (commit `262e1c3`).
- Theo yêu cầu chủ repo, branch protection hiện yêu cầu **0 approval độc lập**, tắt approval cho lần push cuối; vẫn yêu cầu PR, resolve conversations và status check `foundation-checks` với strict=true. Review thực hiện trong chat, người dùng quyết định merge.
- Enforcement áp dụng cả Admin; force push và xóa nhánh không được phép.
- Đây là trạng thái tại thời điểm xác minh; phải kiểm tra lại settings nếu có thay đổi quyền/quy trình.

- `develop`: nhánh làm việc và nhận cập nhật mới theo yêu cầu chủ repo.
- `main`: chỉ nhận thay đổi qua Pull Request đã review. Không direct push implementation, force push hoặc auto-merge.
- Code mới được triển khai trên `develop`; không tự merge vào main hoặc bật lại approval độc lập.
- Repo đã có main và develop. Đọc trạng thái PR và head commit trước khi cập nhật PR; không tự mở lại PR đã đóng.

## Bảo vệ main cần cấu hình tại GitHub

GitHub Settings → Rules → Rulesets hoặc Branch protection:

1. Target `main`; yêu cầu Pull Request trước merge.
2. Approval độc lập = 0, last-push approval tắt theo yêu cầu làm việc một mình; vẫn resolve conversations và review trong chat.
3. Required status check `foundation-checks` sau khi workflow đã chạy lần đầu.
4. Chặn force push và xóa nhánh; hạn chế bypass theo quyền tổ chức/repo.
5. Chủ repo thêm reviewer thật vào CODEOWNERS khi xác nhận được tài khoản.

File này và PR template chỉ ghi quy trình; chúng không tự bật branch protection trên GitHub. Không tự nhận workflow đã được cưỡng chế nếu chưa kiểm chứng settings.

## Quy trình phát hành

Push develop → CI → PR develop → main → review code/migration/quyền trong chat → sửa trên develop → CI lại → người dùng quyết định merge. Agent không tự merge. Bản foundation chưa sẵn sàng production.
