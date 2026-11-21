import { describe, expect, it } from 'vitest';
import type { Order } from '@shango/contracts';
import { emptyStop } from './delivery-draft';
import { ageSeconds, formatVnd, newerOrder, toQuoteRequest } from './order-format';

const stop = {
  ...emptyStop(),
  position: { longitude: 105.852, latitude: 21.028 },
  label: '  Hồ Hoàn Kiếm, Hà Nội ',
  addressDetails: ' Tầng 2 ',
  contactName: 'Nguyễn An',
  contactPhone: '+84901234567',
  note: ' Gọi trước ',
  confirmed: true,
};

describe('Customer order mapping', () => {
  it('maps the confirmed draft to the quote contract without client-only flags', () => {
    const request = toQuoteRequest({ pickup: stop, dropoff: stop }, 'motorcycle');
    expect(request).toEqual({
      vehicleType: 'motorcycle',
      pickup: {
        position: { longitude: 105.852, latitude: 21.028 },
        address: 'Hồ Hoàn Kiếm, Hà Nội',
        detail: 'Tầng 2',
        contactName: 'Nguyễn An',
        contactPhone: '+84901234567',
        note: 'Gọi trước',
      },
      dropoff: request.pickup,
    });
    expect(JSON.stringify(request)).not.toContain('confirmed');
  });
  it('never replaces a newer snapshot with an older one', () => {
    const v2 = { id: 'o', version: 2 } as Order;
    const v3 = { id: 'o', version: 3 } as Order;
    expect(newerOrder(v3, v2)).toBe(v3);
    expect(newerOrder(v2, v3)).toBe(v3);
    expect(newerOrder(undefined, v2)).toBe(v2);
  });
  it('formats integer VND and ages', () => {
    expect(formatVnd(31000).replace(/\s/g, ' ')).toMatch(/^31\.000 ₫$/);
    expect(ageSeconds('2026-11-21T10:00:00Z', Date.parse('2026-11-21T10:00:45Z'))).toBe(45);
    expect(ageSeconds(null, Date.now())).toBeNull();
  });
});
