import { useQuery } from '@tanstack/react-query';
import type { DriverDocuments, DriverProfile } from '@shango/contracts';
import { WebApiError, type createWebApi } from '@shango/api-client';

export type WebApi = ReturnType<typeof createWebApi>;

export const driverKeys = {
  profile: ['driver-profile'] as const,
  documents: ['driver-documents'] as const,
  user: ['user-profile'] as const,
};

export function useDriverProfile(api: WebApi) {
  return useQuery({
    queryKey: driverKeys.profile,
    queryFn: () => api.request<DriverProfile | null>('/drivers/me'),
  });
}

export function useDriverDocuments(api: WebApi, enabled: boolean) {
  return useQuery({
    queryKey: driverKeys.documents,
    enabled,
    queryFn: () => api.request<DriverDocuments>('/drivers/me/documents'),
  });
}

export function errorStatus(error: unknown) {
  return error instanceof WebApiError ? error.status : null;
}

export function requestIdSuffix(error: unknown) {
  return error instanceof WebApiError && error.requestId ? ` Mã yêu cầu: ${error.requestId}.` : '';
}
