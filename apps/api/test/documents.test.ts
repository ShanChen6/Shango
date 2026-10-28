import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Subject } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { normalizeDocument, UploadCapacityInterceptor } from '../src/documents';
import { validRequiredKinds } from '../src/document-policy';

describe('private document images', () => {
  it('decodes and re-encodes images without retaining source metadata', async () => {
    const buffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const normalized = await normalizeDocument({
      buffer,
      size: buffer.length,
      mimetype: 'image/jpeg',
    });
    const metadata = await sharp(normalized).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  it('rejects MIME mismatches, disguised active content and corrupt images', async () => {
    for (const buffer of [
      Buffer.from('<svg><script/></svg>'),
      Buffer.from([255, 216, 255, 1, 2, 3]),
    ])
      await expect(
        normalizeDocument({ buffer, size: buffer.length, mimetype: 'image/jpeg' }),
      ).rejects.toThrow();
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    await expect(
      normalizeDocument({ buffer: png, size: png.length, mimetype: 'image/jpeg' }),
    ).rejects.toThrow();
  });
  it('requires a unique nonempty supported document policy', () => {
    expect(
      validRequiredKinds('identity_front,identity_back,driver_license,vehicle_registration'),
    ).toBe(true);
    for (const value of ['', 'unknown', 'driver_license,driver_license'])
      expect(validRequiredKinds(value)).toBe(false);
  });
  it('bounds concurrent upload memory and frees capacity on cancellation', () => {
    const gate = new UploadCapacityInterceptor();
    const stream = new Subject();
    const next: CallHandler = { handle: () => stream.asObservable() };
    const context = {} as ExecutionContext;
    const first = gate.intercept(context, next).subscribe();
    const second = gate.intercept(context, next).subscribe();
    expect(() => gate.intercept(context, next)).toThrow();
    first.unsubscribe();
    const third = gate.intercept(context, next).subscribe();
    second.unsubscribe();
    third.unsubscribe();
    expect(() =>
      gate.intercept(context, {
        handle: () => {
          throw new Error('sync failure');
        },
      }),
    ).toThrow('sync failure');
    const recovered = gate.intercept(context, next).subscribe();
    recovered.unsubscribe();
  });
});
