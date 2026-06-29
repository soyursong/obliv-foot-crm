/**
 * T-20260601-foot-SPACE-ASSIGN-RESET-REGRESS (REOPEN-3)
 * save_room_assignments: 미배정(null staff) 방도 명시 INSERT 하도록 WHERE 제거.
 * CREATE OR REPLACE 함수 본문만 교체 (additive, idempotent). 데이터 변경/삭제 없음.
 * node-pg 직접 연결.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const SQL = readFileSync(
  new URL('../supabase/migrations/20260601160000_save_room_assignments_include_unassigned.sql', import.meta.url),
  'utf8',
);

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 save_room_assignments WHERE 제거 적용 (REOPEN-3)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  // 사전 데이터 스냅샷 (변경/삭제 없음 확인용)
  const before = await client.query('SELECT count(*)::int AS n FROM room_assignments;');
  console.log('room_assignments 행 수(적용 전):', before.rows[0].n);

  await client.query(SQL);
  console.log('✅ 마이그레이션 적용 완료');

  const after = await client.query('SELECT count(*)::int AS n FROM room_assignments;');
  console.log('room_assignments 행 수(적용 후):', after.rows[0].n);
  if (after.rows[0].n !== before.rows[0].n) {
    console.error('⚠️ 행 수 변동 감지 — 함수 교체만 의도했는데 데이터가 변했습니다. 점검 필요.');
  } else {
    console.log('✅ 데이터 무손실 확인 (행 수 동일)');
  }

  // 검증: 함수 정의에 WHERE NULLIF(...) IS NOT NULL 이 더 이상 없는지
  const fn = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p WHERE p.proname='save_room_assignments';
  `);
  const def = fn.rows[0]?.def ?? '';
  const hasWhere = /NULLIF\(x\.staff_id,\s*''\)\s+IS NOT NULL/i.test(def);
  console.log(hasWhere ? '❌ WHERE 조건 잔존 — 교체 실패' : '✅ WHERE 조건 제거 확인');
  if (hasWhere) process.exit(1);

  console.log('\n✅ 적용 + 검증 완료');
} catch (e) {
  console.error('❌ 실패:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
