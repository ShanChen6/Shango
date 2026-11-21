import { describe, expect, it } from 'vitest';
import {
  insideDiscovery,
  MAX_SERVICE_AREA_VERTICES,
  updateServiceAreaSchema,
  vertexCount,
} from '../src/service-area-policy';

const square = (west: number, south: number, size: number) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const valid = {
  name: 'Nội thành',
  active: true,
  geometry: { type: 'Polygon', coordinates: [square(105.8, 21.0, 0.05)] },
  expectedVersion: 1,
};

describe('service area policy (SG-015)', () => {
  it('accepts a closed polygon inside the discovery rectangle', () => {
    expect(updateServiceAreaSchema.safeParse(valid).success).toBe(true);
    expect(
      updateServiceAreaSchema.safeParse({
        ...valid,
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[square(105.8, 21.0, 0.05)], [square(105.9, 21.1, 0.02)]],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects open rings, foreign keys, other geometry types and areas outside Hanoi', () => {
    const open = { type: 'Polygon', coordinates: [square(105.8, 21.0, 0.05).slice(0, 4)] };
    expect(updateServiceAreaSchema.safeParse({ ...valid, geometry: open }).success).toBe(false);
    expect(updateServiceAreaSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      updateServiceAreaSchema.safeParse({
        ...valid,
        geometry: { type: 'LineString', coordinates: square(105.8, 21.0, 0.05) },
      }).success,
    ).toBe(false);
    const saigon = { type: 'Polygon' as const, coordinates: [square(106.6, 10.7, 0.1)] };
    expect(insideDiscovery(saigon)).toBe(false);
    expect(updateServiceAreaSchema.safeParse({ ...valid, geometry: saigon }).success).toBe(false);
  });

  it('counts vertices and caps them', () => {
    expect(vertexCount(valid.geometry as never)).toBe(5);
    const ring: number[][] = [];
    for (let i = 0; i < MAX_SERVICE_AREA_VERTICES; i += 1) {
      const angle = (2 * Math.PI * i) / MAX_SERVICE_AREA_VERTICES;
      ring.push([105.85 + 0.05 * Math.cos(angle), 21.03 + 0.05 * Math.sin(angle)]);
    }
    ring.push(ring[0]!);
    expect(
      updateServiceAreaSchema.safeParse({
        ...valid,
        geometry: { type: 'Polygon', coordinates: [ring] },
      }).success,
    ).toBe(false);
  });
});
