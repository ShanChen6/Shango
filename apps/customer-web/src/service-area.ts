import type { ActiveServiceArea, AreaGeometry, Coordinate } from '@shango/contracts';

const EPS = 1e-9;

/** Ray casting on planar lng/lat; points on an edge count as inside (like PostGIS ST_Covers). */
function inRing(point: Coordinate, ring: number[][]) {
  const { longitude: x, latitude: y } = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const cross = (xj! - xi!) * (y - yi!) - (yj! - yi!) * (x - xi!);
    const onSegment =
      Math.abs(cross) < EPS &&
      x >= Math.min(xi!, xj!) - EPS &&
      x <= Math.max(xi!, xj!) + EPS &&
      y >= Math.min(yi!, yj!) - EPS &&
      y <= Math.max(yi!, yj!) + EPS;
    if (onSegment) return 'edge' as const;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

function inPolygon(point: Coordinate, rings: number[][][]) {
  const [outer, ...holes] = rings;
  const outside = outer ? inRing(point, outer) : false;
  if (!outside) return false;
  if (outside === 'edge') return true;
  return holes.every((hole) => inRing(point, hole) !== true);
}

export function insideGeometry(point: Coordinate, geometry: AreaGeometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => inPolygon(point, rings));
}

/**
 * Hint only: `null` areas (not loaded) never block, because the server re-checks every quote and
 * order against the authoritative PostGIS shapes.
 */
export function servedBy(point: Coordinate, areas: ActiveServiceArea[] | null) {
  if (!areas) return true;
  return areas.some((area) => insideGeometry(point, area.geometry));
}
