import { describe, expect, it } from 'vitest';
import type { MapConfig } from '@shango/contracts';
import { confirmStop, draftReady, emptyStop, normalizeContactPhone, placeToStop, stopErrors, withinRegion } from './delivery-draft';

const config: MapConfig = { region: { id: 'hanoi-pilot', name: 'Hà Nội', bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 }, center: { longitude: 105.8342, latitude: 21.0278 } }, geocodingConfigured: true, routingConfigured: false, searchMode: 'submit-only', attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright', routingProfile: 'driving-unverified-for-motorcycles' };
const point = { longitude: 105.852, latitude: 21.028 };
const valid = { ...emptyStop(), position: point, label: 'Hồ Hoàn Kiếm, Hà Nội', contactName: 'Nguyễn An', contactPhone: '0901234567' };

describe('Customer web delivery draft parity', () => {
  it('normalizes Vietnamese and international contact numbers', () => { expect(normalizeContactPhone('090-123-4567')).toBe('+84901234567'); expect(normalizeContactPhone('+1 (415) 555-0123')).toBe('+14155550123'); expect(normalizeContactPhone('abc')).toBeNull(); });
  it('rejects swapped, non-finite and out-of-region coordinates', () => { expect(withinRegion(point, config)).toBe(true); expect(withinRegion({ longitude: point.latitude, latitude: point.longitude }, config)).toBe(false); expect(withinRegion({ longitude: NaN, latitude: 21 }, config)).toBe(false); });
  it('requires address and contact data before confirmation', () => { expect(stopErrors(emptyStop(), config)).not.toHaveLength(0); expect(stopErrors(valid, config)).toHaveLength(0); });
  it('normalizes contact data only after explicit confirmation', () => { const result = confirmStop({ ...valid, contactName: '  Nguyễn   An ', contactPhone: '090 123 4567' }, config); expect(result.errors).toEqual([]); expect(result.stop).toMatchObject({ confirmed: true, contactName: 'Nguyễn An', contactPhone: '+84901234567' }); });
  it('invalidates confirmation whenever a search result replaces the stop', () => { const selected = placeToStop({ id: '1', label: 'Văn Miếu, Hà Nội', position: point }, { ...valid, confirmed: true }); expect(selected.confirmed).toBe(false); });
  it('marks the draft ready only after both stops are valid and confirmed', () => { const confirmed = confirmStop(valid, config).stop; expect(draftReady({ pickup: confirmed, dropoff: confirmed }, config)).toBe(true); expect(draftReady({ pickup: confirmed, dropoff: emptyStop() }, config)).toBe(false); });
});
