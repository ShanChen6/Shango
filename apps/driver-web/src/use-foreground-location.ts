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
  /** Milliseconds since start without any fix (null when a fix arrived or not started). */
  waitingForMs: number | null;
  start: () => void;
  stop: () => void;
};

export type Fix = { longitude: number; latitude: number; accuracy: number; recordedAt: string };

/**
 * Some providers only report on movement (and a pending getCurrentPosition can hang while a watch
 * is active), so a stationary driver would go stale. When no fix arrived for RESTART_AFTER_MS we
 * restart the watch, which asks the platform for a fresh fix (maximumAge 0). Never synthesized.
 */
const CHECK_MS = 4_000;
const RESTART_AFTER_MS = 12_000;
const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 };

/**
 * Foreground-only location watch. Coordinates are only handed to `onFix`; the caller decides
 * whether to send them (only while available or on an active order). Never persisted/logged here.
 */
export function useForegroundLocation(onFix?: (fix: Fix) => void): ForegroundLocation {
  const fixCallback = useRef(onFix);
  fixCallback.current = onFix;
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

  const clear = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
  };

  const lastFixRef = useRef<number | null>(null);
  const onPosition = useCallback((position: GeolocationPosition) => {
    lastFixRef.current = Date.now();
    setLastFixAt(lastFixRef.current);
    setAccuracy(Math.round(position.coords.accuracy));
    setLastError(null);
    fixCallback.current?.({
      longitude: position.coords.longitude,
      latitude: position.coords.latitude,
      accuracy: position.coords.accuracy,
      recordedAt: new Date(position.timestamp || Date.now()).toISOString(),
    });
  }, []);

  const onError = useCallback((error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) {
      setDenied(true);
      clear();
      return;
    }
    setLastError(
      error.code === error.TIMEOUT
        ? 'Hết thời gian chờ GPS. Đang tiếp tục thử.'
        : 'Thiết bị chưa xác định được vị trí. Đang tiếp tục thử.',
    );
  }, []);

  const stop = useCallback(() => {
    clear();
    setStartedAt(null);
  }, []);

  const start = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    setDenied(false);
    setLastError(null);
    setLastFixAt(null);
    lastFixRef.current = null;
    setAccuracy(null);
    setHiddenFor(null);
    setStartedAt(Date.now());
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, OPTIONS);
    // Some browsers (e.g. Firefox) never call back when a prompt is dismissed or was blocked
    // earlier; the Permissions API lets us say "blocked" instead of waiting forever.
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        const apply = () => {
          if (status.state === 'denied') {
            setDenied(true);
            clear();
          }
        };
        apply();
        status.onchange = apply;
      })
      .catch(() => undefined);
  }, [supported, onPosition, onError]);

  const active = startedAt !== null;
  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      const last = lastFixRef.current;
      if (watchId.current === null || document.visibilityState !== 'visible' || last === null)
        return;
      if (Date.now() - last < RESTART_AFTER_MS) return;
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = navigator.geolocation.watchPosition(onPosition, onError, OPTIONS);
    }, CHECK_MS);
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
      window.clearInterval(tick);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, onPosition, onError]);

  useEffect(() => () => clear(), []);

  return {
    active,
    freshness: classifyFix({ supported, permissionDenied, lastFixAt, startedAt, now }),
    lastFixAt,
    accuracyMeters,
    now,
    lastError,
    lastHiddenForMs,
    waitingForMs: active && lastFixAt === null && !permissionDenied ? now - startedAt! : null,
    start,
    stop,
  };
}
