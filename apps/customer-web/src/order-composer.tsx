import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Order, Quote, VehicleType } from '@shango/contracts';
import { WebApiError, type createWebApi } from '@shango/api-client';
import { Badge, Button, InlineAlert } from '@shango/ui';
import type { DeliveryStop } from './delivery-draft';
import { formatKm, formatMinutes, formatVnd, toQuoteRequest, vehicleLabels } from './order-format';

type WebApi = ReturnType<typeof createWebApi>;

function message(error: unknown, fallback: string) {
  if (!(error instanceof WebApiError))
    return 'Không kết nối được máy chủ. Thông tin đang nhập vẫn được giữ.';
  if (error.status === 503 || error.status === 422 || error.status === 409 || error.status === 429)
    return error.message;
  return `${fallback}${error.requestId ? ` Mã yêu cầu: ${error.requestId}.` : ''}`;
}

/** Quote then create; the quote id is the idempotency key, so retries never double-book. */
export function OrderComposer(props: {
  api: WebApi;
  stops: { pickup: DeliveryStop; dropoff: DeliveryStop };
  routingConfigured: boolean;
  online: boolean;
}) {
  const navigate = useNavigate();
  const selectId = useId();
  const [vehicleType, setVehicleType] = useState<VehicleType>('motorcycle');
  const [quote, setQuote] = useState<Quote | null>(null);
  const draftKey = JSON.stringify([props.stops, vehicleType]);
  useEffect(() => setQuote(null), [draftKey]);

  const quoteMutation = useMutation({
    mutationFn: () =>
      props.api.request<Quote>('/orders/quote', {
        method: 'POST',
        body: JSON.stringify(toQuoteRequest(props.stops, vehicleType)),
        retryOnAuth: true,
      }),
    onSuccess: setQuote,
  });
  const createMutation = useMutation({
    mutationFn: (quoteId: string) =>
      // Safe to replay after auth refresh: same quoteId returns the same order.
      props.api.request<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({ quoteId }),
        retryOnAuth: true,
      }),
    onSuccess: (order) => navigate(`/orders/${order.id}`),
  });
  const expired = quote ? Date.parse(quote.expiresAt) <= Date.now() : false;

  return (
    <div className="stack composer">
      <div className="sg-field">
        <label htmlFor={selectId}>Loại xe</label>
        <select
          id={selectId}
          value={vehicleType}
          onChange={(event) => setVehicleType(event.target.value as VehicleType)}
        >
          {Object.entries(vehicleLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!props.routingConfigured && (
        <InlineAlert tone="warning">
          Chưa thể báo giá vì máy chủ chưa cấu hình định tuyến. ShanGo không dùng khoảng cách đường
          chim bay.
        </InlineAlert>
      )}
      {quoteMutation.isError && (
        <InlineAlert>{message(quoteMutation.error, 'Không lấy được báo giá.')}</InlineAlert>
      )}
      {createMutation.isError && (
        <InlineAlert>{message(createMutation.error, 'Không tạo được đơn.')}</InlineAlert>
      )}
      {quote && (
        <div className="quote" aria-live="polite">
          <p className="quote-price">{formatVnd(quote.priceVnd)}</p>
          <p>
            {vehicleLabels[quote.vehicleType]} · {formatKm(quote.distanceMeters)} · khoảng{' '}
            {formatMinutes(quote.durationSeconds)}
          </p>
          <Badge>Giá thử nghiệm ({quote.tariffVersion}) — chưa phải bảng giá chính thức</Badge>
          <p className="hint">
            Thanh toán tiền mặt trực tiếp cho tài xế. Báo giá có hiệu lực đến{' '}
            {new Date(quote.expiresAt).toLocaleTimeString('vi-VN')}.
          </p>
        </div>
      )}
      {!quote || expired ? (
        <Button
          type="button"
          disabled={!props.online || !props.routingConfigured || quoteMutation.isPending}
          onClick={() => {
            createMutation.reset();
            quoteMutation.mutate();
          }}
        >
          {quoteMutation.isPending ? 'Đang báo giá…' : expired ? 'Báo giá lại' : 'Nhận báo giá'}
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!props.online || createMutation.isPending}
          onClick={() => createMutation.mutate(quote.id)}
        >
          {createMutation.isPending ? 'Đang đặt đơn…' : `Đặt đơn ${formatVnd(quote.priceVnd)}`}
        </Button>
      )}
    </div>
  );
}
