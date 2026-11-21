import type { Coordinate, MapConfig, MapPlace } from '@shango/contracts';

export type StopKey = 'pickup' | 'dropoff';
export type DeliveryStop = {
  position: Coordinate | null;
  label: string;
  addressDetails: string;
  contactName: string;
  contactPhone: string;
  note: string;
  confirmed: boolean;
};

export const emptyStop = (): DeliveryStop => ({ position: null, label: '', addressDetails: '', contactName: '', contactPhone: '', note: '', confirmed: false });
export const withinRegion = (point: Coordinate, config: MapConfig) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude) && point.longitude >= config.region.bounds.west && point.longitude <= config.region.bounds.east && point.latitude >= config.region.bounds.south && point.latitude <= config.region.bounds.north;
export function normalizeContactPhone(value: string) { const cleaned = value.replace(/[\s().-]/g, ''); const phone = /^0\d{9}$/.test(cleaned) ? `+84${cleaned.slice(1)}` : cleaned; return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null; }
export function stopErrors(stop: DeliveryStop, config: MapConfig | null) {
  const errors: string[] = [];
  if (!config || !stop.position || !withinRegion(stop.position, config)) errors.push('Chọn điểm hợp lệ trong khung thử nghiệm Hà Nội.');
  if (stop.label.trim().length < 3 || stop.label.length > 500) errors.push('Nhập hoặc chọn địa chỉ cho điểm này.');
  const name = stop.contactName.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/.test(stop.contactName)) errors.push('Tên người liên hệ cần 2–80 ký tự.');
  if (!normalizeContactPhone(stop.contactPhone)) errors.push('Nhập số điện thoại hợp lệ, ví dụ 0901234567.');
  if (stop.addressDetails.length > 200 || stop.note.length > 500) errors.push('Chi tiết tối đa 200 ký tự; ghi chú tối đa 500 ký tự.');
  return errors;
}
export function confirmStop(stop: DeliveryStop, config: MapConfig | null) {
  const errors = stopErrors(stop, config);
  if (errors.length) return { stop, errors };
  return { stop: { ...stop, label: stop.label.trim(), contactName: stop.contactName.normalize('NFC').trim().replace(/\s+/g, ' '), contactPhone: normalizeContactPhone(stop.contactPhone)!, confirmed: true }, errors };
}
export const draftReady = (stops: Record<StopKey, DeliveryStop>, config: MapConfig | null) => (['pickup', 'dropoff'] as const).every(key => stops[key].confirmed && stopErrors(stops[key], config).length === 0);
export const placeToStop = (place: MapPlace, current: DeliveryStop): DeliveryStop => ({ ...current, position: place.position, label: place.label, confirmed: false });
