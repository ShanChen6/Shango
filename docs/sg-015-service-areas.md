# SG-015 — Vùng phục vụ dạng polygon (PostGIS)

- Ngày: 2026-11-21
- Trạng thái: **có code, chờ PO duyệt hình dạng vùng thật**. Vùng mặc định `hanoi-pilot` chỉ là
  khung chữ nhật tạm (giống khung tìm kiếm cũ), nên hành vi báo giá chưa đổi cho tới khi Admin lưu
  polygon đã được PO duyệt.

## Mô hình

| Thành phần                             | Ghi chú                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Migration `006_service_areas.sql`      | `service_areas` (`geometry(MultiPolygon,4326)`, GIST, `CHECK ST_IsValid`), `service_area_versions` lưu mọi phiên bản |
| Kiểm tra                               | `ST_Covers` trên geometry phẳng lng/lat, biên tính là bên trong. Điểm phải nằm trong **ít nhất một** vùng đang bật   |
| Báo giá `POST /orders/quote`           | 422 "Điểm lấy hàng/Điểm giao hàng nằm ngoài vùng phục vụ" (chỉ rõ điểm nào)                                          |
| Tạo đơn `POST /orders`                 | Kiểm tra lại trong transaction: nếu vùng bị thu hẹp sau khi báo giá, đơn bị từ chối 422                              |
| Khung tìm kiếm Hà Nội (`HANOI_REGION`) | Giữ nguyên cho geocoding và giới hạn bản đồ. Polygon phải nằm trong khung này                                        |

Dùng geometry thay vì geography để cạnh polygon khớp với đường vẽ trên bản đồ (geography nối cạnh
theo đường tròn lớn, lệch khỏi đường vĩ tuyến ở cạnh dài).

## API Admin

| Endpoint                                | Vai trò          | Ghi chú                                                                                         |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| `GET /admin/service-areas`              | admin/dispatcher | GeoJSON, diện tích km², số đỉnh, phiên bản                                                      |
| `GET /admin/service-areas/:id/versions` | admin/dispatcher | 50 phiên bản gần nhất                                                                           |
| `PUT /admin/service-areas/:id`          | admin            | `{name, active, geometry, expectedVersion}`; audit `service_area.updated`; 409 khi lệch version |

Kiểm tra khi lưu: vòng khép kín, tối đa 2000 đỉnh, mọi đỉnh trong khung Hà Nội (400); PostGIS
`ST_IsValid` với lý do cụ thể, ví dụ tự cắt (422); diện tích bằng 0 (422); không được tắt vùng đang bật
cuối cùng (409). Audit chỉ ghi metadata nhỏ (version, số đỉnh, bật/tắt). Hình dạng cũ nằm trong
`service_area_versions`.

## Admin web

Mục **Vùng phục vụ** (`/service-areas`): thông tin vùng, bản đồ xem trước (vùng đang lưu tô xanh lá,
bản nháp viền nét đứt), lịch sử phiên bản. Quản trị viên dán GeoJSON Polygon/MultiPolygon (nhận cả
Feature hoặc FeatureCollection một phần tử), đổi tên, bật/tắt, rồi lưu. Điều phối viên chỉ xem.

## Customer web

`GET /maps/service-areas` (mọi vai trò đã đăng nhập) trả các vùng đang bật. Trang chọn địa chỉ vẽ vùng
viền xanh nét đứt trên bản đồ, chặn chọn điểm ngoài vùng (bấm bản đồ, nhập tọa độ, xác nhận điểm) và
làm mờ kết quả tìm kiếm ngoài vùng kèm nhãn "Ngoài vùng phục vụ". Kiểm tra phía trình duyệt
(ray casting, biên tính là bên trong) **chỉ là gợi ý**: nếu không tải được vùng thì không chặn, và API
vẫn kiểm tra lại bằng PostGIS ở báo giá và tạo đơn.

## Khôi phục phiên bản cũ

Chưa có nút khôi phục. Lấy GeoJSON của phiên bản cũ bằng SQL rồi dán lại trong Admin (tạo phiên bản
mới, có audit):

```sql
SELECT ST_AsGeoJSON(area, 6) FROM service_area_versions WHERE area_id = '<id>' AND version = <n>;
```

## Kiểm thử

- Unit: policy (vòng khép kín, loại hình học, ngoài khung, giới hạn đỉnh); parser GeoJSON và trang
  Admin (chỉ xem, xem trước, lưu, lỗi máy chủ, hoàn tác).
- Integration (PostGIS thật): quyền, 409 version, 422 tự cắt, 400 ngoài khung và vòng hở, chặn tắt
  vùng cuối, báo giá ngoài polygon nhưng trong khung bị 422, thu hẹp vùng sau báo giá chặn tạo đơn,
  lịch sử phiên bản và audit. Test tự khôi phục vùng ban đầu.
- E2E mock: khách thấy vùng và bị chặn chọn điểm ngoài vùng; Admin lưu polygon, Điều phối viên chỉ xem, không tràn ngang 320–1440px, axe a11y.

## Cần PO

- Ranh giới vùng phục vụ thật (quận/huyện nào, có tách nội/ngoại thành để tính giá không).
- Có cần nhiều vùng với bảng giá riêng không; hiện mọi vùng đang bật dùng chung bảng giá.
