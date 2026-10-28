import { useEffect, useRef, useState } from 'react';
import type { createApi } from '@shango/api-client';
import type { Coordinate, MapConfig, MapPlace, MapRoute } from '@shango/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  InputField,
  InputLabel,
  InputGroup,
  Input,
  InputAction,
  InputDescription,
} from '@/components/ui/shango-theme';
import { MapCanvas } from './map-canvas';

type Props = { api: ReturnType<typeof createApi> };
type SelectedPoint = { position: Coordinate; label: string };
export function MapPlayground({ api }: Props) {
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapPlace[] | null>(null);
  const [target, setTarget] = useState<'pickup' | 'dropoff'>('pickup');
  const [pickup, setPickup] = useState<SelectedPoint | null>(null);
  const [dropoff, setDropoff] = useState<SelectedPoint | null>(null);
  const [route, setRoute] = useState<MapRoute | null>(null);
  const [latitude, setLatitude] = useState('21.0278');
  const [longitude, setLongitude] = useState('105.8342');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    api
      .mapConfig()
      .then((value) => {
        if (active.current) setConfig(value);
      })
      .catch((e) => {
        if (active.current)
          setError(e instanceof Error ? e.message : 'Không tải được cấu hình bản đồ');
      });
    return () => {
      active.current = false;
      generation.current++;
    };
  }, [api]);
  async function run(work: (valid: () => boolean) => Promise<void>) {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    const valid = () => active.current && generation.current === version;
    try {
      await work(valid);
    } catch (e) {
      if (valid()) setError(e instanceof Error ? e.message : 'Không thể xử lý yêu cầu bản đồ');
    } finally {
      if (valid()) setBusy(false);
    }
  }
  function select(position: Coordinate, label: string) {
    if (!config) return;
    const { west, south, east, north } = config.region.bounds;
    if (
      !Number.isFinite(position.latitude) ||
      !Number.isFinite(position.longitude) ||
      position.longitude < west ||
      position.longitude > east ||
      position.latitude < south ||
      position.latitude > north
    ) {
      setError('Tọa độ nằm ngoài khung thử nghiệm Hà Nội.');
      return;
    }
    // Invalidate pending route/reverse results when endpoints change.
    generation.current++;
    setBusy(false);
    setError('');
    setRoute(null);
    (target === 'pickup' ? setPickup : setDropoff)({ position, label });
    setLatitude(String(position.latitude));
    setLongitude(String(position.longitude));
  }
  function typedPoint(): Coordinate | null {
    if (!latitude.trim() || !longitude.trim()) {
      setError('Nhập đủ vĩ độ và kinh độ.');
      return null;
    }
    const point = { latitude: Number(latitude), longitude: Number(longitude) };
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      setError('Tọa độ phải là số hợp lệ.');
      return null;
    }
    return point;
  }
  return (
    <div data-theme="admin" className="grid gap-5 text-foreground">
      <Card variant="soft" density="compact">
        <CardHeader>
          <CardTitle>Thử nghiệm bản đồ Hà Nội</CardTitle>
          <CardDescription>
            Tìm địa chỉ khi bấm nút, chọn điểm lấy/giao và kiểm tra tuyến đường. Khung thử nghiệm
            chưa phải vùng phục vụ được duyệt.
          </CardDescription>
        </CardHeader>
      </Card>
      {error && (
        <p role="alert" className="m-0 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!config ? (
        <Button
          variant="primary-outlined"
          onClick={() =>
            void run(async (valid) => {
              const value = await api.mapConfig();
              if (valid()) setConfig(value);
            })
          }
          loading={busy}
        >
          Tải cấu hình bản đồ
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-muted px-3 py-2 text-xs">
              Địa chỉ: {config.geocodingConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'}
            </span>
            <span className="rounded-full bg-muted px-3 py-2 text-xs">
              Routing: {config.routingConfigured ? 'Đã cấu hình' : 'Chưa cấu hình'}
            </span>
            <a
              href={config.attributionUrl}
              target="_blank"
              rel="noreferrer"
              className="self-center text-xs text-primary-500 underline"
            >
              {config.attribution}
            </a>
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(17rem,1fr)_minmax(0,1.6fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Chọn điểm giao nhận</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="flex gap-2" aria-label="Điểm đang chọn">
                  <Button
                    size="sm"
                    disabled={busy}
                    aria-pressed={target === 'pickup'}
                    variant={target === 'pickup' ? 'primary-contained' : 'secondary'}
                    onClick={() => {
                      setTarget('pickup');
                      setResults(null);
                    }}
                  >
                    Điểm lấy
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    aria-pressed={target === 'dropoff'}
                    variant={target === 'dropoff' ? 'primary-contained' : 'secondary'}
                    onClick={() => {
                      setTarget('dropoff');
                      setResults(null);
                    }}
                  >
                    Điểm giao
                  </Button>
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const submitted = query;
                    setResults(null);
                    void run(async (valid) => {
                      const value = await api.searchPlaces(submitted);
                      if (valid()) setResults(value.items);
                    });
                  }}
                >
                  <InputField disabled={busy || !config.geocodingConfigured}>
                    <InputLabel>Tìm địa chỉ tại Hà Nội</InputLabel>
                    <InputGroup>
                      <Input
                        placeholder="Ví dụ: Hồ Hoàn Kiếm"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        minLength={3}
                        maxLength={160}
                        required
                      />
                      <InputAction
                        type="submit"
                        aria-label="Tìm địa chỉ"
                        disabled={query.trim().length < 3}
                      >
                        ↗
                      </InputAction>
                    </InputGroup>
                    <InputDescription>
                      Chỉ gửi khi bấm tìm; không tự gửi theo từng ký tự.
                    </InputDescription>
                  </InputField>
                </form>
                {results && (
                  <div role="status" className="grid gap-2">
                    {results.length === 0 ? (
                      <p className="m-0 text-sm text-muted-foreground">
                        Không tìm thấy địa chỉ. Thử thêm tên đường hoặc chọn tọa độ.
                      </p>
                    ) : (
                      results.map((item) => (
                        <Button
                          key={item.id}
                          variant="secondary"
                          disabled={busy}
                          className="h-auto justify-start text-left whitespace-normal"
                          onClick={() => select(item.position, item.label)}
                        >
                          {item.label}
                        </Button>
                      ))
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <InputField disabled={busy}>
                    <InputLabel>Vĩ độ</InputLabel>
                    <Input
                      inputMode="decimal"
                      value={latitude}
                      onChange={(event) => setLatitude(event.target.value)}
                    />
                  </InputField>
                  <InputField disabled={busy}>
                    <InputLabel>Kinh độ</InputLabel>
                    <Input
                      inputMode="decimal"
                      value={longitude}
                      onChange={(event) => setLongitude(event.target.value)}
                    />
                  </InputField>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary-outlined"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      const point = typedPoint();
                      if (point) select(point, 'Điểm chọn bằng tọa độ');
                    }}
                  >
                    Chọn tọa độ
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || !config.geocodingConfigured}
                    onClick={() => {
                      const point = typedPoint();
                      if (!point) return;
                      void run(async (valid) => {
                        const value = await api.reversePlace(point);
                        if (valid()) select(value.requestedPosition, value.item.label);
                      });
                    }}
                  >
                    Tìm địa chỉ tọa độ
                  </Button>
                </div>
                <div className="grid gap-3 rounded-xl bg-muted p-3 text-sm">
                  <p className="m-0 text-foreground">
                    <b>Lấy:</b> {pickup?.label ?? 'Chưa chọn'}
                  </p>
                  <p className="m-0 text-foreground">
                    <b>Giao:</b> {dropoff?.label ?? 'Chưa chọn'}
                  </p>
                </div>
                <Button
                  loading={busy}
                  disabled={!pickup || !dropoff || !config.routingConfigured}
                  onClick={() => {
                    if (!pickup || !dropoff) return;
                    setRoute(null);
                    void run(async (valid) => {
                      const value = await api.mapRoute(pickup.position, dropoff.position);
                      if (valid()) setRoute(value);
                    });
                  }}
                >
                  Tính tuyến đường
                </Button>
                {!config.routingConfigured && (
                  <p className="m-0 text-xs text-muted-foreground">
                    Chưa có dịch vụ định tuyến. Tính tuyến sẽ được bật sau khi cấu hình OSRM.
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="grid content-start gap-4">
              <MapCanvas
                config={config}
                pickup={pickup?.position}
                dropoff={dropoff?.position}
                route={route}
                onPick={(point) => {
                  if (!busy) select(point, 'Điểm chọn trên bản đồ');
                }}
              />
              {route && (
                <Card density="compact">
                  <CardContent>
                    <p className="m-0 text-base font-semibold text-foreground">
                      {(route.distanceMeters / 1000).toFixed(2)} km · khoảng{' '}
                      {Math.ceil(route.durationSeconds / 60)} phút
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tuyến ô tô thử nghiệm; chưa xác minh khả năng đi xe máy. Chưa dùng để báo giá.
                    </p>
                  </CardContent>
                </Card>
              )}
              <p className="m-0 text-xs text-muted-foreground">
                Có thể bấm trên bản đồ hoặc nhập tọa độ để chọn điểm. Địa chỉ tìm được cần được
                người dùng kiểm tra lại.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
