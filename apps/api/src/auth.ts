import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Request } from 'express';
import { Cache, Database } from './database';
import { loadConfig } from './config';
import { parse, phoneSchema, publicRoleSchema } from './validation';
import { AccessGuard, Account, AuthRequest } from './security';

export const CONSUME_OTP = `
local hash = redis.call('HGET', KEYS[1], 'hash')
if not hash then return '' end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts > 5 then redis.call('DEL', KEYS[1]); return '' end
if hash ~= ARGV[1] then
  if attempts == 5 then redis.call('DEL', KEYS[1]) end
  return ''
end
local role = redis.call('HGET', KEYS[1], 'role')
redis.call('DEL', KEYS[1])
return role
`;
const INCREMENT_LIMIT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
export function opaqueHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function identity(value: string) {
  return createHmac('sha256', loadConfig().OTP_SECRET).update(value).digest('hex');
}
function otpHash(phone: string, code: string) {
  return identity(`${phone}:${code}`);
}
function publicUser(user: Account) {
  return { id: user.id, phone: user.phone, role: user.role, displayName: user.display_name };
}
function accessToken(userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, loadConfig().JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    jwtid: randomUUID(),
    issuer: 'shango',
    audience: 'shango-apps',
    expiresIn: '15m',
  });
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Cache) private readonly cache: Cache,
  ) {}
  async limit(key: string, maximum: number, seconds: number) {
    const count = Number(await this.cache.redis.eval(INCREMENT_LIMIT, 1, key, String(seconds)));
    if (count > maximum) throw new HttpException('Too many attempts. Try again later.', 429);
  }
  async requestOtp(phone: string, role: string, ip: string) {
    await this.limit(`otp:ip:${identity(ip)}`, 30, 3600);
    await this.limit(`otp:phone:${identity(phone)}`, 5, 3600);
    const locked = await this.cache.redis.set(
      `otp:cooldown:${identity(phone)}`,
      '1',
      'EX',
      60,
      'NX',
    );
    if (!locked) throw new HttpException('Wait before requesting another OTP.', 429);
    const code = String(randomInt(100000, 1000000));
    const result = await this.cache.redis
      .multi()
      .hset(`otp:challenge:${identity(phone)}`, { hash: otpHash(phone, code), role, attempts: '0' })
      .expire(`otp:challenge:${identity(phone)}`, 180)
      .exec();
    if (!result || result.some(([error]) => error)) throw new Error('OTP storage failed');
    // Development provider only: deliberately returned to the caller, never logged.
    // Configuration validation prevents this application starting in production.
    return { expiresIn: 180, devCode: code };
  }
  async verifyOtp(phone: string, code: string, ip: string) {
    await this.limit(`otp:verify:ip:${identity(ip)}`, 60, 60);
    const role = await this.cache.redis.eval(
      CONSUME_OTP,
      1,
      `otp:challenge:${identity(phone)}`,
      otpHash(phone, code),
    );
    if (role !== 'customer' && role !== 'driver')
      throw new UnauthorizedException('Invalid or expired OTP');
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const user = await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO users (phone, role) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`,
        [phone, role],
      );
      const account = (
        await client.query<Account & { status: string }>(
          'SELECT id, phone, role, display_name, status FROM users WHERE phone = $1 FOR UPDATE',
          [phone],
        )
      ).rows[0];
      if (!account || account.status !== 'active') throw new UnauthorizedException();
      await client.query(
        `INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at)
        VALUES ($1, $2, $3, now() + interval '30 days')`,
        [sessionId, account.id, opaqueHash(refreshToken)],
      );
      return account;
    });
    return { accessToken: accessToken(user.id, sessionId), refreshToken, user: publicUser(user) };
  }
  async refresh(token: string) {
    const next = randomBytes(48).toString('base64url');
    const result = await this.database.transaction(async (client) => {
      const session = (
        await client.query<{ id: string; user_id: string }>(
          `UPDATE auth_sessions SET refresh_hash = $1
         WHERE refresh_hash = $2 AND revoked_at IS NULL AND expires_at > now()
         RETURNING id, user_id`,
          [opaqueHash(next), opaqueHash(token)],
        )
      ).rows[0];
      if (!session) throw new UnauthorizedException();
      const user = (
        await client.query<Account>(
          `SELECT id, phone, role, display_name FROM users WHERE id = $1 AND status = 'active'`,
          [session.user_id],
        )
      ).rows[0];
      if (!user) throw new UnauthorizedException();
      return { user, session };
    });
    return {
      accessToken: accessToken(result.user.id, result.session.id),
      refreshToken: next,
      user: publicUser(result.user),
    };
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Database) private readonly database: Database,
  ) {}
  @Post('otp/request')
  @HttpCode(200)
  request(@Body() body: unknown, @Req() request: Request) {
    const input = parse(z.object({ phone: phoneSchema, role: publicRoleSchema }).strict(), body);
    return this.auth.requestOtp(input.phone, input.role, request.ip ?? 'unknown');
  }
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() body: unknown, @Req() request: Request) {
    const input = parse(
      z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }).strict(),
      body,
    );
    return this.auth.verifyOtp(input.phone, input.code, request.ip ?? 'unknown');
  }
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(
      parse(z.object({ refreshToken: z.string().min(32).max(200) }).strict(), body).refreshToken,
    );
  }
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async logout(@Req() request: AuthRequest) {
    await this.database.pool.query('UPDATE auth_sessions SET revoked_at = now() WHERE id = $1', [
      request.sessionId,
    ]);
  }
  @Get('me')
  @UseGuards(AccessGuard)
  me(@Req() request: AuthRequest) {
    return publicUser(request.account);
  }
}
