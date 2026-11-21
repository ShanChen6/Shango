import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { createWebApi, WebApiError } from '@shango/api-client';
import { AppShell, Badge, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import { AddressPage } from './address-page';
import { ProfilePage } from './profile-page';
import './style.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function resetClientSession() { queryClient.getMutationCache().clear(); queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'session' }); queryClient.setQueryData(['session'], null); }
const api = createWebApi(import.meta.env.VITE_API_URL ?? '/api/v1', { app: 'customer', allowedRoles: ['customer'], onSessionInvalid: resetClientSession });

function Login({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState(''); const [code, setCode] = useState(''); const [challenge, setChallenge] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <main className="login-page"><PageHeader eyebrow="KHÁCH HÀNG" title="Đăng nhập ShanGo" description="Phiên web dùng cookie bảo mật; token không được lưu trong trình duyệt."/>{error && <InlineAlert>{error}</InlineAlert>}<Card><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { if (!challenge) { await api.requestOtp(phone); setChallenge(true); } else { await api.verifyOtp(phone, code); onDone(); } } catch (cause) { setError(cause instanceof WebApiError ? cause.message : 'Không thể kết nối máy chủ'); } finally { setBusy(false); } }}><TextField label="Số điện thoại" type="tel" autoComplete="tel" required value={phone} disabled={challenge} onChange={e => setPhone(e.target.value)}/>{challenge && <TextField label="Mã xác thực" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)}/>}<Button disabled={busy}>{busy ? 'Đang xử lý…' : challenge ? 'Đăng nhập' : 'Gửi mã'}</Button></form></Card></main>;
}

function Home() { return <><PageHeader eyebrow="GIAO NHẬN QUANH BẠN" title="Bạn muốn gửi hàng đi đâu?" description="Task-first giúp hoàn tất địa chỉ trước khi mở bản đồ chi tiết."/><div className="grid"><Card><Badge>Draft chỉ lưu trong phiên</Badge><h2>Chuẩn bị thông tin giao nhận</h2><p>Chọn và xác nhận điểm lấy, điểm giao trước khi API quote/order được bật.</p><NavLink className="action-link" to="/addresses">Bắt đầu chọn địa chỉ</NavLink></Card><Card><h2>Đơn hàng</h2><InlineAlert tone="warning">Chưa có API order authoritative. ShanGo không hiển thị đơn hoặc trạng thái giả.</InlineAlert></Card></div></>; }
function NotFound() { return <><PageHeader eyebrow="KHÔNG TÌM THẤY" title="Trang không tồn tại" description="Quay về trang chủ để tiếp tục."/><NavLink className="action-link" to="/">Về trang chủ</NavLink></>; }
function Shell({ onLogout }: { onLogout: () => void }) { return <AppShell appName="Khách hàng" navigation={<><NavLink to="/" end>Trang chủ</NavLink><NavLink to="/addresses">Địa chỉ</NavLink><NavLink to="/profile">Tài khoản</NavLink><Button onClick={() => void api.logout().catch(() => undefined).finally(onLogout)}>Đăng xuất</Button></>}><Routes><Route path="/" element={<Home/>}/><Route path="/addresses" element={<AddressPage api={api}/>}/><Route path="/profile" element={<ProfilePage api={api}/>}/><Route path="*" element={<NotFound/>}/></Routes></AppShell>; }
function App() { const [, rerender] = useState(0); const bootstrap = useQuery({ queryKey: ['session'], queryFn: () => api.bootstrap() }); const update = () => rerender(v => v + 1); if (bootstrap.isPending) return <main className="login-page"><p>Đang khôi phục phiên…</p></main>; if (!api.getSession()) return <Login onDone={() => { queryClient.setQueryData(['session'], api.getSession()); update(); }}/>; return <Shell onLogout={() => { resetClientSession(); update(); }}/>; }
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></StrictMode>);
