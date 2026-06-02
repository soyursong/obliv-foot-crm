/**
 * T-20260602-foot-SELFCHECKIN-DUP-GUARD — idx_checkins_walkin_daily UNIQUE index 적용
 *
 * ⛔⛔ GO_WARN 게이트 — dedupe 사전조사·정리 완료 전 실행 금지 ⛔⛔
 *    본 스크립트는 안전장치로 "선행 중복 검사"를 내장한다:
 *      → 활성 중복 그룹이 1개라도 있으면 index 생성을 시도하지 않고 ABORT(중복 목록 출력).
 *    실행 순서:
 *      1) scripts/dedupe_checkins_walkin_daily_dryrun.sql 로 중복 조사(READ-ONLY)
 *      2) 대표/총괄 행별 confirm → 정리(cancelled/삭제)
 *      3) 본 스크립트 실행 → pre-check 0건 통과 시에만 index 생성
 *    supervisor 단독 게이트. dev-foot 은 생성만, 실행은 supervisor.
 *
 * 적용: node scripts/apply_20260602200010_checkins_walkin_daily_unique.mjs
 * 롤백: supabase/migrations/20260602200010_checkins_walkin_daily_unique.rollback.sql
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  join(__dirname, '../supabase/migrations/20260602200010_checkins_walkin_daily_unique.sql'),
  'utf8',
);

const client = new pg.Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: 'bQpgC6tYfXhp@Hr',
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 idx_checkins_walkin_daily 적용 (GO_WARN 게이트, pre-check 내장)');
try {
  await client.connect();

  // ── 안전장치: 선행 중복 검사 (0 이어야 진행) ──
  const { rows: dup } = await client.query(`
    SELECT clinic_id, customer_id,
           (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_day,
           count(*) AS n
    FROM public.check_ins
    WHERE status NOT IN ('cancelled') AND customer_id IS NOT NULL
    GROUP BY clinic_id, customer_id, (created_at AT TIME ZONE 'Asia/Seoul')::date
    HAVING count(*) > 1
    ORDER BY n DESC;
  `);

  if (dup.length > 0) {
    console.error(`🛑 ABORT — 활성 중복 그룹 ${dup.length}개 존재. index 생성 불가.`);
    console.error('   dedupe_checkins_walkin_daily_dryrun.sql 로 조사 후 사람 confirm → 정리 → 재실행.');
    console.error('   위반 그룹(상위 일부):', JSON.stringify(dup.slice(0, 10)));
    process.exitCode = 1;
    return;
  }

  console.log('✅ pre-check 통과 (활성 중복 0건) → index 생성 진행');
  await client.query(SQL);

  const { rows } = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'check_ins' AND indexname = 'idx_checkins_walkin_daily';
  `);
  console.log('🔎 검증:', JSON.stringify(rows));
  if (rows.length !== 1) throw new Error('index 가 생성되지 않음 — 검증 실패');
  console.log('✅ idx_checkins_walkin_daily 생성 완료');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
