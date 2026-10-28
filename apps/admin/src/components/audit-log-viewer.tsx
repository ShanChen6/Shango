import { useEffect, useState } from 'react';
import type { createApi } from '@shango/api-client';
import type { AuditAction, AuditFilters, AuditPage } from '@shango/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  InputField,
  InputLabel,
  Input,
  InputDescription,
} from '@/components/ui/shango-theme';

const actionLabels: Record<AuditAction, string> = {
  'user.profile.updated': 'Cập nhật hồ sơ',
  'driver.review': 'Duyệt hồ sơ tài xế',
  'admin.bootstrap': 'Cấp quyền quản trị',
  'driver.document.uploaded': 'Nộp giấy tờ tài xế',
  'driver.document.viewed': 'Xem giấy tờ tài xế',
  'driver.review.reopened': 'Mở lại hồ sơ tài xế',
};
const formatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'medium',
});
export function auditDateRange(from: string, to: string): Pick<AuditFilters, 'from' | 'to'> {
  return {
    ...(from ? { from: new Date(`${from}T00:00:00+07:00`).toISOString() } : {}),
    ...(to ? { to: new Date(Date.parse(`${to}T00:00:00+07:00`) + 86400000).toISOString() } : {}),
  };
}
export function AuditLogViewer({ api }: { api: ReturnType<typeof createApi> }) {
  const [action, setAction] = useState<AuditAction | ''>('');
  const [actorId, setActorId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<AuditFilters>({});
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const cursor = cursors.at(-1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    api
      .auditLogs(filters, cursor)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Không tải được nhật ký');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, filters, cursor, revision]);
  return (
    <div data-theme="admin" className="grid gap-5 text-foreground">
      <Card>
        <CardHeader>
          <CardTitle>Nhật ký thao tác</CardTitle>
          <CardDescription>
            Chỉ tài khoản Admin được xem. Thời gian hiển thị theo Việt Nam; khoảng ngày bao gồm cả
            ngày kết thúc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (from && to && from > to) {
                setError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
                return;
              }
              setCursors([undefined]);
              setFilters({
                ...(action ? { action } : {}),
                ...(actorId.trim() ? { actorId: actorId.trim() } : {}),
                ...(entityId.trim() ? { entityId: entityId.trim() } : {}),
                ...auditDateRange(from, to),
              });
            }}
          >
            <InputField>
              <InputLabel htmlFor="audit-action">Loại thao tác</InputLabel>
              <select
                id="audit-action"
                className="m-0 min-h-11 rounded-xl border border-border bg-card px-3 text-sm text-foreground"
                value={action}
                onChange={(event) => setAction(event.target.value as AuditAction | '')}
              >
                <option value="">Tất cả</option>
                {Object.entries(actionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </InputField>
            <InputField>
              <InputLabel>Người thực hiện</InputLabel>
              <Input
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
                placeholder="ID tài khoản (UUID)"
              />
              <InputDescription>Để trống để xem tất cả tài khoản.</InputDescription>
            </InputField>
            <InputField>
              <InputLabel>Đối tượng bị tác động</InputLabel>
              <Input
                value={entityId}
                onChange={(event) => setEntityId(event.target.value)}
                placeholder="ID hồ sơ/tài khoản (UUID)"
              />
            </InputField>
            <InputField>
              <InputLabel>Từ ngày</InputLabel>
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </InputField>
            <InputField>
              <InputLabel>Đến ngày</InputLabel>
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </InputField>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" disabled={loading}>
                Lọc nhật ký
              </Button>
              <Button
                variant="secondary"
                disabled={loading}
                onClick={() => {
                  setCursors([undefined]);
                  setRevision((value) => value + 1);
                }}
              >
                Làm mới
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
          <Button
            className="ml-3"
            size="sm"
            variant="primary-outlined"
            onClick={() => setRevision((value) => value + 1)}
          >
            Thử lại
          </Button>
        </div>
      )}
      <Card>
        <CardContent>
          {loading ? (
            <p role="status" className="m-0 py-6 text-sm text-muted-foreground">
              Đang tải nhật ký…
            </p>
          ) : data?.items.length === 0 ? (
            <p role="status" className="m-0 py-6 text-sm text-muted-foreground">
              Không có thao tác phù hợp bộ lọc.
            </p>
          ) : (
            data && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Người thực hiện</th>
                      <th>Thao tác / đối tượng</th>
                      <th>Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap">
                          {formatter.format(new Date(item.createdAt))}
                          <small>#{item.id}</small>
                        </td>
                        <td>
                          {item.actorDisplayName ?? 'Chưa đặt tên'}
                          <small className="max-w-48 break-all">{item.actorId}</small>
                        </td>
                        <td>
                          {Object.hasOwn(actionLabels, item.action)
                            ? actionLabels[item.action as AuditAction]
                            : item.action}
                          <small className="max-w-56 break-all">
                            {item.entityType} · {item.entityId}
                          </small>
                        </td>
                        <td>
                          <pre className="m-0 max-w-xs text-xs whitespace-pre-wrap break-words">
                            {JSON.stringify(item.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          <div className="mt-5 flex items-center justify-end gap-3">
            <Button
              variant="secondary"
              disabled={loading || cursors.length === 1}
              onClick={() => setCursors((values) => values.slice(0, -1))}
            >
              Trước
            </Button>
            <span className="text-xs">Trang {cursors.length}</span>
            <Button
              variant="secondary"
              disabled={loading || !data?.nextCursor}
              onClick={() => {
                if (data?.nextCursor) setCursors((values) => [...values, data.nextCursor!]);
              }}
            >
              Sau
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
