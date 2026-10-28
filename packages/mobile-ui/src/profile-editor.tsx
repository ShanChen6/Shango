import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, type createApi } from '@shango/api-client';
import type { UserProfile } from '@shango/contracts';

export function ProfileEditor({ api }: { api: ReturnType<typeof createApi> }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    api
      .profile()
      .then((value) => {
        if (generation.current === current) {
          setProfile(value);
          setName(value.displayName ?? '');
        }
      })
      .catch(() => {
        if (generation.current === current) setError('Không tải được hồ sơ. Hãy thử lại.');
      })
      .finally(() => {
        if (generation.current === current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, [api]);
  async function act(save: boolean) {
    const current = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value =
        save && profile ? await api.updateProfile(name, profile.version) : await api.profile();
      if (generation.current !== current) return;
      setProfile(value);
      setName(value.displayName ?? '');
      if (save) setNotice('Đã lưu hồ sơ.');
    } catch (e) {
      if (generation.current === current)
        setError(
          e instanceof ApiError && e.status === 409
            ? 'Hồ sơ đã thay đổi ở nơi khác. Bấm Tải lại hồ sơ để lấy dữ liệu mới trước khi lưu.'
            : 'Không lưu hoặc tải được hồ sơ. Kiểm tra tên và kết nối rồi thử lại.',
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Thông tin cá nhân</Text>
      <Text style={styles.description}>
        Tên này hiển thị trên hồ sơ. Đổi số điện thoại cần quy trình xác thực riêng.
      </Text>
      <Text style={styles.label}>Họ và tên</Text>
      <TextInput
        accessibilityLabel="Họ và tên"
        value={name}
        onChangeText={setName}
        editable={!busy && Boolean(profile)}
        maxLength={80}
        autoCapitalize="words"
        placeholder="Nhập họ và tên"
        style={styles.input}
      />
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
      <Pressable
        accessibilityRole="button"
        disabled={busy || !profile || name.trim().length < 2}
        style={[styles.button, (busy || !profile || name.trim().length < 2) && styles.disabled]}
        onPress={() => void act(true)}
      >
        <Text style={styles.buttonText}>{busy ? 'Đang xử lý…' : 'Lưu thông tin'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void act(false)}>
        <Text style={styles.reload}>Tải lại hồ sơ</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 22,
    gap: 14,
    borderColor: '#e0e9dc',
    borderWidth: 1,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#173f33' },
  label: { fontSize: 13, fontWeight: '600', color: '#173f33' },
  description: { color: '#647c6d', fontSize: 13, lineHeight: 22 },
  input: { borderWidth: 1, borderColor: '#cadaca', borderRadius: 9, padding: 14, color: '#183f33' },
  button: { backgroundColor: '#10694c', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: '#9d3434', fontSize: 13, lineHeight: 21 },
  reload: { color: '#10694c', textAlign: 'center', padding: 8 },
});
