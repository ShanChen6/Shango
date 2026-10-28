import { describe, expect, it } from 'vitest';
import { displayNameSchema } from '../src/profiles';
import { auditMetadata, auditQuerySchema } from '../src/audit';

describe('profile validation', () => {
  it('normalizes Vietnamese names and repeated spacing', () => {
    expect(displayNameSchema.parse('  Nguyễn   Văn An  ')).toBe('Nguyễn Văn An');
    expect(displayNameSchema.parse('Nguyễn An')).toBe('Nguyễn An');
  });
  it('rejects blank, oversized and control-character names', () => {
    for (const value of ['', ' ', 'A', 'a'.repeat(81), 'An\nNguyễn', 'An\u0000Nguyễn'])
      expect(displayNameSchema.safeParse(value).success).toBe(false);
  });
});
describe('audit boundaries', () => {
  it('validates bigint cursors without numeric precision loss or throwing', () => {
    expect(auditQuerySchema.safeParse({ cursor: '9223372036854775807' }).success).toBe(true);
    for (const cursor of ['9223372036854775808', '-1', '0', '1.5', 'abc'])
      expect(auditQuerySchema.safeParse({ cursor }).success).toBe(false);
  });
  it('rejects inverted date ranges and unknown query parameters', () => {
    expect(
      auditQuerySchema.safeParse({
        from: '2026-10-29T00:00:00+07:00',
        to: '2026-10-28T00:00:00+07:00',
      }).success,
    ).toBe(false);
    expect(auditQuerySchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
  it('only returns known metadata fields for supported actions', () => {
    expect(
      auditMetadata('user.profile.updated', {
        fields: ['displayName'],
        version: 1,
        token: 'secret',
      }),
    ).toEqual({ fields: ['displayName'], version: 1 });
    expect(auditMetadata('future.event', { token: 'secret' })).toEqual({});
    expect(auditMetadata('__proto__', { token: 'secret' })).toEqual({});
    expect(auditMetadata('driver.review', { invalid: true })).toEqual({});
  });
});
