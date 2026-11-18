import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createInMemoryPostgres } from './memory-db';

@Injectable()
export class NeonService implements OnModuleInit {
  private readonly logger = new Logger(NeonService.name);
  private sql: any = null;
  private s3Client: S3Client;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  async onModuleInit() {
    await this.initPostgres();
    this.initObjectStorage();
    this.initAuth();
  }

  // 1. Neon Postgres
  private async initPostgres() {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString && !connectionString.includes('your-db') && connectionString.startsWith('postgres')) {
      if (connectionString.includes('neon.tech')) {
        this.sql = neon(connectionString);
        this.logger.log('Neon Postgres serverless driver initialized.');
      } else {
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString });
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
        this.logger.log('Local/Remote Postgres driver connected via pg.Pool.');
      }
    } else {
      this.logger.log('DATABASE_URL not configured. Initializing embedded Postgres with demo seed data...');
      this.sql = await createInMemoryPostgres();
      this.logger.log('Embedded in-memory Postgres initialized and seeded with demo accounts.');
    }
  }

  getSql() {
    return this.sql;
  }

  async testPostgres(): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      if (!this.sql) {
        throw new Error('Neon Postgres client is not initialized');
      }
      const rows = await this.sql('SELECT NOW() as current_time, version() as pg_version, current_database() as database');
      return {
        success: true,
        result: rows[0],
      };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
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
