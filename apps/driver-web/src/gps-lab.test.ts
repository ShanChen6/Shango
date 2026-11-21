import { describe, expect, it } from 'vitest';
import { detectPlatform, summarize, toMarkdownRow, type LabEvent } from './gps-lab';

const t = (seconds: number) => 1_000_000 + seconds * 1000;

describe('WEB-002 gps lab summary', () => {
  it('computes interval and accuracy medians/max from fixes', () => {
    const events: LabEvent[] = [
      { type: 'fix', at: t(2), accuracy: 10 },
      { type: 'fix', at: t(7), accuracy: 20 },
      { type: 'fix', at: t(17), accuracy: 30 },
      { type: 'fix', at: t(22), accuracy: 15 },
    ];
    const summary = summarize(events, t(0), t(25));
    expect(summary).toMatchObject({
      durationSeconds: 25,
      fixes: 4,
      intervalMedian: 5,
      intervalMax: 10,
      accuracyMedian: 18,
      accuracyMax: 30,
      gapWhileHidden: null,
    });
  });

  it('measures the longest fix gap that overlaps a hidden period, including the tail', () => {
    const events: LabEvent[] = [
      { type: 'fix', at: t(5), accuracy: 10 },
      { type: 'hidden', at: t(10) },
      { type: 'visible', at: t(70) },
      { type: 'fix', at: t(72), accuracy: 12 },
      { type: 'hidden', at: t(80) },
    ];
    const summary = summarize(events, t(0), t(100));
    expect(summary.hiddenSeconds).toBe(80);
    expect(summary.gapWhileHidden).toBe(67);
  });

  it('reports reconnect time from the last online event to the next socket connection', () => {
    const events: LabEvent[] = [
      { type: 'offline', at: t(10) },
      { type: 'socket-down', at: t(11) },
      { type: 'online', at: t(55) },
      { type: 'socket-up', at: t(57.5) },
      { type: 'battery', at: t(0), level: 80 },
      { type: 'battery', at: t(60), level: 78 },
      { type: 'denied', at: t(1) },
    ];
    expect(summarize(events, t(0), t(60))).toMatchObject({
      reconnectSeconds: 2.5,
      batteryBefore: 80,
      batteryAfter: 78,
      denied: true,
    });
  });

  it('renders a matrix row without coordinates and escapes pipes', () => {
    const summary = summarize([{ type: 'fix', at: t(5), accuracy: 9 }], t(0), t(120));
    const row = toMarkdownRow(
      {
        device: 'iPhone 13 | test',
        os: 'iOS 18.1',
        browser: 'Safari 18.1',
        scenario: 'Foreground 2 phút',
        recordedAt: '2026-11-21T10:00:00.000Z',
      },
      summary,
      'trời quang',
    );
    expect(row.split(' | ')).toHaveLength(11);
    expect(row).toContain('iPhone 13 / test');
    expect(row).toContain('120s');
    expect(row).toContain('1 fix; gps-lab 2026-11-21T10:00Z; trời quang');
    expect(row).not.toMatch(/\d{2,3}\.\d{4,}/);
  });

  it('detects common mobile platforms from the user agent', () => {
    expect(
      detectPlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ os: 'iOS 18.1', browser: 'Safari 18.1' });
    expect(
      detectPlatform(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      ),
    ).toEqual({ os: 'Android 14', browser: 'Chrome 131' });
  });
});
