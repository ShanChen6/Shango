import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Order, OrderStatus } from '@shango/contracts';
import { WebApiError } from '@shango/api-client';
import { Badge, Button, Card, InlineAlert, PageHeader } from '@shango/ui';
import { useDriverDocuments, useDriverProfile, type WebApi } from './driver-data';
import { directionsUrl, formatAge, freshnessLabels, onboardingSteps } from './driver-policy';
import { useWork, workKeys } from './driver-work';

const stepLinks = { vehicle: '/profile', documents: '/documents', review: '/profile' } as const;
const vnd = new Intl.NumberFormat('vi-VN');
const money = (value: number) => `${vnd.format(value)} ₫`;
const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
const connectionLabels = {
  connecting: 'Đang kết nối',
  connected: 'Đã kết nối',
  reconnecting: 'Mất kết nối, đang thử lại',
  offline: 'Ngoại tuyến',
};

function LocationCheck() {
  const { location, sharing, lastSend } = useWork();
  const { freshness } = location;
  return (
    <Card>
      <h2>Kiểm tra vị trí</h2>
      <p>
        {sharing ? (
          <>
            Vị trí đang được gửi cho ShanGo vì bạn đang sẵn sàng hoặc có đơn. Chỉ gửi khi trang đang
            mở.
          </>
        ) : (
          <>
            Chỉ kiểm tra khi trang đang mở. Vị trí <strong>không</strong> được gửi lên máy chủ ở
            bước này.
          </>
        )}
      </p>
      <p aria-live="polite">
        <span className={`freshness ${freshness}`}>{freshnessLabels[freshness]}</span>
        {location.lastFixAt !== null && (
          <>
            {' '}
            · cập nhật {formatAge(location.now - location.lastFixAt)}
            {location.accuracyMeters !== null && ` · sai số ~${location.accuracyMeters} m`}
          </>
        )}
      </p>
      {sharing && lastSend && !lastSend.result.accepted && (
        <InlineAlert tone="warning">
          Máy chủ chưa nhận vị trí gần nhất ({lastSend.result.reason}).
        </InlineAlert>
      )}
      {location.waitingForMs !== null && location.waitingForMs >= 10_000 && (
        <InlineAlert tone="warning">
          Chưa nhận được vị trí. Nếu trình duyệt đang hỏi quyền, hãy chọn Cho phép; nếu đã bỏ qua
          hoặc chặn, mở cài đặt trang web để bật Vị trí rồi thử lại.
        </InlineAlert>
      )}
      {freshness === 'denied' && (
        <InlineAlert tone="warning">
          Trình duyệt đang chặn quyền vị trí. Mở cài đặt trang web, cho phép Vị trí rồi bấm kiểm tra
          lại.
        </InlineAlert>
      )}
      {freshness === 'unsupported' && (
        <InlineAlert tone="warning">Trình duyệt này không hỗ trợ định vị.</InlineAlert>
      )}
      {freshness === 'stale' && (
        <InlineAlert tone="warning">
          Đã hơn 30 giây chưa có vị trí mới. Giữ trang mở và ở nơi thoáng.
        </InlineAlert>
      )}
      {freshness === 'unavailable' && (
        <InlineAlert tone="warning">
          Đã hơn 60 giây không có vị trí. Tài xế rảnh sẽ không được ghép đơn trong trạng thái này.
        </InlineAlert>
      )}
      {location.lastError && freshness !== 'denied' && (
        <InlineAlert tone="warning">{location.lastError}</InlineAlert>
      )}
      {location.lastHiddenForMs !== null && location.lastHiddenForMs >= 5_000 && (
        <InlineAlert tone="warning">
          Trang vừa ở nền khoảng {Math.round(location.lastHiddenForMs / 1000)} giây; trình duyệt có
          thể đã ngừng cập nhật GPS trong thời gian đó.
        </InlineAlert>
      )}
      {!sharing &&
        (location.active ? (
          <Button type="button" className="secondary" onClick={location.stop}>
            Dừng kiểm tra
          </Button>
        ) : (
          <Button type="button" disabled={freshness === 'unsupported'} onClick={location.start}>
            Kiểm tra vị trí
          </Button>
        ))}
    </Card>
  );
}

