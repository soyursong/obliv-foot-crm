/**
 * T-20260622-foot-SALES-STATS-TAB-EXPORT-LEADREVENUE — APPLY (영속)
 * foot_stats_consultant 에 total_amount 반환 컬럼 추가 (ADDITIVE).
 * dev-foot 직접 DB 적용. 파일 내 BEGIN/COMMIT. 실패 시 *.rollback.sql 로 복구.
 * 적용 후 별도 연결로 함수 시그니처 + 실데이터 1건 dry-run 검증.
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

const migPath = 'supabase/migrations/20260622210000_foot_stats_consultant_total_amount.sql';
const sql = fs.readFileSync(migPath, 'utf8');

const sigQ = `SELECT pg_get_function_result(oid) AS result_def
  FROM pg_proc WHERE proname='foot_stats_consultant' AND pronamespace='public'::regnamespace`;

// ── 1) APPLY ──
const c1 = conn(); await c1.connect();
console.log(`✅ DB 연결 (APPLY)  ${new Date().toISOString()}`);
try {
  const before = await c1.query(sigQ);
  console.log('── before result_def ──\n', (before.rows[0]?.result_def || '(없음)').replace(/\s+/g, ' '));
  await c1.query(sql);
  console.log('✅ 마이그 실행 완료 (COMMIT).');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message); await c1.end(); process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 영속 검증 + 실데이터 dry-run ──
const c2 = conn(); await c2.connect();
const after = await c2.query(sigQ);
const resultDef = (after.rows[0]?.result_def || '').replace(/\s+/g, ' ');
console.log('\n── after result_def ──\n', resultDef);
const hasTotal = /total_amount\s+bigint/i.test(resultDef);
console.log(hasTotal ? '✅ total_amount 컬럼 확인' : '❌ total_amount 누락');

// 실데이터 dry-run: 종로점 clinic 1곳, 이번 달
try {
  const clinics = await c2.query(`SELECT id, name FROM clinics LIMIT 1`);
  if (clinics.rows.length) {
    const cid = clinics.rows[0].id;
    const r = await c2.query(
      `SELECT name, ticketing_count, avg_amount, total_amount,
              CASE WHEN ticketing_count>0 THEN ROUND(total_amount::numeric/ticketing_count) ELSE 0 END AS derived_avg
       FROM foot_stats_consultant($1, date_trunc('month', now())::date, now()::date)`,
      [cid]);
    console.log(`\n── dry-run (clinic=${clinics.rows[0].name}, 이번 달) rows=${r.rows.length} ──`);
    for (const row of r.rows) {
      const match = String(row.avg_amount) === String(row.derived_avg) ? 'avg≈매출/건수 ✓' : `avg≠ (avg=${row.avg_amount} vs 매출/건수=${row.derived_avg})`;
      console.log(`  ${row.name}: 매출=${row.total_amount} 상담건수=${row.ticketing_count} 객단가=${row.avg_amount} [${match}]`);
    }
  }
} catch (e) {
  console.error('⚠ dry-run 조회 오류(비치명):', e.message);
}
await c2.end();
console.log('\n✅ 완료');
