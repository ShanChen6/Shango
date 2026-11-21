# WEB-005 — Web foundation và CI/E2E

- Ngày bắt đầu: 2026-11-20
- Trạng thái: triển khai foundation song song; chưa thay thế Expo
- Phụ thuộc: ADR-002 và quyết định UX WEB-004

## Phạm vi

- `apps/customer-web`: React/Vite shell Task-first, route `/`, `/addresses`, `/profile`.
- `apps/driver-web`: React/Vite shell Task-first, route `/`, `/offers`, `/documents`, `/profile` (nội dung Driver thuộc [WEB-007](web-007-driver-parity.md)).
- `apps/admin`: bổ sung Router/Query provider và web auth canary qua
  `VITE_WEB_AUTH_ENABLED=true`; false quay lại legacy transport. Timeline migration thuộc WEB-008.
- `packages/ui`: semantic tokens và accessible primitives không chứa nghiệp vụ.
- `packages/api-client`: web auth adapter với credential cookie, CSRF, access token memory,
  role gate và refresh single-flight. Endpoint server `/auth/web/*` đã có, mặc định tắt
  ([web auth server](web-auth-server.md)); legacy bearer/Expo transport không đổi.
- Playwright baseline kiểm tra login boundary ở mobile/desktop cho cả ba web app.

## Guardrails

- Không ghi access/refresh/CSRF token vào web storage.
- Wrong-role clear memory/query cache trước protected content.
- Không tự retry mutation nghiệp vụ; request chỉ retry một lần sau auth 401.
- Admin chỉ opt-in replay sau auth-guard 401 cho mutation có `expectedVersion`/
  `expectedUpdatedAt`; upload và mutation không có concurrency key yêu cầu người dùng retry.
- Customer/Driver web dùng workspace tạm để giữ parity/rollback. Không xóa `apps/customer`,
  `apps/driver`, `packages/mobile-ui` hoặc hai bước Expo export trong CI.
- Driver shell không bật availability/tracking production và không cam kết GPS nền.

## Chạy local

```bash
npm run dev:customer-web
npm run dev:driver-web
npm run dev:admin
```

CI chạy typecheck, unit, build, Playwright và vẫn chạy migration/integration/Expo bundle ở
job foundation hiện hữu.
