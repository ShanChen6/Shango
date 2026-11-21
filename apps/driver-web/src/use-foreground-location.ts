import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyFix, type Freshness } from './driver-policy';

export type ForegroundLocation = {
  active: boolean;
  freshness: Freshness;
  lastFixAt: number | null;
  accuracyMeters: number | null;
  now: number;
  lastError: string | null;
  /** Milliseconds the page last spent hidden while checking; tracking may have paused. */
  lastHiddenForMs: number | null;
  start: () => void;
  stop: () => void;
};

/**
 * Foreground-only location check. Coordinates stay inside this hook: they are not sent to
 * the API, persisted or logged. Production presence/tracking is WEB-009 behind the WEB-002 gate.
 */
export function useForegroundLocation(): ForegroundLocation {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const watchId = useRef<number | null>(null);
  const hiddenAt = useRef<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastFixAt, setLastFixAt] = useState<number | null>(null);
  const [accuracyMeters, setAccuracy] = useState<number | null>(null);
  const [permissionDenied, setDenied] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastHiddenForMs, setHiddenFor] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setStartedAt(null);
  }, []);

  const start = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    setDenied(false);
    setLastError(null);
    setLastFixAt(null);
    setAccuracy(null);
    setHiddenFor(null);
    setStartedAt(Date.now());
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setLastFixAt(Date.now());
        setAccuracy(Math.round(position.coords.accuracy));
        setLastError(null);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setDenied(true);
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          return;
        }
        setLastError(
          error.code === error.TIMEOUT
            ? 'Hết thời gian chờ GPS. Đang tiếp tục thử.'
            : 'Thiết bị chưa xác định được vị trí. Đang tiếp tục thử.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }, [supported]);

  const active = startedAt !== null;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null) {
        setHiddenFor(Date.now() - hiddenAt.current);
        hiddenAt.current = null;
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return {
    active,
    freshness: classifyFix({ supported, permissionDenied, lastFixAt, startedAt, now }),
    lastFixAt,
    accuracyMeters,
    now,
    lastError,
    lastHiddenForMs,
    start,
    stop,
  };
}
