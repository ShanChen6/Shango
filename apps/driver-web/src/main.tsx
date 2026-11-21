import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { createWebApi, WebApiError } from '@shango/api-client';
import { AppShell, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import { DocumentsPage } from './documents-page';
import { CurrentOrderPage, HomePage, OffersPage } from './home-page';
import { DriverWorkProvider, stopDriverRealtime } from './driver-work';
import { ProfilePage } from './profile-page';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function resetClientSession() {
  stopDriverRealtime();
  queryClient.getMutationCache().clear();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  queryClient.setQueryData(['session'], null);
}
const api = createWebApi(import.meta.env.VITE_API_URL ?? '/api/v1', {
  app: 'driver',
  allowedRoles: ['driver'],
  onSessionInvalid: resetClientSession,
});

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="login-page">
      <PageHeader
        eyebrow="ĐỐI TÁC TÀI XẾ"
        title="Đăng nhập tài xế"
        description="ShanGo chỉ tracking chủ động khi trang được mở; không bảo đảm GPS nền."
      />
      {error && <InlineAlert>{error}</InlineAlert>}
      <Card>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              if (!challenge) {
                await api.requestOtp(phone);
                setChallenge(true);
              } else {
                await api.verifyOtp(phone, code);
                onDone();
              }
            } catch (cause) {
              setError(cause instanceof WebApiError ? cause.message : 'Không thể kết nối máy chủ');
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            disabled={challenge}
            onChange={(e) => setPhone(e.target.value)}
          />
          {challenge && (
            <TextField
              label="Mã xác thực"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
          <Button disabled={busy}>
            {busy ? 'Đang xử lý…' : challenge ? 'Đăng nhập' : 'Gửi mã'}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="KHÔNG TÌM THẤY"
        title="Không tìm thấy trang"
        description="Quay về trang chủ để tiếp tục."
      />
      <NavLink className="action-link" to="/">
        Về trang chủ
      </NavLink>
    </>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  return (
    <DriverWorkProvider api={api}>
      <AppShell
        appName="Tài xế"
        navigation={
          <>
            <NavLink to="/" end>
              Trang chủ
            </NavLink>
            <NavLink to="/offers">Đề nghị</NavLink>
            <NavLink to="/order">Đơn hiện tại</NavLink>
            <NavLink to="/documents">Giấy tờ</NavLink>
            <NavLink to="/profile">Hồ sơ</NavLink>
            <Button
              onClick={() =>
                void api
                  .logout()
                  .catch(() => undefined)
                  .finally(onLogout)
              }
            >
              Đăng xuất
            </Button>
          </>
        }
      >
        <Routes>
          <Route path="/" element={<HomePage api={api} />} />
          <Route path="/offers" element={<OffersPage api={api} />} />
          <Route path="/order" element={<CurrentOrderPage api={api} />} />
          <Route path="/documents" element={<DocumentsPage api={api} />} />
          <Route path="/profile" element={<ProfilePage api={api} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppShell>
    </DriverWorkProvider>
  );
}

function App() {
  const [, rerender] = useState(0);
  const bootstrap = useQuery({ queryKey: ['session'], queryFn: () => api.bootstrap() });
  const update = () => rerender((v) => v + 1);
  if (bootstrap.isPending)
    return (
      <main className="login-page">
        <p>Đang khôi phục phiên…</p>
      </main>
    );
  if (!api.getSession())
    return (
      <Login
        onDone={() => {
          queryClient.setQueryData(['session'], api.getSession());
          update();
        }}
      />
    );
  return (
    <Shell
      onLogout={() => {
        resetClientSession();
        update();
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
