import { useEffect, useMemo, useRef } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import {
  Map,
  Camera,
  ViewAnnotation,
  type CameraRef,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import type { Coordinate, MapConfig } from '@shango/contracts';
export default function AddressMap({
  config,
  position,
  onPick,
  onError,
}: {
  config: MapConfig;
  position: Coordinate | null;
  onPick: (point: Coordinate) => void;
  onError: () => void;
}) {
  const camera = useRef<CameraRef>(null);
  const tiles = process.env.EXPO_PUBLIC_MAP_TILE_URL;
  const attribution = process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION;
  const mapStyle = useMemo<StyleSpecification>(() => {
    const sources: StyleSpecification['sources'] = {};
    if (tiles && attribution)
      sources.base = { type: 'raster', tiles: [tiles], tileSize: 256, attribution };
    return {
      version: 8,
      sources,
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#e8eee8' } },
        ...(tiles && attribution
          ? [{ id: 'raster', type: 'raster' as const, source: 'base' }]
          : []),
      ],
    };
  }, [tiles, attribution]);
  useEffect(() => {
    if (position)
      camera.current?.jumpTo({ center: [position.longitude, position.latitude], zoom: 15 });
  }, [position]);
  const { center } = config.region;
  return (
    <View style={styles.wrapper}>
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        onPress={(event) =>
          onPick({ longitude: event.nativeEvent.lngLat[0], latitude: event.nativeEvent.lngLat[1] })
        }
        onDidFailLoadingMap={onError}
        attribution
      >
        <Camera
          ref={camera}
          initialViewState={{ center: [center.longitude, center.latitude], zoom: 12 }}
        />
        {position && (
          <ViewAnnotation
            id="selected-address"
            lngLat={[position.longitude, position.latitude]}
            draggable
            onDragEnd={(event) =>
              onPick({
                longitude: event.nativeEvent.lngLat[0],
                latitude: event.nativeEvent.lngLat[1],
              })
            }
          >
            <View style={styles.pin}>
              <Text style={styles.pinText}>●</Text>
            </View>
          </ViewAnnotation>
        )}
      </Map>
      {!(tiles && attribution) && (
        <Text style={styles.hint}>Chưa cấu hình nền tile. Có thể dùng tọa độ để chọn pin.</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { gap: 8 },
  map: { height: 260, borderRadius: 12, overflow: 'hidden' },
  pin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#116c4d',
  },
  pinText: { color: '#116c4d', fontSize: 20 },
  hint: { fontSize: 12, lineHeight: 19, color: '#647c6d' },
});
