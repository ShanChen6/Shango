import { useState } from 'react';
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

function Pin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function ThemeShowcase() {
  const [theme, setTheme] = useState<'customer' | 'driver' | 'admin'>('customer');
  const [destination, setDestination] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const invalid = submitted && destination.trim().length < 5;
  return (
    <div
      data-theme={theme}
      className="min-h-screen bg-background p-4 font-sans text-foreground sm:p-8"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="m-0 text-xs font-semibold tracking-widest text-primary-500">
              SHANGO / DESIGN SYSTEM
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Một bộ giao diện. Ba vai trò.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Button, Input và Card · Mobile first · Semantic theme
            </p>
          </div>
          <Button asChild variant="primary-outlined">
            <a href="/">Về trang quản trị</a>
          </Button>
        </div>
        <div aria-label="Chọn theme" className="flex flex-wrap gap-2">
          {(
            [
              ['customer', 'Khách hàng'],
              ['driver', 'Tài xế'],
              ['admin', 'Quản trị'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              aria-pressed={theme === value}
              variant={theme === value ? 'primary-contained' : 'secondary'}
              onClick={() => setTheme(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <section aria-label="Biến thể Button" className="grid gap-4">
          <h2 className="m-0 text-lg font-semibold">01 / Hành động</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setNotice('Đây là bản xem mẫu; không tạo đơn thật.')}>
              Đặt giao hàng
            </Button>
            <Button variant="primary-outlined">Xem tuyến đường</Button>
            <Button variant="primary-ghost">Bỏ qua</Button>
            <Button variant="secondary">Liên hệ tài xế</Button>
            <Button variant="destructive">Hủy đơn</Button>
            <Button asChild variant="link">
              <a href="#input-demo">Đến ô địa chỉ</a>
            </Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button disabled>Chưa thể nhận đơn</Button>
            <Button loading>Đang tìm tài xế</Button>
            <Button asChild disabled variant="primary-outlined">
              <a href="#disabled">Liên kết bị khóa</a>
            </Button>
            <Button asChild loading variant="secondary">
              <a href="#loading">
                <ButtonSpinner />
                Đang mở hành trình
              </a>
            </Button>
          </div>
        </section>
        <div className="grid gap-6 md:grid-cols-2">
          <Card id="input-demo">
            <CardHeader>
              <CardTitle>02 / Thông tin giao nhận</CardTitle>
              <CardDescription>Thử gửi khi địa chỉ quá ngắn để xem trạng thái lỗi.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(true);
                  if (destination.trim().length >= 5)
                    setNotice('Địa chỉ hợp lệ trong bản xem mẫu. Chưa gửi API.');
                }}
              >
                <InputField invalid={invalid}>
                  <InputLabel>Địa chỉ giao hàng</InputLabel>
                  <InputGroup>
                    <InputIcon>
                      <Pin />
                    </InputIcon>
                    <Input
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="Số nhà, tên đường"
                      autoComplete="street-address"
                    />
                    <InputAction
                      aria-label="Xóa địa chỉ"
                      onClick={() => setDestination('')}
                      disabled={!destination}
                    >
                      ×
                    </InputAction>
                  </InputGroup>
                  <InputDescription>Bổ sung số nhà và hẻm để tài xế dễ tìm.</InputDescription>
                  {invalid && <InputError>Nhập địa chỉ có ít nhất 5 ký tự.</InputError>}
                </InputField>
                <InputField disabled>
                  <InputLabel>Mã tài xế được phân công</InputLabel>
                  <InputGroup variant="soft">
                    <InputIcon>
                      <Pin />
                    </InputIcon>
                    <Input placeholder="Có sau khi tài xế nhận đơn" />
                    <InputAction aria-label="Tra cứu tài xế">↗</InputAction>
                  </InputGroup>
                  <InputDescription>Chưa có tài xế trong bản xem mẫu.</InputDescription>
                </InputField>
                <InputField>
                  <InputLabel>Số điện thoại liên hệ</InputLabel>
                  <Input type="tel" variant="soft" placeholder="090 123 4567" autoComplete="tel" />
                  <InputDescription>Nhấn Tab để kiểm tra focus ring.</InputDescription>
                </InputField>
                <Button type="submit" fullWidth>
                  Kiểm tra địa chỉ
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="grid content-start gap-5">
            <Card variant="elevated">
              <CardHeader>
                <CardTitle>03 / Đơn giao hàng</CardTitle>
                <CardDescription>Đơn minh họa · SG-DEMO-024</CardDescription>
                <CardAction>
                  <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-500">
                    Đang tìm xế
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 text-sm">
                  <div className="flex gap-3">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-primary-500" />
                    <div>
                      <p className="m-0 font-medium text-foreground">Điểm lấy hàng</p>
                      <p className="m-0 text-sm text-muted-foreground">12 Nguyễn Huệ, Quận 1</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="mt-1 size-2 shrink-0 rounded-full bg-warning" />
                    <div>
                      <p className="m-0 font-medium text-foreground">Điểm giao hàng</p>
                      <p className="m-0 text-sm text-muted-foreground">45 Lê Văn Sỹ, Quận 3</p>
                    </div>
                  </div>
                  <div className="flex justify-between border-t border-border pt-4">
                    <span>Cước minh họa</span>
                    <strong>35.000 ₫</strong>
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  fullWidth
                  variant="primary-outlined"
                  onClick={() => setNotice('Chỉ là bản xem mẫu giao diện.')}
                >
                  Xem chi tiết đơn
                </Button>
              </CardFooter>
            </Card>
            <Card variant="soft" density="compact">
              <CardHeader>
                <CardTitle>Thích ứng theo vai trò</CardTitle>
                <CardDescription>
                  Màu của tất cả thành phần đổi theo data-theme ở vùng chứa.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <span className="rounded-lg bg-primary-500 px-3 py-2 text-xs text-primary-foreground">
                  Primary
                </span>
                <span className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Muted
                </span>
                <span className="rounded-lg bg-destructive px-3 py-2 text-xs text-white">
                  Error
                </span>
              </CardContent>
            </Card>
            <Card status="error" density="compact">
              <CardHeader>
                <CardTitle>Không thể tải tuyến đường</CardTitle>
                <CardDescription>
                  Trạng thái lỗi có thông điệp rõ ràng và hành động khôi phục.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  size="sm"
                  variant="primary-outlined"
                  onClick={() => setNotice('Thử lại trong bản xem mẫu.')}
                >
                  Thử lại
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
        <p role="status" aria-live="polite" className="m-0 min-h-6 text-sm text-primary-500">
          {notice}
        </p>
        <p className="m-0 text-xs text-muted-foreground">
          Dữ liệu minh họa · Không đặt đơn hoặc gọi dịch vụ giao nhận thật.
        </p>
      </div>
    </div>
  );
}
