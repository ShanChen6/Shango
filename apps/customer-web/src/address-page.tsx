import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Coordinate, MapConfig, MapPlace, MapRoute, MapSearch } from '@shango/contracts';
import type { createWebApi } from '@shango/api-client';
import { Badge, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import { AddressMap } from './address-map';
import { OrderComposer } from './order-composer';
import {
  confirmStop,
  draftReady,
  emptyStop,
  placeToStop,
  type DeliveryStop,
  type StopKey,
  withinRegion,
} from './delivery-draft';

type WebApi = ReturnType<typeof createWebApi>;
export function AddressPage({ api }: { api: WebApi }) {
  const configQuery = useQuery({
    queryKey: ['map-config'],
    queryFn: () => api.request<MapConfig>('/maps/config'),
  });
  const [active, setActive] = useState<StopKey>('pickup');
  const [stops, setStops] = useState({ pickup: emptyStop(), dropoff: emptyStop() });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [error, setError] = useState('');
  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [route, setRoute] = useState<MapRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const requestEpoch = useRef(0);
  const config = configQuery.data ?? null;
  const stop = stops[active];
  const ready = draftReady(stops, config);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    setLongitude(stop.position ? String(stop.position.longitude) : '');
    setLatitude(stop.position ? String(stop.position.latitude) : '');
  }, [active, stop.position]);
  const invalidatePending = () => {
    requestEpoch.current += 1;
    setSearching(false);
    setReversing(false);
    setRouting(false);
  };
  const changeStop = (patch: Partial<DeliveryStop>) => {
    invalidatePending();
    setStops((current) => ({
      ...current,
      [active]: { ...current[active], ...patch, confirmed: false },
    }));
    setRoute(null);
    setError('');
  };
  const choose = (position: Coordinate, label = '') => {
    if (!config || !withinRegion(position, config)) {
      requestEpoch.current += 1;
      setError('Điểm nằm ngoài khung thử nghiệm Hà Nội.');
      return;
    }
    changeStop({ position, label });
    setLongitude(String(position.longitude));
    setLatitude(String(position.latitude));
    setResults(null);
  };
  const search = async () => {
    if (!config?.geocodingConfigured || query.trim().length < 3) return;
    const version = ++requestEpoch.current;
    setSearching(true);
    setError('');
    try {
      const value = await api.request<MapSearch>(
        `/maps/search?${new URLSearchParams({ q: query.trim() })}`,
      );
      if (version === requestEpoch.current)
        setResults(value.items.filter((item) => withinRegion(item.position, config)));
    } catch {
      if (version === requestEpoch.current)
        setError('Chưa tìm được địa chỉ. Có thể nhập tọa độ và địa chỉ thủ công.');
    } finally {
      if (version === requestEpoch.current) setSearching(false);
    }
  };
  const reverse = async () => {
    if (!stop.position) return;
    const version = ++requestEpoch.current;
    const selectedStop = active;
    setReversing(true);
    setError('');
    try {
      const value = await api.request<{ item: MapPlace }>(
        `/maps/reverse?${new URLSearchParams({ longitude: String(stop.position.longitude), latitude: String(stop.position.latitude) })}`,
      );
      if (version === requestEpoch.current) {
        setStops((current) => ({
          ...current,
          [selectedStop]: { ...current[selectedStop], label: value.item.label, confirmed: false },
        }));
        setRoute(null);
      }
    } catch {
      if (version === requestEpoch.current)
        setError('Chưa tìm được địa chỉ cho điểm này. Bạn có thể tự nhập địa chỉ.');
    } finally {
      if (version === requestEpoch.current) setReversing(false);
    }
  };
  const buildRoute = async () => {
    if (!ready || !config?.routingConfigured) return;
    const version = ++requestEpoch.current;
    setRouting(true);
    setError('');
    try {
      const pickup = stops.pickup.position!;
      const dropoff = stops.dropoff.position!;
      const value = await api.request<MapRoute>(
        `/maps/route?${new URLSearchParams({ pickupLng: String(pickup.longitude), pickupLat: String(pickup.latitude), dropoffLng: String(dropoff.longitude), dropoffLat: String(dropoff.latitude) })}`,
      );
      if (version === requestEpoch.current) setRoute(value);
    } catch {
      if (version === requestEpoch.current)
        setError('Không tính được tuyến. Địa chỉ đã xác nhận vẫn được giữ để thử lại.');
    } finally {
      if (version === requestEpoch.current) setRouting(false);
    }
  };
  const field = (
    label: string,
    key: 'label' | 'addressDetails' | 'contactName' | 'contactPhone' | 'note',
    maxLength: number,
  ) => (
    <TextField
      label={label}
      value={stop[key]}
      maxLength={maxLength}
      onChange={(e) => changeStop({ [key]: e.target.value })}
    />
  );
  if (configQuery.isPending) return <p>Đang tải cấu hình bản đồ…</p>;
  if (configQuery.isError)
    return (
      <>
        <PageHeader
          eyebrow="ĐỊA CHỈ GIAO NHẬN"
          title="Chọn điểm lấy và điểm giao"
          description="Thông tin chỉ giữ trong memory; chưa tạo đơn hoặc tính giá."
        />
        <InlineAlert>
          Không tải được vùng phục vụ nên chưa thể kiểm tra tọa độ nhập thủ công.
        </InlineAlert>
        <Button type="button" onClick={() => void configQuery.refetch()}>
          Thử tải lại
        </Button>
      </>
    );
  return (
    <>
      <PageHeader
        eyebrow="ĐỊA CHỈ GIAO NHẬN"
        title="Chọn điểm lấy và điểm giao"
        description="Thông tin chỉ giữ trong memory; chưa tạo đơn hoặc tính giá."
      />
      {!online && (
        <InlineAlert tone="warning">
          Bạn đang offline. Có thể tiếp tục sửa nội dung hiện có nhưng không thể tìm hoặc xác nhận
          dữ liệu mới từ máy chủ.
        </InlineAlert>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="address-layout">
        <Card>
          <div className="tab-list" aria-label="Điểm giao nhận">
            {(['pickup', 'dropoff'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={active === key}
                onClick={() => {
                  invalidatePending();
                  setActive(key);
                  setError('');
                  setResults(null);
                }}
              >
                {key === 'pickup' ? 'Điểm lấy' : 'Điểm giao'} {stops[key].confirmed ? '✓' : ''}
              </button>
            ))}
          </div>
          {config && <AddressMap config={config} position={stop.position} onPick={choose} />}
          <div className="coordinate-grid">
            <TextField
              label="Kinh độ"
              inputMode="decimal"
              value={longitude}
              onChange={(e) => {
                setLongitude(e.target.value);
                changeStop({});
              }}
            />
            <TextField
              label="Vĩ độ"
              inputMode="decimal"
              value={latitude}
              onChange={(e) => {
                setLatitude(e.target.value);
                changeStop({});
              }}
            />
          </div>
          <Button
            type="button"
            onClick={() => choose({ longitude: Number(longitude), latitude: Number(latitude) })}
          >
            Áp dụng tọa độ
          </Button>
          <a className="attribution" href={config?.attributionUrl} target="_blank" rel="noreferrer">
            {config?.attribution}
          </a>
        </Card>
        <Card>
          <div className="stack">
            <TextField
              label="Tìm địa chỉ tại Hà Nội"
              value={query}
              maxLength={160}
              onChange={(e) => {
                invalidatePending();
                setQuery(e.target.value);
                setResults(null);
              }}
            />
            <Button
              type="button"
              disabled={
                !online || searching || !config?.geocodingConfigured || query.trim().length < 3
              }
              onClick={() => void search()}
            >
              {searching ? 'Đang tìm…' : 'Tìm địa chỉ'}
            </Button>
            {!config?.geocodingConfigured && (
              <p>Tìm địa chỉ chưa được cấu hình. Dùng tọa độ và địa chỉ thủ công.</p>
            )}
            {results?.length === 0 && (
              <p>Không có kết quả. Thử thêm tên đường hoặc nhập thủ công.</p>
            )}
            {results?.map((item) => (
              <button
                className="result"
                key={item.id}
                onClick={() => choose(item.position, item.label)}
              >
                {item.label}
              </button>
            ))}
            <Button
              type="button"
              disabled={!online || reversing || !stop.position || !config?.geocodingConfigured}
              onClick={() => void reverse()}
            >
              {reversing ? 'Đang tra…' : 'Lấy địa chỉ tại điểm'}
            </Button>
            {field('Địa chỉ của điểm', 'label', 2000)}
            {field('Số nhà, hẻm, tầng hoặc điểm hẹn', 'addressDetails', 200)}
            {field('Tên người liên hệ', 'contactName', 80)}
            {field('Số điện thoại liên hệ', 'contactPhone', 30)}
            {field('Ghi chú giao nhận', 'note', 500)}
            <Button
              type="button"
              onClick={() => {
                const checked = confirmStop(stop, config);
                if (checked.errors.length) setError(checked.errors.join(' '));
                else setStops((current) => ({ ...current, [active]: checked.stop }));
              }}
            >
              {stop.confirmed ? 'Đã xác nhận điểm này' : 'Xác nhận điểm này'}
            </Button>
            <Button
              type="button"
              onClick={() => {
                invalidatePending();
                setStops({ pickup: emptyStop(), dropoff: emptyStop() });
                setActive('pickup');
                setQuery('');
                setResults(null);
                setRoute(null);
                setLongitude('');
                setLatitude('');
                setError('');
              }}
            >
              Xóa thông tin giao nhận
            </Button>
          </div>
        </Card>
      </div>
      {ready && (
        <Card className="summary-card">
          <Badge>Draft hợp lệ</Badge>
          <h2>Thông tin giao nhận</h2>
          <p>
            <strong>Điểm lấy:</strong> {stops.pickup.label} · {stops.pickup.contactName}
          </p>
          <p>
            <strong>Điểm giao:</strong> {stops.dropoff.label} · {stops.dropoff.contactName}
          </p>
          {config?.routingConfigured ? (
            <Button disabled={!online || routing} onClick={() => void buildRoute()}>
              {routing ? 'Đang tính tuyến…' : 'Kiểm tra tuyến'}
            </Button>
          ) : (
            <InlineAlert tone="warning">
              Routing chưa cấu hình. Không hiển thị tuyến hoặc thời gian giả.
            </InlineAlert>
          )}
          {route && (
            <p>
              {(route.distanceMeters / 1000).toFixed(1)} km · khoảng{' '}
              {Math.ceil(route.durationSeconds / 60)} phút · chưa xác minh xe máy
            </p>
          )}
          <OrderComposer
            api={api}
            stops={stops}
            routingConfigured={Boolean(config?.routingConfigured)}
            online={online}
          />
        </Card>
      )}
    </>
  );
}
