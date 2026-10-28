import { useCallback, useEffect, useRef, useState } from 'react';
import type { createApi } from '@shango/api-client';
import type { DriverDocuments, DriverProfile, DocumentKind } from '@shango/contracts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shango-theme';

const labels: Record<DocumentKind, string> = {
  identity_front: 'CCCD mặt trước',
  identity_back: 'CCCD mặt sau',
  driver_license: 'Giấy phép lái xe',
  vehicle_registration: 'Đăng ký xe',
};
export function DriverDocumentReview({
  api,
  driverId,
  onProfileChange,
  onReady,
}: {
  api: ReturnType<typeof createApi>;
  driverId: string;
  onProfileChange: (profile: DriverProfile) => void;
  onReady: (ready: boolean) => void;
}) {
  const [data, setData] = useState<DriverDocuments | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ url: string; kind: DocumentKind } | null>(null);
  const callbacks = useRef({ onProfileChange, onReady });
  callbacks.current = { onProfileChange, onReady };
  const previewUrl = useRef<string | null>(null);
  const generation = useRef(0);
  const clearPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  }, []);
  const apply = useCallback((value: DriverDocuments) => {
    setData(value);
    callbacks.current.onProfileChange(value.profile);
    callbacks.current.onReady(
      value.requiredKinds.every((kind) =>
        value.items.some((item) => item.kind === kind && value.viewedIds.includes(item.id)),
      ),
    );
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    callbacks.current.onReady(false);
    setData(null);
    setError('');
    setBusy(true);
    clearPreview();
    api
      .adminDriverDocuments(driverId)
      .then((value) => {
        if (generation.current === version) apply(value);
      })
      .catch((e) => {
        if (generation.current === version)
          setError(e instanceof Error ? e.message : 'Không tải được giấy tờ');
      })
      .finally(() => {
        if (generation.current === version) setBusy(false);
      });
    return () => {
      generation.current++;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    };
  }, [api, driverId, apply, clearPreview]);
  async function open(id: string, kind: DocumentKind) {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    clearPreview();
    callbacks.current.onReady(false);
    try {
      const blob = await api.documentContent(id);
      if (generation.current !== version) return;
      const url = URL.createObjectURL(blob);
      previewUrl.current = url;
      setPreview({ url, kind });
      const latest = await api.adminDriverDocuments(driverId);
      if (generation.current === version) apply(latest);
    } catch (e) {
      if (generation.current === version)
        setError(e instanceof Error ? e.message : 'Không mở được giấy tờ');
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }
  return (
    <Card density="compact">
      <CardHeader>
        <CardTitle>Giấy tờ tài xế</CardTitle>
        <CardDescription>
          Mở từng ảnh bắt buộc để kiểm tra trước khi duyệt. Ảnh chỉ được tải qua phiên đăng nhập có
          quyền.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        {!data && !busy && (
          <Button
            variant="secondary"
            onClick={() => {
              setBusy(true);
              setError('');
              const version = ++generation.current;
              void api
                .adminDriverDocuments(driverId)
                .then((value) => {
                  if (generation.current === version) apply(value);
                })
                .catch(() => {
                  if (generation.current === version) setError('Không tải được giấy tờ');
                })
                .finally(() => {
                  if (generation.current === version) setBusy(false);
                });
            }}
          >
            Tải lại giấy tờ
          </Button>
        )}
        {busy && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            Đang tải giấy tờ…
          </p>
        )}
        {data &&
          data.requiredKinds.map((kind) => {
            const document = data.items.find((item) => item.kind === kind);
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-3 text-sm"
                key={kind}
              >
                <span>
                  {labels[kind]} ·{' '}
                  {document
                    ? data.viewedIds.includes(document.id)
                      ? 'Đã mở'
                      : 'Chưa mở'
                    : 'Chưa nộp'}
                </span>
                {document && (
                  <Button
                    size="sm"
                    variant="primary-outlined"
                    disabled={busy}
                    onClick={() => void open(document.id, kind)}
                  >
                    Xem {labels[kind]}
                  </Button>
                )}
              </div>
            );
          })}
        {preview && (
          <div className="grid gap-2">
            <img
              src={preview.url}
              alt={labels[preview.kind]}
              className="max-h-[32rem] w-full rounded-lg border border-border object-contain"
            />
            <Button variant="secondary" size="sm" onClick={clearPreview}>
              Đóng ảnh
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
