import { describe, expect, it } from 'vitest';
import type { DriverDocument, DriverProfile } from '@shango/contracts';
import {
  classifyFix,
  documentFileError,
  formatAge,
  MAX_DOCUMENT_BYTES,
  missingDocuments,
  normalizePlate,
  onboardingSteps,
  vehicleErrors,
} from './driver-policy';

const profile: DriverProfile = {
  userId: 'd1',
  vehiclePlate: '29A-123.45',
  vehicleType: 'motorcycle',
  status: 'pending',
  rejectionReason: null,
  updatedAt: '2026-11-21T00:00:00.000Z',
};
const doc = (kind: DriverDocument['kind']): DriverDocument => ({
  id: kind,
  driverId: 'd1',
  kind,
  contentType: 'image/jpeg',
  byteSize: 1000,
  createdAt: '2026-11-21T00:00:00.000Z',
});
const required = [
  'identity_front',
  'identity_back',
  'driver_license',
  'vehicle_registration',
] as const;

describe('Driver web document policy', () => {
  it('accepts only non-empty JPEG/PNG up to 5 MiB', () => {
    expect(documentFileError({ type: 'image/jpeg', size: 10 })).toBeNull();
    expect(documentFileError({ type: 'image/png', size: MAX_DOCUMENT_BYTES })).toBeNull();
    expect(documentFileError({ type: 'application/pdf', size: 10 })).toMatch(/JPEG/);
    expect(documentFileError({ type: 'image/svg+xml', size: 10 })).toMatch(/JPEG/);
    expect(documentFileError({ type: 'image/png', size: 0 })).toMatch(/rỗng/);
    expect(documentFileError({ type: 'image/png', size: MAX_DOCUMENT_BYTES + 1 })).toMatch(/5 MiB/);
  });
  it('lists missing required kinds', () => {
    expect(missingDocuments(required, [doc('identity_front')])).toEqual([
      'identity_back',
      'driver_license',
      'vehicle_registration',
    ]);
    expect(missingDocuments(required, required.map(doc))).toEqual([]);
  });
});

describe('Driver web vehicle profile', () => {
  it('normalizes and validates plates like the server bounds', () => {
    expect(normalizePlate('  29a   123.45 ')).toBe('29A 123.45');
    expect(vehicleErrors({ vehiclePlate: '29A', vehicleType: 'motorcycle' })).toHaveLength(1);
    expect(vehicleErrors({ vehiclePlate: '29A-123.45', vehicleType: 'truck' })).toHaveLength(1);
    expect(vehicleErrors({ vehiclePlate: '29A-123.45', vehicleType: 'car' })).toEqual([]);
  });
});

describe('Driver web onboarding checklist', () => {
  it('requires a vehicle profile before documents', () => {
    const steps = onboardingSteps(null, null);
    expect(steps.map((step) => step.done)).toEqual([false, false, false]);
    expect(steps[1].detail).toMatch(/phương tiện/);
  });
  it('counts missing documents and reflects review status', () => {
    const partial = onboardingSteps(profile, {
      requiredKinds: [...required],
      items: [doc('identity_front')],
    });
    expect(partial[1]).toMatchObject({ done: false, detail: 'Còn thiếu 3' });
    const full = onboardingSteps(
      { ...profile, status: 'approved' },
      { requiredKinds: [...required], items: required.map(doc) },
    );
    expect(full.every((step) => step.done)).toBe(true);
  });
});

describe('Driver web GPS freshness (WEB-002 hypotheses)', () => {
  const base = { supported: true, permissionDenied: false, startedAt: 0 };
  it('separates unsupported, denied and waiting states', () => {
    expect(classifyFix({ ...base, supported: false, lastFixAt: null, now: 0 })).toBe('unsupported');
    expect(classifyFix({ ...base, permissionDenied: true, lastFixAt: 1, now: 2 })).toBe('denied');
    expect(classifyFix({ ...base, startedAt: null, lastFixAt: null, now: 5 })).toBe('waiting');
    expect(classifyFix({ ...base, lastFixAt: null, now: 10_000 })).toBe('waiting');
  });
  it('marks fixes stale at 30s and unavailable at 60s', () => {
    expect(classifyFix({ ...base, lastFixAt: 0, now: 29_999 })).toBe('fresh');
    expect(classifyFix({ ...base, lastFixAt: 0, now: 30_000 })).toBe('stale');
    expect(classifyFix({ ...base, lastFixAt: 0, now: 60_000 })).toBe('unavailable');
    expect(classifyFix({ ...base, lastFixAt: null, now: 60_000 })).toBe('unavailable');
  });
  it('formats ages for humans', () => {
    expect(formatAge(4_400)).toBe('4 giây trước');
    expect(formatAge(75_000)).toBe('1 phút 15 giây trước');
  });
});
