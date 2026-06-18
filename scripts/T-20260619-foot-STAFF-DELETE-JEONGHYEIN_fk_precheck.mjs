/**
 * T-20260619-foot-STAFF-DELETE-JEONGHYEIN — PROD READ-ONLY FK precheck (재확인)
 * 정혜인 staff row 단건 특정 + staff 참조 모든 FK 동적 순회 count.
 * 쓰기 없음 (SELECT only). hard-delete 게이트 선조사.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const client = new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`PROD 연결 (READ-ONLY) ${new Date().toISOString()}\n`);

// (1) 정혜인 staff 단건 특정 (동명이인 가드: name='정혜인' 전수)
const cand = await client.query(
  `SELECT id, clinic_id, name, role, active, created_at FROM staff WHERE name = '정혜인'`);
console.log(`── (1) name='정혜인' staff 후보 ${cand.rowCount}건 ──`);
for (const r of cand.rows) {
  console.log(`  id=${r.id} clinic=${r.clinic_id} role=${r.role} active=${r.active} created=${r.created_at?.toISOString?.()||r.created_at}`);
}
console.log('');

if (cand.rowCount !== 1) {
  console.log(`⚠️ 단건 특정 실패 (matched=${cand.rowCount}). 동명이인/부재 가능 → 게이트 재확인 필요.`);
}

const target = cand.rowCount >= 1 ? cand.rows[0].id : '5f141f76-7f72-4560-8a67-bbcdf4938cad';

// (2) staff 를 참조하는 모든 FK 동적 순회 + 대상 id 참조 count
const fks = await client.query(`
  SELECT rel.relname AS child_table, att.attname AS child_col, con.confdeltype AS del_action
  FROM pg_constraint con
  JOIN pg_class rel  ON rel.oid  = con.conrelid
  JOIN pg_class frel ON frel.oid = con.confrelid
  JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
  WHERE con.contype = 'f' AND frel.relname = 'staff' AND frel.relnamespace = 'public'::regnamespace
  ORDER BY rel.relname, att.attname`);
console.log(`── (2) staff 참조 FK ${fks.rowCount}개 — 대상 id=${target} 참조 count ──`);
let total = 0;
const detail = [];
for (const fk of fks.rows) {
  const c = await client.query(
    `SELECT count(*)::int AS n FROM public.${fk.child_table} WHERE ${fk.child_col} = $1`, [target]);
  const n = c.rows[0].n;
  const act = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[fk.del_action] || fk.del_action;
  if (n > 0) { total += n; detail.push(`${fk.child_table}.${fk.child_col}=${n} [${act}]`); }
  console.log(`  ${fk.child_table}.${fk.child_col} [${act}]: ${n}`);
}
console.log('');
console.log(`── 판정 ── 참조 총 ${total}건`);
if (total === 0) {
  console.log('✅ 귀속 0건 → hard-delete GO 가능 (백업 + 단건 DELETE 마이그).');
} else {
  console.log(`⛔ 귀속 ${total}건 잔존 → hard-delete 보류. 상세: ${detail.join(' | ')}`);
}

await client.end();
