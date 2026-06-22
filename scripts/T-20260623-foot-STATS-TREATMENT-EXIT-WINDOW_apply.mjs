/**
 * T-20260623-foot-STATS-TREATMENT-EXIT-WINDOW — AC3 적용
 * 20260623130000_foot_therapist_stats_treatment_exit_window.sql 적용.
 * 측정창 종료 = laser 진입 → 치료실 퇴실(from_status='preconditioning'). summary+services 동일창.
 * 절차: (1) 시그니처 확인(불변) → (2) dry-run(BEGIN;apply;ROLLBACK) → (3) 실적용 → (4) 검증(숫자 이동).
 * 재실행 안전: CREATE OR REPLACE + CREATE INDEX IF NOT EXISTS. 롤백 = *.rollback.sql (laser-end 복원).
 * 인자: --apply (없으면 dry-run 까지만).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const DO_APPLY = process.argv.includes('--apply');

let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/);
    if (m) DB_PASSWORD = m[1].trim();
  }
}
if (!DB_PASSWORD) { console.error('❌ SUPABASE_DB_PASSWORD 필요 (.env)'); process.exit(1); }

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

// .GATE_HOLD 게이트 박제 상태에서도 dry-run 가능하도록 경로 자동 해석.
// AC4+AC5 통과 후 실적용 시 .GATE_HOLD 접미사 제거 → 정상 .sql 로 커밋.
const MIG_BASE = 'supabase/migrations/20260623130000_foot_therapist_stats_treatment_exit_window.sql';
const MIG_PATH = fs.existsSync(MIG_BASE) ? MIG_BASE
              : fs.existsSync(MIG_BASE + '.GATE_HOLD') ? MIG_BASE + '.GATE_HOLD'
              : (() => { console.error('❌ 마이그 파일 없음:', MIG_BASE); process.exit(1); })();
console.log('📄 마이그:', MIG_PATH);
const SQL = fs.readFileSync(MIG_PATH, 'utf8');

async function sig(label) {
  const { rows } = await client.query(`
    SELECT p.proname, pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('foot_stats_therapist_summary','foot_stats_therapist_services')
    ORDER BY p.proname;`);
  for (const r of rows) console.log(`[${label}] ${r.proname}: ${r.result.replace(/\s+/g,' ').slice(0,90)}...`);
}

async function smoke(label) {
  // 전 클리닉·전 기간 합산 — 측정창 이동(평균 상승) 확인 + 무결성(designated<=total).
  const { rows } = await client.query(`
    SELECT
      COALESCE(SUM(s.treatment_count),0)               AS treat_cnt,
      ROUND(AVG(s.avg_treatment_minutes),1)            AS avg_min,
      COALESCE(SUM(s.designated_count),0)              AS desig,
      COALESCE(SUM(s.total_checkin_count),0)           AS total,
      COUNT(*) FILTER (WHERE s.designated_count > s.total_checkin_count) AS integ_bad
    FROM clinics cl
    CROSS JOIN LATERAL foot_stats_therapist_summary(cl.id, DATE '2026-01-01', now()::date) s;`);
  const r = rows[0];
  console.log(`[${label}] summary 전기간: treat=${r.treat_cnt} avg_min=${r.avg_min} desig=${r.desig}/${r.total} integ_bad=${r.integ_bad}`);
  if (Number(r.integ_bad) > 0) throw new Error('무결성 위반: designated_count > total_checkin_count');

  const { rows: svc } = await client.query(`
    SELECT COUNT(*) AS row_cnt, COALESCE(SUM(s.linked_count),0) AS linked
    FROM clinics cl
    CROSS JOIN LATERAL foot_stats_therapist_services(cl.id, DATE '2026-01-01', now()::date) s;`);
  console.log(`[${label}] services 전기간: rows=${svc[0].row_cnt} linked=${svc[0].linked}`);
}

try {
  await client.connect();
  console.log('✅ DB 연결 성공\n');

  await sig('적용 전');
  await smoke('적용 전(laser-end)');

  // (2) dry-run
  console.log('\n── dry-run (BEGIN; apply; ROLLBACK) ──');
  await client.query('BEGIN');
  await client.query(SQL.replace(/^BEGIN;|^COMMIT;$/gm, ''));
  await sig('dry-run');
  await smoke('dry-run(treatment-exit)');
  await client.query('ROLLBACK');
  await smoke('dry-run 롤백 후(laser-end 원복 확인)');

  if (!DO_APPLY) {
    console.log('\n⏸️  dry-run 까지만. 실적용은 --apply 플래그.');
    process.exit(0);
  }

  // (3) 실적용
  console.log('\n── 실적용 (COMMIT) ──');
  await client.query(SQL);
  await sig('적용 후');
  await smoke('적용 후(treatment-exit)');
  console.log('\n✅ 적용 완료 — 측정창 종료기준 = 치료실 퇴실(from_status=preconditioning)');
} catch (e) {
  console.error('❌', e.message);
  try { await client.query('ROLLBACK'); } catch {}
  process.exit(1);
} finally {
  await client.end();
}