function Availability({ approved }: { approved: boolean }) {
  const work = useWork();
  const online = Boolean(work.presence?.available);
  return (
    <Card>
      <h2>Nhận đơn</h2>
      <p>
        <Badge>
          {online
            ? work.presence?.fresh
              ? 'Đang sẵn sàng'
              : 'Sẵn sàng nhưng GPS cũ'
            : 'Đang ngoại tuyến'}
        </Badge>{' '}
        <small className="hint">Kết nối: {connectionLabels[work.connection]}</small>
      </p>
      {!approved && <p>Cần hồ sơ được duyệt trước khi nhận đơn.</p>}
      {online && !work.presence?.fresh && (
        <InlineAlert tone="warning">
          GPS quá 30 giây chưa cập nhật nên bạn tạm không được ghép đơn. Giữ trang mở.
        </InlineAlert>
      )}
      {work.availabilityError && <InlineAlert>{work.availabilityError}</InlineAlert>}
      {work.order && <p>Bạn đang có đơn; hoàn tất đơn trước khi nhận đơn mới.</p>}
      {online ? (
        <Button
          type="button"
          className="secondary"
          disabled={work.availabilityBusy}
          onClick={work.goOffline}
        >
          Tắt sẵn sàng
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!approved || work.availabilityBusy}
          onClick={work.goOnline}
          aria-describedby="availability-gate"
        >
          {work.wantsOnline ? 'Đang lấy vị trí…' : 'Bật sẵn sàng'}
        </Button>
      )}
      <small id="availability-gate" className="hint">
        Bật sẵn sàng sẽ gửi vị trí khi trang mở. Khóa màn hình hoặc chuyển tab có thể làm GPS dừng;
        đơn đã nhận không bị hủy vì mất GPS.
      </small>
    </Card>
  );
}

