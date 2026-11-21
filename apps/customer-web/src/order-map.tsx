import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, MapConfig } from '@shango/contracts';

type Props = {
  config: MapConfig;
  pickup: Coordinate;
  dropoff: Coordinate;
  driver: (Coordinate & { accuracy: number | null }) | null;
};

const toLatLng = (point: Coordinate): L.LatLngTuple => [point.latitude, point.longitude];

/**
 * Read-only order map: pickup, dropoff and the driver's last known position. The map is built
 * once per order; live positions only move the driver marker (no re-render of tiles).
 */
export function OrderMap({ config, pickup, dropoff, driver }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverMarker = useRef<L.CircleMarker | null>(null);
  const accuracyCircle = useRef<L.Circle | null>(null);
  // Bumped whenever the map is rebuilt so the driver marker is re-added to the new map.
  const [mapVersion, setMapVersion] = useState(0);
  const tiles = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const attribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined;

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { zoomControl: true, attributionControl: true });
    map.attributionControl.addAttribution(
      `<a href="${config.attributionUrl}" target="_blank" rel="noreferrer">${config.attribution}</a>`,
    );
    if (tiles && attribution) L.tileLayer(tiles, { attribution }).addTo(map);
    L.circleMarker(toLatLng(pickup), { radius: 9, color: '#176b4a', fillOpacity: 0.9 })
      .bindTooltip('Điểm lấy')
      .addTo(map);
    L.circleMarker(toLatLng(dropoff), { radius: 9, color: '#245cff', fillOpacity: 0.9 })
      .bindTooltip('Điểm giao')
      .addTo(map);
    map.fitBounds(L.latLngBounds([toLatLng(pickup), toLatLng(dropoff)]), {
      padding: [32, 32],
      maxZoom: 16,
    });
    mapRef.current = map;
    setMapVersion((value) => value + 1);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      driverMarker.current = null;
      accuracyCircle.current = null;
    };
  }, [
    config,
    pickup.latitude,
    pickup.longitude,
    dropoff.latitude,
    dropoff.longitude,
    tiles,
    attribution,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!driver) {
      driverMarker.current?.remove();
      accuracyCircle.current?.remove();
      driverMarker.current = null;
      accuracyCircle.current = null;
      return;
    }
    const at = toLatLng(driver);
    if (!driverMarker.current)
      driverMarker.current = L.circleMarker(at, { radius: 8, color: '#b45309', fillOpacity: 1 })
        .bindTooltip('Tài xế')
        .addTo(map);
    else driverMarker.current.setLatLng(at);
    if (driver.accuracy !== null) {
      if (!accuracyCircle.current)
        accuracyCircle.current = L.circle(at, {
          radius: driver.accuracy,
          color: '#b45309',
          weight: 1,
          fillOpacity: 0.1,
        }).addTo(map);
      else accuracyCircle.current.setLatLng(at).setRadius(driver.accuracy);
    }
    // Only the live position matters here; the map itself is rebuilt by the effect above.
  }, [mapVersion, driver?.latitude, driver?.longitude, driver?.accuracy, driver === null]);

  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map-canvas order-map"
        role="img"
        aria-label="Bản đồ đơn hàng: điểm lấy màu xanh lá, điểm giao màu xanh dương, tài xế màu cam. Thông tin dạng chữ nằm bên cạnh."
      />
      {!(tiles && attribution) && (
        <p className="map-fallback">
          Chưa cấu hình nền bản đồ; chỉ hiển thị vị trí tương đối của các điểm.
        </p>
      )}
    </div>
  );
}
