import {
  BadGatewayException,
  Controller,
  Get,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Cache } from './database';
import { loadConfig } from './config';
import { AccessGuard, AuthRequest } from './security';
import { parse } from './validation';

// Discovery rectangle for Hanoi testing, not an administrative or delivery geofence.
export const HANOI_REGION = {
  id: 'hanoi-pilot',
  name: 'Hà Nội',
  bounds: { west: 105.3, south: 20.55, east: 106.05, north: 21.4 },
  center: { longitude: 105.8342, latitude: 21.0278 },
} as const;
type Coordinate = { longitude: number; latitude: number };
export function insideHanoi(point: Coordinate) {
  const { west, south, east, north } = HANOI_REGION.bounds;
  return (
    point.longitude >= west &&
    point.longitude <= east &&
    point.latitude >= south &&
    point.latitude <= north
  );
}
const coordinateSchema = z
  .object({
    longitude: z.coerce.number().finite().min(-180).max(180),
    latitude: z.coerce.number().finite().min(-90).max(90),
  })
  .strict()
  .refine(insideHanoi, 'Point is outside the Hanoi pilot discovery rectangle');
const placeSchema = z.object({
  place_id: z.union([z.string(), z.number()]),
  display_name: z.string().min(1).max(2000),
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
});
const geometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z
    .array(z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]))
    .min(2)
    .max(20000),
});
const routeSchema = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        distance: z.number().finite().nonnegative(),
        duration: z.number().finite().nonnegative(),
        geometry: geometrySchema,
      }),
    )
    .min(1)
    .max(3),
});
function place(result: z.infer<typeof placeSchema>) {
  return {
    id: String(result.place_id),
    label: result.display_name,
    position: { longitude: result.lon, latitude: result.lat },
  };
}
const ADMIT_GEOCODER = `
if redis.call('EXISTS',KEYS[1])==1 or redis.call('EXISTS',KEYS[2])==1 then return 0 end
redis.call('SET',KEYS[1],ARGV[1],'PX',8000)
redis.call('SET',KEYS[2],'1','PX',1200)
return 1`;
const RELEASE = `if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0`;
const INCREMENT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`;

@Injectable()
export class MapsService {
  constructor(@Inject(Cache) private readonly cache: Cache) {}
  settings() {
    const config = loadConfig();
    return {
      region: HANOI_REGION,
      geocodingConfigured: Boolean(config.NOMINATIM_BASE_URL),
      routingConfigured: Boolean(config.OSRM_BASE_URL),
      searchMode: 'submit-only' as const,
      attribution: '© OpenStreetMap contributors',
      attributionUrl: 'https://www.openstreetmap.org/copyright',
      routingProfile: 'driving-unverified-for-motorcycles' as const,
    };
  }
  async userLimit(id: string) {
    const result = Number(await this.cache.redis.eval(INCREMENT, 1, `maps:user:${id}`, ''));
    if (result > 30) throw new HttpException('Map request limit reached. Try again later.', 429);
  }
  private cacheKey(url: URL) {
    return `maps:cache:v1:${createHash('sha256').update(url.href).digest('hex')}`;
  }
  private async fetchJson(url: URL): Promise<unknown> {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': loadConfig().NOMINATIM_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (response.status === 429)
        throw new HttpException('Map provider is busy. Try again later.', 429);
      if (!response.ok) throw new BadGatewayException('Map provider request failed');
      // Bound memory before JSON parsing; an oversized provider response is rejected.
      const reader = response.body?.getReader();
      if (!reader) throw new BadGatewayException('Map provider returned no data');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024 * 1024) {
            await reader.cancel();
            throw new BadGatewayException('Map provider response too large');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException('Map provider unavailable or returned invalid data');
    }
  }
  private async cached<T>(url: URL, schema: z.ZodType<T>, geocoding: boolean): Promise<T> {
    const key = this.cacheKey(url);
    const existing = await this.cache.redis.get(key);
    if (existing) {
      try {
        return schema.parse(JSON.parse(existing));
      } catch {
        await this.cache.redis.del(key);
      }
    }
    const provider = createHash('sha256').update(url.origin).digest('hex');
    const lock = `maps:geocoder:lock:${provider}`;
    const cooldown = `maps:geocoder:cooldown:${provider}`;
    const token = randomUUID();
    if (
      geocoding &&
      Number(await this.cache.redis.eval(ADMIT_GEOCODER, 2, lock, cooldown, token)) !== 1
    ) {
      throw new HttpException('Address search is busy. Wait a moment and submit again.', 429);
    }
    try {
      const parsed = schema.safeParse(await this.fetchJson(url));
      if (!parsed.success)
        throw new BadGatewayException('Map provider returned an unsupported response');
      await this.cache.redis.set(key, JSON.stringify(parsed.data), 'EX', geocoding ? 3600 : 60);
      return parsed.data;
    } finally {
      if (geocoding) await this.cache.redis.eval(RELEASE, 1, lock, token);
    }
  }
  async search(query: string) {
    const config = loadConfig();
    if (!config.NOMINATIM_BASE_URL)
      throw new ServiceUnavailableException('Geocoding is not configured');
    const url = new URL(`${config.NOMINATIM_BASE_URL.replace(/\/$/, '')}/search`);
    const { west, south, east, north } = HANOI_REGION.bounds;
    url.search = new URLSearchParams({
      q: query.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi'),
      format: 'jsonv2',
      limit: '5',
      countrycodes: 'vn',
      viewbox: `${west},${north},${east},${south}`,
      bounded: '1',
      'accept-language': 'vi',
      addressdetails: '0',
    }).toString();
    const results = await this.cached(url, z.array(placeSchema).max(5), true);
    return {
      items: results.map(place).filter((item) => insideHanoi(item.position)),
      provider: 'nominatim' as const,
    };
  }
  async reverse(position: Coordinate) {
    const config = loadConfig();
    if (!config.NOMINATIM_BASE_URL)
      throw new ServiceUnavailableException('Geocoding is not configured');
    const url = new URL(`${config.NOMINATIM_BASE_URL.replace(/\/$/, '')}/reverse`);
    url.search = new URLSearchParams({
      lon: position.longitude.toFixed(6),
      lat: position.latitude.toFixed(6),
      format: 'jsonv2',
      'accept-language': 'vi',
      zoom: '18',
      addressdetails: '0',
    }).toString();
    const schema = z.union([placeSchema, z.object({ error: z.string() })]);
    const result = await this.cached(url, schema, true);
    if ('error' in result) throw new NotFoundException('No address found for this position');
    const item = place(result);
    if (!insideHanoi(item.position))
      throw new NotFoundException('No Hanoi address found for this position');
    return { item, requestedPosition: position, provider: 'nominatim' as const };
  }
  async route(pickup: Coordinate, dropoff: Coordinate) {
    const config = loadConfig();
    if (!config.OSRM_BASE_URL)
      throw new ServiceUnavailableException(
        'Routing is not configured. Configure your own OSRM endpoint.',
      );
    const points = `${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}`;
    const url = new URL(`${config.OSRM_BASE_URL.replace(/\/$/, '')}/route/v1/driving/${points}`);
    url.search = 'overview=full&geometries=geojson&steps=false&alternatives=false&radiuses=100;100';
    const schema = z.union([routeSchema, z.object({ code: z.enum(['NoRoute', 'NoSegment']) })]);
    const result = await this.cached(url, schema, false);
    if (result.code !== 'Ok')
      throw new NotFoundException('No drivable route found for these points');
    const route = result.routes[0]!;
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      provider: 'osrm' as const,
      profile: 'driving' as const,
      motorcycleValidated: false as const,
    };
  }
}

@Controller('maps')
@UseGuards(AccessGuard)
export class MapsController {
  constructor(@Inject(MapsService) private readonly maps: MapsService) {}
  @Get('config') config() {
    return this.maps.settings();
  }
  @Get('search') async search(@Query() query: unknown, @Req() request: AuthRequest) {
    const input = parse(z.object({ q: z.string().trim().min(3).max(160) }).strict(), query);
    await this.maps.userLimit(request.account.id);
    return this.maps.search(input.q);
  }
  @Get('reverse') async reverse(@Query() query: unknown, @Req() request: AuthRequest) {
    const position = parse(coordinateSchema, query);
    await this.maps.userLimit(request.account.id);
    return this.maps.reverse(position);
  }
  @Get('route') async route(@Query() query: unknown, @Req() request: AuthRequest) {
    const input = parse(
      z
        .object({
          pickupLng: z.coerce.number().finite(),
          pickupLat: z.coerce.number().finite(),
          dropoffLng: z.coerce.number().finite(),
          dropoffLat: z.coerce.number().finite(),
        })
        .strict(),
      query,
    );
    const pickup = parse(coordinateSchema, {
      longitude: input.pickupLng,
      latitude: input.pickupLat,
    });
    const dropoff = parse(coordinateSchema, {
      longitude: input.dropoffLng,
      latitude: input.dropoffLat,
    });
    await this.maps.userLimit(request.account.id);
    return this.maps.route(pickup, dropoff);
  }
}
