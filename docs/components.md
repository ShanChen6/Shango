# ShanGo theme components

File duy nhất chứa toàn bộ component và exports: `apps/admin/src/components/ui/shango-theme.tsx`.
Hạ tầng dùng chung: `src/lib/utils.ts` cung cấp cn (clsx + tailwind-merge); `src/theme.css` cung cấp Tailwind v4 và semantic CSS variables.
Xem trực tiếp: chạy `npm run dev:admin`, mở http://localhost:5173/components.

## Theme

Đặt `data-theme="customer"`, `data-theme="driver"` hoặc `data-theme="admin"` trên vùng chứa. CSS variables được kế thừa; không truyền role xuống từng component. Token: bg-primary-500, text-primary-foreground, bg-card, text-muted-foreground, border-border, ring-ring và text-destructive.

Màu mặc định hiện tại là đề xuất và có thể chỉnh tại theme.css. Không có mã màu thương hiệu hardcode trong file component.

## Trạng thái và variants

| Component | Default / variants                                                                                         | Disabled                                                                                  | Focus                                            | Error                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Button    | primary-contained, primary-outlined, primary-ghost, secondary, destructive, link; sm/md/lg/icon; fullWidth | Native disabled hoặc aria-disabled + chặn sự kiện khi asChild; loading cũng khóa thao tác | focus-visible ring; hỗ trợ bàn phím              | destructive dành cho hành động nguy hiểm; không đồng nghĩa lỗi validation   |
| Input     | outline/soft; sm/md/lg; đứng riêng hoặc InputGroup có icon/action                                          | InputField/InputGroup truyền disabled xuống input và action                               | Input focus-visible; Group focus-within          | invalid + aria-invalid, border đỏ, liên kết InputError qua aria-describedby |
| Card      | default/elevated/soft/outlined; compact/comfortable; default/success/warning/error                         | Không có disabled vì Card là khối thông tin                                               | Không tự focus; Button/Link bên trong nhận focus | status=error đổi viền; luôn có nội dung giải thích, không chỉ dựa vào màu   |

## Ví dụ

```tsx
import {
  Button,
  ButtonSpinner,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  InputField,
  InputLabel,
  InputGroup,
  Input,
  InputIcon,
  InputAction,
  InputDescription,
  InputError,
} from '@/components/ui/shango-theme';

<div data-theme="driver">
  <Card variant="elevated">
    <CardHeader>
      <CardTitle>Đơn giao mới</CardTitle>
      <CardDescription>Điểm lấy cách bạn 1,2 km</CardDescription>
      <CardAction>
        <Button size="sm" variant="primary-ghost">
          Chi tiết
        </Button>
      </CardAction>
    </CardHeader>
    <CardContent>
      <InputField controlId="pickup" invalid={Boolean(error)}>
        <InputLabel>Địa chỉ lấy hàng</InputLabel>
        <InputGroup>
          <InputIcon>
            <PinIcon />
          </InputIcon>
          <Input value={address} onChange={onAddressChange} />
          <InputAction aria-label="Xóa địa chỉ" onClick={clearAddress}>
            ×
          </InputAction>
        </InputGroup>
        <InputDescription>Kiểm tra số nhà trước khi nhận.</InputDescription>
        {error && <InputError>{error}</InputError>}
      </InputField>
    </CardContent>
    <CardFooter>
      <Button fullWidth loading={accepting} onClick={acceptOrder}>
        Nhận đơn
      </Button>
    </CardFooter>
  </Card>
</div>;
```

`PinIcon`, state và handler trong ví dụ do ứng dụng cung cấp. Một InputField dành cho một control, tối đa một InputDescription và một InputError; dùng controlId ở InputField để đổi ID đồng bộ với label. Icon chỉ trang trí; action chỉ có icon bắt buộc có aria-label.

```tsx
<Button asChild variant="primary-outlined"><a href="/orders">Xem đơn</a></Button>
<Button asChild loading><a href="/orders"><ButtonSpinner />Đang mở đơn</a></Button>
```

asChild nhận đúng một phần tử tương tác, không truyền Fragment. Với loading + asChild, tự đặt ButtonSpinner bên trong child để Slot giữ đúng một child. Button native mặc định type=button, chỉ submit form khi type=submit. Link đã disabled dùng aria-disabled/tabIndex và chặn click/Enter/Space; với router component tùy biến phải forward props/ref/handlers đúng contract Slot.

Card không bọc toàn bộ nội dung bằng button để tránh lồng phần tử tương tác. Dùng Button asChild cho hành động điều hướng riêng. Các component nhận ref theo React 19; không dùng chúng trong dự án React 18 nếu chưa chuyển sang forwardRef.
