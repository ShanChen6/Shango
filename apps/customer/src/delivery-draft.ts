import type { Coordinate, MapConfig, MapPlace } from '@shango/contracts';
import type { createApi } from '@shango/api-client';
export type StopKey = 'pickup' | 'dropoff';
export interface DeliveryStop {
  position: Coordinate | null;
  label: string;
  addressDetails: string;
  contactName: string;
  contactPhone: string;
  note: string;
  confirmed: boolean;
}
export interface DraftState {
  coordinateEditing: boolean;
  config: MapConfig | null;
  loading: boolean;
  active: StopKey;
  query: string;
  results: MapPlace[] | null;
  searching: boolean;
  reversing: boolean;
  error: string;
  stops: Record<StopKey, DeliveryStop>;
}
export const emptyStop = (): DeliveryStop => ({
  position: null,
  label: '',
  addressDetails: '',
  contactName: '',
  contactPhone: '',
  note: '',
  confirmed: false,
});
export function withinRegion(point: Coordinate, config: MapConfig) {
  const b = config.region.bounds;
  return (
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    point.longitude >= b.west &&
    point.longitude <= b.east &&
    point.latitude >= b.south &&
    point.latitude <= b.north
  );
}
export function normalizeContactPhone(value: string) {
  const cleaned = value.replace(/[\s().-]/g, '');
  const phone = /^0\d{9}$/.test(cleaned) ? `+84${cleaned.slice(1)}` : cleaned;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function stopErrors(stop: DeliveryStop, config: MapConfig | null) {
  const errors: string[] = [];
  if (!config || !stop.position || !withinRegion(stop.position, config))
    errors.push('Chọn pin hợp lệ trong khung thử nghiệm Hà Nội.');
  if (stop.label.trim().length < 3 || stop.label.length > 2000)
    errors.push('Nhập hoặc chọn địa chỉ cho pin.');
  const name = stop.contactName.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(stop.contactName))
    errors.push('Tên người liên hệ cần 2–80 ký tự, không có ký tự điều khiển.');
  if (!normalizeContactPhone(stop.contactPhone))
    errors.push('Nhập số điện thoại hợp lệ, ví dụ 0901234567 hoặc +84901234567.');
  if (stop.addressDetails.length > 200 || stop.note.length > 500)
    errors.push('Chi tiết địa chỉ tối đa 200 ký tự; ghi chú tối đa 500 ký tự.');
  return errors;
}
export function draftReady(state: DraftState) {
  if (state.loading || state.searching || state.reversing || state.coordinateEditing) return false;
  return (['pickup', 'dropoff'] as const).every(
    (key) => state.stops[key].confirmed && stopErrors(state.stops[key], state.config).length === 0,
  );
}
type MapsApi = Pick<ReturnType<typeof createApi>, 'mapConfig' | 'searchPlaces' | 'reversePlace'>;
export function createDeliveryDraft(api: MapsApi) {
  let state: DraftState = {
    coordinateEditing: false,
    config: null,
    loading: false,
    active: 'pickup',
    query: '',
    results: null,
    searching: false,
    reversing: false,
    error: '',
    stops: { pickup: emptyStop(), dropoff: emptyStop() },
  };
  let epoch = 0;
  const listeners = new Set<() => void>();
  const emit = (patch: Partial<DraftState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const modify = (patch: Partial<DeliveryStop>) => {
    epoch++;
    emit({
      loading: false,
      stops: {
        ...state.stops,
        [state.active]: { ...state.stops[state.active], ...patch, confirmed: false },
      },
      searching: false,
      reversing: false,
      error: '',
    });
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel: () => {
      epoch++;
    },
    reset: () => {
      epoch++;
      emit({
        loading: false,
        coordinateEditing: false,
        stops: { pickup: emptyStop(), dropoff: emptyStop() },
        active: 'pickup',
        query: '',
        results: null,
        error: '',
        searching: false,
        reversing: false,
      });
    },
    load: async () => {
      const version = ++epoch;
      emit({ loading: true, error: '', searching: false, reversing: false });
      try {
        const config = await api.mapConfig();
        if (version !== epoch) return;
        const stops = { ...state.stops };
        for (const key of ['pickup', 'dropoff'] as const)
          if (stops[key].position && !withinRegion(stops[key].position!, config))
            stops[key] = { ...stops[key], position: null, confirmed: false };
        emit({ config, stops });
      } catch {
        if (version === epoch)
          emit({ error: 'Không tải được cấu hình bản đồ. Kiểm tra mạng rồi thử lại.' });
      } finally {
        if (version === epoch) emit({ loading: false });
      }
    },
    setActive: (active: StopKey) => {
      epoch++;
      emit({
        coordinateEditing: false,
        active,
        query: '',
        results: null,
        error: '',
        searching: false,
        reversing: false,
        loading: false,
      });
    },
    setQuery: (query: string) => {
      modify({});
      emit({ query, results: null });
    },
    coordinatesChanged: () => {
      modify({});
      emit({ coordinateEditing: true });
    },
    update: (
      field: 'label' | 'addressDetails' | 'contactName' | 'contactPhone' | 'note',
      value: string,
    ) => modify({ [field]: value }),
    select: (position: Coordinate, label = '') => {
      if (!state.config || !withinRegion(position, state.config)) {
        modify({ position: null, label: '' });
        emit({ error: 'Pin nằm ngoài khung thử nghiệm Hà Nội.', coordinateEditing: false });
        return false;
      }
      modify({ position: { ...position }, label });
      emit({ results: null, coordinateEditing: false });
      return true;
    },
    search: async () => {
      const query = state.query.trim();
      if (!state.config?.geocodingConfigured) {
        emit({ error: 'Tìm địa chỉ chưa cấu hình. Có thể nhập tọa độ và địa chỉ thủ công.' });
        return;
      }
      if (query.length < 3 || query.length > 160) {
        emit({ error: 'Từ khóa cần 3–160 ký tự.' });
        return;
      }
      const version = ++epoch;
      emit({ searching: true, reversing: false, results: null, error: '' });
      try {
        const response = await api.searchPlaces(query);
        if (version === epoch)
          emit({
            results: response.items.filter((item) => withinRegion(item.position, state.config!)),
          });
      } catch {
        if (version === epoch)
          emit({ error: 'Chưa tìm được địa chỉ. Chờ một chút rồi bấm tìm lại.' });
      } finally {
        if (version === epoch) emit({ searching: false });
      }
    },
    reverse: async () => {
      const position = state.stops[state.active].position;
      if (!position || !state.config?.geocodingConfigured || state.coordinateEditing) {
        emit({ error: 'Chọn pin và cấu hình tìm địa chỉ trước khi tra cứu.' });
        return;
      }
      const version = ++epoch;
      const active = state.active;
      emit({ reversing: true, searching: false, error: '' });
      try {
        const response = await api.reversePlace(position);
        if (version === epoch)
          emit({
            stops: {
              ...state.stops,
              [active]: { ...state.stops[active], label: response.item.label, confirmed: false },
            },
          });
      } catch {
        if (version === epoch)
          emit({ error: 'Chưa tìm được địa chỉ cho pin. Bạn có thể tự nhập địa chỉ.' });
      } finally {
        if (version === epoch) emit({ reversing: false });
      }
    },
    confirm: () => {
      const stop = state.stops[state.active];
      const errors = stopErrors(stop, state.config);
      if (state.coordinateEditing) errors.push('Bấm Chọn tọa độ đã nhập trước khi xác nhận.');
      epoch++;
      if (errors.length) {
        emit({ error: errors.join('\n'), searching: false, reversing: false });
        return false;
      }
      emit({
        stops: {
          ...state.stops,
          [state.active]: {
            ...stop,
            label: stop.label.trim(),
            contactName: stop.contactName.normalize('NFC').trim().replace(/\s+/g, ' '),
            contactPhone: normalizeContactPhone(stop.contactPhone)!,
            confirmed: true,
          },
        },
        error: '',
        searching: false,
        reversing: false,
      });
      return true;
    },
  };
}
