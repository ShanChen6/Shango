import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { loadConfig } from './config';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: loadConfig().DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  constructor() {
    this.pool.on('error', () => console.error(JSON.stringify({ event: 'database.pool.error' })));
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
@Injectable()
export class Cache implements OnModuleDestroy {
  readonly redis = new Redis(loadConfig().REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 3000,
  });
  constructor() {
    this.redis.on('error', () =>
      console.error(JSON.stringify({ event: 'redis.connection.error' })),
    );
  }
  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
