import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppModule } from '../src/app';
import { Database } from '../src/database';

describe('profiles and audit integration', () => {
  let app: INestApplication;
  let database: Database;
  let base: string;
  const ids: string[] = [];
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Use dedicated test services');
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    database = app.get(Database);
  });
  afterAll(async () => {
    if (database && ids.length) {
      await database.pool.query('DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])', [ids]);
      await database.pool.query('DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])', [ids]);
      await database.pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    }
    if (app) await app.close();
  });
  async function account(role = 'customer') {
    const id = randomUUID();
    const sid = randomUUID();
    ids.push(id);
    await database.pool.query('INSERT INTO users(id,phone,role) VALUES($1,$2,$3)', [
      id,
      `+849${randomInt(10000000, 99999999)}`,
      role,
    ]);
    await database.pool.query(
      "INSERT INTO auth_sessions(id,user_id,refresh_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sid, id, randomUUID()],
    );
    const token = jwt.sign({ sid }, process.env.JWT_SECRET!, {
      subject: id,
      issuer: 'shango',
      audience: 'shango-apps',
      expiresIn: '15m',
      algorithm: 'HS256',
    });
    return { id, token };
  }
  async function call(path: string, token?: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  it('updates only the signed-in user and keeps auth profile consistent', async () => {
    const user = await account();
    const other = await account();
    expect((await call('/users/me')).status).toBe(401);
    const current = await call('/users/me', user.token);
    expect(current.data.version).toBe(0);
    const updated = await call('/users/me', user.token, 'PATCH', {
      displayName: '  Nguyễn   Văn An ',
      expectedVersion: 0,
    });
    expect(updated.status).toBe(200);
    expect(updated.data.displayName).toBe('Nguyễn Văn An');
    expect(updated.data.version).toBe(1);
    expect((await call('/auth/me', user.token)).data.displayName).toBe('Nguyễn Văn An');
    expect((await call('/users/me', other.token)).data.displayName).toBeNull();
    const audit = await database.pool.query('SELECT * FROM audit_logs WHERE actor_id=$1', [
      user.id,
    ]);
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].metadata).toEqual({ fields: ['displayName'], version: 1 });
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain('Nguyễn');
  });
  it('rejects protected fields and does not persist invalid input', async () => {
    const user = await account();
    for (const extra of [{ role: 'admin' }, { phone: '+84999999999' }, { id: randomUUID() }])
      expect(
        (
          await call('/users/me', user.token, 'PATCH', {
            displayName: 'Tên hợp lệ',
            expectedVersion: 0,
            ...extra,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call('/users/me', user.token, 'PATCH', {
          displayName: 'An\nNguyễn',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(400);
    const result = await call('/users/me', user.token);
    expect(result.data.version).toBe(0);
    expect(result.data.role).toBe('customer');
  });
  it('allows only one concurrent update and records no extra event for an unchanged name', async () => {
    const user = await account();
    const results = await Promise.all(
      ['Nguyễn An', 'Trần Bình'].map((displayName) =>
        call('/users/me', user.token, 'PATCH', { displayName, expectedVersion: 0 }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results.find((result) => result.status === 200)!.data;
    expect(
      (
        await call('/users/me', user.token, 'PATCH', {
          displayName: winner.displayName,
          expectedVersion: 1,
        })
      ).data.version,
    ).toBe(1);
    expect(
      (await database.pool.query('SELECT 1 FROM audit_logs WHERE actor_id=$1', [user.id])).rowCount,
    ).toBe(1);
  });
  it('restricts audit access to admin and checks it on every request', async () => {
    const admin = await account('admin');
    expect((await call('/admin/audit-logs', admin.token)).status).toBe(200);
    for (const role of ['customer', 'driver', 'dispatcher', 'accountant'])
      expect((await call('/admin/audit-logs', (await account(role)).token)).status).toBe(403);
    await database.pool.query("UPDATE users SET status='blocked' WHERE id=$1", [admin.id]);
    expect((await call('/admin/audit-logs', admin.token)).status).toBe(401);
  });
  it('paginates deterministically despite new events and filters exact entity/actor/action', async () => {
    const admin = await account('admin');
    const user = await account();
    for (const version of [1, 2, 3])
      await database.pool.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'user.profile.updated','user',$1,$2)",
        [user.id, JSON.stringify({ fields: ['displayName'], version, token: 'hidden-token' })],
      );
    const query = `actorId=${user.id}&entityId=${user.id}&action=user.profile.updated&limit=2`;
    const first = await call(`/admin/audit-logs?${query}`, admin.token);
    expect(first.data.items).toHaveLength(2);
    expect(first.data.nextCursor).toBeTruthy();
    expect(JSON.stringify(first.data)).not.toContain('hidden-token');
    await database.pool.query(
      "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'user.profile.updated','user',$1,$2)",
      [user.id, JSON.stringify({ fields: ['displayName'], version: 4 })],
    );
    const second = await call(
      `/admin/audit-logs?${query}&cursor=${first.data.nextCursor}`,
      admin.token,
    );
    expect(second.data.items).toHaveLength(1);
    expect(second.data.nextCursor).toBeNull();
    expect(second.data.items[0].metadata.version).toBe(1);
    expect(
      (await call(`/admin/audit-logs?actorId=${admin.id}`, admin.token)).data.items,
    ).toHaveLength(0);
  });
  it('honors inclusive-from/exclusive-to time bounds and validates cursor/filter input', async () => {
    const admin = await account('admin');
    const user = await account();
    for (const at of [
      '2026-10-27T16:59:59Z',
      '2026-10-27T17:00:00Z',
      '2026-10-28T16:59:59Z',
      '2026-10-28T17:00:00Z',
    ])
      await database.pool.query(
        "INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,created_at) VALUES($1,'admin.bootstrap','user',$1,'{\"source\":\"operator-cli\"}',$2)",
        [user.id, at],
      );
    const filters = new URLSearchParams({
      actorId: user.id,
      from: '2026-10-28T00:00:00+07:00',
      to: '2026-10-29T00:00:00+07:00',
    });
    expect((await call(`/admin/audit-logs?${filters}`, admin.token)).data.items).toHaveLength(2);
    for (const query of [
      'cursor=abc',
      'cursor=9223372036854775808',
      'limit=51',
      'actorId=wrong',
      'untrusted=value',
    ])
      expect((await call(`/admin/audit-logs?${query}`, admin.token)).status).toBe(400);
  });
});
