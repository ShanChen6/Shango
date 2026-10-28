# SG-014 — Chọn địa chỉ lấy/giao trên App Khách

## Phạm vi đã có code

- Điểm lấy và điểm giao độc lập, chọn từ tìm kiếm Hà Nội, bấm/kéo pin MapLibre hoặc nhập tọa độ.
- Địa chỉ pin, chi tiết số nhà/hẻm/tầng, tên/số điện thoại người liên hệ và ghi chú từng điểm.
- Tìm khi bấm nút, không autocomplete bằng Nominatim public. Reverse cũng chỉ khi bấm nút; kết quả không dời pin sang tọa độ địa chỉ gần nhất.
- Xác nhận từng điểm sau validation. Sửa pin/địa chỉ/liên hệ/ghi chú hủy xác nhận; tọa độ gõ mới phải được áp dụng trước xác nhận.
- Chỉ xem tóm tắt khi cả hai điểm hợp lệ và đã xác nhận, không có tìm kiếm/reverse đang chờ.
- Request cũ không được ghi đè khi đổi từ khóa, chuyển điểm, kéo pin, reset hoặc unmount.
- Dữ liệu giao nhận chỉ trong bộ nhớ; xóa/reset/logout làm mất draft. Chưa gửi backend để tạo đơn, chưa lưu AsyncStorage/SecureStore và không ghi log thông tin liên hệ.

## Native map

App Khách dùng `@maplibre/maplibre-react-native` v11, plugin Expo và React Native new architecture. Không dùng Google SDK. Module này chỉ thuộc App Khách; App Tài xế không bị buộc thêm native map ở đợt này.

MapLibre không có trong Expo Go: cần development/native build. Map được tải lazy trong ErrorBoundary; nếu native map không sẵn sàng, tìm địa chỉ/nhập tọa độ vẫn là đường thay thế. Đây chưa phải bằng chứng runtime fallback đã qua QA trên từng thiết bị.

```sh
npm ci
npm run android -w @shango/customer
```

Lệnh build/run cần Android SDK và thiết bị/emulator tương thích; iOS cần macOS/Xcode. Không tự phát hành lên store.

Nguồn tile được đặt riêng trong `apps/customer/.env`:

```dotenv
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/api/v1
EXPO_PUBLIC_MAP_TILE_URL=https://your-authorized-provider/{z}/{x}/{y}.png
EXPO_PUBLIC_MAP_TILE_ATTRIBUTION=Attribution theo yêu cầu nhà cung cấp
```

Thiết bị thật dùng URL LAN/HTTPS phù hợp; HTTP chỉ cho development theo cấu hình native của môi trường. Không đặt secret server vào EXPO_PUBLIC_*. Không có cả tile URL và attribution thì map chỉ có nền màu/pin, không tự gọi demo hay public tile server. Hiển thị attribution của OSM và nhà cung cấp.

Search/reverse yêu cầu cấu hình Nominatim tại Backend như maps-hanoi.md. Provider chưa có thì UI báo rõ và cho nhập tọa độ/địa chỉ thủ công. Chưa tự xin quyền GPS hoặc có nút vị trí hiện tại; không cần quyền GPS để chọn bằng pin.

## Validation / ranh giới

### Build Windows với đường dẫn dài

Repo có plugin `with-short-cmake-path`. Nếu Ninja/CMake báo đường dẫn object quá dài, đặt `SHANGO_CMAKE_BUILD_DIR` thành thư mục local ngắn, riêng cho app (ví dụ một thư mục trong Documents/Codex/work), chạy prebuild rồi build lại. Không dùng thư mục con của android/app/build và không dùng chung một staging directory giữa các app/build chạy đồng thời.

Plugin đọc đường dẫn từ môi trường khi Gradle chạy, không commit đường dẫn máy người dùng. Không có biến này thì giữ mặc định AGP. Tham khảo [CMake buildStagingDirectory](https://developer.android.com/reference/tools/gradle-api/8.13/com/android/build/api/dsl/Cmake).

- Pin phải hữu hạn, nằm trong **rectangle khám phá Hà Nội** do API trả về; đây chưa phải polygon vùng phục vụ SG-015.
- Số điện thoại Việt Nam dạng 0 + 9 chữ số đổi sang +84; E.164 được chấp nhận. Chưa xác minh chủ sở hữu số liên hệ bằng OTP.
- Tên 2–80 ký tự, không control characters; chi tiết địa chỉ tối đa 200, ghi chú 500 ký tự.
- Tọa độ nguồn MapLibre/GeoJSON luôn lng/lat; ô nhập có nhãn vĩ độ và kinh độ riêng.
- Confirmation ở client chỉ phục vụ UX. Backend SG-015/016/017 phải kiểm tra lại vùng, tọa độ, liên hệ và quote; không tin cờ confirmed từ client.

## Kiểm chứng và việc còn thiếu

Ngày 28/10/2026: Android prebuild và APK debug arm64 (SDK 36/NDK 27.1) đã build thành công trên máy phát triển sau khi dùng staging CMake ngắn. Bản debug vẫn cần Metro; chưa chạy trên thiết bị/emulator và chưa build iOS.

Test logic bao phủ stale search/reverse, đổi điểm/pin, confirmation, chuẩn hóa liên hệ, tọa độ sai/ngoài vùng, mất mạng, provider thiếu và xóa dữ liệu. TypeScript và CI bundling kiểm tra các import/type native; chúng không thay thế chạy app trên thiết bị.

Chỉ đánh dấu SG-014 nghiệm thu đầy đủ sau khi QA Android/iOS: bấm/kéo pin trong ScrollView, bàn phím, mất mạng, map lỗi và kiểm tra địa chỉ thực tế. Chưa có polygon vùng phục vụ, báo giá, order hoặc dispatch. Task tiếp theo theo thứ tự là **SG-015 — Geofence và vùng hoạt động**.

Nguồn đối chiếu: [MapLibre Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/), [Map component](https://maplibre.org/maplibre-react-native/docs/components/map/).
