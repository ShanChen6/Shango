import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, MapConfig, MapRoute } from '@shango/contracts';

type Props = {
  config: MapConfig;
  pickup?: Coordinate;
  dropoff?: Coordinate;
  route: MapRoute | null;
  onPick: (point: Coordinate) => void;
};
export function MapCanvas({ config, pickup, dropoff, route, onPick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const points = useRef<L.LayerGroup | null>(null);
  const callback = useRef(onPick);
  callback.current = onPick;
  const tiles = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const attribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined;
  // Attribution must be supplied alongside the configured tile source.
  const tilesReady = Boolean(tiles && attribution);
  useEffect(() => {
    if (!container.current) return;
    const { bounds, center } = config.region;
    const instance = L.map(container.current, {
      center: [center.latitude, center.longitude],
      zoom: 12,
      minZoom: 9,
      maxZoom: 19,
      maxBounds: [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      maxBoundsViscosity: 1,
    });
    map.current = instance;
    instance.attributionControl.addAttribution(
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>',
    );
    if (tilesReady)
      L.tileLayer(tiles!, { attribution, maxZoom: 19, updateWhenIdle: true, keepBuffer: 1 }).addTo(
        instance,
      );
    points.current = L.layerGroup().addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) =>
      callback.current({
        longitude: Number(event.latlng.lng.toFixed(6)),
        latitude: Number(event.latlng.lat.toFixed(6)),
      }),
    );
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
      points.current = null;
    };
  }, [config, tiles, attribution, tilesReady]);
  useEffect(() => {
    if (!map.current || !points.current) return;
    const layer = points.current;
    layer.clearLayers();
    const locations: L.LatLngTuple[] = [];
    for (const [point, label, color] of [
      [pickup, 'Điểm lấy', '#116c4d'],
      [dropoff, 'Điểm giao', '#315bbc'],
    ] as const) {
      if (!point) continue;
      const position: L.LatLngTuple = [point.latitude, point.longitude];
      locations.push(position);
      L.circleMarker(position, { radius: 9, color, fillColor: color, fillOpacity: 0.85, weight: 3 })
        .bindTooltip(label)
        .addTo(layer);
    }
    if (route) {
      const line = L.polyline(
        route.geometry.coordinates.map(
          ([longitude, latitude]) => [latitude, longitude] as L.LatLngTuple,
        ),
        { color: '#116c4d', weight: 5 },
      ).addTo(layer);
      map.current.fitBounds(line.getBounds(), { padding: [35, 35], maxZoom: 16 });
    } else if (locations.length === 2)
      map.current.fitBounds(L.latLngBounds(locations), { padding: [45, 45], maxZoom: 16 });
    else if (locations[0]) map.current.setView(locations[0], 15);
  }, [pickup, dropoff, route, config]);
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-border">
      <div
        ref={container}
        className="h-80 w-full bg-muted sm:h-[28rem]"
        aria-label="Bản đồ thử nghiệm Hà Nội. Dùng ô tọa độ để chọn điểm bằng bàn phím."
      />
      {!tilesReady && (
        <div className="pointer-events-none absolute top-3 right-3 left-12 z-[500] rounded-lg bg-card/95 p-3 text-xs text-foreground shadow-sm">
          Chưa cấu hình nền bản đồ. Vẫn có thể nhập tọa độ để kiểm tra điểm và tuyến; không có tuyến
          giả được vẽ.
        </div>
      )}
    </div>
  );
}
