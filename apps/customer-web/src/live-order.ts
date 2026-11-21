import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Order, OrderLocationEvent, OrderUpdatedEvent } from '@shango/contracts';
import { createRealtime, type createWebApi, type RealtimeStatus } from '@shango/api-client';
import { newerOrder } from './order-format';

type WebApi = ReturnType<typeof createWebApi>;
let shared: {
  realtime: ReturnType<typeof createRealtime>;
  listeners: Set<(s: RealtimeStatus) => void>;
  status: RealtimeStatus;
} | null = null;

/** One socket per tab, created lazily after login. */
export function realtimeFor(api: WebApi) {
  if (!shared) {
    const listeners = new Set<(s: RealtimeStatus) => void>();
    const state = {
      listeners,
      status: 'connecting' as RealtimeStatus,
      realtime: createRealtime({
        url: import.meta.env.VITE_REALTIME_URL,
        getToken: async (force) =>
          force ? (await api.bootstrap()).accessToken : (api.getSession()?.accessToken ?? null),
        onStatus: (value) => {
          state.status = value;
          listeners.forEach((listener) => listener(value));
        },
      }),
    };
    shared = state;
  }
  shared.realtime.start();
  return shared;
}

export function stopRealtime() {
  shared?.realtime.stop();
  shared = null;
}

/** Authoritative snapshot via REST/subscribe ack; socket events only trigger version-ordered refetches. */
export function useLiveOrder(api: WebApi, orderId: string) {
  const client = useQueryClient();
  const key = ['order', orderId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.request<Order>(`/orders/${orderId}`),
  });
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  useEffect(() => {
    const live = realtimeFor(api);
    const { socket } = live.realtime;
    setStatus(live.status);
    live.listeners.add(setStatus);
    const subscribe = () => {
      socket.emit('order:subscribe', { orderId }, (reply: { order?: Order }) => {
        if (reply.order)
          client.setQueryData<Order>(key, (current) => newerOrder(current, reply.order!));
      });
    };
    const onUpdate = (event: OrderUpdatedEvent) => {
      if (event.orderId !== orderId) return;
      const current = client.getQueryData<Order>(key);
      if (!current || event.version > current.version)
        void client.invalidateQueries({ queryKey: key });
    };
    const onLocation = (event: OrderLocationEvent) => {
      if (event.orderId !== orderId) return;
      client.setQueryData<Order>(key, (current) =>
        current && current.driverLocation
          ? {
              ...current,
              driverLocation: {
                ...current.driverLocation,
                longitude: event.longitude,
                latitude: event.latitude,
                accuracy: event.accuracy,
                recordedAt: event.recordedAt,
                lastSeenAt: new Date().toISOString(),
              },
            }
          : current,
      );
    };
    socket.on('connect', subscribe);
    socket.on('order.updated', onUpdate);
    socket.on('order.location', onLocation);
    if (socket.connected) subscribe();
    return () => {
      live.listeners.delete(setStatus);
      socket.off('connect', subscribe);
      socket.off('order.updated', onUpdate);
      socket.off('order.location', onLocation);
      socket.emit('order:unsubscribe', { orderId });
    };
  }, [api, orderId]);
  return { ...query, connection: status };
}
