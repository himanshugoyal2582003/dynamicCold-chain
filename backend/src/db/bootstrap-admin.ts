import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });

async function bootstrapAdmin() {
  const connectionString = process.env.DATABASE_URL;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!connectionString || !name || !email || !password) {
    throw new Error('DATABASE_URL and BOOTSTRAP_ADMIN_NAME/EMAIL/PASSWORD are required.');
  }
  if (password.length < 14) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters.');
  }

  const sql = neon(connectionString);
  const admins = await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`;
  if (admins.length) {
    throw new Error('Bootstrap refused: an administrator already exists.');
  }

  const duplicate = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (duplicate.length) {
    throw new Error('Bootstrap refused: this email is already in use.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await sql`
    INSERT INTO users (name, email, password_hash, role, active)
    VALUES (${name}, ${email}, ${passwordHash}, 'admin', true)
  `;
  console.log('Initial administrator created. Remove BOOTSTRAP_ADMIN_* environment variables now.');
}

bootstrapAdmin().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Administrator bootstrap failed.');
  process.exit(1);
});
