import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host:'aws-1-ap-southeast-1.pooler.supabase.com', port:5432, database:'postgres', user:'postgres.rxlomoozakkjesdqjtvd', password:DB_PASSWORD, ssl:{rejectUnauthorized:false} });
await client.connect();
const ciId = 'f0805c8f-82ef-46f3-b9e5-3361f8d9692d';
const ci = await client.query(`SELECT id, customer_id, customer_name, visit_type, status, checked_in_at FROM check_ins WHERE id=$1;`, [ciId]);
console.log('── check_in row ──'); console.table(ci.rows);
const cid = ci.rows[0]?.customer_id;
if (cid) {
  const cust = await client.query(`SELECT id, name, phone, chart_number, created_at, lead_source FROM customers WHERE id=$1;`, [cid]);
  console.log('── customer row ──'); console.table(cust.rows);
  const allCi = await client.query(`SELECT id, customer_name, status, checked_in_at FROM check_ins WHERE customer_id=$1 ORDER BY checked_in_at;`, [cid]);
  console.log(`── 이 customer_id 의 모든 check_ins (${allCi.rows.length}) ──`); console.table(allCi.rows);
  const allResv = await client.query(`SELECT id, customer_name, reservation_date, status FROM reservations WHERE customer_id=$1 ORDER BY reservation_date;`, [cid]);
  console.log(`── 이 customer_id 의 모든 reservations (${allResv.rows.length}) ──`); console.table(allResv.rows);
}
// '고양이' / '초진환자1' 이름 가진 다른 customers 있는지
const named = await client.query(`SELECT id, name, phone, chart_number FROM customers WHERE name IN ('고양이','초진환자1') ORDER BY name;`);
console.log('── name=고양이 또는 초진환자1 인 customers ──'); console.table(named.rows);
await client.end();
