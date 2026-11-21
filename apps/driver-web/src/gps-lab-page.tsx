import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, InlineAlert, PageHeader, TextField } from '@shango/ui';
import { useWork } from './driver-work';
import { useForegroundLocation } from './use-foreground-location';
import {
  detectPlatform,
  SCENARIOS,
  summarize,
  toMarkdownRow,
  type LabEvent,
  type ScenarioId,
} from './gps-lab';

type BatteryManager = { level: number };
const connectionLabels = {
  connecting: 'đang kết nối',
  connected: 'đã kết nối',
  reconnecting: 'đang thử lại',
  offline: 'ngoại tuyến',
};
const withUnit = (value: number | null, unit: string) => (value === null ? '—' : `${value}${unit}`);
const readBattery = async () => {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    const battery = await nav.getBattery?.();
    return battery ? Math.round(battery.level * 100) : null;
  } catch {
    return null;
  }
};

/**
 * WEB-002 field tool. Records fix timing/accuracy and page/network/socket events locally,
 * never coordinates, and never sends anything to the API.
 */
export function GpsLabPage() {
  const { connection } = useWork();
  const platform = detectPlatform(navigator.userAgent);
  const [device, setDevice] = useState('');
  const [scenario, setScenario] = useState<ScenarioId>('foreground-2m');
  const [notes, setNotes] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const events = useRef<LabEvent[]>([]);
  const recording = startedAt !== null && endedAt === null;
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  const record = (event: LabEvent) => {
    if (!recordingRef.current) return;
    events.current.push(event);
    setCount(events.current.length);
  };

  const location = useForegroundLocation((fix) =>
    record({ type: 'fix', at: Date.now(), accuracy: fix.accuracy }),
  );

  useEffect(() => {
    if (location.freshness === 'denied') record({ type: 'denied', at: Date.now() });
  }, [location.freshness]);
  useEffect(() => {
    if (location.lastError)
      record({ type: 'error', at: Date.now(), code: location.lastError.slice(0, 40) });
  }, [location.lastError]);
  useEffect(() => {
    record({ type: connection === 'connected' ? 'socket-up' : 'socket-down', at: Date.now() });
  }, [connection]);
  useEffect(() => {
    const onVisibility = () =>
      record({
        type: document.visibilityState === 'hidden' ? 'hidden' : 'visible',
        at: Date.now(),
      });
    const onOnline = () => record({ type: 'online', at: Date.now() });
    const onOffline = () => record({ type: 'offline', at: Date.now() });
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('online', onOnline);
    addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('online', onOnline);
      removeEventListener('offline', onOffline);
    };
  }, []);

  const start = async () => {
    events.current = [];
    setCount(0);
    setCopied(false);
    setEndedAt(null);
    const now = Date.now();
    setStartedAt(now);
    recordingRef.current = true;
    const level = await readBattery();
    if (level !== null) record({ type: 'battery', at: now, level });
    location.start();
  };
  const stop = async () => {
    const level = await readBattery();
    if (level !== null) record({ type: 'battery', at: Date.now(), level });
    location.stop();
    setEndedAt(Date.now());
  };

  const meta = SCENARIOS.find((item) => item.id === scenario)!;
  const summary =
    startedAt !== null ? summarize(events.current, startedAt, endedAt ?? location.now) : null;
  const row =
    summary && endedAt !== null
      ? toMarkdownRow(
          {
            device: device || 'Chưa ghi tên máy',
            os: platform.os,
            browser: platform.browser,
            scenario: meta.label,
            recordedAt: new Date(startedAt!).toISOString(),
          },
          summary,
          notes,
        )
      : '';
  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            tool: 'shango-gps-lab',
            scenario: meta.label,
            device,
            ...platform,
            startedAt,
            endedAt,
            summary,
            events: events.current,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `web002-${scenario}-${new Date(startedAt!).toISOString().slice(0, 16).replace(':', '')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        eyebrow="WEB-002 · ĐO TRÊN THIẾT BỊ THẬT"
        title="Đo GPS trình duyệt"
        description="Chỉ lưu thời điểm và sai số trên máy này; không lưu tọa độ và không gửi lên máy chủ."
      />
      <div className="grid">
        <Card>
          <h2>Thiết lập</h2>
          <div className="stack">
            <TextField
              label="Tên thiết bị (ví dụ: iPhone 13, Pixel 8)"
              value={device}
              disabled={recording}
              onChange={(e) => setDevice(e.target.value)}
            />
            <p className="hint">
              Nhận diện: {platform.os} · {platform.browser}
            </p>
            <div className="sg-field">
              <label htmlFor="gps-lab-scenario">Kịch bản</label>
              <select
                id="gps-lab-scenario"
                value={scenario}
                disabled={recording}
                onChange={(e) => setScenario(e.target.value as ScenarioId)}
              >
                {SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <InlineAlert tone="warning">{meta.steps}</InlineAlert>
            <TextField
              label="Ghi chú (điện năng, mạng, thời tiết…)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {recording ? (
              <Button type="button" className="secondary" onClick={() => void stop()}>
                Dừng đo
              </Button>
            ) : (
              <Button type="button" onClick={() => void start()}>
                Bắt đầu đo
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <h2>Kết quả</h2>
          <p aria-live="polite">
            <Badge>{recording ? 'Đang đo' : endedAt ? 'Đã dừng' : 'Chưa đo'}</Badge> ·{' '}
            {summary?.fixes ?? 0} fix · {count} sự kiện · socket: {connectionLabels[connection]}
          </p>
          {summary && (
            <ul className="lab-stats">
              <li>
                Thời lượng: {summary.durationSeconds}s (mục tiêu {meta.minutes * 60}s)
              </li>
              <li>
                Khoảng cách fix median/max: {summary.intervalMedian ?? '—'}/
                {summary.intervalMax ?? '—'} giây
              </li>
              <li>
                Sai số median/max: {summary.accuracyMedian ?? '—'}/{summary.accuracyMax ?? '—'} m
              </li>
              <li>
                Thời gian ẩn trang: {summary.hiddenSeconds}s; gap lớn nhất khi ẩn:{' '}
                {withUnit(summary.gapWhileHidden, 's')}
              </li>
              <li>Kết nối lại socket: {withUnit(summary.reconnectSeconds, 's')}</li>
            </ul>
          )}
          {row && (
            <div className="stack">
              <label className="sg-field" htmlFor="gps-lab-row">
                Dòng cho docs/web-002-browser-evidence.md
              </label>
              <textarea id="gps-lab-row" className="lab-row" readOnly value={row} rows={4} />
              <div className="document-actions">
                <Button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard?.writeText(row).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  {copied ? 'Đã sao chép' : 'Sao chép dòng'}
                </Button>
                <Button type="button" className="secondary" onClick={exportJson}>
                  Tải JSON (không có tọa độ)
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
