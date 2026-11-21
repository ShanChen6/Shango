import { useCallback, useEffect, useState } from 'react';
import type { createApi } from '@shango/api-client';
import type { Order, OrderStatus } from '@shango/contracts';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shango-theme';
import { exceptionLabel, orderExceptions, summarize } from '@/lib/dispatch';

type Api = Pick<ReturnType<typeof createApi>, 'adminOrders' | 'cancelOrder'>;

export const orderStatusLabels: Record<OrderStatus, string> = {
  SEARCHING: 'Đang tìm tài xế',
  ASSIGNED: 'Đã gán',
  AT_PICKUP: 'Ở điểm lấy',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn tìm',
};
/** Mirrors the server policy; the server re-checks status and version on every cancel. */
export const staffCancellable = (status: OrderStatus) =>
  ['SEARCHING', 'ASSIGNED', 'AT_PICKUP'].includes(status);
const vnd = new Intl.NumberFormat('vi-VN');
const time = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'short',
});

function locationAge(order: Order, now: number) {
  if (!order.driverLocation) return null;
  return Math.max(0, Math.round((now - Date.parse(order.driverLocation.lastSeenAt)) / 1000));
}

export function OrdersBoard({
  api,
  refreshMs = 5000,
  online = true,
}: {
  api: Api;
  refreshMs?: number;
  online?: boolean;
}) {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [items, setItems] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await api.adminOrders(status);
      setItems(page.items);
      setError('');
      setNow(Date.now());
    } catch {
      setError('Không tải được danh sách đơn. Đơn hàng có thể chưa được bật trên máy chủ.');
    }
  }, [api, status]);

  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const timer = setInterval(() => void load(), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  const confirmCancel = async () => {
    if (!cancelling || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const updated = await api.cancelOrder(cancelling.id, cancelling.version, reason.trim());
      setNotice(`Đã hủy đơn ${updated.id.slice(0, 8)}.`);
      setCancelling(null);
      setReason('');
    } catch {
      setError('Không hủy được: đơn có thể vừa đổi trạng thái. Danh sách đã được tải lại.');
      setCancelling(null);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const visible =
    items &&
    (onlyExceptions ? items.filter((order) => orderExceptions(order, now).length > 0) : items);
  return (
    <div data-theme="admin" className="grid gap-5 text-foreground">
      <Card>
        <CardHeader>
          <CardTitle>Đơn hàng</CardTitle>
          <CardDescription>
            Tự động làm mới mỗi {Math.round(refreshMs / 1000)} giây. Điều phối viên chỉ hủy được
            trước khi lấy hàng; mọi lần hủy cần lý do và được ghi nhật ký.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="grid max-w-xs gap-1 text-sm font-semibold">
            Trạng thái
            <select
              className="m-0 min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
              value={status}
              onChange={(event) => setStatus(event.target.value as OrderStatus | '')}
            >
              <option value="">Tất cả</option>
              {Object.entries(orderStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {items && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-muted px-3 py-1">
                {summarize(items, now).searching} đơn tìm tài xế lâu
              </span>
              <span className="rounded-full bg-muted px-3 py-1">
                {summarize(items, now).gps} đơn mất GPS tài xế
              </span>
              <label className="inline-flex min-h-11 items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  className="m-0 size-5 w-auto"
                  checked={onlyExceptions}
                  onChange={(event) => setOnlyExceptions(event.target.checked)}
                />
                Chỉ hiện ngoại lệ
              </label>
            </div>
          )}
        </CardContent>
      </Card>
      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="m-0 rounded-xl bg-primary/10 p-4 text-sm">
          {notice}
        </p>
      )}
      {cancelling && (
        <Card>
          <CardHeader>
            <CardTitle>Hủy đơn {cancelling.id.slice(0, 8)}</CardTitle>
            <CardDescription>
              {orderStatusLabels[cancelling.status]} · {cancelling.stops.pickup.address} →{' '}
              {cancelling.stops.dropoff.address}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Lý do hủy
              <input
                className="m-0 min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy || !online || reason.trim().length < 3}
                onClick={() => void confirmCancel()}
              >
                Xác nhận hủy
              </Button>
              <Button type="button" variant="primary-outlined" onClick={() => setCancelling(null)}>
                Giữ đơn
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          {items === null ? (
            <p role="status" className="m-0 py-6 text-sm text-muted-foreground">
              Đang tải…
            </p>
          ) : visible!.length === 0 ? (
            <p role="status" className="m-0 py-6 text-sm text-muted-foreground">
              Không có đơn phù hợp.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {visible!.map((order) => {
                const age = locationAge(order, now);
                const exceptions = orderExceptions(order, now);
                return (
                  <li
                    key={order.id}
                    className={`grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-center ${exceptions.length ? 'border-destructive' : 'border-border'}`}
                  >
                    <div className="grid min-w-0 gap-1">
                      <strong className="break-words">
                        {order.stops.pickup.address} → {order.stops.dropoff.address}
                      </strong>
                      <small className="text-muted-foreground">
                        {time.format(new Date(order.createdAt))} · {vnd.format(order.priceVnd)} ₫
                      </small>
                      {exceptions.length > 0 && (
                        <span className="flex flex-wrap gap-2">
                          {exceptions.map((item) => (
                            <span
                              key={item.kind}
                              className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                            >
                              ⚠ {exceptionLabel(item)}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="grid min-w-0 gap-1">
                      <span className="font-semibold">{orderStatusLabels[order.status]}</span>
                      {order.cancelReason && (
                        <small className="text-muted-foreground">{order.cancelReason}</small>
                      )}
                      {order.driver ? (
                        <span>
                          {order.driver.displayName ?? 'Tài xế'} · {order.driver.vehiclePlate}
                        </span>
                      ) : (
                        <small className="text-muted-foreground">Chưa có tài xế</small>
                      )}
                      {age !== null && (
                        <small className={age >= 60 ? 'text-destructive' : 'text-muted-foreground'}>
                          GPS {age}s trước
                        </small>
                      )}
                    </div>
                    <div>
                      {staffCancellable(order.status) && (
                        <Button
                          type="button"
                          variant="primary-outlined"
                          onClick={() => {
                            setNotice('');
                            setReason('');
                            setCancelling(order);
                          }}
                        >
                          Hủy đơn
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
