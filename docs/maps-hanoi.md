# Bản đồ Hà Nội — SG-005 / SG-013

## Phạm vi đã triển khai

- Backend: adapter Nominatim search/reverse và OSRM route, xác thực phiên, validation input/output, timeout và giới hạn kích thước response.
- Khung khám phá: west=105.3, south=20.55, east=106.05, north=21.4; tâm 105.8342/21.0278.
- Đây là rectangle thử nghiệm, không phải ranh giới hành chính hoặc geofence dịch vụ được duyệt. SG-015 sẽ dùng polygon PostGIS và quyết định của vận hành.
- Admin: tab Bản đồ Hà Nội, tìm khi submit, chọn lấy/giao bằng kết quả/tọa độ/click, reverse geocoding, hiển thị tuyến và ETA khi OSRM sẵn sàng.
- Tái sử dụng Button/Input/Card của design system, có loading/empty/error và thao tác bằng bàn phím.
- Shared contracts/API client dùng được cho Mobile; chưa tích hợp native map hoặc kiểm chứng thiết bị Android/iOS.

## Chạy local

Sau khi cài dependencies, giữ PostgreSQL/Redis chạy và khởi động API như README. Mặc định provider chưa cấu hình; API trả 503 cho chức năng cần provider, UI khóa nút tương ứng. Không có dữ liệu địa chỉ hoặc tuyến giả trong luồng thật.

Đặt trong `apps/api/.env`:

```dotenv
NOMINATIM_BASE_URL=http://127.0.0.1:8088
OSRM_BASE_URL=http://127.0.0.1:5000
NOMINATIM_USER_AGENT=ShanGo/0.1 (+https://github.com/ShanChen6/Shango)
```

Các URL trên minh họa dịch vụ tự vận hành; repo chưa tự tải/import dữ liệu OSM hoặc khởi động những dịch vụ đó. Cần chuẩn bị dữ liệu đủ rộng quanh Hà Nội, profile phương tiện và kiểm tra đường cấm/hẻm trước khi dùng báo giá.

Nếu chỉ thử tìm kiếm thủ công ở local và chấp nhận điều khoản dịch vụ công cộng:

```dotenv
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_PUBLIC_OPT_IN=true
```

Không gõ để autocomplete; chỉ gửi khi người dùng submit. Gateway có cache 1 giờ, nhận dạng User-Agent và Redis admission dùng chung: tối đa một request geocoding đang chạy và khoảng cách ít nhất 1,2 giây giữa các request mới. Tất cả instance của cùng ứng dụng phải dùng chung Redis/namespace; không tạo các Redis độc lập để vượt giới hạn. Không bật môi trường OTP dev ra Internet.

Nền tile cấu hình riêng trong `apps/admin/.env`:

```dotenv
VITE_MAP_TILE_URL=https://your-authorized-provider/{z}/{x}/{y}.png
VITE_MAP_TILE_ATTRIBUTION=Attribution theo yêu cầu nhà cung cấp
```

Không có cả URL và attribution thì không tải tile bên ngoài; vẫn có thể kiểm tra tọa độ và vector trên nền trống. Chỉ dùng nguồn tile có điều khoản phù hợp. Attribution là cấu hình tin cậy của người vận hành, không nhận từ request người dùng. Vite cần khởi động lại sau khi đổi `.env`.

Đăng nhập Admin rồi chọn **Bản đồ Hà Nội**. Endpoint cấu hình không trả URL nội bộ hoặc secret.

## API

Tất cả endpoint yêu cầu Bearer session:

| Endpoint                 | Input                                        | Output                                                     |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| GET /api/v1/maps/config  | Không                                        | Khung Hà Nội, trạng thái cấu hình, attribution, chế độ tìm |
| GET /api/v1/maps/search  | q: 3–160 ký tự                               | Tối đa 5 địa chỉ với position lng/lat; lọc ngoài khung     |
| GET /api/v1/maps/reverse | longitude, latitude                          | Địa chỉ gần nhất và requestedPosition riêng                |
| GET /api/v1/maps/route   | pickupLng, pickupLat, dropoffLng, dropoffLat | distanceMeters, durationSeconds, GeoJSON LineString        |

- Reverse không tự dời pin về tọa độ của địa chỉ gần nhất.
- 400: input sai/ngoài khung; 401: phiên thiếu/hết hạn; 404: không có địa chỉ/tuyến; 429: quota/bận; 502: upstream lỗi hoặc payload sai; 503: chưa cấu hình.
- Quota 30 yêu cầu/phút/user cho search/reverse/route, áp dụng cả cache hit để hạn chế spam.
- Route cache 60 giây; kết quả giữ metadata driving/motorcycleValidated=false. Không tự fallback đường thẳng hoặc tạo giá.
- API không nhận URL nhà cung cấp từ client; URL chỉ cấu hình ở server. Không theo redirect của provider.
- Query không được ghi vào log, cache key là SHA-256; payload địa chỉ trong Redis có TTL. Chính sách retention trước production còn phải chốt.

## Nghiệm thu tiếp theo

Đã smoke test một truy vấn địa danh thật **Hồ Hoàn Kiếm** qua adapter Nominatim công cộng ngày 28/10/2026: nhận được kết quả trong Hà Nội với tọa độ 105.8525357/21.0288313. Đây chỉ là một điểm kiểm chứng, chưa đại diện chất lượng địa chỉ toàn thành phố và không chứng minh routing hoạt động.

1. Provision OSRM/Nominatim hoặc chốt nhà cung cấp đủ điều kiện; chưa có bằng chứng chạy self-host với graph Hà Nội.
2. Chốt tile provider; đo chất lượng tìm kiếm bằng bộ địa chỉ thực tế và ghi nhận địa chỉ không tìm thấy.
3. Spike native renderer Android/iOS. Nếu không dùng SDK Google trên Android, đánh giá MapLibre trên development build.
4. Kiểm chứng tuyến xe máy, hẻm và đường cấm; hiện chỉ có adapter theo profile driving.
5. Chốt polygon phục vụ rồi báo giá/đặt đơn; không coi rectangle khám phá là điều kiện cho phép cung cấp dịch vụ.

## Nguồn đối chiếu

- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): hạn mức công cộng, nhận dạng, cache và cấm autocomplete.
- [Nominatim Search](https://nominatim.org/release-docs/latest/api/Search/): viewbox, bounded, countrycodes và jsonv2.
- [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/): thứ tự lng/lat, routing profile và GeoJSON.
- [Leaflet reference](https://leafletjs.com/reference.html): tile, attribution, polyline và lifecycle map.
