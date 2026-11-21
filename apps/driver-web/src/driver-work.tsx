import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DriverOffer,
  DriverPresence,
  LocationFix,
  LocationResult,
  Order,
  OfferUpdatedEvent,
  OrderUpdatedEvent,
} from '@shango/contracts';
import { createRealtime, WebApiError, type RealtimeStatus } from '@shango/api-client';
import type { WebApi } from './driver-data';
import {
  type Fix,
  type ForegroundLocation,
  useForegroundLocation,
} from './use-foreground-location';

/** Send at most one fix per interval; the server orders fixes by device time. */
const SEND_INTERVAL_MS = 5_000;
export const workKeys = {
  presence: ['driver-presence'] as const,
  offer: ['driver-offer'] as const,
  order: ['driver-order'] as const,
};

type Work = {
  location: ForegroundLocation;
  connection: RealtimeStatus;
  presence: DriverPresence | undefined;
  offer: DriverOffer | null;
  order: Order | null;
  sharing: boolean;
  lastSend: { at: number; result: LocationResult } | null;
  goOnline: () => void;
  goOffline: () => void;
  availabilityError: string;
  availabilityBusy: boolean;
  wantsOnline: boolean;
};

const WorkContext = createContext<Work | null>(null);
export function useWork() {
  const value = useContext(WorkContext);
  if (!value) throw new Error('useWork outside DriverWorkProvider');
  return value;
}

let realtime: ReturnType<typeof createRealtime> | null = null;
export function stopDriverRealtime() {
  realtime?.stop();
  realtime = null;
}

export function DriverWorkProvider({ api, children }: { api: WebApi; children: ReactNode }) {
  const client = useQueryClient();
  const [connection, setConnection] = useState<RealtimeStatus>('connecting');
  const [wantsOnline, setWantsOnline] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [lastSend, setLastSend] = useState<Work['lastSend']>(null);
  const sequence = useRef(0);
  const lastSentAt = useRef(0);

  const presence = useQuery({
    queryKey: workKeys.presence,
    queryFn: () => api.request<DriverPresence>('/drivers/me/presence'),
    refetchInterval: 10_000,
  });
  const offer = useQuery({
    queryKey: workKeys.offer,
    queryFn: async () =>
      (await api.request<{ offer: DriverOffer | null }>('/drivers/me/offers/current')).offer,
    refetchInterval: 15_000,
  });
  const order = useQuery({
    queryKey: workKeys.order,
    queryFn: async () =>
      (await api.request<{ order: Order | null }>('/drivers/me/orders/current')).order,
    refetchInterval: 30_000,
  });

  const available = Boolean(presence.data?.available);
  const activeOrder = order.data ?? null;
  const sharing = available || wantsOnline || Boolean(activeOrder);
  const sharingRef = useRef(sharing);
  sharingRef.current = sharing;

  useEffect(() => {
    if (!realtime)
      realtime = createRealtime({
        url: import.meta.env.VITE_REALTIME_URL,
        getToken: async (force) =>
          force ? (await api.bootstrap()).accessToken : (api.getSession()?.accessToken ?? null),
        onStatus: setConnection,
      });
    const { socket } = realtime;
    const onOffer = (_event: OfferUpdatedEvent) =>
      void client.invalidateQueries({ queryKey: workKeys.offer });
    const onOrder = (_event: OrderUpdatedEvent) => {
      void client.invalidateQueries({ queryKey: workKeys.order });
      void client.invalidateQueries({ queryKey: workKeys.offer });
    };
    const onConnect = () => {
      // Snapshot-first recovery: re-read authoritative state after every (re)connect.
      void client.invalidateQueries({ queryKey: workKeys.offer });
      void client.invalidateQueries({ queryKey: workKeys.order });
      void client.invalidateQueries({ queryKey: workKeys.presence });
    };
    socket.on('offer.updated', onOffer);
    socket.on('order.updated', onOrder);
    socket.on('connect', onConnect);
    realtime.start();
    return () => {
      socket.off('offer.updated', onOffer);
      socket.off('order.updated', onOrder);
      socket.off('connect', onConnect);
    };
  }, [api, client]);

  const send = useCallback(
    async (fix: Fix, force = false) => {
      if (!sharingRef.current && !force) return null;
      const now = Date.now();
      if (!force && now - lastSentAt.current < SEND_INTERVAL_MS) return null;
      lastSentAt.current = now;
      sequence.current += 1;
      const payload: LocationFix = { ...fix, sequence: sequence.current };
      const socket = realtime?.socket;
      let result: LocationResult;
      try {
        result = socket?.connected
          ? await socket.timeout(5000).emitWithAck('driver:location', payload)
          : await api.request<LocationResult>('/drivers/me/location', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
      } catch {
        result = { accepted: false, reason: 'network' };
      }
      setLastSend({ at: Date.now(), result });
      return result;
    },
    [api],
  );

  const pendingOnline = useRef(false);
  const availability = useMutation({
    mutationFn: (value: boolean) =>
      api.request<{ available: boolean }>('/drivers/me/availability', {
        method: 'PATCH',
        body: JSON.stringify({ available: value }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: workKeys.presence }),
  });

  const location = useForegroundLocation((fix) => {
    if (pendingOnline.current) {
      pendingOnline.current = false;
      void send(fix, true).then((result) => {
        if (!result?.accepted) {
          setWantsOnline(false);
          setAvailabilityError(
            result && 'reason' in result && result.reason === 'inaccurate'
              ? 'GPS chưa đủ chính xác (sai số > 200 m). Ra nơi thoáng rồi thử lại.'
              : 'Máy chủ chưa nhận được vị trí. Thử lại.',
          );
          return;
        }
        availability.mutate(true, {
          onSettled: () => setWantsOnline(false),
          onError: (error) =>
            setAvailabilityError(
              error instanceof WebApiError ? error.message : 'Không bật được sẵn sàng.',
            ),
        });
      });
      return;
    }
    void send(fix);
  });

  // Keep sharing GPS while on an active order even after a page reload.
  useEffect(() => {
    if ((available || activeOrder) && !location.active) location.start();
  }, [available, activeOrder, location]);

  const goOnline = () => {
    setAvailabilityError('');
    setWantsOnline(true);
    pendingOnline.current = true;
    location.start();
  };
  const goOffline = () => {
    setAvailabilityError('');
    pendingOnline.current = false;
    setWantsOnline(false);
    availability.mutate(false, {
      onSuccess: () => {
        if (!activeOrder) location.stop();
      },
      onError: () => setAvailabilityError('Không tắt được sẵn sàng. Thử lại.'),
    });
  };

  // Permission denied while trying to go online: surface it instead of waiting forever.
  useEffect(() => {
    if (wantsOnline && (location.freshness === 'denied' || location.freshness === 'unsupported')) {
      pendingOnline.current = false;
      setWantsOnline(false);
      setAvailabilityError('Cần cho phép truy cập vị trí để bật sẵn sàng.');
    }
  }, [wantsOnline, location.freshness]);

  const value: Work = {
    location,
    connection,
    presence: presence.data,
    offer: offer.data ?? null,
    order: activeOrder,
    sharing,
    lastSend,
    goOnline,
    goOffline,
    availabilityError,
    availabilityBusy: availability.isPending || wantsOnline,
    wantsOnline,
  };
  return <WorkContext.Provider value={value}>{children}</WorkContext.Provider>;
}
