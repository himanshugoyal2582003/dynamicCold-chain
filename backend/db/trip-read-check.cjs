require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const columns = await pool.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='trips' ORDER BY ordinal_position");
    const rows = await pool.query('SELECT id,truck_id,user_id,origin,destination,cargo_type,started_at,ended_at FROM trips ORDER BY started_at DESC NULLS LAST LIMIT 50');
    const trucks = await pool.query('SELECT truck_id,COUNT(*)::int AS count FROM trips WHERE ended_at IS NULL GROUP BY truck_id HAVING COUNT(*)>1');
    const drivers = await pool.query('SELECT user_id,COUNT(*)::int AS count FROM trips WHERE ended_at IS NULL GROUP BY user_id HAVING COUNT(*)>1');
    console.log(JSON.stringify({columns:columns.rows,tripCount:rows.rowCount,trips:rows.rows,duplicateActiveTrucks:trucks.rows,duplicateActiveDrivers:drivers.rows},null,2));
  } finally { await pool.end(); }
})().catch(e => {console.error('TRIP_READ_CHECK_FAILED',String(e.message||e).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]'));process.exit(1)});
