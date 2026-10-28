import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { createApi } from '@shango/api-client';
import { createDeliveryDraft, draftReady, type DeliveryStop } from './delivery-draft';
const AddressMap = lazy(() => import('./address-map'));
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Text style={styles.hint}>
        Bản đồ cần bản build native có MapLibre. Vẫn có thể tìm địa chỉ hoặc nhập tọa độ bên dưới.
      </Text>
    ) : (
      this.props.children
    );
  }
}
export function CustomerAddressPlanner({ api }: { api: ReturnType<typeof createApi> }) {
  const draft = useMemo(() => createDeliveryDraft(api), [api]);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [summary, setSummary] = useState(false);
  const [mapError, setMapError] = useState(false);
  const stop = state.stops[state.active];
  const ready = draftReady(state);
  useEffect(() => {
    void draft.load();
    return () => draft.cancel();
  }, [draft]);
  useEffect(() => {
    setLatitude(stop.position ? String(stop.position.latitude) : '');
    setLongitude(stop.position ? String(stop.position.longitude) : '');
    setSummary(false);
  }, [stop.position, state.active]);
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      onPress={action}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  const field = (
    label: string,
    kind: 'label' | 'addressDetails' | 'contactName' | 'contactPhone' | 'note',
    maxLength: number,
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={stop[kind]}
        maxLength={maxLength}
        keyboardType={kind === 'contactPhone' ? 'phone-pad' : 'default'}
        multiline={kind === 'note'}
        onChangeText={(value) => {
          setSummary(false);
          draft.update(kind, value);
        }}
      />
    </View>
  );
  const renderStop = (label: string, value: DeliveryStop) => (
    <View style={styles.summary}>
      <Text style={styles.label}>{label}</Text>
      <Text>{value.label}</Text>
      <Text>{value.addressDetails}</Text>
      <Text>
        {value.contactName} · {value.contactPhone}
      </Text>
      {value.note ? <Text>{value.note}</Text> : null}
    </View>
  );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Giao hàng tại Hà Nội</Text>
      <Text style={styles.hint}>
        Chọn điểm, kiểm tra số nhà/hẻm và xác nhận người liên hệ. Chưa tạo đơn hoặc tính cước.
      </Text>
      <View style={styles.tabs}>
        {(['pickup', 'dropoff'] as const).map((key) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: state.active === key }}
            key={key}
            style={[styles.tab, state.active === key && styles.activeTab]}
            disabled={state.loading}
            onPress={() => {
              draft.setActive(key);
              setSummary(false);
            }}
          >
            <Text style={styles.label}>
              {key === 'pickup' ? 'Điểm lấy' : 'Điểm giao'}
              {state.stops[key].confirmed ? ' ✓' : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
      ) : null}
      {!state.config ? (
        <>
          {button(
            state.loading ? 'Đang tải cấu hình…' : 'Tải cấu hình bản đồ',
            () => void draft.load(),
            state.loading,
          )}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Tìm địa chỉ tại Hà Nội"
            style={styles.input}
            placeholder="Ví dụ: Hồ Hoàn Kiếm"
            value={state.query}
            maxLength={160}
            onChangeText={(value) => {
              setSummary(false);
              draft.setQuery(value);
            }}
          />
          {button(
            state.searching ? 'Đang tìm…' : 'Tìm địa chỉ',
            () => void draft.search(),
            state.loading ||
              state.searching ||
              !state.config.geocodingConfigured ||
              state.query.trim().length < 3,
          )}
          {!state.config.geocodingConfigured && (
            <Text style={styles.hint}>
              Tìm địa chỉ chưa cấu hình. Có thể chọn tọa độ và tự nhập địa chỉ.
            </Text>
          )}
          {state.results?.length === 0 && (
            <Text style={styles.hint}>
              Không tìm thấy kết quả. Thử thêm tên đường hoặc nhập tọa độ.
            </Text>
          )}
          {state.results?.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              style={styles.result}
              onPress={() => {
                draft.select(item.position, item.label);
                setMapError(false);
              }}
            >
              <Text>{item.label}</Text>
            </Pressable>
          ))}
          <MapBoundary>
            <Suspense fallback={<Text style={styles.hint}>Đang mở bản đồ…</Text>}>
              <AddressMap
                config={state.config}
                position={stop.position}
                onPick={(point) => draft.select(point)}
                onError={() => setMapError(true)}
              />
            </Suspense>
          </MapBoundary>
          {mapError && (
            <Text accessibilityRole="alert" style={styles.error}>
              Không tải được nền bản đồ. Vẫn có thể nhập tọa độ và địa chỉ.
            </Text>
          )}
          <Text style={styles.hint}>
            Bấm bản đồ hoặc kéo pin; chỉ tra địa chỉ khi bấm nút, không gửi theo từng ký tự.
          </Text>
          <View style={styles.coordinates}>
            <TextInput
              accessibilityLabel="Vĩ độ"
              placeholder="Vĩ độ"
              style={[styles.input, styles.coordinate]}
              inputMode="decimal"
              value={latitude}
              onChangeText={(value) => {
                setLatitude(value);
                draft.coordinatesChanged();
              }}
            />
            <TextInput
              accessibilityLabel="Kinh độ"
              placeholder="Kinh độ"
              style={[styles.input, styles.coordinate]}
              inputMode="decimal"
              value={longitude}
              onChangeText={(value) => {
                setLongitude(value);
                draft.coordinatesChanged();
              }}
            />
          </View>
          {button('Chọn tọa độ đã nhập', () =>
            draft.select({
              latitude: latitude.trim() ? Number(latitude) : NaN,
              longitude: longitude.trim() ? Number(longitude) : NaN,
            }),
          )}
          {button(
            state.reversing ? 'Đang tra địa chỉ…' : 'Lấy địa chỉ tại pin',
            () => void draft.reverse(),
            !stop.position ||
              state.reversing ||
              !state.config.geocodingConfigured ||
              state.coordinateEditing,
          )}
          {field('Địa chỉ của pin', 'label', 2000)}
          {field('Số nhà, hẻm, tầng hoặc điểm hẹn', 'addressDetails', 200)}
          {field('Tên người liên hệ', 'contactName', 80)}
          {field('Số điện thoại liên hệ', 'contactPhone', 30)}
          {field('Ghi chú giao nhận', 'note', 500)}
          {button(stop.confirmed ? 'Đã xác nhận điểm này' : 'Xác nhận điểm này', () => {
            draft.confirm();
            setSummary(false);
          })}
          {button('Xem thông tin giao nhận', () => setSummary(true), !ready)}
          {summary && ready && (
            <View style={styles.summary}>
              {renderStop('Điểm lấy', state.stops.pickup)}
              {renderStop('Điểm giao', state.stops.dropoff)}
              <Text style={styles.hint}>
                Thông tin chỉ nằm trong bộ nhớ phiên này. Vùng phục vụ và báo giá sẽ kiểm tra ở bước
                tiếp theo.
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              draft.reset();
              setSummary(false);
            }}
          >
            <Text style={styles.link}>Xóa thông tin giao nhận</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(state.config!.attributionUrl).catch(() => {})}
          >
            <Text style={styles.link}>{state.config.attribution}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#e0e9dc',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#173f33' },
  hint: { fontSize: 12, lineHeight: 20, color: '#647c6d' },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: '600', color: '#173f33' },
  input: {
    borderWidth: 1,
    borderColor: '#cadaca',
    borderRadius: 9,
    padding: 12,
    color: '#173f33',
    backgroundColor: '#fafcf8',
  },
  button: { padding: 14, borderRadius: 9, backgroundColor: '#10694c', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  tabs: { flexDirection: 'row', gap: 10 },
  tab: { flex: 1, padding: 12, borderRadius: 9, backgroundColor: '#f2f6ef' },
  activeTab: { borderWidth: 2, borderColor: '#10694c' },
  coordinates: { flexDirection: 'row', gap: 10 },
  coordinate: { flex: 1 },
  result: { padding: 13, borderRadius: 8, backgroundColor: '#edf3ee' },
  error: { color: '#9d3434', fontSize: 13, lineHeight: 21 },
  summary: { padding: 12, gap: 8, borderRadius: 10, backgroundColor: '#f2f6ef' },
  link: { color: '#10694c', paddingVertical: 7, fontSize: 12 },
});
