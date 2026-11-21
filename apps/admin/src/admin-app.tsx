import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type { createApi } from '@shango/api-client';
import type { DriverReviewItem, Page, Session } from '@shango/contracts';
import { MapPlayground } from './components/map-playground';
import { AuditLogViewer } from './components/audit-log-viewer';
import { DriverDocumentReview } from './components/driver-document-review';
import { OrdersBoard } from './components/orders-board';
import {
  canAccess,
  errorStatus,
  homePath,
  roleLabels,
  sectionForPath,
  sections,
  sectionsFor,
  STAFF_ROLES,
  type Section,
} from './lib/navigation';

type Api = ReturnType<typeof createApi>;
type WebSessionApi = Api & {
  bootstrap?: () => Promise<Session>;
  subscribeSessionInvalid?: (listener: () => void) => () => void;
};
const statusLabels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' } as const;

export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function message(error: unknown, fallback: string) {
  const status = errorStatus(error);
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
  if (status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
  if (status === 429) return 'Thao tác quá nhanh. Thử lại sau ít phút.';
  if (status === null) return 'Không kết nối được máy chủ. Dữ liệu đang nhập vẫn được giữ.';
  return fallback;
}

// ---------- Login ----------

function LoginPage({ api, onSession }: { api: Api; onSession: (session: Session) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="card login"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        void (async () => {
          try {
            if (!challenge) {
              const value = await api.requestOtp(phone, 'customer');
              setChallenge(true);
              setDevCode(value.devCode ?? '');
              return;
            }
            const value = await api.verifyOtp(phone, code);
            if (!(STAFF_ROLES as readonly string[]).includes(value.user.role)) {
              await api.logout().catch(() => undefined);
              throw new Error('Tài khoản chưa có quyền quản trị. Liên hệ người quản lý.');
            }
            setDevCode('');
            setCode('');
            onSession(value);
          } catch (cause) {
            setError(
              cause instanceof Error && !(cause instanceof TypeError) && errorStatus(cause) === null
                ? cause.message
                : message(cause, 'Mã không hợp lệ hoặc đã hết hạn.'),
            );
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <h2>Chào mừng trở lại</h2>
      <p>Dùng số điện thoại đã được cấp quyền vận hành.</p>
      <label>
        Số điện thoại (E.164)
        <input
          required
          type="tel"
          autoComplete="tel"
          placeholder="+84901234567"
          value={phone}
          disabled={challenge}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>
      {challenge && (
        <label>
          Mã xác thực
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      )}
      {devCode && <p className="dev">Môi trường phát triển · OTP: {devCode}</p>}
      <div className="actions">
        <button disabled={busy}>
          {busy ? 'Đang xử lý…' : challenge ? 'Đăng nhập' : 'Gửi mã xác thực'}
        </button>
        {challenge && (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setChallenge(false);
              setCode('');
              setDevCode('');
            }}
          >
            Đổi số / gửi lại mã
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- Drivers: list + detail ----------

function DriverList({
  data,
  role,
  selectedId,
  query,
}: {
  data: Page<DriverReviewItem> | null;
  role: string;
  selectedId?: string;
  query: string;
}) {
  if (!data)
    return (
      <p className="empty" role="status">
        Đang tải dữ liệu…
      </p>
    );
  if (data.items.length === 0)
    return (
      <p className="empty" role="status">
        Không có hồ sơ trong bộ lọc này.
      </p>
    );
  return (
    <ul className="driver-list">
      {data.items.map((item) => {
        const actionable =
          item.status === 'pending' || (item.status === 'approved' && role === 'admin');
        return (
          <li key={item.userId} className={item.userId === selectedId ? 'selected' : undefined}>
            <div className="driver-main">
              <b>{item.displayName ?? item.phone}</b>
              <small>{item.phone}</small>
            </div>
            <div>
              {item.vehiclePlate}
              <small>{item.vehicleType === 'car' ? 'Ô tô' : 'Xe máy'}</small>
            </div>
            <div>
              <span className={`badge ${item.status}`}>{statusLabels[item.status]}</span>
              {item.rejectionReason && <small>{item.rejectionReason}</small>}
            </div>
            <div className="driver-action">
              {actionable && (
                <Link
                  className="button-link secondary"
                  to={`/drivers/${item.userId}${query}`}
                  aria-current={item.userId === selectedId ? 'true' : undefined}
                >
                  {item.status === 'approved' ? 'Mở lại hồ sơ' : 'Xem xét'}
                  <span className="sr-only"> {item.vehiclePlate}</span>
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DriverReview({
  api,
  id,
  role,
  item,
  online,
  backTo,
  onDone,
}: {
  api: Api;
  id: string;
  role: string;
  item: DriverReviewItem | undefined;
  online: boolean;
  backTo: string;
  onDone: (notice: string) => void;
}) {
  const [profile, setProfile] = useState<Pick<
    DriverReviewItem,
    'status' | 'updatedAt' | 'vehiclePlate' | 'vehicleType'
  > | null>(item ?? null);
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setProfile(item ?? null);
    setReason('');
    setError('');
    setConflict(false);
    // Reset only when the selected driver changes, not on every list refresh.
  }, [id]);

  const act = async (work: () => Promise<unknown>, notice: string) => {
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      await work();
      setReason('');
      onDone(notice);
    } catch (cause) {
      if (errorStatus(cause) === 409) {
        // Stale revision: reload authoritative documents/profile, keep the typed reason.
        setConflict(true);
        setReloadKey((value) => value + 1);
      } else setError(message(cause, 'Không lưu được quyết định. Lý do đang nhập vẫn được giữ.'));
    } finally {
      setBusy(false);
    }
  };
  const status = profile?.status;
  const disabled = busy || !online || !profile;
  return (
    <section className="card review" aria-labelledby="review-title">
      <Link className="back-link" to={backTo}>
        ← Danh sách hồ sơ
      </Link>
      <h2 id="review-title">Xem xét: {profile?.vehiclePlate ?? '…'}</h2>
      <p>
        {item
          ? `${item.displayName ?? 'Chưa có tên'} · ${item.phone}`
          : `Mã tài xế ${id.slice(0, 8)}`}
      </p>
      {conflict && (
        <div role="status" className="warning">
          Hồ sơ vừa thay đổi ở phiên khác (nộp ảnh mới hoặc đã có người duyệt). Dữ liệu mới đã được
          tải; hãy xem lại giấy tờ trước khi quyết định.
        </div>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <DriverDocumentReview
        key={`${id}-${reloadKey}`}
        api={api}
        driverId={id}
        onReady={setReady}
        onProfileChange={(value) => setProfile((current) => ({ ...current, ...value }))}
      />
      {(status === 'pending' || (status === 'approved' && role === 'admin')) && (
        <label>
          {status === 'approved' ? 'Lý do mở lại hồ sơ' : 'Lý do từ chối'}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
          />
        </label>
      )}
      <div className="actions">
        {status === 'approved' && role === 'admin' && (
          <button
            disabled={disabled || reason.trim().length < 3}
            onClick={() =>
              void act(() => api.reopenDriver(id, profile!.updatedAt, reason), 'Đã mở lại hồ sơ.')
            }
          >
            Mở lại để bổ sung giấy tờ
          </button>
        )}
        {status === 'pending' && (
          <>
            <button
              disabled={disabled || !ready}
              onClick={() =>
                void act(
                  () => api.reviewDriver(id, 'approved', profile!.updatedAt),
                  'Đã duyệt hồ sơ.',
                )
              }
            >
              Duyệt hồ sơ
            </button>
            <button
              className="danger"
              disabled={disabled || reason.trim().length < 3}
              onClick={() =>
                void act(
                  () => api.reviewDriver(id, 'rejected', profile!.updatedAt, reason),
                  'Đã từ chối hồ sơ.',
                )
              }
            >
              Từ chối
            </button>
          </>
        )}
      </div>
      {status === 'pending' && !ready && (
        <small>Mở đủ ảnh của bản hiện tại để bật nút Duyệt.</small>
      )}
      {status && status !== 'pending' && !(status === 'approved' && role === 'admin') && (
        <small>Hồ sơ ở trạng thái {statusLabels[status]}; không có thao tác cho vai trò này.</small>
      )}
    </section>
  );
}

function DriversPage({ api, role, online }: { api: Api; role: string; online: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const status = search.get('status') ?? 'pending';
  const page = Math.max(1, Number(search.get('page')) || 1);
  const query = `?${new URLSearchParams({ status, page: String(page) })}`;
  const [data, setData] = useState<Page<DriverReviewItem> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    api
      .drivers(page, status)
      .then((value) => active && setData(value))
      .catch((cause) => active && setError(message(cause, 'Không tải được danh sách hồ sơ.')));
    return () => {
      active = false;
    };
  }, [api, page, status, refresh]);

  const setFilter = (next: Record<string, string>) => {
    setData(null);
    setSearch({ status, page: String(page), ...next });
  };
  return (
    <div className={`split${id ? ' has-detail' : ''}`}>
      <div className="split-list">
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            {error}{' '}
            <button className="secondary" onClick={() => setRefresh((value) => value + 1)}>
              Thử lại
            </button>
          </div>
        )}
        <section className="card">
          <div className="toolbar">
            <h2>
              Danh sách hồ sơ <small className="inline">{data ? `${data.total} hồ sơ` : ''}</small>
            </h2>
            <label className="filter">
              Trạng thái
              <select
                value={status}
                onChange={(event) => setFilter({ status: event.target.value, page: '1' })}
              >
                <option value="">Tất cả</option>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={() => setRefresh((value) => value + 1)}>
              Làm mới
            </button>
          </div>
          <DriverList data={data} role={role} selectedId={id} query={query} />
          <div className="pagination">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setFilter({ page: String(page - 1) })}
            >
              Trước
            </button>
            <span>Trang {page}</span>
            <button
              className="secondary"
              disabled={!data || page * data.pageSize >= data.total}
              onClick={() => setFilter({ page: String(page + 1) })}
            >
              Sau
            </button>
          </div>
        </section>
      </div>
      {id && (
        <div className="split-detail">
          <DriverReview
            api={api}
            id={id}
            role={role}
            online={online}
            item={data?.items.find((item) => item.userId === id)}
            backTo={`/drivers${query}`}
            onDone={(text) => {
              setNotice(text);
              setRefresh((value) => value + 1);
              navigate(`/drivers${query}`);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------- Shell ----------

function Forbidden() {
  return (
    <section className="card" role="status">
      <h2>Không có quyền truy cập</h2>
      <p>Vai trò của bạn không dùng được mục này. Máy chủ cũng kiểm tra quyền cho mọi thao tác.</p>
      <Link to="/">Về trang chính</Link>
    </section>
  );
}

function Guard({
  role,
  section,
  children,
}: {
  role: string;
  section: Section;
  children: ReactNode;
}) {
  return canAccess(role, section) ? <>{children}</> : <Forbidden />;
}

function Home({ role }: { role: string }) {
  const target = homePath(role);
  if (target) return <Navigate to={target} replace />;
  return (
    <section className="card" role="status">
      <h2>Chưa có chức năng cho vai trò {roleLabels[role] ?? role}</h2>
      <p>Màn hình kế toán/đối soát sẽ có khi PO chốt chính sách ledger.</p>
    </section>
  );
}

export function AdminApp({
  api,
  webAuth,
  onLogout,
}: {
  api: WebSessionApi;
  webAuth: boolean;
  onLogout?: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(webAuth);
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();

  useEffect(() => {
    if (!webAuth || !api.bootstrap) return;
    let active = true;
    const unsubscribe = api.subscribeSessionInvalid?.(() => active && setSession(null));
    api
      .bootstrap()
      .then(
        (value) =>
          active &&
          setSession((STAFF_ROLES as readonly string[]).includes(value.user.role) ? value : null),
      )
      .catch(() => active && setSession(null))
      .finally(() => active && setRestoring(false));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api, webAuth]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      onLogout?.();
      navigate('/', { replace: true });
    }
  }, [api, navigate, onLogout]);

  const role = session?.user.role ?? '';
  const section = sectionForPath(location.pathname);
  const title = !session
    ? 'Đăng nhập quản trị'
    : section
      ? sections[section].title
      : 'Bảng điều khiển';
  useEffect(() => {
    document.title = `${title} · ShanGo Admin`;
  }, [title]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Bỏ qua điều hướng
      </a>
      <aside>
        <Link className="brand" to="/">
          ShanGo<span>ĐIỀU PHỐI GIAO NHẬN</span>
        </Link>
        {session && (
          <nav aria-label="Điều hướng quản trị" className="nav-list">
            {sectionsFor(role).map((key) => (
              <NavLink key={key} className="nav" to={sections[key].path}>
                {sections[key].label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="sidebar-note">
          Nền tảng phát triển
          <br />
          Đơn hàng thử nghiệm, giá chưa phải bảng giá chính thức.
        </div>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header>
          <div>
            <p className="eyebrow">KHÔNG GIAN VẬN HÀNH</p>
            <h1>{title}</h1>
          </div>
          {session && (
            <div className="session">
              <small>
                {session.user.displayName ?? session.user.phone} · {roleLabels[role] ?? role}
              </small>
              <button className="secondary" onClick={() => void logout()}>
                Đăng xuất
              </button>
            </div>
          )}
        </header>
        {!online && (
          <div role="status" className="warning">
            Mất kết nối mạng. Đang hiển thị dữ liệu đã tải; duyệt và hủy tạm khóa cho đến khi có
            mạng.
          </div>
        )}
        {restoring ? (
          <p className="empty">Đang khôi phục phiên…</p>
        ) : !session ? (
          <LoginPage api={api} onSession={setSession} />
        ) : (
          <Routes>
            <Route path="/" element={<Home role={role} />} />
            <Route
              path="/drivers/:id?"
              element={
                <Guard role={role} section="drivers">
                  <DriversPage api={api} role={role} online={online} />
                </Guard>
              }
            />
            <Route
              path="/orders"
              element={
                <Guard role={role} section="orders">
                  <OrdersBoard api={api} online={online} />
                </Guard>
              }
            />
            <Route
              path="/maps"
              element={
                <Guard role={role} section="maps">
                  <MapPlayground api={api} />
                </Guard>
              }
            />
            <Route
              path="/audit"
              element={
                <Guard role={role} section="audit">
                  <AuditLogViewer api={api} />
                </Guard>
              }
            />
            <Route
              path="*"
              element={
                <section className="card" role="status">
                  <h2>Không tìm thấy trang</h2>
                  <Link to="/">Về trang chính</Link>
                </section>
              }
            />
          </Routes>
        )}
        <footer>ShanGo · Môi trường phát triển · Chưa mở dịch vụ công khai</footer>
      </main>
    </div>
  );
}
