import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserProfile } from '@shango/contracts';
import { WebApiError, type createWebApi } from '@shango/api-client';
import { Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';

type WebApi = ReturnType<typeof createWebApi>;
export function ProfilePage({ api }: { api: WebApi }) {
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.request<UserProfile>('/users/me'),
  });
  const [name, setName] = useState('');
  useEffect(() => {
    if (profile.data) setName(profile.data.displayName ?? '');
  }, [profile.data]);
  const update = useMutation({
    mutationFn: () =>
      api.request<UserProfile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: name, expectedVersion: profile.data!.version }),
        retryOnAuth: true,
      }),
    onSuccess: (value) => client.setQueryData(['profile'], value),
  });
  const conflict =
    update.error &&
    typeof update.error === 'object' &&
    'status' in update.error &&
    update.error.status === 409;
  const updateFailed = update.isError && !conflict;
  const requestId = update.error instanceof WebApiError ? update.error.requestId : undefined;
  return (
    <>
      <PageHeader
        eyebrow="TÀI KHOẢN"
        title="Hồ sơ khách hàng"
        description="Cập nhật có kiểm tra phiên bản để không ghi đè thay đổi từ phiên khác."
      />
      {profile.isError && (
        <>
          <InlineAlert>Không tải được hồ sơ. Kiểm tra mạng rồi thử lại.</InlineAlert>
          <Button type="button" onClick={() => void profile.refetch()}>
            Thử tải lại
          </Button>
        </>
      )}
      {conflict && (
        <InlineAlert tone="warning">
          Hồ sơ đã thay đổi ở phiên khác. Tải lại trước khi lưu.
        </InlineAlert>
      )}
      {updateFailed && (
        <InlineAlert>
          Không lưu được hồ sơ. Nội dung đang sửa vẫn được giữ để bạn thử lại.
          {requestId ? ` Mã yêu cầu: ${requestId}.` : ''}
        </InlineAlert>
      )}
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <TextField
            label="Tên hiển thị"
            value={name}
            minLength={2}
            maxLength={80}
            required
            onChange={(e) => setName(e.target.value)}
          />
          <Button disabled={!profile.data || update.isPending}>
            {update.isPending ? 'Đang lưu…' : updateFailed ? 'Thử lưu lại' : 'Lưu hồ sơ'}
          </Button>
          {conflict && (
            <Button type="button" onClick={() => void profile.refetch()}>
              Tải phiên bản mới
            </Button>
          )}
        </form>
      </Card>
    </>
  );
}
