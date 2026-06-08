/**
 * T-20260606-foot-DASH-STAFFASSIGN-RESET-FIX (REOPEN)
 * save_room_assignments: blanket-DELETE → payload room_name scoped DELETE.
 * 비-payload 방(가열성레이저 등) 보존 → 데이터 무손실. CREATE OR REPLACE(함수 본문만, idempotent).
 * node-pg 직접 연결. 행 수 무변동 가드 + 적용 후 본문/스코프 재검증.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const SQL = readFileSync(
  new URL('../supabase/migrations/20260608140000_save_room_assignments_scoped_delete.sql', import.meta.url),
  'utf8',
);

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd', password: 'bQpgC6tYfXhp@Hr', ssl: { rejectUnauthorized: false },
});

console.log('🚀 save_room_assignments payload-scoped DELETE 적용 (REOPEN)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  const before = await client.query('SELECT count(*)::int AS n FROM room_assignments;');
  console.log('room_assignments 행 수(적용 전):', before.rows[0].n);

  await client.query(SQL);
  console.log('✅ 마이그레이션 적용 완료');

  const after = await client.query('SELECT count(*)::int AS n FROM room_assignments;');
  console.log('room_assignments 행 수(적용 후):', after.rows[0].n);
  if (after.rows[0].n !== before.rows[0].n) {
    console.error('⚠️ 행 수 변동 — 함수 교체만 의도했는데 데이터가 변함. 점검 필요.');
    process.exit(1);
  }

  // 본문 재검증: scoped DELETE(room_name IN ...) 가 들어갔는지
  const fn = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='save_room_assignments' LIMIT 1;`);
  const def = fn.rows[0].def;
  const scoped = /room_name\s+IN\s*\(/i.test(def);
  console.log('payload-scoped DELETE 적용 확인:', scoped ? '✅' : '❌');
  if (!scoped) process.exit(1);

  console.log('✅ 검증 완료 — 데이터 무손실, scoped delete 반영');
} catch (e) {
  console.error('❌ 적용 실패:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