export function HomePage({ api }: { api: WebApi }) {
  const profile = useDriverProfile(api);
  const documents = useDriverDocuments(api, Boolean(profile.data));
  const steps = onboardingSteps(profile.data ?? null, documents.data ?? null);
  const approved = profile.data?.status === 'approved';
  const work = useWork();
  return (
    <>
      <PageHeader
        eyebrow="TRẠNG THÁI LÀM VIỆC"
        title="Sẵn sàng khi GPS hợp lệ"
        description="Socket và độ mới GPS là hai tín hiệu riêng biệt. Khóa màn hình hoặc chuyển nền có thể làm GPS ngừng cập nhật."
      />
      {work.offer && (
        <InlineAlert tone="success">
          Có đề nghị giao hàng mới. <NavLink to="/offers">Xem đề nghị</NavLink>
        </InlineAlert>
      )}
      {work.order && (
        <InlineAlert tone="success">
          Bạn đang có đơn. <NavLink to="/order">Mở đơn hiện tại</NavLink>
        </InlineAlert>
      )}
      <div className="grid">
        <div className="stack">
          <Card>
            <h2>Hoàn tất hồ sơ</h2>
            {profile.isError && (
              <InlineAlert>
                Không tải được hồ sơ.{' '}
                <Button type="button" onClick={() => void profile.refetch()}>
                  Thử tải lại
                </Button>
              </InlineAlert>
            )}
            {profile.isPending ? (
              <p>Đang tải hồ sơ…</p>
            ) : (
              <ol className="checklist">
                {steps.map((step) => (
                  <li key={step.id} className={step.done ? 'done' : ''}>
                    <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
                    <NavLink to={stepLinks[step.id]}>{step.label}</NavLink>
                    <small>{step.detail}</small>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Availability approved={approved} />
        </div>
        <LocationCheck />
      </div>
    </>
  );
}

export function OffersPage({ api }: { api: WebApi }) {
  const { offer, presence, order } = useWork();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      api.request<Order | undefined>(`/drivers/me/offers/${id}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
      }),
    onSuccess: (result, input) => {
      void client.invalidateQueries({ queryKey: workKeys.offer });
      if (input.accept && result) {
        client.setQueryData(workKeys.order, result);
        navigate('/order');
      }
    },
    onError: () => void client.invalidateQueries({ queryKey: workKeys.offer }),
  });
  useEffect(() => {
    // Snapshot on open: never rely only on a socket event having arrived.
    void client.invalidateQueries({ queryKey: workKeys.offer });
    void client.invalidateQueries({ queryKey: workKeys.order });
  }, [client]);
  const secondsLeft = offer
    ? Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - now) / 1000))
    : 0;
  return (
    <>
      <PageHeader
        eyebrow="ĐỀ NGHỊ GIAO HÀNG"
        title="Đề nghị giao hàng"
        description="Mỗi đề nghị chỉ dành cho bạn trong thời gian ngắn rồi chuyển cho tài xế khác."
      />
      {respond.isError && (
        <InlineAlert>
          {respond.error instanceof WebApiError && respond.error.status === 409
            ? respond.error.message
            : 'Không gửi được phản hồi. Thử lại.'}
        </InlineAlert>
      )}
      {order && (
        <InlineAlert tone="success">
          Bạn đang có đơn. <NavLink to="/order">Mở đơn hiện tại</NavLink>
        </InlineAlert>
      )}
      {!offer && !order && (
        <Card>
          <p>
            {presence?.available
              ? 'Chưa có đề nghị. Giữ trang mở để nhận đề nghị mới.'
              : 'Bật sẵn sàng ở Trang chủ để nhận đề nghị.'}
          </p>
          <p className="hint">Khi có đơn đã nhận, mất GPS sẽ không tự hủy đơn.</p>
        </Card>
      )}
      {offer && secondsLeft > 0 && (
        <Card>
          <p>
            <Badge>Còn {secondsLeft} giây</Badge>
          </p>
          <p className="quote-price">{money(offer.priceVnd)}</p>
          <p>
            Cách điểm lấy {km(offer.pickupDistanceMeters)} · quãng đường {km(offer.distanceMeters)}
          </p>
          <p>
            <strong>Lấy:</strong> {offer.pickup.address}
          </p>
          <p>
            <strong>Giao:</strong> {offer.dropoff.address}
          </p>
          <p className="hint">
            Thu tiền mặt của khách. Giá thử nghiệm, chưa phải bảng giá chính thức.
          </p>
          <div className="document-actions">
            <Button
              type="button"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: offer.id, accept: true })}
            >
              Nhận đơn
            </Button>
            <Button
              type="button"
              className="secondary"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: offer.id, accept: false })}
            >
              Từ chối
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}

const nextAction: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  ASSIGNED: { status: 'AT_PICKUP', label: 'Đã đến điểm lấy' },
  AT_PICKUP: { status: 'PICKED_UP', label: 'Đã lấy hàng' },
  PICKED_UP: { status: 'IN_TRANSIT', label: 'Bắt đầu giao' },
  IN_TRANSIT: { status: 'DELIVERED', label: 'Đã giao hàng' },
};
const statusLabels: Record<OrderStatus, string> = {
  SEARCHING: 'Đang tìm tài xế',
  ASSIGNED: 'Đang đến điểm lấy',
  AT_PICKUP: 'Đang ở điểm lấy',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Đã giao',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
};

export function CurrentOrderPage({ api }: { api: WebApi }) {
  const { order } = useWork();
  const client = useQueryClient();
  const [done, setDone] = useState<Order | null>(null);
  const advance = useMutation({
    mutationFn: (input: { id: string; status: OrderStatus; expectedVersion: number }) =>
      api.request<Order>(`/drivers/me/orders/${input.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: input.status, expectedVersion: input.expectedVersion }),
      }),
    onSuccess: (result) => {
      if (result.status === 'DELIVERED') setDone(result);
      void client.invalidateQueries({ queryKey: workKeys.order });
    },
    onError: () => void client.invalidateQueries({ queryKey: workKeys.order }),
  });
  if (!order)
    return (
      <>
        <PageHeader
          eyebrow="ĐƠN HIỆN TẠI"
          title={done ? 'Đã giao xong' : 'Chưa có đơn'}
          description={
            done ? `Thu ${money(done.priceVnd)} tiền mặt nếu chưa thu.` : 'Nhận đề nghị để bắt đầu.'
          }
        />
        <NavLink className="action-link" to="/offers">
          Xem đề nghị
        </NavLink>
      </>
    );
  const action = nextAction[order.status];
  const { pickup, dropoff } = order.stops;
  const toPickup = order.status === 'ASSIGNED' || order.status === 'AT_PICKUP';
  return (
    <>
      <PageHeader
        eyebrow="ĐƠN HIỆN TẠI"
        title={statusLabels[order.status]}
        description={`${money(order.priceVnd)} tiền mặt · ${km(order.distanceMeters)}`}
      />
      {advance.isError && (
        <InlineAlert>
          {advance.error instanceof WebApiError && advance.error.status === 409
            ? 'Đơn vừa thay đổi (có thể đã bị hủy). Trạng thái mới đã được tải.'
            : 'Không cập nhật được trạng thái. Thử lại.'}
        </InlineAlert>
      )}
      <div className="grid">
        <Card>
          <h2>{toPickup ? 'Điểm lấy hàng' : 'Điểm giao hàng'}</h2>
          {[toPickup ? pickup : dropoff].map((stop) => (
            <div key={stop.address} className="stack">
              <p>
                <strong>{stop.address}</strong>
                {stop.detail && <> · {stop.detail}</>}
              </p>
              <p>
                {stop.contactName} · <a href={`tel:${stop.contactPhone}`}>{stop.contactPhone}</a>
              </p>
              {stop.note && <p className="hint">Ghi chú: {stop.note}</p>}
              <a
                className="action-link secondary-link"
                href={directionsUrl(stop.position, order.vehicleType)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Mở chỉ đường (Google Maps)
              </a>
            </div>
          ))}
          {action && (
            <Button
              type="button"
              disabled={advance.isPending}
              onClick={() =>
                advance.mutate({
                  id: order.id,
                  status: action.status,
                  expectedVersion: order.version,
                })
              }
            >
              {advance.isPending ? 'Đang cập nhật…' : action.label}
            </Button>
          )}
        </Card>
        <Card>
          <h2>Hành trình</h2>
          <p>
            <strong>Lấy:</strong> {pickup.address}
          </p>
          <p>
            <strong>Giao:</strong> {dropoff.address}
          </p>
          <p className="hint">
            Giữ trang mở để khách thấy vị trí của bạn. Mất GPS không làm hủy đơn.
          </p>
        </Card>
      </div>
    </>
  );
}
