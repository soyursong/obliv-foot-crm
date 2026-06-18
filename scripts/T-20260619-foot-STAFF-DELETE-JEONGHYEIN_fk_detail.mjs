/** T-20260619-foot-STAFF-DELETE-JEONGHYEIN — 참조 레코드 상세 (READ-ONLY) */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const c = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await c.connect();
const T = '5f141f76-7f72-4560-8a67-bbcdf4938cad';

const ra = await c.query(`SELECT * FROM room_assignments WHERE staff_id = $1`, [T]);
console.log('── room_assignments (staff_id 참조) ──');
for (const r of ra.rows) console.log('  ', JSON.stringify(r));

const cu = await c.query(`SELECT id, name, phone FROM customers WHERE assigned_staff_id = $1`, [T]);
console.log('── customers (assigned_staff_id 참조) ──');
for (const r of cu.rows) console.log(`  id=${r.id} name=${r.name} phone=${r.phone}`);

await c.end();
