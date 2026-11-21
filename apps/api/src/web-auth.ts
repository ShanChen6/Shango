import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { Database } from './database';
import { loadConfig } from './config';
import { parse, phoneSchema } from './validation';
import type { Account } from './security';
import { accessToken, AuthService, opaqueHash, publicUser } from './auth';
import {
  challengeMarker,
  clearRefreshCookie,
  csrfToken,
  csrfValid,
  originAllowed,
  parseAllowedOrigins,
  readCookie,
  REFRESH_COOKIE,
  refreshCookie,
  registrationRole,
  roleAllowed,
  WEB_APPS,
  type WebApp,
} from './web-auth-policy';

const SESSION_DAYS = 30;
const appSchema = z.enum(WEB_APPS);
const emptyBody = z.union([z.undefined(), z.object({}).strict()]);
// Generic on purpose: never reveal whether a phone exists or which role it has.
const INVALID_LOGIN = 'Mã không hợp lệ, đã hết hạn hoặc tài khoản không dùng được ứng dụng này';

type LiveSession = { id: string; user_id: string; app: WebApp; ttl_seconds: number };

function settings() {
  const config = loadConfig();
  return {
    enabled: config.WEB_AUTH_ENABLED === 'true',
    csrfSecret: config.CSRF_SECRET ?? '',
    origins: parseAllowedOrigins(config.CORS_ORIGINS),
  };
}

@Injectable()
export class WebAuthService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async verify(phone: string, code: string, app: WebApp, ip: string) {
    const marker = await this.auth.consumeOtp(phone, code, ip);
    if (marker !== challengeMarker(app)) throw new UnauthorizedException(INVALID_LOGIN);
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const role = registrationRole(app);
    // App/role mapping is enforced inside the transaction, before any session row exists;
    // a mismatch rolls back the whole user/session mutation.
    const user = await this.database.transaction(async (client) => {
      if (role)
        await client.query(
          'INSERT INTO users (phone, role) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING',
          [phone, role],
        );
      const account = (
        await client.query<Account & { status: string }>(
          'SELECT id, phone, role, display_name, status FROM users WHERE phone = $1 FOR UPDATE',
          [phone],
        )
      ).rows[0];
      if (!account || account.status !== 'active' || !roleAllowed(app, account.role))
        throw new UnauthorizedException(INVALID_LOGIN);
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at, transport, app)
         VALUES ($1, $2, $3, now() + make_interval(days => $4), 'web', $5)`,
        [sessionId, account.id, opaqueHash(refreshToken), SESSION_DAYS, app],
      );
      return account;
    });
    return { user, sessionId, refreshToken, ttlSeconds: SESSION_DAYS * 86400 };
  }

  async live(refreshToken: string) {
    return (
      await this.database.pool.query<LiveSession>(
        `SELECT id, user_id, app, EXTRACT(EPOCH FROM expires_at - now())::int AS ttl_seconds
         FROM auth_sessions WHERE refresh_hash = $1 AND transport = 'web'
         AND revoked_at IS NULL AND expires_at > now()`,
        [opaqueHash(refreshToken)],
      )
    ).rows[0];
  }

  /** Atomic rotation: concurrent refreshes with the same cookie produce one winner. */
  async rotate(refreshToken: string, csrf: unknown, secret: string) {
    const next = randomBytes(48).toString('base64url');
    return this.database.transaction(async (client) => {
      const session = (
        await client.query<LiveSession>(
          `SELECT id, user_id, app, EXTRACT(EPOCH FROM expires_at - now())::int AS ttl_seconds
           FROM auth_sessions WHERE refresh_hash = $1 AND transport = 'web'
           AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
          [opaqueHash(refreshToken)],
        )
      ).rows[0];
      if (!session) throw new UnauthorizedException();
      if (!csrfValid(secret, session.id, csrf)) throw new ForbiddenException('Invalid CSRF token');
      const user = (
        await client.query<Account>(
          `SELECT id, phone, role, display_name FROM users WHERE id = $1 AND status = 'active'`,
          [session.user_id],
        )
      ).rows[0];
      if (!user || !roleAllowed(session.app, user.role)) throw new UnauthorizedException();
      await client.query('UPDATE auth_sessions SET refresh_hash = $1 WHERE id = $2', [
        opaqueHash(next),
        session.id,
      ]);
      return { user, session, refreshToken: next };
    });
  }

  async revoke(sessionId: string) {
    await this.database.pool.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );
  }
}

@Controller('auth/web')
export class WebAuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(WebAuthService) private readonly web: WebAuthService,
  ) {}

  /** Flag, Origin and mixed-credential checks shared by every web endpoint. */
  private guard(request: Request, response: Response, originRequired: boolean) {
    const config = settings();
    if (!config.enabled) {
      response.append('Set-Cookie', clearRefreshCookie());
      throw new ServiceUnavailableException('Web authentication is disabled');
    }
    response.setHeader('Cache-Control', 'no-store');
    if (!originAllowed(config.origins, request.headers.origin, originRequired))
      throw new ForbiddenException('Origin not allowed');
    if (request.headers.authorization)
      throw new BadRequestException('Mixed credentials are not allowed');
    return config;
  }

  private session(
    sessionId: string,
    refreshToken: string,
    ttl: number,
    user: Account,
    secret: string,
    response: Response,
  ) {
    response.append('Set-Cookie', refreshCookie(refreshToken, ttl));
    return {
      accessToken: accessToken(user.id, sessionId),
      csrfToken: csrfToken(secret, sessionId),
      user: publicUser(user),
    };
  }

  @Post('otp/request')
  @HttpCode(200)
  request(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.guard(request, response, true);
    const input = parse(z.object({ phone: phoneSchema, app: appSchema }).strict(), body);
    // Same challenge flow for every app (including Admin) so responses do not enumerate accounts.
    return this.auth.requestOtp(input.phone, challengeMarker(input.app), request.ip ?? 'unknown');
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verify(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const config = this.guard(request, response, true);
    const input = parse(
      z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/), app: appSchema }).strict(),
      body,
    );
    const result = await this.web.verify(
      input.phone,
      input.code,
      input.app,
      request.ip ?? 'unknown',
    );
    return this.session(
      result.sessionId,
      result.refreshToken,
      result.ttlSeconds,
      result.user,
      config.csrfSecret,
      response,
    );
  }

  @Get('csrf')
  async csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const config = this.guard(request, response, false);
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    const session = token ? await this.web.live(token) : undefined;
    if (!session) {
      if (token) response.append('Set-Cookie', clearRefreshCookie());
      throw new UnauthorizedException();
    }
    return { csrfToken: csrfToken(config.csrfSecret, session.id) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const config = this.guard(request, response, true);
    parse(emptyBody, body);
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException();
    // A losing concurrent refresh gets 401 without clearing the cookie the winner just set.
    const result = await this.web.rotate(token, request.headers['x-csrf-token'], config.csrfSecret);
    return this.session(
      result.session.id,
      result.refreshToken,
      result.session.ttl_seconds,
      result.user,
      config.csrfSecret,
      response,
    );
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const config = this.guard(request, response, true);
    parse(emptyBody, body);
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    const session = token ? await this.web.live(token) : undefined;
    if (session) {
      // Validate CSRF before touching a live session; failure neither revokes nor clears.
      if (!csrfValid(config.csrfSecret, session.id, request.headers['x-csrf-token']))
        throw new ForbiddenException('Invalid CSRF token');
      await this.web.revoke(session.id);
    }
    response.append('Set-Cookie', clearRefreshCookie());
  }
}
