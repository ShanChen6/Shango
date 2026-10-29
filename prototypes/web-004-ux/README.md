# WEB-004 responsive UX prototype

Throwaway prototype để review cấu trúc luồng, không phải production frontend và không kết
nối dữ liệu thật.

```sh
npm install
npm start
```

Mở `http://127.0.0.1:4174/?role=customer&variant=A&state=active`.

- Role: `customer`, `driver`, `admin`.
- Variant: `A` task-first, `B` map-first split, `C` timeline console.
- State chung: `active`, `loading`, `empty`, `error`, `offline`.
- Driver thêm: `stale`, `unavailable`, `permission-denied`, `reconnecting`.
- Phím ←/→ đổi variant. Thanh điều khiển chỉ hiện ở dev; production build cố ý ẩn.

Review ở 320, 360, 390, 768, 1024, 1280 và 1440px; zoom 200%, keyboard-only và
reduced-motion. Không chọn variant chỉ vì ảnh đẹp: dùng tiêu chí trong
`docs/web-004-ux-flows.md`, ghi quyết định trước khi đưa pattern vào `packages/ui`.
