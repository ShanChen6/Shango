import type { AreaGeometry } from '@shango/contracts';

/**
 * Accepts a GeoJSON Polygon/MultiPolygon, or a Feature/FeatureCollection holding exactly one,
 * as exported by common map editors. The server re-validates everything (rings, bounds, vertices,
 * self-intersection).
 */
export function parseAreaGeoJson(text: string): { geometry: AreaGeometry } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'Không đọc được JSON.' };
  }
  const node = value as { type?: string; geometry?: unknown; features?: unknown[] } | null;
  if (node?.type === 'FeatureCollection') {
    if (!Array.isArray(node.features) || node.features.length !== 1)
      return { error: 'FeatureCollection phải có đúng một vùng.' };
    return parseAreaGeoJson(JSON.stringify(node.features[0]));
  }
  if (node?.type === 'Feature') return parseAreaGeoJson(JSON.stringify(node.geometry ?? null));
  const geometry = node as { type?: string; coordinates?: unknown };
  if (
    (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') &&
    Array.isArray(geometry.coordinates)
  )
    return { geometry: { type: geometry.type, coordinates: geometry.coordinates } as AreaGeometry };
  return { error: 'Chỉ nhận GeoJSON Polygon hoặc MultiPolygon (tọa độ [kinh độ, vĩ độ]).' };
}
