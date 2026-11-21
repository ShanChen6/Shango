/**
 * WEB-002 field measurement (pure). Events carry timestamps and accuracy only — never
 * coordinates — so the exported evidence can be committed without exposing locations.
 */
export const SCENARIOS = [
  {
    id: 'foreground-2m',
    label: 'Foreground 2 phút',
    minutes: 2,
    steps: 'Giữ trang mở, màn hình sáng, đứng hoặc di chuyển ngoài trời.',
  },
  {
    id: 'background-2m',
    label: 'Background 2 phút',
    minutes: 2,
    steps: 'Bắt đầu, chuyển sang app khác 2 phút, rồi quay lại và Dừng.',
  },
  {
    id: 'lock-2m',
    label: 'Lock 2 phút',
    minutes: 2,
    steps: 'Bắt đầu, khóa màn hình 2 phút, mở khóa rồi Dừng.',
  },
  {
    id: 'offline-45s',
    label: 'Offline 45 giây',
    minutes: 1.5,
    steps: 'Bắt đầu, bật chế độ máy bay 45 giây, tắt đi, chờ kết nối lại rồi Dừng.',
  },
  {
    id: 'permission-denied',
    label: 'Permission denied',
    minutes: 0.5,
    steps: 'Chặn quyền Vị trí cho trang trong cài đặt trình duyệt trước khi Bắt đầu.',
  },
  {
    id: 'foreground-15m',
    label: 'Foreground 15 phút / battery',
    minutes: 15,
    steps: 'Giữ trang mở 15 phút, ghi % pin trước và sau.',
  },
] as const;
export type ScenarioId = (typeof SCENARIOS)[number]['id'];

export type LabEvent =
  | { type: 'fix'; at: number; accuracy: number }
  | {
      type: 'hidden' | 'visible' | 'offline' | 'online' | 'socket-up' | 'socket-down' | 'denied';
      at: number;
    }
  | { type: 'error'; at: number; code: string }
  | { type: 'battery'; at: number; level: number };

