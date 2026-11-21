import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapConfig, Order, OrderEvent } from '@shango/contracts';
import { WebApiError, type createWebApi } from '@shango/api-client';
import { Badge, Button, Card, InlineAlert, PageHeader } from '@shango/ui';
import { useLiveOrder } from './live-order';
import { OrderMap } from './order-map';
import {
  ACTIVE_STATUSES,
  ageSeconds,
  formatKm,
  formatVnd,
  progressSteps,
  statusLabels,
  vehicleLabels,
} from './order-format';

type WebApi = ReturnType<typeof createWebApi>;

export function OrdersPage({ api }: { api: WebApi }) {
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.request<{ items: Order[] }>('/orders'),
  });
  return (
    <>
      <PageHeader
        eyebrow="ĐƠN HÀNG"
        title="Đơn của bạn"
        description="Trạng thái lấy từ máy chủ; không có đơn hoặc trạng thái giả."
      />
      {orders.isError && (
        <InlineAlert>
          {orders.error instanceof WebApiError && orders.error.status === 503
            ? orders.error.message
            : 'Không tải được danh sách đơn.'}{' '}
          <Button type="button" onClick={() => void orders.refetch()}>
            Thử lại
          </Button>
        </InlineAlert>
      )}
      {orders.isPending && <p>Đang tải đơn…</p>}
      {orders.data && orders.data.items.length === 0 && (
        <Card>
          <p>Bạn chưa có đơn nào.</p>
          <NavLink className="action-link" to="/addresses">
            Tạo đơn mới
          </NavLink>
        </Card>
      )}
      <ul className="order-list">
        {orders.data?.items.map((order) => (
          <li key={order.id}>
            <NavLink to={`/orders/${order.id}`} className="order-row">
              <span>
                <strong>{order.stops.dropoff.address}</strong>
                <small>{new Date(order.createdAt).toLocaleString('vi-VN')}</small>
              </span>
              <span>
                <Badge>{statusLabels[order.status]}</Badge>
                <small>{formatVnd(order.priceVnd)}</small>
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

const connectionLabels = {
  connecting: 'Đang kết nối',
  connected: 'Đang cập nhật trực tiếp',
  reconnecting: 'Mất kết nối, đang thử lại',
  offline: 'Ngoại tuyến',
};

export function OrderDetailPage({ api }: { api: WebApi }) {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const order = useLiveOrder(api, id);
  const mapConfig = useQuery({
    queryKey: ['map-config'],
    queryFn: () => api.request<MapConfig>('/maps/config'),
    staleTime: 10 * 60_000,
  });
  // Refetched whenever the live order version changes.
  const events = useQuery({
    queryKey: ['order-events', id, order.data?.version],
    queryFn: () => api.request<{ items: OrderEvent[] }>(`/orders/${id}/events`),
    enabled: Boolean(order.data),
  });
  const eventTime = new Map(
    (events.data?.items ?? []).map((event) => [
      event.status,
      new Date(event.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    ]),
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const cancel = useMutation({
    mutationFn: (expectedVersion: number) =>
      api.request<Order>(`/orders/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion }),
      }),
    onSuccess: (value) => {
      client.setQueryData(['order', id], value);
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  if (order.isPending) return <p>Đang tải đơn…</p>;
  if (order.isError || !order.data)
    return (
      <>
        <PageHeader
          eyebrow="ĐƠN HÀNG"
          title="Không tìm thấy đơn"
          description="Đơn không tồn tại hoặc bạn không có quyền xem."
        />
        <NavLink className="action-link" to="/orders">
          Về danh sách đơn
        </NavLink>
      </>
    );
  const data = order.data;
  const active = ACTIVE_STATUSES.includes(data.status);
  const stepIndex = progressSteps.indexOf(data.status);
  const locationAge = ageSeconds(data.driverLocation?.lastSeenAt, now);
  const searchLeft = Math.max(0, Math.round((Date.parse(data.searchDeadline) - now) / 1000));
  return (
    <>
      <PageHeader
        eyebrow="CHI TIẾT ĐƠN"
        title={statusLabels[data.status]}
        description={`${formatVnd(data.priceVnd)} · ${vehicleLabels[data.vehicleType]} · ${formatKm(data.distanceMeters)}`}
      />
      <p className={`connection ${order.connection}`} role="status">
        {connectionLabels[order.connection]}
      </p>
      <div className="grid">
        <div className="stack">
          <Card>
            <h2>Tiến trình</h2>
            {stepIndex >= 0 ? (
              <ol className="progress">
                {progressSteps.map((step, index) => (
                  <li
                    key={step}
                    className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''}
                    aria-current={index === stepIndex ? 'step' : undefined}
                  >
                    {statusLabels[step]}
                    {eventTime.get(step) && (
                      <time className="step-time"> · {eventTime.get(step)}</time>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <InlineAlert tone="warning">
                {statusLabels[data.status]}
                {data.cancelReason ? `: ${data.cancelReason}` : ''}
                {eventTime.get(data.status) ? ` (${eventTime.get(data.status)})` : ''}
              </InlineAlert>
            )}
            {data.status === 'SEARCHING' && (
              <p>Còn khoảng {Math.ceil(searchLeft / 60)} phút tìm tài xế.</p>
            )}
            {data.status === 'SEARCHING' && (
              <>
                {cancel.isError && (
                  <InlineAlert>
                    {cancel.error instanceof WebApiError && cancel.error.status === 409
                      ? 'Đơn vừa thay đổi (có thể đã có tài xế nhận). Trạng thái mới đã được tải.'
                      : 'Không hủy được đơn. Thử lại.'}
                  </InlineAlert>
                )}
                <Button
                  type="button"
                  className="secondary"
                  disabled={cancel.isPending}
                  onClick={() =>
                    cancel.mutate(data.version, { onError: () => void order.refetch() })
                  }
                >
                  {cancel.isPending ? 'Đang hủy…' : 'Hủy đơn'}
                </Button>
              </>
            )}
            {active && <p className="hint">Sau khi tài xế nhận đơn, liên hệ hỗ trợ nếu cần hủy.</p>}
          </Card>
          <Card>
            <h2>Điểm lấy và giao</h2>
            <p>
              <strong>Lấy:</strong> {data.stops.pickup.address}
              {data.stops.pickup.detail && ` (${data.stops.pickup.detail})`} ·{' '}
              {data.stops.pickup.contactName}
            </p>
            <p>
              <strong>Giao:</strong> {data.stops.dropoff.address}
              {data.stops.dropoff.detail && ` (${data.stops.dropoff.detail})`} ·{' '}
              {data.stops.dropoff.contactName}
            </p>
            <p className="hint">
              Giá thử nghiệm {data.tariffVersion}; thanh toán tiền mặt cho tài xế.
            </p>
          </Card>
        </div>
        <div className="stack">
          <Card>
            <h2>Tài xế</h2>
            {!data.driver && <p>Chưa có tài xế nhận đơn.</p>}
            {data.driver && (
              <>
                <p>
                  <strong>{data.driver.displayName ?? 'Tài xế ShanGo'}</strong> ·{' '}
                  {vehicleLabels[data.driver.vehicleType]} {data.driver.vehiclePlate}
                </p>
                {active && data.driverLocation && locationAge !== null && (
                  <p aria-live="polite">
                    Vị trí cuối cập nhật {locationAge} giây trước
                    {data.driverLocation.accuracy !== null &&
                      ` · sai số ~${data.driverLocation.accuracy} m`}
                  </p>
                )}
                {active && locationAge !== null && locationAge >= 60 && (
                  <InlineAlert tone="warning">
                    Chưa nhận được vị trí mới của tài xế hơn 1 phút. Đơn vẫn được giữ; trình duyệt
                    của tài xế có thể đang ở nền.
                  </InlineAlert>
                )}
                {active && !data.driverLocation && <p>Chưa có vị trí của tài xế.</p>}
              </>
            )}
          </Card>
          {mapConfig.data && (
            <Card>
              <h2>Bản đồ</h2>
              <OrderMap
                config={mapConfig.data}
                pickup={data.stops.pickup.position}
                dropoff={data.stops.dropoff.position}
                driver={
                  active && data.driverLocation
                    ? {
                        longitude: data.driverLocation.longitude,
                        latitude: data.driverLocation.latitude,
                        accuracy: data.driverLocation.accuracy,
                      }
                    : null
                }
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
