import { useCallback, useEffect, useMemo, useState } from 'react';
import type { createApi } from '@shango/api-client';
import type { ServiceArea, ServiceAreaVersion } from '@shango/contracts';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shango-theme';
import { errorStatus } from '@/lib/navigation';
import { parseAreaGeoJson } from '@/lib/service-area';
import { AreaMap } from './area-map';

type Api = Pick<
  ReturnType<typeof createApi>,
  'serviceAreas' | 'serviceAreaVersions' | 'updateServiceArea'
>;
const time = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'short',
});

function saveError(error: unknown) {
  const status = errorStatus(error);
  if (status === 400)
    return 'Dữ liệu vùng không hợp lệ: mỗi vòng phải khép kín, nằm trong khung Hà Nội và tối đa 2000 đỉnh.';
  if (status === 403) return 'Chỉ Quản trị viên được sửa vùng phục vụ.';
  if ((status === 409 || status === 422) && error instanceof Error) return error.message;
  return 'Không lưu được vùng phục vụ. Thử lại sau.';
}

export function ServiceAreasPage({
  api,
  role,
  online = true,
}: {
  api: Api;
  role: string;
  online?: boolean;
}) {
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ServiceAreaVersion[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const canEdit = role === 'admin';
  const area = areas?.find((item) => item.id === selectedId) ?? null;

  const reset = useCallback((value: ServiceArea) => {
    setName(value.name);
    setActive(value.active);
    setText(JSON.stringify(value.geometry, null, 2));
  }, []);

  const load = useCallback(
    async (keep?: string) => {
      try {
        const page = await api.serviceAreas();
        setAreas(page.items);
        setError('');
        const next = page.items.find((item) => item.id === keep) ?? page.items[0] ?? null;
        setSelectedId(next?.id ?? null);
        if (next) {
          reset(next);
          setVersions((await api.serviceAreaVersions(next.id)).items);
        }
      } catch {
        setError('Không tải được vùng phục vụ.');
      }
    },
    [api, reset],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = useMemo(() => (text.trim() ? parseAreaGeoJson(text) : null), [text]);
  const draft = parsed && 'geometry' in parsed ? parsed.geometry : null;
  const changed =
    !!area &&
    (name.trim() !== area.name ||
      active !== area.active ||
      (draft !== null && JSON.stringify(draft) !== JSON.stringify(area.geometry)));

  const save = async () => {
    if (!area || !draft) return;
    setBusy(true);
    setNotice('');
    setSaveMessage('');
    try {
      const updated = await api.updateServiceArea(area.id, {
        name: name.trim(),
        active,
        geometry: draft,
        expectedVersion: area.version,
      });
      setNotice(`Đã lưu phiên bản ${updated.version}. Báo giá mới áp dụng vùng này ngay.`);
      await load(area.id);
    } catch (caught) {
      setSaveMessage(saveError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    );
  if (!areas) return <p className="text-muted-foreground">Đang tải vùng phục vụ…</p>;
  if (!area) return <p>Chưa có vùng phục vụ nào.</p>;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Vùng phục vụ</CardTitle>
          <CardDescription>
            Báo giá và tạo đơn chỉ nhận khi cả điểm lấy và điểm giao nằm trong một vùng đang bật.
            Hình dạng vùng do PO duyệt; vùng mặc định là khung tạm Hà Nội.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {areas.length > 1 && (
            <label className="grid max-w-xs gap-1 text-sm font-semibold">
              Chọn vùng
              <select
                className="min-h-11 rounded-lg border border-border bg-card px-3"
                value={area.id}
                onChange={(event) => void load(event.target.value)}
              >
                {areas.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Mã</dt>
              <dd className="font-semibold">{area.code}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trạng thái</dt>
              <dd className="font-semibold">{area.active ? 'Đang bật' : 'Đang tắt'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Diện tích</dt>
              <dd className="font-semibold">
                {area.areaKm2.toLocaleString('vi-VN')} km² · {area.vertices} đỉnh
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Phiên bản</dt>
              <dd className="font-semibold">
                {area.version} · {time.format(new Date(area.updatedAt))}
              </dd>
            </div>
          </dl>
          <AreaMap saved={area.geometry} draft={changed ? draft : null} />
        </CardContent>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Sửa vùng</CardTitle>
            <CardDescription>
              Dán GeoJSON Polygon hoặc MultiPolygon (tọa độ theo thứ tự kinh độ, vĩ độ). Bản nháp
              hiện nét đứt trên bản đồ trước khi lưu. Mỗi lần lưu tạo phiên bản mới và ghi nhật ký.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              Tên vùng
              <input
                className="min-h-11 rounded-lg border border-border bg-card px-3 font-normal"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Đang bật (nhận báo giá và đơn)
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              GeoJSON
              <textarea
                className="min-h-48 rounded-lg border border-border bg-card p-3 font-mono text-xs font-normal"
                spellCheck={false}
                value={text}
                aria-invalid={parsed !== null && 'error' in parsed}
                aria-describedby="area-json-status"
                onChange={(event) => setText(event.target.value)}
              />
            </label>
            <p id="area-json-status" className="text-sm" aria-live="polite">
              {parsed && 'error' in parsed ? (
                <span className="text-destructive">{parsed.error}</span>
              ) : changed ? (
                'Có thay đổi chưa lưu.'
              ) : (
                'Không có thay đổi.'
              )}
            </p>
            {saveMessage && (
              <p role="alert" className="text-sm text-destructive">
                {saveMessage}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary-contained"
                disabled={!online || busy || !changed || !draft || name.trim().length < 2}
                onClick={() => void save()}
              >
                {busy ? 'Đang lưu…' : 'Lưu vùng'}
              </Button>
              <Button
                type="button"
                variant="primary-outlined"
                disabled={busy || !changed}
                onClick={() => {
                  reset(area);
                  setSaveMessage('');
                }}
              >
                Hoàn tác
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Điều phối viên chỉ xem được vùng. Chỉ Quản trị viên được sửa.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lịch sử phiên bản</CardTitle>
        </CardHeader>
        <CardContent>
          <ol aria-label="Lịch sử phiên bản vùng" className="grid gap-1 text-sm">
            {versions.map((item) => (
              <li key={item.version}>
                <strong>v{item.version}</strong> · {time.format(new Date(item.changedAt))} ·{' '}
                {item.name} · {item.active ? 'bật' : 'tắt'} · {item.areaKm2.toLocaleString('vi-VN')}{' '}
                km² · {item.vertices} đỉnh
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
