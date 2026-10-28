import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi } from '@shango/api-client';
import type { DriverReviewItem, Page, Session } from '@shango/contracts';
import './style.css';
import { ThemeShowcase } from './components/theme-showcase';
import { MapPlayground } from './components/map-playground';

let currentSession: Session | null = null;
const api = createApi(import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1', {
  get: async () => currentSession,
  set: async (value) => {
    currentSession = value;
  },
});
const labels = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' };
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<'drivers' | 'maps'>('drivers');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [data, setData] = useState<Page<DriverReviewItem> | null>(null);
  const [selected, setSelected] = useState<DriverReviewItem | null>(null);
  const [reason, setReason] = useState('');
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(async () => {
    setData(await api.drivers(page, status));
  }, [page, status]);
  useEffect(() => {
    if (!session || view !== 'drivers') return;
    let active = true;
    setData(null);
    setError('');
    api
      .drivers(page, status)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Không tải được hồ sơ');
      });
    return () => {
      active = false;
    };
  }, [session, page, status, view]);
  async function review(decision: 'approved' | 'rejected') {
    if (!selected) return;
    await api.reviewDriver(
      selected.userId,
      decision,
      selected.updatedAt,
      decision === 'rejected' ? reason : undefined,
    );
    setSelected(null);
    setReason('');
    await load();
  }
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          ShanGo<span>ĐIỀU PHỐI GIAO NHẬN</span>
        </a>
        <button
          type="button"
          className="nav"
          aria-pressed={view === 'drivers'}
          onClick={() => setView('drivers')}
        >
          Hồ sơ tài xế
        </button>
        <button
          type="button"
          className="nav"
          aria-pressed={view === 'maps'}
          onClick={() => setView('maps')}
        >
          Bản đồ Hà Nội
        </button>
        <div className="sidebar-note">
          Nền tảng phát triển
          <br />
          Đơn hàng và tracking sẽ được bổ sung theo backlog.
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">KHÔNG GIAN VẬN HÀNH</p>
            <h1>
              {session
                ? view === 'maps'
                  ? 'Bản đồ Hà Nội'
                  : 'Duyệt hồ sơ tài xế'
                : 'Đăng nhập quản trị'}
            </h1>
          </div>
          {session && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    await api.logout();
                  } finally {
                    setSession(null);
                    setData(null);
                  }
                })
              }
            >
              Đăng xuất
            </button>
          )}
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        {!session ? (
          <form
            className="card login"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!challenge) {
                  const value = await api.requestOtp(phone, 'customer');
                  setChallenge(true);
                  setDevCode(value.devCode ?? '');
                } else {
                  const value = await api.verifyOtp(phone, code);
                  if (!['admin', 'dispatcher'].includes(value.user.role)) {
                    await api.logout();
                    throw new Error('Tài khoản chưa có quyền quản trị. Liên hệ người quản lý.');
                  }
                  setSession(value);
                  setDevCode('');
                  setCode('');
                }
              });
            }}
          >
            <h2>Chào mừng trở lại</h2>
            <p>Dùng số điện thoại đã được cấp quyền vận hành.</p>
            <label>
              Số điện thoại (E.164)
              <input
                required
                type="tel"
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
          </form>
        ) : view === 'maps' ? (
          <MapPlayground api={api} />
        ) : (
          <>
            <section className="summary card">
              <div>
                <p className="eyebrow">HỒ SƠ TRONG BỘ LỌC</p>
                <strong>{data?.total ?? '—'}</strong>
              </div>
              <p>
                Chỉ duyệt sau khi kiểm tra thông tin.
                <br />
                Mọi quyết định được ghi vào nhật ký.
              </p>
            </section>
            <section className="card">
              <div className="toolbar">
                <h2>Danh sách hồ sơ</h2>
                <label className="filter">
                  Trạng thái
                  <select
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPage(1);
                      setSelected(null);
                    }}
                  >
                    <option value="">Tất cả</option>
                    {Object.entries(labels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="secondary" disabled={busy} onClick={() => void run(load)}>
                  Làm mới
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tài xế</th>
                      <th>Phương tiện</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.items.map((item) => (
                      <tr key={item.userId}>
                        <td>
                          <b>{item.displayName ?? item.phone}</b>
                          <small>{item.phone}</small>
                        </td>
                        <td>
                          {item.vehiclePlate}
                          <small>{item.vehicleType === 'car' ? 'Ô tô' : 'Xe máy'}</small>
                        </td>
                        <td>
                          <span className={`badge ${item.status}`}>{labels[item.status]}</span>
                          {item.rejectionReason && <small>{item.rejectionReason}</small>}
                        </td>
                        <td>
                          {item.status === 'pending' && (
                            <button
                              className="secondary"
                              onClick={() => {
                                setSelected(item);
                                setReason('');
                              }}
                            >
                              Xem xét
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data?.items.length === 0 && (
                <p className="empty">Không có hồ sơ trong bộ lọc này.</p>
              )}
              {!data && <p className="empty">Đang tải dữ liệu…</p>}
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={page === 1 || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Trước
                </button>
                <span>Trang {page}</span>
                <button
                  className="secondary"
                  disabled={!data || page * data.pageSize >= data.total || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Sau
                </button>
              </div>
            </section>
            {selected && (
              <section className="card review">
                <h2>Xem xét: {selected.vehiclePlate}</h2>
                <p>{selected.phone} · Chưa bao gồm kiểm tra giấy tờ trong bản nền tảng này.</p>
                <label>
                  Lý do từ chối
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={500}
                  />
                </label>
                <div className="actions">
                  <button disabled={busy} onClick={() => void run(() => review('approved'))}>
                    Duyệt hồ sơ
                  </button>
                  <button
                    className="danger"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void run(() => review('rejected'))}
                  >
                    Từ chối
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => setSelected(null)}>
                    Đóng
                  </button>
                </div>
              </section>
            )}
          </>
        )}
        <footer>ShanGo · Môi trường phát triển · Chưa mở dịch vụ công khai</footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/components' ? <ThemeShowcase /> : <App />}
  </StrictMode>,
);
