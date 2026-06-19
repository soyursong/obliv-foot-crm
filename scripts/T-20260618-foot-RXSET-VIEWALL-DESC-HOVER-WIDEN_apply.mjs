/**
 * T-20260618-foot-RXSET-VIEWALL-DESC-HOVER-WIDEN (Part C) — APPLY (영속)
 * dev-foot 직접 DB 적용 (pg 직접 연결, 'dev-foot DB 마이그레이션 직접 실행' 메모리 정책).
 * ADDITIVE: prescription_codes.description TEXT 컬럼 1개 추가(IF NOT EXISTS).
 *   1) dry-run: 적용 전 컬럼 부재 확인
 *   2) APPLY: 마이그 실행
 *   3) 별도 연결로 영속 검증(컬럼 존재 + is_nullable=YES + data_type=text)
 * rollback: supabase/migrations/20260618130000_prescription_codes_description.rollback.sql
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
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260618130000_prescription_codes_description.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const qCol = `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='prescription_codes' AND column_name='description'`;

// ── 0) dry-run: 컬럼 부재 확인 ──
const c0 = conn();
await c0.connect();
console.log(`✅ DB 연결 (dry-run)  ${new Date().toISOString()}`);
const before = (await c0.query(qCol)).rows;
console.log(`── dry-run: prescription_codes.description ${before.length === 0 ? '부재(기대대로)' : '이미 존재(IF NOT EXISTS 멱등)'} ──`);
await c0.end();

// ── 1) APPLY ──
const c1 = conn();
await c1.connect();
console.log(`\n✅ DB 연결 (APPLY)`);
try {
  await c1.query(sql);
  console.log('✅ 마이그 실행 완료.');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  await c1.end();
  process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn();
await c2.connect();
const after = (await c2.query(qCol)).rows;
await c2.end();

let pass = true;
const chk = (n, v) => { console.log(`  ${v ? '✅' : '❌'} ${n}`); if (!v) pass = false; };
console.log('\n── 영속 검증 (신규 연결) ──');
const col = after[0];
chk('description 컬럼 존재', !!col);
chk('data_type = text', col?.data_type === 'text');
chk('is_nullable = YES (ADDITIVE, NULL 허용)', col?.is_nullable === 'YES');

console.log(`\n${pass ? '✅ APPLY + 영속검증 PASS' : '❌ 영속검증 FAIL'}`);
process.exit(pass ? 0 : 1);
