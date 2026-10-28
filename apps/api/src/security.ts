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
    let claims: jwt.JwtPayload;
    try {
      const result = jwt.verify(authorization.slice(7), loadConfig().JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'shango',
        audience: 'shango-apps',
      });
      if (
        typeof result === 'string' ||
        typeof result.sub !== 'string' ||
        typeof result.sid !== 'string'
      )
        throw new Error('Invalid claims');
      claims = result;
    } catch {
      throw new UnauthorizedException();
    }
    const result = await this.database.pool.query<Account>(
      `SELECT u.id, u.phone, u.role, u.display_name FROM users u
       JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active' AND s.id = $2
       AND s.revoked_at IS NULL AND s.expires_at > now()`,
      [claims.sub, claims.sid],
    );
    const account = result.rows[0];
    if (!account) throw new UnauthorizedException();
    request.account = account;
    request.sessionId = claims.sid as string;
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(account.role)) throw new ForbiddenException();
    return true;
  }
}
