import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rmdir, unlink, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { AppModule } from '../src/app';
import { Cache, Database } from '../src/database';
import { DOCUMENT_KINDS } from '../src/document-policy';
import { PrivateDocumentStore } from '../src/documents';

describe('private driver documents integration', () => {
  let app: INestApplication;
  let database: Database;
  let cache: Cache;
  let store: PrivateDocumentStore;
  let base: string;
  let directory: string;
  let png: Buffer;
  const ids: string[] = [];
  const previous = process.env.PRIVATE_DOCUMENTS_DIR;
  beforeAll(async () => {
    if (process.env.NODE_ENV !== 'test') throw new Error('Use dedicated test services');
    directory = await mkdtemp(path.join(os.tmpdir(), 'shango-documents-'));
    process.env.PRIVATE_DOCUMENTS_DIR = directory;
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api/v1`;
    database = app.get(Database);
    cache = app.get(Cache);
    store = app.get(PrivateDocumentStore);
    png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#c8d8e8' } })
      .png()
      .toBuffer();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (database && ids.length) {
      await database.pool.query(
        'DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[]) OR entity_id=ANY($1::uuid[])',
        [ids],
      );
      await database.pool.query('DELETE FROM driver_documents WHERE driver_id=ANY($1::uuid[])', [
        ids,
      ]);
      await database.pool.query('DELETE FROM driver_profiles WHERE user_id=ANY($1::uuid[])', [ids]);
      await database.pool.query('DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])', [ids]);
      await database.pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    }
    if (cache && ids.length)
      await cache.redis.del(
        ...ids.flatMap((id) => [`documents:upload:${id}`, `documents:read:${id}`]),
      );
    if (app) await app.close();
    if (
      directory &&
      path.dirname(directory) === os.tmpdir() &&
      path.basename(directory).startsWith('shango-documents-')
    ) {
      for (const file of await readdir(directory)) {
        if (!/^[0-9a-f-]{36}\.jpg$/.test(file))
          throw new Error('Unexpected test file; refusing cleanup');
        await unlink(path.join(directory, file));
      }
      await rmdir(directory);
    }
    if (previous === undefined) delete process.env.PRIVATE_DOCUMENTS_DIR;
    else process.env.PRIVATE_DOCUMENTS_DIR = previous;
  });
  async function account(role = 'driver') {
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
    if (role === 'driver')
      await database.pool.query(
        "INSERT INTO driver_profiles(user_id,vehicle_plate,vehicle_type) VALUES($1,'TEST-DOC','motorcycle')",
        [id],
      );
    return { id, token };
  }
  async function call(url: string, token?: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  async function profile(user: { token: string }) {
    return (await call('/drivers/me', user.token)).data;
  }
  async function upload(
    user: { token: string },
    kind: string,
    expectedUpdatedAt: string,
    buffer = png,
    mime = 'image/png',
  ) {
    const body = new FormData();
    body.append('kind', kind);
    body.append('expectedUpdatedAt', expectedUpdatedAt);
    body.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mime }),
      '../../private-original.png',
    );
    const response = await fetch(`${base}/drivers/me/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}` },
      body,
    });
    return { status: response.status, data: await response.json() };
  }
  async function content(id: string, token?: string) {
    return fetch(`${base}/driver-documents/${id}/content`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
  it('stores normalized private images and exposes only safe metadata', async () => {
    const driver = await account();
    const current = await profile(driver);
    const result = await upload(driver, 'identity_front', current.updatedAt);
    expect(result.status).toBe(201);
    expect(Date.parse(result.data.profile.updatedAt)).toBeGreaterThan(
      Date.parse(current.updatedAt),
    );
    const list = await call('/drivers/me/documents', driver.token);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.requiredKinds).toEqual([...DOCUMENT_KINDS]);
    const serialized = JSON.stringify(list.data);
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('private-original');
    expect(serialized).not.toContain('sha256');
    const download = await content(result.data.document.id, driver.token);
    expect(download.status).toBe(200);
    expect(download.headers.get('cache-control')).toContain('no-store');
    expect(download.headers.get('content-disposition')).toContain('identity_front.jpg');
    expect(download.headers.get('content-type')).toContain('image/jpeg');
    const decoded = await sharp(Buffer.from(await download.arrayBuffer())).metadata();
    expect(decoded.format).toBe('jpeg');
    expect(decoded.exif).toBeUndefined();
  });
  it('protects content from anonymous, customers, other drivers and revoked users', async () => {
    const driver = await account();
    const result = await upload(driver, 'driver_license', (await profile(driver)).updatedAt);
    const id = result.data.document.id;
    expect((await content(id)).status).toBe(401);
    for (const role of ['customer', 'driver', 'accountant'])
      expect((await content(id, (await account(role)).token)).status).toBe(404);
    const reviewer = await account('dispatcher');
    expect((await content(id, reviewer.token)).status).toBe(200);
    await database.pool.query("UPDATE users SET status='blocked' WHERE id=$1", [driver.id]);
    expect((await content(id, driver.token)).status).toBe(401);
  });
  it('enforces type, content, size, required fields and upload role', async () => {
    const driver = await account();
    const at = (await profile(driver)).updatedAt;
    expect((await upload(driver, 'unknown', at)).status).toBe(400);
    expect(
      (await upload(driver, 'identity_front', at, Buffer.from('<svg><script/></svg>'), 'image/png'))
        .status,
    ).toBe(400);
    expect((await upload(driver, 'identity_front', at, png, 'image/jpeg')).status).toBe(400);
    expect(
      (await upload(driver, 'identity_front', at, Buffer.from('%PDF-1.7'), 'application/pdf'))
        .status,
    ).toBe(400);
    expect(
      (await upload(driver, 'identity_front', at, Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'))
        .status,
    ).toBe(413);
    expect((await upload(await account('customer'), 'identity_front', at)).status).toBe(403);
    const missing = new FormData();
    missing.append('kind', 'identity_front');
    missing.append('expectedUpdatedAt', at);
    expect(
      (
        await fetch(`${base}/drivers/me/documents`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${driver.token}` },
          body: missing,
        })
      ).status,
    ).toBe(400);
    expect((await call('/drivers/me/documents', driver.token)).data.items).toHaveLength(0);
  });
  it('serializes concurrent uploads and leaves no losing file or row', async () => {
    const driver = await account();
    const at = (await profile(driver)).updatedAt;
    const count = (await readdir(directory)).length;
    const results = await Promise.all([
      upload(driver, 'identity_front', at),
      upload(driver, 'identity_back', at),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      (await database.pool.query('SELECT 1 FROM driver_documents WHERE driver_id=$1', [driver.id]))
        .rowCount,
    ).toBe(1);
    expect((await readdir(directory)).length - count).toBe(1);
  });
  it('requires all four documents and each reviewer to inspect current versions before approval', async () => {
    const driver = await account();
    const admin = await account('admin');
    const second = await account('admin');
    let current = await profile(driver);
    const approve = () =>
      call(`/admin/drivers/${driver.id}/review`, admin.token, 'PATCH', {
        status: 'approved',
        expectedUpdatedAt: current.updatedAt,
      });
    expect((await approve()).status).toBe(409);
    for (const kind of DOCUMENT_KINDS) {
      const result = await upload(driver, kind, current.updatedAt);
      expect(result.status).toBe(201);
      current = result.data.profile;
    }
    expect((await approve()).status).toBe(409);
    const list = (await call(`/admin/drivers/${driver.id}/documents`, admin.token)).data;
    for (const item of list.items) expect((await content(item.id, admin.token)).status).toBe(200);
    // Changing vehicle details invalidates every previous inspection, even if document IDs are unchanged.
    const changed = await call('/drivers/me', driver.token, 'POST', {
      vehiclePlate: 'TEST-CHANGED',
      vehicleType: 'motorcycle',
    });
    current = changed.data;
    expect((await approve()).status).toBe(409);
    expect(
      (await call(`/admin/drivers/${driver.id}/documents`, admin.token)).data.viewedIds,
    ).toHaveLength(0);
    for (const item of list.items) expect((await content(item.id, admin.token)).status).toBe(200);
    expect(
      (
        await call(`/admin/drivers/${driver.id}/review`, second.token, 'PATCH', {
          status: 'approved',
          expectedUpdatedAt: current.updatedAt,
        })
      ).status,
    ).toBe(409);
    expect((await approve()).status).toBe(200);
    expect((await upload(driver, 'identity_front', (await profile(driver)).updatedAt)).status).toBe(
      409,
    );
  });
  it('replaces a rejected image, revokes the old ID and invalidates stale reviews', async () => {
    const driver = await account();
    const admin = await account('admin');
    const first = await upload(driver, 'identity_front', (await profile(driver)).updatedAt);
    expect(
      (
        await call(`/admin/drivers/${driver.id}/review`, admin.token, 'PATCH', {
          status: 'rejected',
          reason: 'Ảnh chưa rõ',
          expectedUpdatedAt: first.data.profile.updatedAt,
        })
      ).status,
    ).toBe(200);
    const at = (await profile(driver)).updatedAt;
    const replacement = await upload(driver, 'identity_front', at);
    expect(replacement.status).toBe(201);
    expect(replacement.data.profile.status).toBe('pending');
    expect((await content(first.data.document.id, driver.token)).status).toBe(404);
    expect(
      (
        await call(`/admin/drivers/${driver.id}/review`, admin.token, 'PATCH', {
          status: 'rejected',
          reason: 'Đánh giá cũ',
          expectedUpdatedAt: at,
        })
      ).status,
    ).toBe(409);
    expect((await call('/drivers/me/documents', driver.token)).data.items).toHaveLength(1);
  });
  it('rolls back profile and metadata when private storage fails', async () => {
    const driver = await account();
    const current = await profile(driver);
    const spy = vi.spyOn(store, 'write').mockRejectedValueOnce(new Error('storage unavailable'));
    try {
      expect((await upload(driver, 'identity_front', current.updatedAt)).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect((await profile(driver)).updatedAt).toBe(current.updatedAt);
    expect((await call('/drivers/me/documents', driver.token)).data.items).toHaveLength(0);
  });
  it('lets only Admin reopen legacy approval for missing documents, with an audited reason', async () => {
    const driver = await account();
    const admin = await account('admin');
    const dispatcher = await account('dispatcher');
    await database.pool.query("UPDATE driver_profiles SET status='approved' WHERE user_id=$1", [
      driver.id,
    ]);
    const current = await profile(driver);
    const body = { reason: 'Bổ sung giấy tờ còn thiếu', expectedUpdatedAt: current.updatedAt };
    expect(
      (await call(`/admin/drivers/${driver.id}/reopen`, dispatcher.token, 'POST', body)).status,
    ).toBe(403);
    expect(
      (
        await call(`/admin/drivers/${driver.id}/reopen`, admin.token, 'POST', {
          ...body,
          reason: '',
        })
      ).status,
    ).toBe(400);
    const result = await call(`/admin/drivers/${driver.id}/reopen`, admin.token, 'POST', body);
    expect(result.status).toBe(201);
    expect(result.data.status).toBe('pending');
    expect(
      (await call(`/admin/drivers/${driver.id}/reopen`, admin.token, 'POST', body)).status,
    ).toBe(409);
    expect((await upload(driver, 'identity_front', result.data.updatedAt)).status).toBe(201);
    const audit = await database.pool.query(
      "SELECT metadata FROM audit_logs WHERE entity_id=$1 AND action='driver.review.reopened'",
      [driver.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].metadata.reason).toBe(body.reason);
  });
  it('refuses tampered content and does not record a successful view', async () => {
    const driver = await account();
    const admin = await account('admin');
    const result = await upload(driver, 'identity_front', (await profile(driver)).updatedAt);
    const metadata = (
      await database.pool.query('SELECT storage_key FROM driver_documents WHERE id=$1', [
        result.data.document.id,
      ])
    ).rows[0];
    const file = path.join(directory, `${metadata.storage_key}.jpg`);
    const original = await readFile(file);
    await writeFile(file, Buffer.from('changed'));
    try {
      expect((await content(result.data.document.id, admin.token)).status).toBe(503);
    } finally {
      await writeFile(file, original);
    }
    expect(
      (
        await database.pool.query(
          "SELECT 1 FROM audit_logs WHERE actor_id=$1 AND action='driver.document.viewed'",
          [admin.id],
        )
      ).rowCount,
    ).toBe(0);
  });
});
