import { describe, expect, it } from 'vitest';
import { parseAreaGeoJson } from './service-area';

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [105.8, 21],
      [105.9, 21],
      [105.9, 21.06],
      [105.8, 21],
    ],
  ],
};

describe('parseAreaGeoJson', () => {
  it('accepts a geometry, a Feature or a single-feature FeatureCollection', () => {
    expect(parseAreaGeoJson(JSON.stringify(polygon))).toEqual({ geometry: polygon });
    expect(parseAreaGeoJson(JSON.stringify({ type: 'Feature', geometry: polygon }))).toEqual({
      geometry: polygon,
    });
    expect(
      parseAreaGeoJson(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: polygon }],
        }),
      ),
    ).toEqual({ geometry: polygon });
  });

  it('explains what is wrong', () => {
    expect(parseAreaGeoJson('{')).toEqual({ error: 'Không đọc được JSON.' });
    expect(parseAreaGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [] }))).toEqual({
      error: 'FeatureCollection phải có đúng một vùng.',
    });
    expect(
      parseAreaGeoJson(JSON.stringify({ type: 'Point', coordinates: [105.8, 21] })),
    ).toHaveProperty('error');
  });
});
