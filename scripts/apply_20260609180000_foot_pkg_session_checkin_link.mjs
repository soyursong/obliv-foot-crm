/**
 * T-20260609-foot-PKGSESS-CHECKIN-LINK — check_in_id 컬럼 멱등 보강 + 통계 RPC 2종 정밀화 적용/검증
 *
 *   AC1) package_sessions.check_in_id (이미 존재 → ADD COLUMN IF NOT EXISTS no-op) + idx 보강.
 *   AC3) foot_stats_therapist_summary / _services : A↔B 매칭에 check_in_id 정확매칭 우선 + 근사 fallback.
 *
 * 실행 모드:
 *   node scripts/apply_20260609180000_foot_pkg_session_checkin_link.mjs --dry-run
 *     → BEGIN; (마이그 SQL); ROLLBACK;  : 파싱·RPC 호출 가능성만 검증, 영속 변경 0.
 *   node scripts/apply_20260609180000_foot_pkg_session_checkin_link.mjs --apply
 *     → COMMIT. ⚠️ supervisor 마이그 게이트(db_change=true) GO 후에만 사용.
 *
 * node-pg pooler 직접 연결. ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE = 멱등(재실행 안전).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const MODE = process.argv.includes('--apply') ? 'apply'
           : process.argv.includes('--dry-run') ? 'dry-run'
           : null;
if (!MODE) { console.error('❌ --dry-run 또는 --apply 필요'); process.exit(1); }

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const MIG = 'supabase/migrations/20260609180000_foot_pkg_session_checkin_link.sql';
const raw = fs.readFileSync(MIG, 'utf8');
const inner = raw
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// 교체 후 함수가 호출 가능한지 + check_in_id 컬럼 존재 검증.
const SMOKE = `
WITH c AS (SELECT id FROM clinics LIMIT 1)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name='package_sessions' AND column_name='check_in_id') AS has_checkin_col,
  (SELECT COUNT(*) FROM foot_stats_therapist_summary((SELECT id FROM c), CURRENT_DATE - 60, CURRENT_DATE))  AS summary_rows,
  (SELECT COUNT(*) FROM foot_stats_therapist_services((SELECT id FROM c), CURRENT_DATE - 60, CURRENT_DATE)) AS services_rows;
`;

(async () => {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(inner);
    const r = await client.query(SMOKE);
    console.log('스모크 결과:', r.rows[0]);
    if (Number(r.rows[0].has_checkin_col) !== 1) {
      throw new Error('AC1 위반: package_sessions.check_in_id 컬럼 부재');
    }
    if (MODE === 'apply') {
      await client.query('COMMIT');
      console.log('✅ --apply: 마이그 COMMIT 완료.');
    } else {
      await client.query('ROLLBACK');
      console.log('✅ --dry-run: 파싱·RPC 호출·check_in_id 컬럼 검증 통과. ROLLBACK (영속 변경 없음).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
