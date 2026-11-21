import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DriverProfile, UserProfile } from '@shango/contracts';
import { Badge, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import {
  driverKeys,
  errorStatus,
  requestIdSuffix,
  useDriverProfile,
  type WebApi,
} from './driver-data';
import {
  normalizePlate,
  statusLabels,
  vehicleErrors,
  vehicleTypeLabels,
  type VehicleType,
} from './driver-policy';

function DisplayNameCard({ api }: { api: WebApi }) {
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: driverKeys.user,
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
    onSuccess: (value) => client.setQueryData(driverKeys.user, value),
  });
  const conflict = errorStatus(update.error) === 409;
  return (
    <Card>
      <h2>Tên hiển thị</h2>
      {profile.isError && (
        <InlineAlert>
          Không tải được tài khoản.{' '}
          <Button type="button" onClick={() => void profile.refetch()}>
            Thử tải lại
          </Button>
        </InlineAlert>
      )}
      {conflict && (
        <InlineAlert tone="warning">
          Tên đã được đổi ở phiên khác. Tải lại trước khi lưu.
        </InlineAlert>
      )}
      {update.isError && !conflict && (
        <InlineAlert>
          Không lưu được tên. Nội dung đang sửa vẫn được giữ.{requestIdSuffix(update.error)}
        </InlineAlert>
      )}
      {update.isSuccess && <InlineAlert tone="success">Đã lưu tên hiển thị.</InlineAlert>}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
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
          {update.isPending ? 'Đang lưu…' : 'Lưu tên'}
        </Button>
        {conflict && (
          <Button
            type="button"
            onClick={() => {
              update.reset();
              void profile.refetch();
            }}
          >
            Tải phiên bản mới
          </Button>
        )}
      </form>
    </Card>
  );
}

function VehicleCard({ api }: { api: WebApi }) {
  const client = useQueryClient();
  const profile = useDriverProfile(api);
  const selectId = useId();
  const [plate, setPlate] = useState('');
  const [type, setType] = useState<VehicleType | ''>('');
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (profile.data) {
      setPlate(profile.data.vehiclePlate);
      setType(profile.data.vehicleType as VehicleType);
    }
  }, [profile.data]);
  const submit = useMutation({
    mutationFn: () =>
      api.request<DriverProfile>('/drivers/me', {
        method: 'POST',
        body: JSON.stringify({ vehiclePlate: normalizePlate(plate), vehicleType: type }),
      }),
    onSuccess: (value) => {
      client.setQueryData(driverKeys.profile, value);
      void client.invalidateQueries({ queryKey: driverKeys.documents });
    },
  });
  const approved = profile.data?.status === 'approved';
  const conflict = errorStatus(submit.error) === 409;
  return (
    <Card>
      <h2>Hồ sơ phương tiện</h2>
      {profile.isPending && <p>Đang tải hồ sơ…</p>}
      {profile.isError && (
        <InlineAlert>
          Không tải được hồ sơ phương tiện.{' '}
          <Button type="button" onClick={() => void profile.refetch()}>
            Thử tải lại
          </Button>
        </InlineAlert>
      )}
      {profile.data && (
        <p>
          Trạng thái: <Badge>{statusLabels[profile.data.status]}</Badge>
        </p>
      )}
      {profile.data?.status === 'rejected' && (
        <InlineAlert tone="warning">
          Lý do từ chối: {profile.data.rejectionReason ?? 'Không có ghi chú'}. Cập nhật thông tin
          hoặc giấy tờ rồi gửi lại.
        </InlineAlert>
      )}
      {approved && (
        <InlineAlert tone="success">
          Hồ sơ đã duyệt. Muốn thay đổi phương tiện, liên hệ quản trị viên để mở lại hồ sơ.
        </InlineAlert>
      )}
      {conflict && (
        <InlineAlert tone="warning">
          Hồ sơ vừa được duyệt hoặc thay đổi. Tải lại để xem trạng thái mới.
        </InlineAlert>
      )}
      {submit.isError && !conflict && (
        <InlineAlert>
          Không gửi được hồ sơ. Thông tin đang nhập vẫn được giữ.{requestIdSuffix(submit.error)}
        </InlineAlert>
      )}
      {submit.isSuccess && (
        <InlineAlert tone="success">
          Đã gửi hồ sơ phương tiện. Hồ sơ chuyển về chờ duyệt.
        </InlineAlert>
      )}
      {errors.length > 0 && (
        <InlineAlert>
          {errors.map((error) => (
            <span key={error}>{error} </span>
          ))}
        </InlineAlert>
      )}
      {!profile.isPending && !profile.isError && (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const found = vehicleErrors({ vehiclePlate: plate, vehicleType: type });
            setErrors(found);
            if (found.length === 0) submit.mutate();
          }}
        >
          <div className="sg-field">
            <label htmlFor={selectId}>Loại phương tiện</label>
            <select
              id={selectId}
              value={type}
              disabled={approved}
              required
              onChange={(e) => setType(e.target.value as VehicleType)}
            >
              <option value="">Chọn loại phương tiện</option>
              {Object.entries(vehicleTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Biển số xe"
            value={plate}
            disabled={approved}
            autoComplete="off"
            required
            maxLength={20}
            onChange={(e) => setPlate(e.target.value)}
          />
          {profile.data && !approved && (
            <p className="hint">Gửi lại hồ sơ sẽ đưa hồ sơ về trạng thái chờ duyệt.</p>
          )}
          <Button disabled={approved || submit.isPending}>
            {submit.isPending
              ? 'Đang gửi…'
              : profile.data
                ? 'Cập nhật hồ sơ'
                : 'Gửi hồ sơ phương tiện'}
          </Button>
          {conflict && (
            <Button
              type="button"
              onClick={() => {
                submit.reset();
                void profile.refetch();
              }}
            >
              Tải lại hồ sơ
            </Button>
          )}
        </form>
      )}
    </Card>
  );
}

export function ProfilePage({ api }: { api: WebApi }) {
  return (
    <>
      <PageHeader
        eyebrow="HỒ SƠ TÀI XẾ"
        title="Hồ sơ tài xế"
        description="Thông tin phương tiện được quản trị viên xét duyệt trước khi nhận đơn."
      />
      <div className="grid">
        <VehicleCard api={api} />
        <DisplayNameCard api={api} />
      </div>
    </>
  );
}
