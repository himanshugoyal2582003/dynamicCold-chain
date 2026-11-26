import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createInMemoryPostgres } from './memory-db';

export interface SqlTransactionStatement {
  text: string;
  values: unknown[];
}

@Injectable()
export class NeonService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NeonService.name);
  private sql: any = null;
  private pool: any = null;
  private provider = 'unavailable';
  private databaseName: string | null = null;
  private persistent = false;
  private s3Client: S3Client;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  async onModuleInit() {
    await this.initPostgres();
    this.initObjectStorage();
    this.initAuth();
  }

  // 1. Neon Postgres
  private async initPostgres() {
    const connectionString = process.env.DATABASE_URL?.trim();
    const allowMemory = process.env.NODE_ENV !== 'production' && process.env.ALLOW_IN_MEMORY_DATABASE === 'true';

    if (!connectionString) {
      if (!allowMemory) {
        this.logger.error('[DB] DATABASE_URL is missing; refusing to start without persistent PostgreSQL.');
        throw new Error(
          'DATABASE_URL is required. For an intentionally temporary local demo only, set ALLOW_IN_MEMORY_DATABASE=true (data will be lost on restart).',
        );
      }
      this.provider = 'In-memory PostgreSQL';
      this.persistent = false;
      this.databaseName = 'coldchain_demo_memory';
      this.sql = await createInMemoryPostgres();
      await this.sql('SELECT 1 AS query_ok');
      this.logger.warn('WARNING: RUNNING WITH NON-PERSISTENT DATABASE. All writes will be lost when the backend restarts.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(connectionString);
    } catch {
      throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
      throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
    }
    if (/your-db|username:password/i.test(connectionString)) {
      throw new Error('DATABASE_URL still contains the example placeholder. Configure a real persistent PostgreSQL URL.');
    }

    this.logger.log('[DB] Connecting to persistent PostgreSQL...');
    this.provider = parsedUrl.hostname.endsWith('.neon.tech') || parsedUrl.hostname === 'neon.tech'
      ? 'Neon PostgreSQL'
      : 'PostgreSQL';
    if (process.env.NODE_ENV === 'production' && this.provider !== 'Neon PostgreSQL') {
      throw new Error('Production DATABASE_URL must point to a Neon PostgreSQL host.');
    }
    this.persistent = true;

    try {
      if (this.provider === 'Neon PostgreSQL' && process.env.NEON_USE_HTTP === 'true') {
        this.sql = neon(connectionString);
      } else {
        const { Pool } = await import('pg');
        const pool = new Pool({
          connectionString,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 30000,
          keepAlive: true,
        });
        pool.on('error', (err: any) => {
          this.logger.warn(`[DB] Idle pool client error: ${err?.message || err}`);
        });
        this.pool = pool;
        this.sql = async (stringsOrQuery: any, ...values: any[]) => {
          if (typeof stringsOrQuery === 'string') {
            const params = values[0] || [];
            const res = await pool.query(stringsOrQuery, params);
            return res.rows;
          }
          let query = '';
          const params: any[] = [];
          for (let i = 0; i < stringsOrQuery.length; i++) {
            query += stringsOrQuery[i];
            if (i < values.length) {
              params.push(values[i]);
              query += '$' + params.length;
            }
          }
          const res = await pool.query(query, params);
          return res.rows;
        };
      }
      const rows = await this.sql('SELECT current_database() AS database_name');
      this.databaseName = rows[0]?.database_name || null;
      if (!this.databaseName) throw new Error('Database connection check returned no database name.');
      this.logger.log(`[DB] Database provider: ${this.provider}`);
      this.logger.log(`[DB] Connection successful (database: ${this.databaseName})`);
    } catch (error: any) {
      this.sql = null;
      this.databaseName = null;
      if (this.pool) {
        await this.pool.end().catch(() => undefined);
        this.pool = null;
      }
      const message = String(error?.message || 'connection failed').replace(connectionString, '[redacted DATABASE_URL]');
      this.logger.error(`[DB] Persistent PostgreSQL connection failed: ${message}`);
      throw new Error(`Could not connect to configured persistent PostgreSQL: ${message}`);
    }
  }

  getSql() {
    return this.sql;
  }

  async onApplicationShutdown() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async getDatabaseHealth() {
    const provider = this.provider;
    const persistent = this.persistent;
    try {
      if (!this.sql) throw new Error('Database query client is not initialized.');
      const rows = await this.sql(persistent
        ? 'SELECT 1 AS query_ok, current_database() AS database_name'
        : 'SELECT 1 AS query_ok');
      return {
        status: persistent ? 'connected' : 'warning',
        provider,
        databaseName: rows[0]?.database_name || this.databaseName,
        querySucceeded: rows[0]?.query_ok === 1 || rows[0]?.query_ok === '1',
        persistent,
        ...(persistent ? {} : { warning: 'WARNING: RUNNING WITH NON-PERSISTENT DATABASE' }),
      };
    } catch (error: any) {
      const message = String(error?.message || 'Database health query failed.');
      this.logger.error(`[DB] Health query failed: ${message}`);
      return {
        status: 'unavailable',
        provider,
        databaseName: this.databaseName,
        querySucceeded: false,
        persistent,
        error: 'Database health query failed.',
      };
    }
  }

  /** Execute fixed statements atomically across the supported PostgreSQL drivers. */
  async runTransaction(statements: SqlTransactionStatement[]): Promise<any[][]> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const results: any[][] = [];
        for (const statement of statements) {
          const result = await client.query(statement.text, statement.values);
          results.push(result.rows);
        }
        await client.query('COMMIT');
        if (process.env.NODE_ENV !== 'production' && process.env.DB_DEBUG_TRANSACTIONS === 'true') {
          this.logger.log('[DB] Transaction committed');
        }
        return results;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    if (typeof this.sql?.transaction === 'function') {
      const queries = statements.map(({ text, values }) => this.toNeonQuery(text, values));
      const results = await this.sql.transaction(queries);
      if (process.env.NODE_ENV !== 'production' && process.env.DB_DEBUG_TRANSACTIONS === 'true') {
        this.logger.log('[DB] Transaction committed');
      }
      return results;
    }
    if (typeof this.sql?.runTransaction === 'function') {
      const results = await this.sql.runTransaction(statements);
      if (process.env.NODE_ENV !== 'production' && process.env.DB_DEBUG_TRANSACTIONS === 'true') {
        this.logger.log('[DB] Transaction committed');
      }
      return results;
    }
    throw new Error('Database transaction support is unavailable.');
  }

  private toNeonQuery(text: string, values: unknown[]) {
    const sqlTag = this.sql;
    const segments: string[] = [];
    const orderedValues: unknown[] = [];
    const pattern = /\$(\d+)/g;
    let previousIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      segments.push(text.slice(previousIndex, match.index));
      orderedValues.push(values[Number(match[1]) - 1]);
      previousIndex = match.index + match[0].length;
    }
    segments.push(text.slice(previousIndex));
    Object.defineProperty(segments, 'raw', { value: [...segments] });
    return sqlTag(segments, ...orderedValues);
  }

  async testPostgres(): Promise<{ success: boolean; result?: any; error?: string }> {
    const health = await this.getDatabaseHealth();
    return health.querySucceeded
      ? { success: true, result: health }
      : { success: false, error: 'PostgreSQL health query failed.' };
  }

  // 2. Neon Object Storage (S3-compatible)
  private initObjectStorage() {
    const endpoint = process.env.AWS_ENDPOINT_URL_S3;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || 'us-east-2';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      this.logger.warn('Neon Object Storage credentials incomplete.');
      return;
    }

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.logger.log('Neon Object Storage client initialized.');
  }

  getS3Client(): S3Client {
    return this.s3Client;
  }

  async testObjectStorage(bucketName = 'assets'): Promise<{ success: boolean; result?: any; error?: string }> {
    const testKey = `healthcheck/test-${Date.now()}.txt`;
    try {
      // 1. Put a test file
      const testBody = `ColdChain Neon Storage Check at ${new Date().toISOString()}`;
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: testKey,
          Body: testBody,
          ContentType: 'text/plain',
        }),
      );

      // 2. List objects in bucket
      const listRes = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          MaxKeys: 10,
        }),
      );

      return {
        success: true,
        result: {
          bucket: bucketName,
          uploadedKey: testKey,
          totalKeysListed: listRes.KeyCount || 0,
          sampleKeys: listRes.Contents?.map((c) => c.Key) || [],
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      // Clean up test file so storage objects do not persist on every check
      try {
        if (this.s3Client) {
          await this.s3Client.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: testKey,
            }),
          );
        }
      } catch (cleanupErr: any) {
        this.logger.warn(`Failed to clean up test object ${testKey}: ${cleanupErr.message}`);
      }
    }
  }

  // 3. Neon Auth (JWKS)
  private initAuth() {
    const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
    if (jwksUrl) {
      try {
        this.jwks = createRemoteJWKSet(new URL(jwksUrl));
        this.logger.log(`Neon Auth JWKS configured with ${jwksUrl}`);
      } catch (err: any) {
        this.logger.error(`Failed to configure Neon Auth JWKS: ${err.message}`);
      }
    }
  }

  async testAuth(): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const authUrl = process.env.NEON_AUTH_BASE_URL;
      const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
      if (!authUrl || !jwksUrl) {
        return { success: false, error: 'NEON_AUTH_BASE_URL or NEON_AUTH_JWKS_URL missing' };
      }

      // Fetch the JWKS endpoint directly to verify reachability and validity
      const response = await fetch(jwksUrl);
      if (!response.ok) {
        throw new Error(`JWKS request failed with status: ${response.status} ${response.statusText}`);
      }
      const jwksData = await response.json();
      if (!Array.isArray(jwksData?.keys) || jwksData.keys.length === 0) {
        throw new Error('JWKS endpoint returned no usable keys');
      }

      return {
        success: true,
        result: {
          authBaseUrl: authUrl,
          jwksUrl,
          keyCount: jwksData.keys.length,
          status: 'reachable',
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // 4. Neon Functions (hello)
  async testFunction(): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const funcBaseUrl = process.env.NEON_FUNCTION_HELLO_BASE_URL;
      if (!funcBaseUrl) {
        return { success: false, error: 'NEON_FUNCTION_HELLO_BASE_URL missing' };
      }

      const res = await fetch(funcBaseUrl);
      if (!res.ok) {
        throw new Error(`Neon Function request failed with status: ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      return {
        success: true,
        result: {
          functionUrl: funcBaseUrl,
          httpStatus: res.status,
          response: text.trim(),
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Test all 4 services end-to-end
  async testAllServices() {
    const postgres = await this.testPostgres();
    const storage = await this.testObjectStorage();
    const auth = await this.testAuth();
    const func = await this.testFunction();

    return {
      timestamp: new Date().toISOString(),
      services: {
        postgres,
        objectStorage: storage,
        neonAuth: auth,
        functions: func,
      },
      allPassed: postgres.success && storage.success && auth.success && func.success,
    };
  }
}
