import { z } from 'zod';
import { HANOI_REGION } from './maps';

export const MAX_SERVICE_AREA_VERTICES = 2000;

const position = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
const ring = z
  .array(position)
  .min(4)
  .refine(
    (points) => {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      return first[0] === last[0] && first[1] === last[1];
    },
    { message: 'Each ring must be closed (first point equals last point)' },
  );
const polygon = z.array(ring).min(1).max(50);

export const areaGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygon }).strict(),
  z
    .object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1).max(50) })
    .strict(),
]);
export type AreaGeometry = z.infer<typeof areaGeometrySchema>;

export function vertexCount(geometry: AreaGeometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((sum, rings) => sum + rings.reduce((n, r) => n + r.length, 0), 0);
}

/** The discovery rectangle bounds search and map panning, so an area outside it is unreachable. */
export function insideDiscovery(geometry: AreaGeometry) {
  const { west, south, east, north } = HANOI_REGION.bounds;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.every((rings) =>
    rings.every((r) =>
      r.every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north),
    ),
  );
}

export const updateServiceAreaSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[^\p{Cc}]*$/u),
    active: z.boolean(),
    geometry: areaGeometrySchema,
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine((input) => vertexCount(input.geometry) <= MAX_SERVICE_AREA_VERTICES, {
    message: `At most ${MAX_SERVICE_AREA_VERTICES} vertices`,
    path: ['geometry'],
  })
  .refine((input) => insideDiscovery(input.geometry), {
    message: 'Area must lie inside the Hanoi discovery rectangle',
    path: ['geometry'],
  });
