import { NavLink } from 'react-router-dom';
import { Badge, Button, Card, InlineAlert, PageHeader } from '@shango/ui';
import { useDriverDocuments, useDriverProfile, type WebApi } from './driver-data';
import { formatAge, freshnessLabels, onboardingSteps } from './driver-policy';
import { useForegroundLocation } from './use-foreground-location';

const stepLinks = { vehicle: '/profile', documents: '/documents', review: '/profile' } as const;

function LocationCheck() {
  const location = useForegroundLocation();
  const { freshness } = location;
  return (
    <Card>
      <h2>Kiểm tra vị trí</h2>
      <p>
        Chỉ kiểm tra khi trang đang mở. Vị trí <strong>không</strong> được gửi lên máy chủ ở bước
        này.
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
      {location.active ? (
        <Button type="button" className="secondary" onClick={location.stop}>
          Dừng kiểm tra
        </Button>
      ) : (
        <Button type="button" disabled={freshness === 'unsupported'} onClick={location.start}>
          Kiểm tra vị trí
        </Button>
      )}
    </Card>
  );
}

export function HomePage({ api }: { api: WebApi }) {
  const profile = useDriverProfile(api);
  const documents = useDriverDocuments(api, Boolean(profile.data));
  const steps = onboardingSteps(profile.data ?? null, documents.data ?? null);
  const approved = profile.data?.status === 'approved';
  return (
    <>
      <PageHeader
        eyebrow="TRẠNG THÁI LÀM VIỆC"
        title="Sẵn sàng khi GPS hợp lệ"
        description="Socket và độ mới GPS là hai tín hiệu riêng biệt. Khóa màn hình hoặc chuyển nền có thể làm GPS ngừng cập nhật."
      />
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
          <Card>
            <h2>Nhận đơn</h2>
            <Badge>Đang ngoại tuyến</Badge>
            <p>
              {approved
                ? 'Hồ sơ đã duyệt. Bật sẵn sàng sẽ mở khi API dispatch/presence (WEB-009) và bằng chứng thiết bị WEB-002 được nghiệm thu.'
                : 'Cần hồ sơ được duyệt trước khi nhận đơn.'}
            </p>
            <Button type="button" disabled aria-describedby="availability-gate">
              Bật sẵn sàng
            </Button>
            <small id="availability-gate" className="hint">
              ShanGo không bật nhận đơn khi chưa có server presence và chính sách GPS được duyệt.
            </small>
          </Card>
        </div>
        <LocationCheck />
      </div>
    </>
  );
}

export function OffersPage() {
  return (
    <>
      <PageHeader
        eyebrow="ĐỀ NGHỊ GIAO HÀNG"
        title="Đề nghị giao hàng"
        description="Danh sách đề nghị và thao tác đơn chỉ đến từ API authoritative."
      />
      <Card>
        <InlineAlert tone="warning">
          Chưa có API đơn hàng/điều phối (WEB-009). ShanGo không hiển thị đề nghị hoặc trạng thái
          đơn giả.
        </InlineAlert>
        <p>
          Khi có đơn đã nhận, mất GPS sẽ <strong>không</strong> tự hủy đơn; ứng dụng hiển thị vị trí
          cuối, tuổi vị trí và trạng thái kết nối.
        </p>
      </Card>
    </>
  );
}
