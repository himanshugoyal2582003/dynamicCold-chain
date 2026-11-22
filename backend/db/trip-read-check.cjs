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
    const statusCounts = await pool.query('SELECT status,COUNT(*)::int AS count FROM trips GROUP BY status ORDER BY status');
    const byTruck = await pool.query(`SELECT t.plate_number, COUNT(tr.id)::int AS trip_count,
      COUNT(*) FILTER (WHERE tr.status='IN_PROGRESS')::int AS in_progress,
      COUNT(*) FILTER (WHERE tr.status='COMPLETED')::int AS completed,
      COUNT(*) FILTER (WHERE tr.user_id=driver.id)::int AS assigned_driver_trips
      FROM trucks t LEFT JOIN trips tr ON tr.truck_id=t.id
      LEFT JOIN users driver ON driver.truck_id=t.id AND driver.role='truckUser' AND driver.active=true
      GROUP BY t.id,t.plate_number ORDER BY t.plate_number`);
    const migrations = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename');
    console.log(JSON.stringify({columns:columns.rows,tripCount:rows.rowCount,trips:rows.rows,statusCounts:statusCounts.rows,tripsByTruck:byTruck.rows,duplicateActiveTrucks:trucks.rows,duplicateActiveDrivers:drivers.rows,migrations:migrations.rows.map(x=>x.filename)},null,2));
  } finally { await pool.end(); }
})().catch(e => {console.error('TRIP_READ_CHECK_FAILED',String(e.message||e).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]'));process.exit(1)});
