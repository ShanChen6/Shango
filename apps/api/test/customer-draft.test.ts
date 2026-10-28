import { describe, expect, it, vi } from 'vitest';
import type { MapConfig, MapSearch } from '@shango/contracts';
import {
  createDeliveryDraft,
  draftReady,
  normalizeContactPhone,
  stopErrors,
  emptyStop,
} from '../../customer/src/delivery-draft';
const config: MapConfig = {
  region: {
    id: 'hanoi-pilot',
    name: 'Hà Nội',
    bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
    center: { longitude: 105.8342, latitude: 21.0278 },
  },
  geocodingConfigured: true,
  routingConfigured: false,
  searchMode: 'submit-only',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
  routingProfile: 'driving-unverified-for-motorcycles',
};
const point = { longitude: 105.852, latitude: 21.028 };
const place = { id: 'hoankiem', label: 'Hồ Hoàn Kiếm, Hà Nội', position: point };
function setup() {
  const api = {
    mapConfig: vi.fn().mockResolvedValue(config),
    searchPlaces: vi.fn().mockResolvedValue({ items: [place] }),
    reversePlace: vi
      .fn()
      .mockResolvedValue({
        item: { ...place, position: { longitude: 105.85, latitude: 21.03 } },
        requestedPosition: point,
      }),
  };
  return { api, draft: createDeliveryDraft(api) };
}
function contact(draft: ReturnType<typeof createDeliveryDraft>) {
  draft.update('contactName', '  Nguyễn   An ');
  draft.update('contactPhone', '090 123 4567');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('SG-014 customer delivery draft', () => {
  it('ignores a reverse response after the user moves the pin', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.select(point, 'Địa chỉ cũ');
    const request = deferred<{
      item: typeof place;
      requestedPosition: typeof point;
      provider: 'nominatim';
    }>();
    api.reversePlace.mockReturnValueOnce(request.promise);
    const pending = draft.reverse();
    const next = { longitude: 105.84, latitude: 21.04 };
    draft.select(next, 'Điểm mới');
    request.resolve({ item: place, requestedPosition: point, provider: 'nominatim' });
    await pending;
    expect(draft.getSnapshot().stops.pickup.position).toEqual(next);
    expect(draft.getSnapshot().stops.pickup.label).toBe('Điểm mới');
  });
  it('does not offer a ready summary while a new reverse lookup is pending', async () => {
    const { api, draft } = setup();
    await draft.load();
    for (const key of ['pickup', 'dropoff'] as const) {
      draft.setActive(key);
      draft.select(point, place.label);
      contact(draft);
      draft.confirm();
    }
    expect(draftReady(draft.getSnapshot())).toBe(true);
    const request = deferred<{
      item: typeof place;
      requestedPosition: typeof point;
      provider: 'nominatim';
    }>();
    api.reversePlace.mockReturnValueOnce(request.promise);
    const pending = draft.reverse();
    expect(draftReady(draft.getSnapshot())).toBe(false);
    request.resolve({ item: place, requestedPosition: point, provider: 'nominatim' });
    await pending;
    expect(draftReady(draft.getSnapshot())).toBe(false);
  });
  it('does not search per keystroke and requires an explicit submit', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.setQuery('Hồ Hoàn Kiếm');
    expect(api.searchPlaces).not.toHaveBeenCalled();
    await draft.search();
    expect(api.searchPlaces).toHaveBeenCalledExactlyOnceWith('Hồ Hoàn Kiếm');
    expect(draft.getSnapshot().results).toEqual([place]);
  });
  it('ignores stale results after text changes', async () => {
    const { api, draft } = setup();
    await draft.load();
    const request = deferred<MapSearch>();
    api.searchPlaces.mockReturnValueOnce(request.promise);
    draft.setQuery('Hoàn Kiếm');
    const pending = draft.search();
    draft.setQuery('Văn Miếu');
    request.resolve({ items: [place], provider: 'nominatim' });
    await pending;
    expect(draft.getSnapshot().results).toBeNull();
    expect(draft.getSnapshot().query).toBe('Văn Miếu');
  });
  it('does not apply an old search to the other stop', async () => {
    const { api, draft } = setup();
    await draft.load();
    const request = deferred<MapSearch>();
    api.searchPlaces.mockReturnValueOnce(request.promise);
    draft.setQuery('Hoàn Kiếm');
    const pending = draft.search();
    draft.setActive('dropoff');
    request.resolve({ items: [place], provider: 'nominatim' });
    await pending;
    expect(draft.getSnapshot().results).toBeNull();
    expect(draft.getSnapshot().stops.dropoff.position).toBeNull();
  });
  it('preserves the requested pin when reverse returns a nearby address', async () => {
    const { draft } = setup();
    await draft.load();
    draft.select(point);
    await draft.reverse();
    expect(draft.getSnapshot().stops.pickup.position).toEqual(point);
    expect(draft.getSnapshot().stops.pickup.label).toBe(place.label);
  });
  it('invalidates confirmation when pin/contact/note changes', async () => {
    const { draft } = setup();
    await draft.load();
    draft.select(point, place.label);
    contact(draft);
    expect(draft.confirm()).toBe(true);
    draft.update('note', 'Gọi khi đến');
    expect(draft.getSnapshot().stops.pickup.confirmed).toBe(false);
    draft.confirm();
    draft.select({ longitude: 105.84, latitude: 21.03 });
    expect(draft.getSnapshot().stops.pickup.confirmed).toBe(false);
    expect(draft.confirm()).toBe(false);
  });
  it('only becomes ready after both stops have valid contacts and explicit confirmations', async () => {
    const { draft } = setup();
    await draft.load();
    draft.select(point, place.label);
    contact(draft);
    draft.confirm();
    expect(draftReady(draft.getSnapshot())).toBe(false);
    draft.setActive('dropoff');
    draft.select({ longitude: 105.84, latitude: 21.04 }, 'Địa chỉ giao, Hà Nội');
    contact(draft);
    draft.confirm();
    expect(draftReady(draft.getSnapshot())).toBe(true);
    expect(draft.getSnapshot().stops.dropoff.contactPhone).toBe('+84901234567');
    draft.update('contactPhone', 'wrong');
    expect(draftReady(draft.getSnapshot())).toBe(false);
  });
  it('does not confirm a previous pin while manually edited coordinates are uncommitted', async () => {
    const { draft } = setup();
    await draft.load();
    draft.select(point, place.label);
    contact(draft);
    draft.confirm();
    draft.coordinatesChanged();
    expect(draft.confirm()).toBe(false);
    draft.select(point, place.label);
    expect(draft.confirm()).toBe(true);
  });
  it('rejects out-of-region or swapped coordinates and removes the old candidate', async () => {
    const { draft } = setup();
    await draft.load();
    draft.select(point, place.label);
    expect(draft.select({ longitude: 106.7, latitude: 10.77 })).toBe(false);
    expect(draft.getSnapshot().stops.pickup.position).toBeNull();
    expect(draft.select({ longitude: 21.028, latitude: 105.852 })).toBe(false);
    expect(draft.select({ longitude: NaN, latitude: 21 })).toBe(false);
  });
  it('permits manual address entry when geocoding is not configured', async () => {
    const { api, draft } = setup();
    api.mapConfig.mockResolvedValue({ ...config, geocodingConfigured: false });
    await draft.load();
    draft.setQuery('Hồ Hoàn Kiếm');
    await draft.search();
    expect(api.searchPlaces).not.toHaveBeenCalled();
    draft.select(point, 'Điểm hẹn tự nhập');
    contact(draft);
    expect(draft.confirm()).toBe(true);
  });
  it('preserves contacts and candidate after a provider failure', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.select(point, 'Địa chỉ tự nhập');
    contact(draft);
    api.reversePlace.mockRejectedValueOnce(new Error('Offline'));
    await draft.reverse();
    expect(draft.getSnapshot().stops.pickup.contactName).toContain('Nguyễn');
    expect(draft.getSnapshot().stops.pickup.position).toEqual(point);
    expect(draft.getSnapshot().error).toBeTruthy();
  });
  it('clears personal data and ignores responses after reset', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.select(point, place.label);
    contact(draft);
    const request = deferred<MapSearch>();
    api.searchPlaces.mockReturnValueOnce(request.promise);
    draft.setQuery('Hoàn Kiếm');
    const pending = draft.search();
    draft.reset();
    request.resolve({ items: [place], provider: 'nominatim' });
    await pending;
    expect(draft.getSnapshot().stops.pickup).toEqual(emptyStop());
    expect(draft.getSnapshot().results).toBeNull();
  });
  it('retries configuration load after a network failure', async () => {
    const { api, draft } = setup();
    api.mapConfig.mockRejectedValueOnce(new Error('Offline'));
    await draft.load();
    expect(draft.getSnapshot().config).toBeNull();
    expect(draft.getSnapshot().loading).toBe(false);
    await draft.load();
    expect(draft.getSnapshot().config?.region.name).toBe('Hà Nội');
  });
  it('validates name/phone/notes independently of UI length restrictions', () => {
    expect(normalizeContactPhone('090-123-4567')).toBe('+84901234567');
    expect(normalizeContactPhone('+1 (415) 555-0123')).toBe('+14155550123');
    expect(normalizeContactPhone('abc')).toBeNull();
    expect(
      stopErrors(
        {
          ...emptyStop(),
          position: point,
          label: 'Hà Nội',
          contactName: 'An\nNguyễn',
          contactPhone: '0901234567',
          note: 'x'.repeat(501),
        },
        config,
      ).length,
    ).toBe(2);
  });
});
