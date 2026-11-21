import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ActiveServiceArea, Coordinate, MapConfig } from '@shango/contracts';

export function AddressMap({ config, position, onPick, areas = null }: { config: MapConfig; position: Coordinate | null; onPick: (point: Coordinate) => void; areas?: ActiveServiceArea[] | null }) {
  const container = useRef<HTMLDivElement>(null); const callback = useRef(onPick); callback.current = onPick;
  const tiles = import.meta.env.VITE_MAP_TILE_URL as string | undefined; const attribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined;
  useEffect(() => {
    if (!container.current) return;
    const b = config.region.bounds; const c = config.region.center;
    const map = L.map(container.current, { center: [c.latitude, c.longitude], zoom: 12, maxBounds: [[b.south, b.west], [b.north, b.east]], maxBoundsViscosity: 1 });
    map.attributionControl.addAttribution(`<a href="${config.attributionUrl}" target="_blank" rel="noreferrer">${config.attribution}</a>`);
    if (tiles && attribution) L.tileLayer(tiles, { attribution }).addTo(map);
    for (const area of areas ?? []) L.geoJSON(area.geometry, { interactive: false, style: { color: '#176b4a', weight: 2, fillOpacity: .08, dashArray: '4 4' } }).addTo(map);
    const marker = L.circleMarker([c.latitude, c.longitude], { radius: 9, color: '#176b4a', fillOpacity: .85 });
    if (position) marker.setLatLng([position.latitude, position.longitude]).addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => { const point = { longitude: Number(event.latlng.lng.toFixed(6)), latitude: Number(event.latlng.lat.toFixed(6)) }; marker.setLatLng(event.latlng).addTo(map); callback.current(point); });
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); };
  }, [config, areas, position?.latitude, position?.longitude, tiles, attribution]);
  return <div className="map-wrap"><div ref={container} className="map-canvas" role="img" aria-label={areas?.length ? "Bản đồ Hà Nội, vùng viền xanh nét đứt là nơi ShanGo đang nhận đơn. Người dùng bàn phím có thể nhập tọa độ ở biểu mẫu bên dưới." : "Bản đồ Hà Nội. Người dùng bàn phím có thể nhập tọa độ ở biểu mẫu bên dưới."}/>{!(tiles && attribution) && <p className="map-fallback">Chưa cấu hình nền bản đồ. Vẫn có thể tìm địa chỉ hoặc nhập tọa độ thủ công.</p>}</div>;
}
