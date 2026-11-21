import { useEffect, useId, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentKind,
  DocumentUpload,
  DriverDocument,
  DriverDocuments,
} from '@shango/contracts';
import { Badge, Button, Card, InlineAlert, PageHeader } from '@shango/ui';
import {
  driverKeys,
  errorStatus,
  requestIdSuffix,
  useDriverDocuments,
  useDriverProfile,
  type WebApi,
} from './driver-data';
import {
  ACCEPTED_DOCUMENT_TYPES,
  documentFileError,
  documentLabels,
  missingDocuments,
} from './driver-policy';

type Selection = { kind: DocumentKind; file: File; url: string };
type Viewer = { kind: DocumentKind; url: string };

/** Object URLs are memory-only; every replacement, close, unmount or hide revokes the previous one. */
function useObjectUrl<T extends { url: string }>() {
  const [value, setValue] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  const replace = (next: T | null) => {
    if (current.current) URL.revokeObjectURL(current.current.url);
    current.current = next;
    setValue(next);
  };
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current.url);
    },
    [],
  );
  return [value, replace] as const;
}

function uploadMessage(error: unknown) {
  switch (errorStatus(error)) {
    case 409:
      return 'Hồ sơ đã thay đổi hoặc đã được duyệt. Tải lại hồ sơ rồi nộp lại; ảnh đã chọn vẫn được giữ.';
    case 413:
      return 'Ảnh vượt quá giới hạn của máy chủ.';
    case 429:
      return 'Bạn đã tải lên quá nhiều lần. Vui lòng thử lại sau.';
    case 400:
      return 'Máy chủ không đọc được ảnh. Hãy chọn ảnh JPEG/PNG rõ nét khác.';
    default:
      return 'Không nộp được ảnh. Ảnh đã chọn vẫn được giữ để thử lại.';
  }
}

