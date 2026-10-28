# Kiến trúc ShanGo — foundation v0.1

## Quyết định hiện tại

- Modular monolith NestJS; npm workspaces; Node 24; TypeScript.
- PostgreSQL/PostGIS: dữ liệu chuẩn; SQL migrations và `pg` để kiểm soát transaction/spatial query.
- Redis: OTP/rate limit hiện tại; presence, latest-location và Socket adapter trong giai đoạn tiếp theo.
- Hai Expo/React Native app, cùng module giao diện và API client; Admin React/Vite.
- Không triển khai Kubernetes hoặc microservices trong foundation.
- Expo development build sẽ cần thiết cho tracking nền. Expo Go không phải bằng chứng tính đúng đắn GPS nền.

## Luồng đã triển khai

`OTP request → Redis challenge 180s → verify atomic → user + auth_session transaction → JWT 15m + opaque refresh 30d`.

Refresh token chỉ lưu SHA-256 trong DB và được rotate bằng UPDATE có điều kiện. AccessGuard tra DB để kiểm tra user active, phiên chưa thu hồi và vai trò hiện hành; logout thu hồi cả access đang tồn tại. Đây là đánh đổi có chủ ý ở quy mô MVP để quyền có hiệu lực tức thì.

OTP dùng provider development: trả `devCode` cho caller, không gửi SMS. Toàn bộ API bị chặn khởi động với NODE_ENV=production cho đến khi tích hợp provider thật và thay đổi safeguard có review. Tuyệt đối không công khai môi trường dev này.

OTP giới hạn 5 yêu cầu/số/giờ, cooldown 60s, tối đa 5 lần đoán/challenge và rate limit IP. Chưa cấu hình trust proxy; khi đặt sau proxy phải chốt trusted proxy để tránh spoof IP hoặc gom toàn bộ người dùng thành một IP.

Vai trò đăng ký công khai chỉ customer/driver. Một số điện thoại có một vai trò; OTP đăng nhập không thay đổi vai trò tài khoản đã tồn tại. Admin cấp bằng CLI có quyền DB và được audit; không có mật khẩu hay tài khoản quản trị mặc định.

Hồ sơ hiện tại gồm tên hiển thị có version, phương tiện, bốn ảnh giấy tờ riêng tư và trạng thái duyệt. Admin có nhật ký thao tác với phân trang cursor và lọc metadata; xem profiles-and-audit.md và driver-documents.md. Upload và review khóa cùng row; approval cần đủ ảnh và lượt xem của người duyệt trong revision hiện hành. Storage ảnh đang là filesystem private cho phát triển, chưa phải KYC được kiểm định hoặc hạ tầng production. Online chủ động bị chặn cho đến khi GPS/presence được triển khai.

## State machine đã chốt cho MVP (chưa code)

| Từ                 | Sang       | Actor              | Điều kiện                                                           |
| ------------------ | ---------- | ------------------ | ------------------------------------------------------------------- |
| SEARCHING          | ASSIGNED   | Tài xế             | Offer còn hạn, đúng tài xế, tài xế rảnh; transaction chống nhận kép |
| SEARCHING          | EXPIRED    | Worker             | Hết thời gian tìm và đơn vẫn SEARCHING                              |
| SEARCHING          | CANCELLED  | Khách/điều phối    | Đúng quyền, chưa có thay đổi trạng thái cạnh tranh                  |
| ASSIGNED           | AT_PICKUP  | Tài xế được gán    | Phiên hợp lệ, đúng version                                          |
| AT_PICKUP          | PICKED_UP  | Tài xế được gán    | Xác nhận đã nhận hàng                                               |
| PICKED_UP          | IN_TRANSIT | Tài xế được gán    | Bắt đầu giao                                                        |
| IN_TRANSIT         | DELIVERED  | Tài xế được gán    | Bằng chứng giao theo chính sách và ghi tiền idempotent              |
| ASSIGNED/AT_PICKUP | CANCELLED  | Theo chính sách PO | Cần chốt phí hủy và điều kiện tài xế hủy                            |

