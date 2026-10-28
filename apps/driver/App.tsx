import { ShanGoApp } from '@shango/mobile-ui';
export default function App() {
  return (
    <ShanGoApp
      role="driver"
      apiUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1'}
    />
  );
}
