import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { Database } from './database';
import { loadConfig } from './config';

export type Account = { id: string; phone: string; role: string; display_name: string | null };
export type AuthRequest = Request & { account: Account; sessionId: string };
export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

/** Verifies a JWT access token against the live DB session (used by HTTP and Socket.IO). */
export async function authenticateAccessToken(database: Database, token: string) {
  let claims: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, loadConfig().JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'shango',
      audience: 'shango-apps',
    });
    if (
      typeof result === 'string' ||
      typeof result.sub !== 'string' ||
      typeof result.sid !== 'string'
    )
      return null;
    claims = result;
  } catch {
    return null;
  }
  const account = (
    await database.pool.query<Account>(
      `SELECT u.id, u.phone, u.role, u.display_name FROM users u
       JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active' AND s.id = $2
       AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [claims.sub, claims.sid],
    )
  ).rows[0];
  return account
    ? { account, sessionId: claims.sid as string, expiresAt: (claims.exp ?? 0) * 1000 }
    : null;
}

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException();
    const session = await authenticateAccessToken(this.database, authorization.slice(7));
    if (!session) throw new UnauthorizedException();
    const { account } = session;
    request.account = account;
    request.sessionId = session.sessionId;
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(account.role)) throw new ForbiddenException();
    return true;
  }
}
