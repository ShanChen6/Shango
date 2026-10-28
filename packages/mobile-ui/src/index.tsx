import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createApi } from '@shango/api-client';
import type { DriverProfile, PublicRole, Session } from '@shango/contracts';
import { ProfileEditor } from './profile-editor';

const statusLabels = {
  pending: 'Đang chờ duyệt',
  approved: 'Đã được duyệt',
  rejected: 'Cần cập nhật hồ sơ',
};
export function ShanGoApp({ role, apiUrl }: { role: PublicRole; apiUrl: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [plate, setPlate] = useState('');
  const key = `shango.${role}.session`;
  const api = useMemo(
    () =>
      createApi(apiUrl, {
        get: async () => {
          const value = await SecureStore.getItemAsync(key);
          return value ? (JSON.parse(value) as Session) : null;
        },
        set: async (value) => {
          if (value) await SecureStore.setItemAsync(key, JSON.stringify(value));
          else await SecureStore.deleteItemAsync(key);
          setSession(value);
        },
      }),
    [apiUrl, key],
  );
  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const raw = await SecureStore.getItemAsync(key);
        if (!raw) return;
        const stored = JSON.parse(raw) as Session;
        if (stored.user.role !== role) {
          await SecureStore.deleteItemAsync(key);
          return;
        }
        const user = await api.me();
        if (user.role !== role) {
          await api.logout();
          return;
        }
        const latest = await SecureStore.getItemAsync(key);
        if (active && latest) setSession({ ...(JSON.parse(latest) as Session), user });
      } catch {
        if (active) setError('Không thể khôi phục phiên. Kiểm tra mạng hoặc đăng nhập lại.');
      } finally {
        if (active) setReady(true);
      }
    }
    void restore();
    return () => {
      active = false;
    };
  }, [api, key, role]);
  const loadProfile = useCallback(async () => {
    const value = await api.driverProfile();
    setProfile(value);
    if (value) setPlate(value.vehiclePlate);
  }, [api]);
  useEffect(() => {
    if (session?.user.role === 'driver')
      void loadProfile().catch(() => setError('Không tải được hồ sơ'));
  }, [session?.user.id, loadProfile]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }
  const button = (label: string, action: () => Promise<void>, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      style={[styles.button, (busy || disabled) && styles.disabled]}
      onPress={() => void run(action)}
    >
      <Text style={styles.buttonText}>{busy ? 'Đang xử lý…' : label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>ShanGo</Text>
        <Text style={styles.kicker}>
          {role === 'driver' ? 'DÀNH CHO ĐỐI TÁC TÀI XẾ' : 'GIAO NHẬN QUANH BẠN'}
        </Text>
        <Text style={styles.title}>
          {session
            ? role === 'driver'
              ? 'Sẵn sàng cho hành trình mới'
              : 'Gửi hàng, nhẹ nhàng hơn.'
            : 'Bắt đầu cùng ShanGo'}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {!ready ? (
          <Text>Đang khôi phục phiên…</Text>
        ) : !session ? (
          <View style={styles.card}>
            <Text style={styles.heading}>Đăng nhập bằng số điện thoại</Text>
            <Text style={styles.description}>
              Nhập số theo định dạng quốc tế, ví dụ +84901234567.
            </Text>
            <TextInput
              accessibilityLabel="Số điện thoại"
              style={styles.input}
              value={phone}
              editable={!challenge && !busy}
              keyboardType="phone-pad"
              placeholder="+84901234567"
              onChangeText={setPhone}
            />
            {challenge && (
              <TextInput
                accessibilityLabel="Mã OTP"
                style={styles.input}
                value={code}
                editable={!busy}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                maxLength={6}
                placeholder="Mã OTP 6 chữ số"
                onChangeText={setCode}
              />
            )}
            {devCode ? <Text style={styles.dev}>OTP phát triển: {devCode}</Text> : null}
            {button(
              challenge ? 'Xác thực và tiếp tục' : 'Gửi mã xác thực',
              async () => {
                if (!challenge) {
                  const value = await api.requestOtp(phone, role);
                  setDevCode(value.devCode ?? '');
                  setChallenge(true);
                  setCooldown(60);
                } else {
                  const value = await api.verifyOtp(phone, code);
                  if (value.user.role !== role) {
                    await api.logout();
                    throw new Error('Số điện thoại thuộc vai trò khác. Hãy dùng ứng dụng phù hợp.');
                  }
                  setSession(value);
                  setDevCode('');
                  setCode('');
                }
              },
              !/^\+[1-9]\d{7,14}$/.test(phone) || (challenge && !/^\d{6}$/.test(code)),
            )}
            {challenge && (
              <Pressable
                disabled={busy || cooldown > 0}
                onPress={() => {
                  setChallenge(false);
                  setDevCode('');
                  setCode('');
                }}
              >
                <Text style={styles.link}>
                  {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : 'Đổi số / gửi lại mã'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <ProfileEditor api={api} />
            <View style={styles.card}>
              <Text style={styles.heading}>{session.user.phone}</Text>
              <Text style={styles.description}>
                {role === 'driver' ? 'Hồ sơ đối tác' : 'Tài khoản khách hàng'}
              </Text>
              {role === 'driver' ? (
                <>
                  <Text style={styles.status}>
                    {profile ? statusLabels[profile.status] : 'Chưa gửi hồ sơ phương tiện'}
                  </Text>
                  {profile?.rejectionReason && (
                    <Text style={styles.error}>{profile.rejectionReason}</Text>
                  )}
                  <TextInput
                    accessibilityLabel="Biển số xe"
                    style={styles.input}
                    value={plate}
                    editable={!busy && profile?.status !== 'approved'}
                    placeholder="Biển số xe máy"
                    onChangeText={setPlate}
                  />
                  {profile?.status !== 'approved' &&
                    button(
                      'Gửi hồ sơ phương tiện',
                      async () => {
                        setProfile(await api.submitDriver(plate.trim(), 'motorcycle'));
                      },
                      plate.trim().length < 4,
                    )}
                  {button('Làm mới trạng thái', loadProfile)}
                  <Text style={styles.description}>
                    Bản nền tảng chưa hỗ trợ tải giấy tờ, bật online hoặc nhận đơn.
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.status}>Đăng nhập thành công</Text>
                  <Text style={styles.description}>
                    Chọn địa chỉ, báo giá và đặt đơn sẽ được bổ sung ở giai đoạn tiếp theo.
                  </Text>
                </>
              )}
            </View>
            {button('Đăng xuất', async () => {
              try {
                await api.logout();
              } finally {
                setSession(null);
                setProfile(null);
                setChallenge(false);
              }
            })}
          </>
        )}
        <Pressable
          onPress={() =>
            Alert.alert(
              'Bản phát triển',
              'ShanGo đang xây dựng nền tảng. Chưa mở dịch vụ giao nhận công khai.',
            )
          }
        >
          <Text style={styles.footer}>ShanGo · Bản nền tảng phát triển</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f2f6ef' },
  container: { padding: 26, paddingTop: 45, gap: 14 },
  brand: { color: '#0b5742', fontSize: 42, fontWeight: '800', letterSpacing: -2 },
  kicker: { color: '#6c8276', fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  title: { color: '#173f33', fontSize: 29, fontWeight: '700', lineHeight: 37, marginVertical: 12 },
  card: {
    borderRadius: 18,
    backgroundColor: '#fff',
    padding: 22,
    gap: 15,
    borderColor: '#e0e9dc',
    borderWidth: 1,
  },
  heading: { fontSize: 18, fontWeight: '700', color: '#173f33' },
  description: { color: '#647c6d', fontSize: 13, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#cadaca',
    borderRadius: 9,
    padding: 14,
    color: '#183f33',
    backgroundColor: '#fafcf8',
  },
  button: { padding: 16, borderRadius: 10, backgroundColor: '#10694c', alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: '#9d3434', fontSize: 13, lineHeight: 21 },
  dev: { backgroundColor: '#fff1cb', padding: 10, color: '#7b5f1d' },
  link: { color: '#10694c', paddingVertical: 12, textAlign: 'center' },
  status: { color: '#10694c', fontWeight: '600' },
  footer: { textAlign: 'center', color: '#7c9181', fontSize: 11, marginTop: 18 },
});
