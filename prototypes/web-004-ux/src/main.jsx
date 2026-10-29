import React, { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const variants = [
  { id: 'A', name: 'Task-first' },
  { id: 'B', name: 'Map-first split' },
  { id: 'C', name: 'Timeline console' },
];
const roles = ['customer', 'driver', 'admin'];
const commonStates = ['active', 'loading', 'empty', 'error', 'offline'];
const driverStates = [...commonStates, 'stale', 'unavailable', 'permission-denied', 'reconnecting'];
const statesFor = (role) => role === 'driver' ? driverStates : commonStates;

const copy = {
  customer: {
    eyebrow: 'GIAO NHẬN QUANH BẠN',
    title: 'Gửi hàng tới Hồ Tây',
    subtitle: 'Đón tại 18 Lý Thường Kiệt · 4,2 km',
    action: 'Xác nhận điểm giao',
    metric: '42.000đ',
    metricLabel: 'Giá tạm tính',
    steps: ['Chọn điểm lấy hàng', 'Chọn điểm giao', 'Xác nhận và đặt đơn'],
    items: ['Nguyễn Tuân · Đang tìm tài xế', 'Đội Cấn · Đã giao lúc 09:42'],
  },
  driver: {
    eyebrow: 'ĐỐI TÁC TÀI XẾ',
    title: 'Bạn đang sẵn sàng',
    subtitle: 'GPS mới 7 giây trước · Kết nối ổn định',
    action: 'Xem đề nghị mới',
    metric: '3',
    metricLabel: 'Đơn hôm nay',
    steps: ['Bật sẵn sàng', 'Nhận đề nghị', 'Lấy và giao hàng'],
    items: ['Lý Thường Kiệt → Hồ Tây · 42.000đ', 'GPS: fresh · accuracy 12m'],
  },
  admin: {
    eyebrow: 'KHÔNG GIAN VẬN HÀNH',
    title: 'Điều phối Hà Nội',
    subtitle: '12 tài xế online · 2 vị trí stale',
    action: 'Xử lý cảnh báo',
    metric: '7',
    metricLabel: 'Đơn đang giao',
    steps: ['Theo dõi vận hành', 'Xử lý ngoại lệ', 'Đối chiếu audit'],
    items: ['2 hồ sơ đang chờ duyệt', '1 tài xế mất GPS 68 giây'],
  },
};

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const role = roles.includes(params.get('role')) ? params.get('role') : 'customer';
  const variant = variants.some((item) => item.id === params.get('variant'))
    ? params.get('variant')
    : 'A';
  const state = statesFor(role).includes(params.get('state')) ? params.get('state') : 'active';
  return { role, variant, state };
}

function navigate(next) {
  const current = readParams();
  const params = new URLSearchParams({ ...current, ...next });
  window.location.search = params.toString();
}

function dataForState(role, state, data) {
  if (role !== 'driver') return data;
  const overrides = {
    offline: { title: 'Mất kết nối mạng', subtitle: 'Vị trí cuối 28 giây trước · thao tác mới bị khóa', action: 'Chờ kết nối lại' },
    stale: { title: 'Vị trí đang stale', subtitle: 'Socket connected · GPS mới 36 giây trước', action: 'Mở trang để lấy GPS mới' },
    unavailable: { title: 'Tạm ngừng nhận đơn', subtitle: 'Không có GPS hợp lệ trong 72 giây', action: 'Lấy lại vị trí' },
    reconnecting: { title: 'Đang khôi phục phiên', subtitle: 'Chờ snapshot trước khi gửi vị trí mới', action: 'Đang kết nối lại' },
  }[state];
  return overrides ? { ...data, ...overrides } : data;
}

function StateBanner({ state, role }) {
  if (state === 'active') return null;
  const content = {
    loading: ['Đang đồng bộ dữ liệu…', 'Giữ nguyên cấu trúc để tránh nhảy layout.'],
    empty: ['Chưa có dữ liệu', role === 'customer' ? 'Tạo đơn đầu tiên để bắt đầu.' : 'Không có việc cần xử lý.'],
    error: ['Không tải được dữ liệu', 'Thử lại; mã lỗi/request ID phải có trong chi tiết hỗ trợ.'],
    offline: ['Bạn đang offline', role === 'driver' ? 'Vị trí cuối 28 giây trước; không hứa GPS nền.' : 'Dữ liệu bên dưới là bản gần nhất; thao tác mới chưa được gửi.'],
    stale: ['GPS đã stale · 36 giây', 'Socket vẫn connected nhưng tài xế đã bị loại khỏi matching.'],
    unavailable: ['Không có GPS mới · 72 giây', 'Không nhận đơn mới; mở trang và lấy fix hợp lệ để quay lại.'],
    'permission-denied': ['Chưa được cấp quyền vị trí', 'Mở browser settings và cho phép vị trí khi dùng trang.'],
    reconnecting: ['Đang kết nối lại…', 'Giữ vị trí cuối 28 giây trước; chờ snapshot authoritative.'],
  }[state];
  return (
    <div className={`state-banner ${state}`} role={state === 'error' ? 'alert' : 'status'}>
      <strong>{content[0]}</strong><span>{content[1]}</span>
    </div>
  );
}

