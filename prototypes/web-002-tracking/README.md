# WEB-002 tracking prototype

Throwaway spike để đo Web Geolocation và Connection Recovery. Không import vào app
production và không dùng kết quả simulator thay cho bằng chứng thiết bị thật.

## Chạy trên desktop localhost

```sh
npm install
npm start
```

Mở `http://localhost:4173`. Localhost được browser coi là secure context cho
Geolocation. DevTools có thể giả lập vị trí và offline, nhưng kết quả này chỉ xác nhận
harness/state transitions, không xác nhận hành vi GPS/OS.

## Chạy trên điện thoại

Điện thoại truy cập qua LAN bắt buộc trusted HTTPS. Tạo/chọn certificate được thiết bị
tin cậy, rồi chạy:

```sh
HTTPS_CERT_FILE=/absolute/path/cert.pem \
HTTPS_KEY_FILE=/absolute/path/key.pem \
npm start
```

Mở `https://<ip-lan>:4173` trên Safari iOS hoặc Chrome Android. Certificate tự ký chưa
được thiết bị tin cậy không phải môi trường test hợp lệ. Không dùng endpoint công khai
hoặc tunnel chứa token nếu chưa được phê duyệt.

Thực hiện sáu scenario hiển thị trên trang, dùng nút **Copy evidence đã khử tọa độ** và
điền `docs/web-002-browser-evidence.md`. Không commit raw event log hoặc latitude/longitude
thật; đặc biệt không ghi vị trí nhà riêng/địa điểm cá nhân vào issue hay PR. Mỗi kết quả
phải ghi rõ thiết bị, OS/browser version, power mode, network và timestamp.
