import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createApi } from '@shango/api-client';
import type { Session } from '@shango/contracts';
import './style.css';
import { ThemeShowcase } from './components/theme-showcase';
import { createAdminWebApi } from './lib/admin-web-api';
import { AdminApp } from './admin-app';

let currentSession: Session | null = null;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const webAuthEnabled = import.meta.env.VITE_WEB_AUTH_ENABLED === 'true';
// Cookie auth needs a same-site API: default to the Vite/ingress proxy when web auth is on.
const apiBaseUrl =
  import.meta.env.VITE_API_URL ?? (webAuthEnabled ? '/api/v1' : 'http://localhost:3000/api/v1');
const legacyApi = createApi(apiBaseUrl, {
  get: async () => currentSession,
  set: async (value) => {
    currentSession = value;
  },
});
const adminWebApi = createAdminWebApi(apiBaseUrl, () => {
  currentSession = null;
  queryClient.clear();
});
const api = webAuthEnabled ? adminWebApi : legacyApi;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {window.location.pathname === '/components' ? (
          <ThemeShowcase />
        ) : (
          <AdminApp api={api} webAuth={webAuthEnabled} onLogout={() => queryClient.clear()} />
        )}
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