Sau PICKED_UP, xử lý hàng trả/giao thất bại là workflow ngoại lệ phải được PO chốt trước SG-028/031. Không tự coi hủy là cách giải phóng hàng đã nhận.

## Realtime dự kiến

- Handshake JWT; room `user:{id}`, `driver:{id}`, `order:{id}` do server cấp sau kiểm tra quyền.
- GPS khoảng 10s khi OS cho phép; seq/timestamp/accuracy validation → Redis latest+TTL → room đơn; worker batch PostGIS mỗi 10s.
- Lịch sử GPS tách khỏi bảng vị trí hiện tại; giới hạn retention phải được PO chốt.
- Tracking có thể coalesce/bỏ điểm cũ khi nghẽn; trạng thái đơn dùng transactional outbox, eventId/version và snapshot khi reconnect.
- Redis adapter + sticky sessions nếu dùng long-polling; Pub/Sub adapter không mặc định khôi phục sự kiện bị mất.
- Chưa triển khai gateway, worker, orders hoặc ledger ở commit foundation này.

## PostGIS

`driver_locations.position` là geography(Point,4326), GiST partial index khi available. Tọa độ SQL theo lng,lat; bán kính mét. Chỉ query `ST_DWithin` sau khi lọc freshness/availability. Khoảng cách thẳng không dùng làm cước đường bộ.

```sql
WITH pickup AS (
  SELECT ST_SetSRID(ST_MakePoint($1, $2),4326)::geography AS point
)
SELECT d.driver_id, ST_Distance(d.position,p.point) AS distance_m
FROM driver_locations d CROSS JOIN pickup p
WHERE d.is_available AND d.last_seen_at > now()-interval '30 seconds'
  AND ST_DWithin(d.position,p.point,$3)
ORDER BY distance_m,d.driver_id LIMIT 20;
```

## Bản đồ: quyết định cần thử nghiệm

Địa bàn pilot đã được chủ dự án chọn: **Hà Nội**. Map Gateway Nominatim/OSRM và Web map lab dùng Leaflet đã được bổ sung; chi tiết tại maps-hanoi.md. Đây là tiến độ Web/API; quyết định renderer native và chất lượng provider vẫn cần thử nghiệm.

Chưa chọn provider hoặc renderer trước spike trên thiết bị. React Native Maps UrlTile vẫn phụ thuộc SDK native; nếu yêu cầu không dùng SDK Google trên Android, thử MapLibre React Native.

- Tile: nhà cung cấp OSM-derived có điều khoản phù hợp hoặc self-host. Không hardcode public tile server làm production.
- Geocoding: adapter qua Backend; Nominatim self-host/nhà cung cấp cho phép. Không autocomplete bằng Nominatim public.
- Routing: OSRM khu vực triển khai; kiểm chứng profile xe máy/đường cấm/hẻm. Không dùng demo endpoint cho production.
- Ghi attribution và đo địa chỉ Việt Nam trước khi chốt. Self-host vẫn có chi phí compute, cập nhật dữ liệu và vận hành.

Nguồn kỹ thuật: https://socket.io/docs/v4/redis-adapter/ ; https://postgis.net/docs/ST_DWithin.html ; https://operations.osmfoundation.org/policies/nominatim/ ; https://operations.osmfoundation.org/policies/tiles/ .

## Câu hỏi PO cần chốt

1. Thành phố, vùng dịch vụ, loại phương tiện và nguồn geocoding.
2. Hồ sơ bắt buộc của tài xế và ai có quyền xét duyệt giấy tờ.
3. Phí hủy, trả hàng, COD hàng hóa và bằng chứng giao.
4. Công thức hoa hồng/công nợ, cut-off đối soát và giới hạn công nợ.
5. Retention GPS/ảnh/tài liệu và quy trình xóa dữ liệu.

Không mặc định đã được phép xử lý COD giá trị hàng hóa hoặc cung cấp ví khách hàng.
