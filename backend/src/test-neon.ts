import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from backend and root
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { neon } from '@neondatabase/serverless';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function runNeonTests() {
  console.log('====================================================');
  console.log('   COLDCHAIN NEON CLOUD SERVICES VERIFICATION SUITE  ');
  console.log('====================================================\n');

  let allPassed = true;

  // 1. Neon Postgres
  console.log('1. Testing Neon Postgres...');
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql('SELECT NOW() as current_time, version() as pg_version, current_database() as database');
    console.log('   [SUCCESS] Connected to Neon Postgres database:', rows[0].database);
    console.log('   Server Time:', rows[0].current_time);
    console.log('   Postgres Version:', String(rows[0].pg_version).split(' ')[0], String(rows[0].pg_version).split(' ')[1]);
  } catch (err: any) {
    console.error('   [FAILED] Neon Postgres error:', err.message || err);
    allPassed = false;
  }

  // 2. Neon Object Storage
  console.log('\n2. Testing Neon Object Storage (S3)...');
  try {
    const s3 = new S3Client({
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      region: process.env.AWS_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });
    const bucket = process.env.S3_BUCKET_NAME || 'assets';
    const testKey = `test-verify-${Date.now()}.txt`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: testKey,
        Body: 'Neon Object Storage end-to-end verification payload',
        ContentType: 'text/plain',
      }),
    );
    console.log(`   [SUCCESS] Uploaded test object "${testKey}" to bucket "${bucket}"`);

    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 5,
      }),
    );
    console.log(`   [SUCCESS] Listed ${list.KeyCount} objects in bucket "${bucket}"`);
  } catch (err: any) {
    console.error('   [FAILED] Neon Object Storage error:', err.message);
    allPassed = false;
  }

  // 3. Neon Auth (JWKS)
  console.log('\n3. Testing Neon Auth JWKS Endpoint...');
  try {
    const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
    if (!jwksUrl) throw new Error('NEON_AUTH_JWKS_URL is missing');
    const resp = await fetch(jwksUrl);
    if (!resp.ok) throw new Error(`HTTP status ${resp.status}`);
    const data = await resp.json();
    console.log('   [SUCCESS] Neon Auth JWKS reachable at:', jwksUrl);
    console.log('   Public Keys count:', Array.isArray(data?.keys) ? data.keys.length : 0);
  } catch (err: any) {
    console.error('   [FAILED] Neon Auth error:', err.message);
    allPassed = false;
  }

  // 4. Neon Functions
  console.log('\n4. Testing Neon Function (hello)...');
  try {
    const funcUrl = process.env.NEON_FUNCTION_HELLO_BASE_URL;
    if (!funcUrl) throw new Error('NEON_FUNCTION_HELLO_BASE_URL is missing');
    const resp = await fetch(funcUrl);
    const body = await resp.text();
    console.log('   [SUCCESS] Neon Function reachable at:', funcUrl);
    console.log('   HTTP Status:', resp.status);
    console.log('   Function Response Payload:', body.trim());
  } catch (err: any) {
    console.error('   [FAILED] Neon Function error:', err.message);
    allPassed = false;
  }

  console.log('\n====================================================');
  if (allPassed) {
    console.log('  ALL NEON SERVICES TESTED AND OPERATIONAL (100% OK) ');
  } else {
    console.log('  SOME NEON SERVICES ENCOUNTERED ERRORS            ');
  }
  console.log('====================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runNeonTests();
