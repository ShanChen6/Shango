import { describe, expect, it } from 'vitest';
import type { ActiveServiceArea } from '@shango/contracts';
import { insideGeometry, servedBy } from './service-area';

const square = (west: number, south: number, size: number) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const area: ActiveServiceArea = {
  id: 'a',
  name: 'Nội thành',
  version: 2,
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [square(105.8, 21.0, 0.1), square(105.84, 21.02, 0.01)],
      [square(105.95, 21.1, 0.02)],
    ],
  },
};

describe('service area hint', () => {
  it('handles outer rings, holes and multiple polygons', () => {
    expect(insideGeometry({ longitude: 105.81, latitude: 21.01 }, area.geometry)).toBe(true);
    expect(insideGeometry({ longitude: 105.845, latitude: 21.025 }, area.geometry)).toBe(false);
    expect(insideGeometry({ longitude: 105.96, latitude: 21.11 }, area.geometry)).toBe(true);
    expect(insideGeometry({ longitude: 105.5, latitude: 21.2 }, area.geometry)).toBe(false);
  });

  it('counts the boundary as inside like ST_Covers', () => {
    expect(insideGeometry({ longitude: 105.8, latitude: 21.05 }, area.geometry)).toBe(true);
    expect(insideGeometry({ longitude: 105.9, latitude: 21.1 }, area.geometry)).toBe(true);
  });

  it('never blocks while areas are unknown', () => {
    expect(servedBy({ longitude: 105.5, latitude: 21.2 }, null)).toBe(true);
    expect(servedBy({ longitude: 105.5, latitude: 21.2 }, [])).toBe(false);
    expect(servedBy({ longitude: 105.81, latitude: 21.01 }, [area])).toBe(true);
  });
});
