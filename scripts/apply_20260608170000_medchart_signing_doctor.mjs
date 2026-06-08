/**
 * T-20260608-foot-MEDCHART-SIGN-AUDIT (Phase 2) — 진료기록 진료의 귀속 + 변경이력 audit + 신규행 강제
 *
 *   ① medical_charts.signing_doctor_{id,name,seal_url} 컬럼 추가(전부 nullable — 레거시 면제)
 *   ② medical_chart_signer_audit 테이블 생성(append-only, RLS)
 *   ③ enforce_medchart_signing_doctor 트리거(신규/수정행 NOT NULL 강제, 레거시 면제)
 *
 * additive · backward-compatible (nullable 컬럼/신규 테이블/트리거, 기존 레거시 행 무영향). 멱등(IF NOT EXISTS).
 * supabase/migrations/20260608170000_medchart_signing_doctor.sql 와 동일(SQL이 자체 BEGIN/COMMIT 포함).
 *
 * 실행 모드:
 *   node scripts/apply_20260608170000_medchart_signing_doctor.mjs --dry-run   # 현재 적용 여부만 확인
 *   node scripts/apply_20260608170000_medchart_signing_doctor.mjs --apply      # 적용
 *
 * 롤백: supabase/migrations/20260608170000_medchart_signing_doctor.rollback.sql
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

const client = new Client({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 5432, database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

const COL_CHECK = `
  SELECT column_name FROM information_schema.columns
  WHERE table_name='medical_charts'
    AND column_name IN ('signing_doctor_id','signing_doctor_name','signing_doctor_seal_url')
  ORDER BY column_name;`;
const TBL_CHECK = `SELECT to_regclass('public.medical_chart_signer_audit') AS tbl;`;

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE ──');
  const colB = await client.query(COL_CHECK);
  console.log('▶ medical_charts signing_doctor 컬럼:', colB.rows.map((r) => r.column_name).join(', ') || '(없음)');
  const tblB = await client.query(TBL_CHECK);
  console.log('▶ medical_chart_signer_audit =', tblB.rows[0].tbl);

  if (MODE === 'dry-run') {
    console.log('\n🟡 dry-run 종료 (변경 없음).');
    await client.end();
    process.exit(0);
  }

  console.log('\n── APPLY: 컬럼 + audit 테이블 + 트리거 (SQL 자체 BEGIN/COMMIT) ──');
  const sql = fs.readFileSync('supabase/migrations/20260608170000_medchart_signing_doctor.sql', 'utf8');
  await client.query(sql);
  console.log('✅ 적용 완료');

  console.log('\n── AFTER: 검증 ──');
  const colA = await client.query(COL_CHECK);
  console.log('▶ medical_charts signing_doctor 컬럼:', colA.rows.map((r) => r.column_name).join(', '),
              '(기대: signing_doctor_id, signing_doctor_name, signing_doctor_seal_url)');
  const tblA = await client.query(TBL_CHECK);
  console.log('▶ medical_chart_signer_audit =', tblA.rows[0].tbl, '(기대: public.medical_chart_signer_audit)');
  const trg = await client.query(`
    SELECT tgname FROM pg_trigger WHERE tgname='trg_enforce_medchart_signing_doctor';`);
  console.log('▶ 트리거:', trg.rows.map((r) => r.tgname).join(', ') || '(없음)');

  await client.end();
  console.log('\n🟢 done.');
} catch (e) {
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