function StatusPill({ role, state }) {
  const driverLabel = {
    active: 'GPS fresh · 7s', stale: 'Socket on · GPS stale', unavailable: 'GPS unavailable',
    'permission-denied': 'Location denied', reconnecting: 'Reconnecting', offline: 'Offline',
    loading: 'Đang kiểm tra', empty: 'Chưa sẵn sàng', error: 'Có lỗi',
  }[state];
  const label = role === 'driver' ? driverLabel : role === 'admin' ? '2 cảnh báo' : 'Hà Nội';
  return <span className={`pill ${role} ${state}`}>{label}</span>;
}

function Header({ role, state }) {
  return (
    <header className="app-header">
      <a className="brand" href="/">ShanGo<span>{role}</span></a>
      <StatusPill role={role} state={state} />
      <button className="avatar" aria-label="Mở tài khoản">SC</button>
    </header>
  );
}

function MapMock({ role, state }) {
  const showPositions = !['loading', 'empty', 'error', 'permission-denied'].includes(state);
  return (
    <div className="map" role="img" aria-label={showPositions ? 'Bản đồ minh họa: điểm A, điểm B và vị trí gần nhất' : 'Bản đồ minh họa chưa có dữ liệu vị trí'}>
      <div aria-hidden="true"><div className="road one"/><div className="road two"/><div className="road three"/>
      {showPositions && <><span className="pin pickup">A</span><span className="pin dropoff">B</span>
      {role !== 'customer' && <span className="driver-dot">●</span>}</>}</div>
      <p className="map-summary">{showPositions ? 'Tóm tắt: điểm A đến điểm B; vị trí gần nhất có timestamp.' : 'Chưa có vị trí. Dùng địa chỉ dạng text để tiếp tục.'}</p>
      <small>Prototype map · attribution/provider chưa chốt</small>
    </div>
  );
}

function PrimaryAction({ data, disabled = false }) {
  return <button className="primary" disabled={disabled}>{data.action}</button>;
}

const canUsePrimaryAction = (role, state) => state === 'active'
  || (role === 'driver' && ['stale', 'unavailable'].includes(state));

function LoadingPlaceholder() {
  return <section className="card placeholder" aria-label="Đang tải"><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton tall"/><span className="sr-only">Đang tải dữ liệu</span></section>;
}

function BlockingPlaceholder({ state, role }) {
  if (state === 'loading') return <LoadingPlaceholder/>;
  const content = {
    empty: [role === 'customer' ? 'Chưa có đơn hàng' : 'Không có việc cần xử lý', role === 'customer' ? 'Tạo đơn đầu tiên khi bạn sẵn sàng.' : 'Bộ lọc hiện tại không có kết quả.', role === 'customer' ? 'Tạo đơn đầu tiên' : 'Làm mới'],
    error: ['Không tải được nội dung', 'Dữ liệu active không được hiển thị vì chưa xác minh freshness.', 'Thử lại'],
    'permission-denied': ['Cần quyền vị trí để bật sẵn sàng', 'Bạn vẫn có thể xem hồ sơ; không thể nhận đơn khi chưa có GPS hợp lệ.', 'Xem hướng dẫn cài đặt'],
  }[state];
  return <section className="card placeholder"><h2>{content[0]}</h2><p>{content[1]}</p><button className="primary">{content[2]}</button></section>;
}

const blocksActiveData = (state) => ['loading', 'empty', 'error', 'permission-denied'].includes(state);

