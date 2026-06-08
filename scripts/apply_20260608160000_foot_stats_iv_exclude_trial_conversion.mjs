/**
 * T-20260608-foot-TICKET-DEDUCT-SLOT-DATA (AC1 + AC3) — 통계 RPC 2종 교체 적용/검증
 *
 *   AC1) foot_stats_by_category       : 회차 소진 집계에서 수액(session_type='iv') 제외.
 *   AC3) foot_stats_therapist_summary : 체험→결제 전환을 '당일 전환'(contract_date = 체험 내원일)만 인정.
 *
 *   ※ 차감 항목 선택 UI 4곳·차감 이력·마스터데이터 무변경 (통계 집계 레이어만 손댐).
 *
 * 실행 모드:
 *   node scripts/apply_20260608160000_foot_stats_iv_exclude_trial_conversion.mjs --dry-run
 *     → BEGIN; (마이그 SQL); ROLLBACK;  : 함수 본문 파싱·교체 유효성만 검증, 영속 변경 0.
 *   node scripts/apply_20260608160000_foot_stats_iv_exclude_trial_conversion.mjs --apply
 *     → 마이그 SQL COMMIT. ⚠️ supervisor 마이그 게이트 GO 후에만 사용.
 *
 * node-pg pooler 직접 연결. CREATE OR REPLACE FUNCTION 멱등(재실행 안전).
 * supabase/migrations/20260608160000_foot_stats_iv_exclude_trial_conversion.sql 와 동일.
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

const MIG = 'supabase/migrations/20260608160000_foot_stats_iv_exclude_trial_conversion.sql';
// 마이그 본문은 BEGIN/COMMIT 을 포함하므로, dry-run 시엔 그 래퍼를 떼고 우리가 직접 BEGIN/ROLLBACK.
const raw = fs.readFileSync(MIG, 'utf8');
const inner = raw
  .replace(/^\s*BEGIN;\s*$/m, '')
  .replace(/^\s*COMMIT;\s*$/m, '');

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// 교체 후 함수가 호출 가능한지 검증하는 스모크 (clinic 1개 잡아 RPC 1회씩 호출)
const SMOKE = `
WITH c AS (SELECT id FROM clinics LIMIT 1)
SELECT
  (SELECT COUNT(*) FROM foot_stats_by_category((SELECT id FROM c), CURRENT_DATE - 30, CURRENT_DATE)) AS by_category_rows,
  (SELECT COUNT(*) FROM foot_stats_therapist_summary((SELECT id FROM c), CURRENT_DATE - 30, CURRENT_DATE)) AS therapist_rows,
  (SELECT COUNT(*) FROM foot_stats_by_category((SELECT id FROM c), CURRENT_DATE - 30, CURRENT_DATE) WHERE category = 'iv') AS iv_rows_should_be_0;
`;

(async () => {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(inner);
    const r = await client.query(SMOKE);
    console.log('스모크 결과:', r.rows[0]);
    if (Number(r.rows[0].iv_rows_should_be_0) !== 0) {
      throw new Error(`AC1 위반: by_category 에 iv 행이 ${r.rows[0].iv_rows_should_be_0}건 남음`);
    }
    if (MODE === 'apply') {
      await client.query('COMMIT');
      console.log('✅ --apply: 함수 교체 COMMIT 완료.');
    } else {
      await client.query('ROLLBACK');
      console.log('✅ --dry-run: 함수 교체 파싱·호출·AC1(iv=0) 검증 통과. ROLLBACK (영속 변경 없음).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ 실패:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
