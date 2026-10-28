import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ApiError, type createApi } from '@shango/api-client';
import type { DocumentKind, DriverDocuments, DriverProfile } from '@shango/contracts';

const labels: Record<DocumentKind, string> = {
  identity_front: 'CCCD mặt trước',
  identity_back: 'CCCD mặt sau',
  driver_license: 'Giấy phép lái xe',
  vehicle_registration: 'Đăng ký xe',
};
async function removeCachedCopy(uri: string | null) {
  if (uri && FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory))
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được ảnh'));
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Không đọc được ảnh'));
    reader.readAsDataURL(blob);
  });
}
export function DriverDocumentsPanel({
  api,
  profile,
  onProfileChange,
}: {
  api: ReturnType<typeof createApi>;
  profile: DriverProfile;
  onProfileChange: (profile: DriverProfile) => void;
}) {
  const [data, setData] = useState<DriverDocuments | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{
    asset: DocumentPicker.DocumentPickerAsset;
    kind: DocumentKind;
  } | null>(null);
  const [preview, setPreview] = useState<{ uri: string; label: string } | null>(null);
  const selectedUri = useRef<string | null>(null);
  const generation = useRef(0);
  const callback = useRef(onProfileChange);
  callback.current = onProfileChange;
  useEffect(() => {
    const version = ++generation.current;
    setBusy(true);
    api
      .driverDocuments()
      .then((value) => {
        if (generation.current === version) {
          setData(value);
          callback.current(value.profile);
        }
      })
      .catch(() => {
        if (generation.current === version) setError('Không tải được danh sách giấy tờ');
      })
      .finally(() => {
        if (generation.current === version) setBusy(false);
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setPreview(null);
    });
    return () => {
      generation.current++;
      subscription.remove();
      void removeCachedCopy(selectedUri.current);
      selectedUri.current = null;
    };
  }, [api, profile.userId]);
  async function choose(kind: DocumentKind) {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if (generation.current !== version) {
        await removeCachedCopy(asset.uri);
        return;
      }
      if (asset.size && asset.size > 5 * 1024 * 1024) {
        await removeCachedCopy(asset.uri);
        throw new Error('Ảnh phải có kích thước tối đa 5 MiB');
      }
      await removeCachedCopy(selectedUri.current);
      selectedUri.current = asset.uri;
      setSelected({ asset, kind });
      setPreview({ uri: asset.uri, label: labels[kind] });
    } catch (e) {
      if (generation.current === version)
        setError(e instanceof Error ? e.message : 'Không chọn được ảnh');
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }
  async function upload() {
    if (!selected) return;
    const version = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.uploadDriverDocument(selected.kind, profile.updatedAt, {
        uri: selected.asset.uri,
        name: 'document-upload',
        type:
          selected.asset.mimeType ??
          (selected.asset.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'),
      });
      if (generation.current !== version) return;
      callback.current(result.profile);
      setData((current) =>
        current
          ? {
              ...current,
              profile: result.profile,
              items: [
                ...current.items.filter((item) => item.kind !== result.document.kind),
                result.document,
              ],
            }
          : current,
      );
      setSelected(null);
      setPreview(null);
      await removeCachedCopy(selectedUri.current);
      selectedUri.current = null;
      setNotice('Đã nộp ảnh. Hồ sơ đang chờ kiểm tra.');
    } catch (e) {
      if (generation.current === version)
        setError(
          e instanceof ApiError && e.status === 409
            ? 'Hồ sơ đã thay đổi. Tải lại giấy tờ trước khi nộp lại.'
            : e instanceof Error
              ? e.message
              : 'Không nộp được ảnh',
        );
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }
  async function open(id: string, kind: DocumentKind) {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const uri = await dataUrl(await api.documentContent(id));
      if (generation.current === version) setPreview({ uri, label: labels[kind] });
    } catch {
      if (generation.current === version) setError('Không mở được giấy tờ. Hãy tải lại danh sách.');
    } finally {
      if (generation.current === version) setBusy(false);
    }
  }
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Giấy tờ tài xế</Text>
      <Text style={styles.description}>
        Ảnh JPEG/PNG, tối đa 5 MiB mỗi ảnh. Kiểm tra ảnh đã chọn rồi bấm Nộp ảnh.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.description}>
          {notice}
        </Text>
      ) : null}
      {data?.requiredKinds.map((kind) => {
        const document = data.items.find((item) => item.kind === kind);
        return (
          <View key={kind} style={styles.row}>
            <Text style={styles.label}>
              {labels[kind]} · {document ? 'Đã nộp' : 'Chưa nộp'}
            </Text>
            <View style={styles.actions}>
              {profile.status !== 'approved' && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void choose(kind)}
                >
                  <Text style={styles.link}>{document ? 'Thay ảnh' : 'Chọn ảnh'}</Text>
                </Pressable>
              )}
              {document && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void open(document.id, kind)}
                >
                  <Text style={styles.link}>Xem ảnh</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
      {selected && profile.status !== 'approved' && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={[styles.button, busy && styles.disabled]}
          onPress={() => void upload()}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Đang xử lý…' : `Nộp ảnh ${labels[selected.kind]}`}
          </Text>
        </Pressable>
      )}
      {selected && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setSelected(null);
            setPreview(null);
            const uri = selectedUri.current;
            selectedUri.current = null;
            void removeCachedCopy(uri);
          }}
        >
          <Text style={styles.link}>Hủy ảnh đã chọn</Text>
        </Pressable>
      )}
      {preview && (
        <View>
          <Image
            accessibilityLabel={preview.label}
            source={{ uri: preview.uri }}
            style={styles.preview}
            resizeMode="contain"
          />
          <Pressable accessibilityRole="button" onPress={() => setPreview(null)}>
            <Text style={styles.link}>Đóng ảnh</Text>
          </Pressable>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          const version = ++generation.current;
          setBusy(true);
          setError('');
          void api
            .driverDocuments()
            .then((value) => {
              if (generation.current === version) {
                setData(value);
                callback.current(value.profile);
              }
            })
            .catch(() => {
              if (generation.current === version) setError('Không tải được giấy tờ');
            })
            .finally(() => {
              if (generation.current === version) setBusy(false);
            });
        }}
      >
        <Text style={styles.link}>{busy ? 'Đang xử lý…' : 'Tải lại giấy tờ'}</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e0e9dc' },
  heading: { fontSize: 17, fontWeight: '700', color: '#173f33' },
  description: { fontSize: 12, lineHeight: 20, color: '#647c6d' },
  row: { padding: 12, borderRadius: 8, backgroundColor: '#f2f6ef', gap: 8 },
  label: { fontSize: 13, color: '#173f33' },
  actions: { flexDirection: 'row', gap: 20 },
  link: { color: '#10694c', fontWeight: '600', paddingVertical: 8 },
  error: { color: '#9d3434', fontSize: 12, lineHeight: 20 },
  button: { padding: 14, borderRadius: 8, backgroundColor: '#10694c', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  preview: { width: '100%', height: 280 },
});
