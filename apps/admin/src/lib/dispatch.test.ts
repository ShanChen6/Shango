import { describe, expect, it } from 'vitest';
import type { Order } from '@shango/contracts';
import { exceptionLabel, orderExceptions, summarize } from './dispatch';

const now = Date.parse('2026-11-21T10:10:00Z');
const base = {
  id: 'o',
  status: 'SEARCHING',
  createdAt: '2026-11-21T10:09:30Z',
  searchDeadline: '2026-11-21T10:14:30Z',
  driverLocation: null,
} as unknown as Order;
const at = (patch: Partial<Order>) => ({ ...base, ...patch }) as Order;
const location = (lastSeenAt: string) => ({
  longitude: 105.85,
  latitude: 21.03,
  accuracy: 10,
  recordedAt: lastSeenAt,
  lastSeenAt,
});

describe('admin dispatch exceptions', () => {
  it('flags orders searching for two minutes or close to expiry', () => {
    expect(orderExceptions(base, now)).toEqual([]);
    expect(orderExceptions(at({ createdAt: '2026-11-21T10:07:30Z' }), now)).toEqual([
      { kind: 'searching-long', seconds: 150 },
    ]);
    expect(orderExceptions(at({ searchDeadline: '2026-11-21T10:10:45Z' }), now)).toEqual([
      { kind: 'search-ending', seconds: 45 },
    ]);
  });
  it('flags active orders whose driver GPS is stale or missing, never cancelling anything', () => {
    expect(orderExceptions(at({ status: 'ASSIGNED' }), now)).toEqual([{ kind: 'gps-missing' }]);
    expect(
      orderExceptions(
        at({ status: 'IN_TRANSIT', driverLocation: location('2026-11-21T10:08:50Z') }),
        now,
      ),
    ).toEqual([{ kind: 'gps-stale', seconds: 70 }]);
    expect(
      orderExceptions(
        at({ status: 'PICKED_UP', driverLocation: location('2026-11-21T10:09:40Z') }),
        now,
      ),
    ).toEqual([]);
  });
  it('ignores finished orders and summarizes counts', () => {
    expect(
      orderExceptions(at({ status: 'DELIVERED', createdAt: '2026-11-21T09:00:00Z' }), now),
    ).toEqual([]);
    expect(
      summarize(
        [
          at({ createdAt: '2026-11-21T10:00:00Z' }),
          at({ status: 'ASSIGNED' }),
          at({ status: 'CANCELLED' }),
        ],
        now,
      ),
    ).toEqual({ searching: 1, gps: 1 });
    expect(exceptionLabel({ kind: 'searching-long', seconds: 150 })).toBe('Tìm tài xế 2 phút');
  });
});
