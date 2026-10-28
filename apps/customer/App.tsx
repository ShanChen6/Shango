import { ShanGoApp } from '@shango/mobile-ui';
import { CustomerAddressPlanner } from './src/customer-address-planner';
export default function App() {
  return (
    <ShanGoApp
      role="customer"
      customerPanel={(api) => <CustomerAddressPlanner api={api} />}
      apiUrl={process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1'}
    />
  );
}
