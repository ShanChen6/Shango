import type { DocumentKind, DriverDocument, DriverProfile, DriverStatus } from '@shango/contracts';

export const documentLabels: Record<DocumentKind, string> = {
  identity_front: 'CCCD mặt trước',
  identity_back: 'CCCD mặt sau',
  driver_license: 'Giấy phép lái xe',
  vehicle_registration: 'Đăng ký xe',
};

export const statusLabels: Record<DriverStatus, string> = {
  pending: 'Đang chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Bị từ chối',
};

export const vehicleTypeLabels = { motorcycle: 'Xe máy', car: 'Ô tô' } as const;
export type VehicleType = keyof typeof vehicleTypeLabels;

/** Mirrors the server limit; the API remains the authority and re-validates every upload. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;
export const ACCEPTED_DOCUMENT_TYPES = ACCEPTED_TYPES.join(',');

export function documentFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type))
    return 'Chỉ nhận ảnh JPEG hoặc PNG.';
  if (file.size <= 0) return 'File ảnh rỗng.';
  if (file.size > MAX_DOCUMENT_BYTES) return 'Ảnh vượt quá 5 MiB.';
  return null;
}

export function normalizePlate(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function vehicleErrors(input: { vehiclePlate: string; vehicleType: string }) {
  const errors: string[] = [];
  const plate = normalizePlate(input.vehiclePlate);
  if (plate.length < 4 || plate.length > 20) errors.push('Biển số cần 4–20 ký tự.');
  if (!(input.vehicleType in vehicleTypeLabels)) errors.push('Chọn loại phương tiện.');
  return errors;
}

export function missingDocuments(
  required: readonly DocumentKind[],
  items: readonly DriverDocument[],
) {
  const present = new Set(items.map((item) => item.kind));
  return required.filter((kind) => !present.has(kind));
}

export type OnboardingStep = {
  id: 'vehicle' | 'documents' | 'review';
  label: string;
  done: boolean;
  detail: string;
};

export function onboardingSteps(
  profile: DriverProfile | null,
  documents: { requiredKinds: DocumentKind[]; items: DriverDocument[] } | null,
): OnboardingStep[] {
  const missing =
    profile && documents ? missingDocuments(documents.requiredKinds, documents.items) : null;
  const documentsDone =
    profile?.status === 'approved' || (missing !== null && missing.length === 0);
  return [
    {
      id: 'vehicle',
      label: 'Hồ sơ phương tiện',
      done: Boolean(profile),
      detail: profile
        ? `${vehicleTypeLabels[profile.vehicleType as VehicleType] ?? profile.vehicleType} · ${profile.vehiclePlate}`
        : 'Chưa gửi',
    },
    {
      id: 'documents',
      label: 'Giấy tờ bắt buộc',
      done: documentsDone,
      detail: !profile
        ? 'Gửi hồ sơ phương tiện trước'
        : documentsDone
          ? 'Đã nộp đủ'
          : missing === null
            ? 'Chưa tải được danh sách'
            : `Còn thiếu ${missing.length}`,
    },
    {
      id: 'review',
      label: 'Xét duyệt',
      done: profile?.status === 'approved',
      detail: profile ? statusLabels[profile.status] : 'Chưa bắt đầu',
    },
  ];
}

/** WEB-002 hypotheses (pending device evidence and PO approval), not production policy. */
export const GPS_STALE_AFTER_MS = 30_000;
export const GPS_UNAVAILABLE_AFTER_MS = 60_000;

export type Freshness = 'waiting' | 'fresh' | 'stale' | 'unavailable' | 'denied' | 'unsupported';

export function classifyFix(input: {
  supported: boolean;
  permissionDenied: boolean;
  lastFixAt: number | null;
  startedAt: number | null;
  now: number;
}): Freshness {
  if (!input.supported) return 'unsupported';
  if (input.permissionDenied) return 'denied';
  const reference = input.lastFixAt ?? input.startedAt;
  if (reference === null) return 'waiting';
  const age = Math.max(0, input.now - reference);
  if (age >= GPS_UNAVAILABLE_AFTER_MS) return 'unavailable';
  if (input.lastFixAt === null) return 'waiting';
  return age >= GPS_STALE_AFTER_MS ? 'stale' : 'fresh';
}

export const freshnessLabels: Record<Freshness, string> = {
  waiting: 'Đang chờ vị trí',
  fresh: 'Vị trí mới',
  stale: 'Vị trí cũ',
  unavailable: 'Mất vị trí',
  denied: 'Bị chặn quyền vị trí',
  unsupported: 'Trình duyệt không hỗ trợ',
};

export function formatAge(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60
    ? `${seconds} giây trước`
    : `${Math.floor(seconds / 60)} phút ${seconds % 60} giây trước`;
}

/**
 * External turn-by-turn link (opened only when the driver taps it; the destination is then
 * shared with that map provider). ShanGo does not proxy or store the navigation session.
 */
export function directionsUrl(
  destination: { longitude: number; latitude: number },
  vehicleType: string,
) {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)}`,
    travelmode: vehicleType === 'motorcycle' ? 'two-wheeler' : 'driving',
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