function DocumentRow(props: {
  kind: DocumentKind;
  current: DriverDocument | undefined;
  locked: boolean;
  busy: boolean;
  onPick: (kind: DocumentKind, file: File | undefined) => void;
  onView: (document: DriverDocument) => void;
}) {
  const inputId = useId();
  const label = documentLabels[props.kind];
  return (
    <li className="document-row">
      <div>
        <strong>{label}</strong>
        <span className={props.current ? 'doc-state ok' : 'doc-state missing'}>
          {props.current ? 'Đã nộp' : 'Còn thiếu'}
        </span>
      </div>
      <div className="document-actions">
        {props.current && (
          <Button type="button" disabled={props.busy} onClick={() => props.onView(props.current!)}>
            Xem ảnh {label}
          </Button>
        )}
        {!props.locked && (
          <>
            <label className="file-button" htmlFor={inputId}>
              {props.current ? 'Thay' : 'Chọn'} ảnh {label}
            </label>
            <input
              id={inputId}
              className="visually-hidden"
              type="file"
              accept={ACCEPTED_DOCUMENT_TYPES}
              disabled={props.busy}
              onChange={(event) => {
                props.onPick(props.kind, event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </>
        )}
      </div>
    </li>
  );
}

export function DocumentsPage({ api }: { api: WebApi }) {
  const client = useQueryClient();
  const profile = useDriverProfile(api);
  const documents = useDriverDocuments(api, Boolean(profile.data));
  const [selection, setSelection] = useObjectUrl<Selection>();
  const [viewer, setViewer] = useObjectUrl<Viewer>();
  const [pickError, setPickError] = useState('');
  const [viewError, setViewError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setViewer(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const upload = useMutation({
    mutationFn: (input: { selection: Selection; expectedUpdatedAt: string }) => {
      const form = new FormData();
      form.append('kind', input.selection.kind);
      form.append('expectedUpdatedAt', input.expectedUpdatedAt);
      form.append('file', input.selection.file);
      // Uploads are never replayed automatically after auth failures (WEB-005 guardrail).
      return api.request<DocumentUpload>('/drivers/me/documents', { method: 'POST', body: form });
    },
    onSuccess: (result) => {
      client.setQueryData<DriverDocuments>(driverKeys.documents, (old) =>
        old
          ? {
              ...old,
              profile: result.profile,
              items: [
                ...old.items.filter((item) => item.kind !== result.document.kind),
                result.document,
              ],
            }
          : old,
      );
      client.setQueryData(driverKeys.profile, result.profile);
      setNotice(`Đã nộp ${documentLabels[result.document.kind]}. Hồ sơ chuyển về chờ duyệt.`);
      setSelection(null);
    },
  });

  const view = useMutation({
    mutationFn: (document: DriverDocument) =>
      api.request<Blob>(`/driver-documents/${document.id}/content`, { responseType: 'blob' }),
    onSuccess: (blob, document) =>
      setViewer({ kind: document.kind, url: URL.createObjectURL(blob) }),
    onError: () =>
      setViewError(
        'Không mở được ảnh. Ảnh có thể đã được thay bằng bản mới; hãy tải lại danh sách.',
      ),
  });

  const pick = (kind: DocumentKind, file: File | undefined) => {
    setNotice('');
    upload.reset();
    if (!file) return;
    const error = documentFileError(file);
    setPickError(error ?? '');
    if (error) return;
    setSelection({ kind, file, url: URL.createObjectURL(file) });
  };

  const reload = async () => {
    upload.reset();
    await profile.refetch();
    await documents.refetch();
  };

  if (profile.isPending) return <p>Đang tải hồ sơ…</p>;
  const data = documents.data;
  const locked = profile.data?.status === 'approved';
  const missing = data ? missingDocuments(data.requiredKinds, data.items) : [];
  const busy = upload.isPending || view.isPending;

  return (
    <>
      <PageHeader
        eyebrow="XÁC MINH TÀI XẾ"
        title="Giấy tờ tài xế"
        description="Ảnh được lưu riêng tư, chỉ bạn và người xét duyệt được xem. Chỉ nhận JPEG/PNG tối đa 5 MiB."
      />
      {profile.isError && (
        <InlineAlert>
          Không tải được hồ sơ.{' '}
          <Button type="button" onClick={() => void profile.refetch()}>
            Thử tải lại
          </Button>
        </InlineAlert>
      )}
      {profile.isSuccess && !profile.data && (
        <Card>
          <InlineAlert tone="warning">Cần gửi hồ sơ phương tiện trước khi nộp giấy tờ.</InlineAlert>
          <NavLink className="action-link" to="/profile">
            Gửi hồ sơ phương tiện
          </NavLink>
        </Card>
      )}
      {documents.isError && (
        <InlineAlert>
          Không tải được danh sách giấy tờ.{' '}
          <Button type="button" onClick={() => void documents.refetch()}>
            Thử tải lại
          </Button>
        </InlineAlert>
      )}
      {locked && (
        <InlineAlert tone="success">
          Hồ sơ đã duyệt; giấy tờ không thể thay từ phía tài xế.
        </InlineAlert>
      )}
      {notice && <InlineAlert tone="success">{notice}</InlineAlert>}
      {pickError && <InlineAlert>{pickError}</InlineAlert>}
      {viewError && <InlineAlert>{viewError}</InlineAlert>}
      {data && (
        <div className="grid">
          <Card>
            <h2>Giấy tờ bắt buộc</h2>
            <p>
              <Badge>
                {missing.length === 0
                  ? 'Đã nộp đủ'
                  : `Còn thiếu ${missing.length}/${data.requiredKinds.length}`}
              </Badge>
            </p>
            <ul className="document-list">
              {data.requiredKinds.map((kind) => (
                <DocumentRow
                  key={kind}
                  kind={kind}
                  current={data.items.find((item) => item.kind === kind)}
                  locked={locked}
                  busy={busy}
                  onPick={pick}
                  onView={(document) => {
                    setViewError('');
                    setViewer(null);
                    view.mutate(document);
                  }}
                />
              ))}
            </ul>
          </Card>
          <div className="stack">
            {selection && (
              <Card>
                <h2>Kiểm tra trước khi nộp</h2>
                <img
                  className="document-preview"
                  src={selection.url}
                  alt={`Ảnh xem trước ${documentLabels[selection.kind]}`}
                />
                <p>
                  {documentLabels[selection.kind]} ·{' '}
                  {Math.max(1, Math.ceil(selection.file.size / 1024))} KiB
                </p>
                {upload.isError && (
                  <InlineAlert>
                    {uploadMessage(upload.error)}
                    {requestIdSuffix(upload.error)}
                  </InlineAlert>
                )}
                <div className="document-actions">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      upload.mutate({ selection, expectedUpdatedAt: data.profile.updatedAt })
                    }
                  >
                    {upload.isPending ? 'Đang nộp…' : 'Nộp ảnh'}
                  </Button>
                  <Button
                    type="button"
                    className="secondary"
                    disabled={upload.isPending}
                    onClick={() => {
                      upload.reset();
                      setSelection(null);
                    }}
                  >
                    Hủy ảnh đã chọn
                  </Button>
                  {errorStatus(upload.error) === 409 && (
                    <Button type="button" className="secondary" onClick={() => void reload()}>
                      Tải lại hồ sơ
                    </Button>
                  )}
                </div>
              </Card>
            )}
            {viewer && (
              <Card>
                <h2>{documentLabels[viewer.kind]}</h2>
                <img
                  className="document-preview"
                  src={viewer.url}
                  alt={`Ảnh đã nộp: ${documentLabels[viewer.kind]}`}
                />
                <Button type="button" className="secondary" onClick={() => setViewer(null)}>
                  Đóng ảnh
                </Button>
              </Card>
            )}
            {!selection && !viewer && (
              <Card>
                <h2>Hướng dẫn</h2>
                <p>
                  Chụp rõ toàn bộ giấy tờ, không lóa, không che thông tin. Ảnh được chuẩn hóa và
                  loại bỏ metadata trên máy chủ.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
