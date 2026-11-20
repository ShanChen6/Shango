import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { createWebApi, WebApiError } from '@shango/api-client';
import { AppShell, Badge, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function resetClientSession() { queryClient.getMutationCache().clear(); queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'session' }); queryClient.setQueryData(['session'], null); }
const api = createWebApi(import.meta.env.VITE_API_URL ?? '/api/v1', { app: 'customer', allowedRoles: ['customer'], onSessionInvalid: resetClientSession });

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [challenge, setChallenge] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <main className="login-page"><PageHeader eyebrow="KHÁCH HÀNG" title="Đăng nhập ShanGo" description="Phiên web dùng cookie bảo mật; token không được lưu trong trình duyệt."/>{error && <InlineAlert>{error}</InlineAlert>}<Card><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { if (!challenge) { await api.requestOtp(phone); setChallenge(true); } else { await api.verifyOtp(phone, code); onDone(); } } catch (cause) { setError(cause instanceof WebApiError ? cause.message : 'Không thể kết nối máy chủ'); } finally { setBusy(false); } }}><TextField label="Số điện thoại" type="tel" autoComplete="tel" required value={phone} disabled={challenge} onChange={e => setPhone(e.target.value)}/>{challenge && <TextField label="Mã xác thực" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)}/>}<Button disabled={busy}>{busy ? 'Đang xử lý…' : challenge ? 'Đăng nhập' : 'Gửi mã'}</Button></form></Card></main>;
}

function Home() { return <><PageHeader eyebrow="GIAO NHẬN QUANH BẠN" title="Bạn muốn gửi hàng đi đâu?" description="Task-first giúp hoàn tất địa chỉ trước khi mở bản đồ chi tiết."/><div className="grid"><Card><Badge>Chưa có đơn đang chạy</Badge><h2>Tạo đơn mới</h2><p>Chức năng tạo đơn sẽ được bật khi API nghiệp vụ authoritative sẵn sàng.</p><Button disabled>Tạo bản nháp</Button></Card><Card><h2>Hoạt động gần đây</h2><p>Đơn hàng sẽ xuất hiện tại đây sau khi API nghiệp vụ được bật.</p></Card></div></>; }
function Placeholder({ title }: { title: string }) { return <><PageHeader eyebrow="WEB-005 FOUNDATION" title={title} description="Route đã sẵn sàng; nghiệp vụ được bổ sung ở WEB-006."/><Card><InlineAlert tone="warning">Chưa bật chức năng production trong task nền tảng.</InlineAlert></Card></>; }
function Shell({ onLogout }: { onLogout: () => void }) { return <AppShell appName="Khách hàng" navigation={<><NavLink to="/" end>Trang chủ</NavLink><NavLink to="/addresses">Địa chỉ</NavLink><NavLink to="/profile">Tài khoản</NavLink><Button onClick={() => void api.logout().catch(() => undefined).finally(onLogout)}>Đăng xuất</Button></>}><Routes><Route path="/" element={<Home/>}/><Route path="/addresses" element={<Placeholder title="Địa chỉ giao nhận"/>}/><Route path="/profile" element={<Placeholder title="Tài khoản"/>}/><Route path="*" element={<Placeholder title="Không tìm thấy trang"/>}/></Routes></AppShell>; }
function App() { const [, rerender] = useState(0); const bootstrap = useQuery({ queryKey: ['session'], queryFn: () => api.bootstrap() }); const update = () => rerender(v => v + 1); if (bootstrap.isPending) return <main className="login-page"><p>Đang khôi phục phiên…</p></main>; if (!api.getSession()) return <Login onDone={() => { queryClient.setQueryData(['session'], api.getSession()); update(); }}/>; return <Shell onLogout={() => { resetClientSession(); update(); }}/>; }
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></StrictMode>);
