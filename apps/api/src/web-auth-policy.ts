import { createHmac, timingSafeEqual } from 'node:crypto';

/** Pure web-auth policy (ADR-002). Kept framework-free so it can be unit tested. */
export const REFRESH_COOKIE = '__Host-shango-refresh';
export const WEB_APPS = ['customer', 'driver', 'admin'] as const;
export type WebApp = (typeof WEB_APPS)[number];

const APP_ROLES: Record<WebApp, readonly string[]> = {
  customer: ['customer'],
  driver: ['driver'],
  admin: ['admin', 'dispatcher', 'accountant'],
};

/** Role that public OTP may register for an app; Admin never registers accounts. */
export function registrationRole(app: WebApp): 'customer' | 'driver' | null {
  return app === 'admin' ? null : app;
}

export function roleAllowed(app: WebApp, role: string) {
  return APP_ROLES[app].includes(role);
}

/** Marker stored in the OTP challenge so legacy and web challenges can never be mixed. */
export function challengeMarker(app: WebApp) {
  return `web:${app}`;
}

export function refreshCookie(token: string, maxAgeSeconds: number) {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${REFRESH_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function clearRefreshCookie() {
  return `${REFRESH_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  // Duplicate cookies (e.g. tossing from a sibling host) are ambiguous: refuse them.
  if (values.length !== 1) return null;
  const value = values[0] ?? '';
  return /^[A-Za-z0-9_-]{32,200}$/.test(value) ? value : null;
}

export function csrfToken(secret: string, sessionId: string) {
  return createHmac('sha256', secret).update(`csrf:v1:${sessionId}`).digest('base64url');
}

export function csrfValid(secret: string, sessionId: string, candidate: unknown) {
  if (typeof candidate !== 'string' || candidate.length > 128) return false;
  const expected = Buffer.from(csrfToken(secret, sessionId));
  const given = Buffer.from(candidate);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Parses CORS_ORIGINS into exact origins. Throws on wildcard, invalid, duplicate,
 * non-origin values (path/query/credentials) and non-HTTPS origins other than localhost.
 */
export function parseAllowedOrigins(raw: string): string[] {
  const entries = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error('CORS_ORIGINS must list at least one origin');
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.includes('*') || entry === 'null')
      throw new Error('Wildcard/null origins are not allowed');
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error('CORS_ORIGINS contains an invalid origin');
    }
    if (url.origin !== entry) throw new Error('CORS_ORIGINS entries must be exact origins');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)))
      throw new Error('Credentialed origins must use HTTPS outside localhost');
    if (seen.has(entry)) throw new Error('CORS_ORIGINS contains duplicates');
    seen.add(entry);
  }
  return [...seen];
}

export function originAllowed(
  allowed: readonly string[],
  origin: string | undefined,
  required: boolean,
) {
  if (origin === undefined) return !required;
  return allowed.includes(origin);
}
