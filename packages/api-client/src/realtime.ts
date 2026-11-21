import { io, type Socket } from 'socket.io-client';

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * Socket.IO client for WEB-009. Authenticates with the in-memory access token; on server
 * disconnect (token expiry/revocation) it forces one refresh before reconnecting.
 * Events are hints: callers re-read authoritative snapshots and order them by version.
 */
export function createRealtime(options: {
  url?: string;
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  onStatus?: (status: RealtimeStatus) => void;
}) {
  let forceRefresh = false;
  const socket: Socket = io(options.url ?? '', {
    path: '/socket.io',
    autoConnect: false,
    withCredentials: true,
    auth: (callback) => {
      const force = forceRefresh;
      forceRefresh = false;
      options
        .getToken(force)
        .then((token) => callback({ token: token ?? '' }))
        .catch(() => callback({ token: '' }));
    },
  });
  const status = (value: RealtimeStatus) => options.onStatus?.(value);
  socket.on('connect', () => status('connected'));
  socket.on('session.expired', () => {
    forceRefresh = true;
  });
  socket.on('disconnect', (reason) => {
    if (reason === 'io client disconnect') return status('offline');
    status('reconnecting');
    // Server-initiated disconnects are not retried automatically by Socket.IO.
    if (reason === 'io server disconnect') {
      forceRefresh = true;
      setTimeout(() => socket.connect(), 1000);
    }
  });
  socket.on('connect_error', () => {
    forceRefresh = true;
    status('reconnecting');
  });
  return {
    socket,
    start() {
      if (!socket.connected) {
        status('connecting');
        socket.connect();
      }
    },
    stop() {
      socket.disconnect();
    },
  };
}