function TaskFirst({ role, data, state }) {
  const [activeTab, setActiveTab] = useState('Trang chủ');
  const tabs = ['Trang chủ', 'Hoạt động', 'Tài khoản'];
  return (
    <div className="variant task-first">
      <Header role={role} state={state}/>
      <main>
        <StateBanner state={state} role={role}/>
        {blocksActiveData(state) ? <BlockingPlaceholder state={state} role={role}/> : <><section className={`hero-card ${state !== 'active' ? 'cached' : ''}`}>
          <p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p>{data.subtitle}</p>
          <div className="metric"><strong>{data.metric}</strong><span>{data.metricLabel}</span></div>
          <PrimaryAction data={data} disabled={!canUsePrimaryAction(role, state)}/>
        </section>
        <section className="task-grid">
          <article className="card"><h2>Tiếp theo</h2><ol>{data.steps.map((step, i) => <li key={step}><b>{i + 1}</b>{step}</li>)}</ol></article>
          <article className="card"><h2>Gần đây</h2>{data.items.map(item => <button className="list-row" key={item}>{item}<span>›</span></button>)}</article>
        </section></>}
      </main>
      <nav className="bottom-nav" aria-label="Điều hướng chính">{tabs.map(tab => <button key={tab} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
    </div>
  );
}

function MapFirst({ role, data, state }) {
  return (
    <div className="variant map-first">
      <Header role={role} state={state}/>
      <main className="split-shell">
        <section className="map-pane"><MapMock role={role} state={state}/></section>
        <aside className="action-pane">
          <StateBanner state={state} role={role}/>
          {blocksActiveData(state) ? <BlockingPlaceholder state={state} role={role}/> : <><p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p>{data.subtitle}</p>
          <div className="route-card">{data.items.map(item => <div key={item}><span className="route-dot"/>{item}</div>)}</div>
          <div className="metric"><strong>{data.metric}</strong><span>{data.metricLabel}</span></div>
          <PrimaryAction data={data} disabled={!canUsePrimaryAction(role, state)}/></>}
        </aside>
      </main>
    </div>
  );
}

function TimelineConsole({ role, data, state }) {
  return (
    <div className="variant timeline-console">
      <aside className="rail"><a className="brand" href="/">S<span>ShanGo</span></a>{data.steps.map((step, i) => <button key={step} className={i === 0 ? 'selected' : ''}>{i + 1}<span>{step}</span></button>)}</aside>
      <div className="console-content">
        <Header role={role} state={state}/>
        <main>
          <StateBanner state={state} role={role}/>
          {blocksActiveData(state) ? <BlockingPlaceholder state={state} role={role}/> : <><div className="console-title"><div><p className="eyebrow">{data.eyebrow}</p><h1>{data.title}</h1><p>{data.subtitle}</p></div><div className="metric"><strong>{data.metric}</strong><span>{data.metricLabel}</span></div></div>
          <section className="console-grid">
            <article className="card timeline"><h2>Dòng thời gian</h2>{data.steps.map((step, i) => <div key={step} className={i === 0 ? 'current' : ''}><time>{`${String(9 + i).padStart(2, '0')}:15`}</time><span/><p><b>{step}</b><small>{i === 0 ? 'Đang hoạt động' : 'Chờ bước trước hoàn tất'}</small></p></div>)}</article>
            <article className="card"><h2>Ngữ cảnh</h2><MapMock role={role} state={state}/><PrimaryAction data={data} disabled={!canUsePrimaryAction(role, state)}/></article>
          </section>
          </>}
        </main>
      </div>
    </div>
  );
}

function PrototypeSwitcher({ role, variant, state }) {
  useEffect(() => {
    const onKey = (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target.closest('button, select, input, textarea, a, [contenteditable="true"]')) return;
      const index = variants.findIndex((item) => item.id === variant);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      navigate({ variant: variants[(index + delta + variants.length) % variants.length].id });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [variant]);
  if (import.meta.env.PROD) return null;
  return (
    <aside className="prototype-switcher" aria-label="Prototype controls">
      <strong>WEB-004 · throwaway</strong>
      <label>Role<select value={role} onChange={e => navigate({ role: e.target.value, state: 'active' })}>{roles.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>State<select value={state} onChange={e => navigate({ state: e.target.value })}>{statesFor(role).map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="variant-tabs">{variants.map(item => <button className={item.id === variant ? 'active' : ''} onClick={() => navigate({ variant: item.id })} key={item.id}>{item.id} · {item.name}</button>)}</div>
      <small>←/→ đổi variant · state: {JSON.stringify({ role, variant, state })}</small>
    </aside>
  );
}

function App() {
  const params = useMemo(readParams, []); const data = dataForState(params.role, params.state, copy[params.role]);
  const Page = params.variant === 'B' ? MapFirst : params.variant === 'C' ? TimelineConsole : TaskFirst;
  return <><Page role={params.role} data={data} state={params.state}/><PrototypeSwitcher {...params}/></>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App/></StrictMode>);
