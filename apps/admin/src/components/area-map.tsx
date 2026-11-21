import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AreaGeometry } from '@shango/contracts';

/** Read-only preview: the saved area in green, an unsaved draft dashed on top. */
export function AreaMap({
  saved,
  draft,
}: {
  saved: AreaGeometry | null;
  draft: AreaGeometry | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const tiles = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const attribution = import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined;
  const tilesReady = Boolean(tiles && attribution);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { center: [21.0278, 105.8342], zoom: 10 });
    map.current = instance;
    if (tilesReady) L.tileLayer(tiles!, { attribution, maxZoom: 19 }).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
      layers.current = null;
    };
  }, [tiles, attribution, tilesReady]);
  useEffect(() => {
    if (!map.current || !layers.current) return;
    layers.current.clearLayers();
    let bounds: L.LatLngBounds | null = null;
    for (const [geometry, style] of [
      [saved, { color: '#116c4d', weight: 2, fillOpacity: 0.15 }],
      [draft, { color: '#315bbc', weight: 3, dashArray: '6 6', fillOpacity: 0.05 }],
    ] as const) {
      if (!geometry) continue;
      const layer = L.geoJSON(geometry, { style }).addTo(layers.current);
      bounds = bounds ? bounds.extend(layer.getBounds()) : layer.getBounds();
    }
    if (bounds?.isValid()) map.current.fitBounds(bounds, { padding: [20, 20] });
  }, [saved, draft]);
  return (
    <div className="relative isolate overflow-hidden rounded-xl border border-border">
      <div
        ref={container}
        className="h-72 w-full bg-muted sm:h-96"
        role="img"
        aria-label="Xem trước vùng phục vụ: nền xanh lá là vùng đang lưu, viền xanh dương nét đứt là bản nháp."
      />
      {!tilesReady && (
        <div className="pointer-events-none absolute top-3 right-3 left-3 z-[500] rounded-lg bg-card/95 p-2 text-xs shadow-sm">
          Chưa cấu hình nền bản đồ; vẫn xem được hình dạng vùng.
        </div>
      )}
    </div>
  );
}
