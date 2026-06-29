/**
 * T-20260602-foot-TZ-AUDIT-FIX — idx_check_ins_clinic_date KST 재구성 (CONCURRENTLY)
 *
 * 적용:  node scripts/apply_20260602250010_tz_checkin_index_kst_concurrent.mjs
 * 롤백:  node scripts/apply_20260602250010_tz_checkin_index_kst_concurrent.mjs --rollback
 *
 * ⚠ CREATE INDEX CONCURRENTLY 는 트랜잭션 밖에서만 가능 → statement 별로 분리 실행.
 *   (단일 멀티-statement query 는 암묵 트랜잭션이 되어 CONCURRENTLY 가 실패함.)
 * non-unique 함수 인덱스 → 중복/제약 위험 없음. 쓰기 락 없음(라이브 무중단).
 */
import pg from 'pg';

const ROLLBACK = process.argv.includes('--rollback');

// statement 단위 분리 (각 statement 가 독립 implicit txn → CONCURRENTLY 가능)
const STEPS_APPLY = [
  `DROP INDEX IF EXISTS idx_check_ins_clinic_date_kst;`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_check_ins_clinic_date_kst
     ON check_ins (clinic_id, kst_date(checked_in_at));`,
  `DROP INDEX IF EXISTS idx_check_ins_clinic_date;`,
  `ALTER INDEX idx_check_ins_clinic_date_kst RENAME TO idx_check_ins_clinic_date;`,
  `COMMENT ON INDEX idx_check_ins_clinic_date IS
     'T-20260602-foot-TZ-AUDIT-FIX: (clinic_id, kst_date(checked_in_at)) — KST 일일경계 쿼리 커버.';`,
];
const STEPS_ROLLBACK = [
  `DROP INDEX IF EXISTS idx_check_ins_clinic_date_utc;`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_check_ins_clinic_date_utc
     ON check_ins (clinic_id, (checked_in_at::date));`,
  `DROP INDEX IF EXISTS idx_check_ins_clinic_date;`,
  `ALTER INDEX idx_check_ins_clinic_date_utc RENAME TO idx_check_ins_clinic_date;`,
];
const STEPS = ROLLBACK ? STEPS_ROLLBACK : STEPS_APPLY;

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })(),
  ssl: { rejectUnauthorized: false },
});

console.log(`🚀 idx_check_ins_clinic_date ${ROLLBACK ? '롤백(UTC)' : 'KST 재구성'} (CONCURRENTLY)`);
try {
  await client.connect();
  for (const [i, stmt] of STEPS.entries()) {
    console.log(`  · step ${i + 1}/${STEPS.length}: ${stmt.trim().split('\n')[0].slice(0, 60)}…`);
    await client.query(stmt);
  }

  // 검증: 인덱스 정의에 kst_date(적용) / checked_in_at::date(롤백) 표현식 확인
  const { rows } = await client.query(`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'check_ins' AND indexname = 'idx_check_ins_clinic_date';
  `);
  if (rows.length !== 1) throw new Error('idx_check_ins_clinic_date 미존재 — 검증 실패');
  const def = rows[0].indexdef;
  const needle = ROLLBACK ? 'checked_in_at)::date' : 'kst_date';
  const ok = def.includes(needle) || (!ROLLBACK && def.includes('kst_date'));
  console.log('🔎 indexdef:', def);
  if (!ok) throw new Error(`인덱스 표현식 검증 실패 (기대: ${needle})`);
  console.log(`✅ idx_check_ins_clinic_date ${ROLLBACK ? '롤백' : 'KST 재구성'} 완료`);
} catch (err) {
  console.error('❌ 오류:', err.message);
  console.error('   (INVALID 잔존 인덱스 의심 시: idx_check_ins_clinic_date_kst 수동 DROP 후 재실행)');
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