export type LabSummary = {
  durationSeconds: number;
  fixes: number;
  intervalMedian: number | null;
  intervalMax: number | null;
  accuracyMedian: number | null;
  accuracyMax: number | null;
  hiddenSeconds: number;
  gapWhileHidden: number | null;
  reconnectSeconds: number | null;
  batteryBefore: number | null;
  batteryAfter: number | null;
  denied: boolean;
  errors: number;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Hidden periods as [start, end]; an unfinished one ends at `end`. */
function hiddenPeriods(events: LabEvent[], end: number) {
  const periods: Array<[number, number]> = [];
  let since: number | null = null;
  for (const event of events) {
    if (event.type === 'hidden' && since === null) since = event.at;
    if (event.type === 'visible' && since !== null) {
      periods.push([since, event.at]);
      since = null;
    }
  }
  if (since !== null) periods.push([since, end]);
  return periods;
}

export function summarize(events: LabEvent[], start: number, end: number): LabSummary {
  const fixes = events.filter(
    (event): event is Extract<LabEvent, { type: 'fix' }> => event.type === 'fix',
  );
  const times = [start, ...fixes.map((fix) => fix.at)];
  const intervals: Array<{ from: number; to: number; seconds: number }> = [];
  for (let index = 1; index < times.length; index += 1)
    intervals.push({
      from: times[index - 1]!,
      to: times[index]!,
      seconds: (times[index]! - times[index - 1]!) / 1000,
    });
  // The tail after the last fix counts as a gap too (e.g. GPS stopped while locked).
  if (fixes.length)
    intervals.push({
      from: times[times.length - 1]!,
      to: end,
      seconds: (end - times[times.length - 1]!) / 1000,
    });
  const fixIntervals = intervals.slice(1, fixes.length).map((item) => item.seconds);
  const periods = hiddenPeriods(events, end);
  const overlapping = intervals.filter((item) =>
    periods.some(([from, to]) => item.from < to && item.to > from),
  );
  const batteries = events.filter(
    (event): event is Extract<LabEvent, { type: 'battery' }> => event.type === 'battery',
  );

  let reconnectSeconds: number | null = null;
  const lastOnline = [...events].reverse().find((event) => event.type === 'online');
  if (lastOnline) {
    const up = events.find((event) => event.type === 'socket-up' && event.at >= lastOnline.at);
    if (up) reconnectSeconds = round1((up.at - lastOnline.at) / 1000);
  }
  const accuracies = fixes.map((fix) => fix.accuracy);
  const intervalMedian = median(fixIntervals);
  const accuracyMedian = median(accuracies);
  return {
    durationSeconds: Math.round((end - start) / 1000),
    fixes: fixes.length,
    intervalMedian: intervalMedian === null ? null : round1(intervalMedian),
    intervalMax: fixIntervals.length ? round1(Math.max(...fixIntervals)) : null,
    accuracyMedian: accuracyMedian === null ? null : Math.round(accuracyMedian),
    accuracyMax: accuracies.length ? Math.round(Math.max(...accuracies)) : null,
    hiddenSeconds: Math.round(periods.reduce((sum, [from, to]) => sum + (to - from), 0) / 1000),
    gapWhileHidden: overlapping.length
      ? round1(Math.max(...overlapping.map((item) => item.seconds)))
      : null,
    reconnectSeconds,
    batteryBefore: batteries[0]?.level ?? null,
    batteryAfter: batteries.length > 1 ? batteries[batteries.length - 1]!.level : null,
    denied: events.some((event) => event.type === 'denied'),
    errors: events.filter((event) => event.type === 'error').length,
  };
}

export function detectPlatform(userAgent: string) {
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  const android = /Android/.test(userAgent);
  const osVersion = ios
    ? (userAgent.match(/OS (\d+[_.]\d+)/)?.[1]?.replace('_', '.') ?? '')
    : android
      ? (userAgent.match(/Android (\d+(?:\.\d+)?)/)?.[1] ?? '')
      : '';
  const browser = /CriOS\/(\d+)/.exec(userAgent)
    ? `Chrome iOS ${/CriOS\/(\d+)/.exec(userAgent)![1]}`
    : /Firefox\/(\d+)|FxiOS\/(\d+)/.exec(userAgent)
      ? `Firefox ${/Firefox\/(\d+)|FxiOS\/(\d+)/.exec(userAgent)!.slice(1).find(Boolean)}`
      : /Chrome\/(\d+)/.exec(userAgent)
        ? `Chrome ${/Chrome\/(\d+)/.exec(userAgent)![1]}`
        : /Version\/(\d+(?:\.\d+)?).*Safari/.exec(userAgent)
          ? `Safari ${/Version\/(\d+(?:\.\d+)?)/.exec(userAgent)![1]}`
          : 'Không rõ';
  return {
    os: ios ? `iOS ${osVersion}`.trim() : android ? `Android ${osVersion}`.trim() : 'Desktop/khác',
    browser,
  };
}

const cell = (value: string) => value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '—';
const pair = (a: number | null, b: number | null, unit: string) =>
  a === null ? '—' : `${a}/${b ?? '—'} ${unit}`;

/** One row for the matrix in docs/web-002-browser-evidence.md (no coordinates by construction). */
export function toMarkdownRow(
  meta: { device: string; os: string; browser: string; scenario: string; recordedAt: string },
  summary: LabSummary,
  notes: string,
) {
  const gap =
    summary.gapWhileHidden === null
      ? '—'
      : `max ${summary.gapWhileHidden}s (ẩn ${summary.hiddenSeconds}s)`;
  const reconnect =
    summary.reconnectSeconds === null ? '—' : `${summary.reconnectSeconds}s tới socket`;
  const battery =
    summary.batteryBefore === null
      ? '—'
      : `${summary.batteryBefore}%/${summary.batteryAfter ?? '—'}%`;
  const evidence = [
    `${summary.fixes} fix`,
    summary.denied ? 'UI báo bị chặn quyền' : '',
    summary.errors ? `${summary.errors} lỗi GPS` : '',
    `gps-lab ${meta.recordedAt.slice(0, 16)}Z`,
    notes,
  ]
    .filter(Boolean)
    .join('; ');
  return `| ${[
    meta.device,
    meta.os,
    meta.browser,
    meta.scenario,
    `${summary.durationSeconds}s`,
    pair(summary.intervalMedian, summary.intervalMax, 's'),
    pair(summary.accuracyMedian, summary.accuracyMax, 'm'),
    gap,
    reconnect,
    battery,
    evidence,
  ]
    .map(cell)
    .join(' | ')} |`;
}
