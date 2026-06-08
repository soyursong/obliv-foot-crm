/**
 * T-20260609-foot-DRUG-INSURANCE-GATE Phase1 — prescription_codes 급여여부 컬럼 3개 추가
 *
 *   ALTER TABLE prescription_codes ADD COLUMN IF NOT EXISTS insurance_status            TEXT CHECK (...);
 *   ALTER TABLE prescription_codes ADD COLUMN IF NOT EXISTS insurance_status_updated_at TIMESTAMPTZ;
 *   ALTER TABLE prescription_codes ADD COLUMN IF NOT EXISTS insurance_status_source     TEXT CHECK (...);
 *
 * additive · backward-compatible (기본 NULL → 기존 row·집계·게이트 무영향, NULL=게이트 통과). 멱등(재실행 안전).
 * supabase/migrations/20260609140000_prescription_codes_insurance_status.sql 와 동일.
 *
 * 실행 모드:
 *   node scripts/apply_20260609140000_prescription_codes_insurance_status.mjs --dry-run   # 컬럼 존재 여부 SELECT only
 *   node scripts/apply_20260609140000_prescription_codes_insurance_status.mjs --apply      # ADD COLUMN 적용
 *
 * 롤백: supabase/migrations/20260609140000_prescription_codes_insurance_status.rollback.sql
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

const COLS = ['insurance_status', 'insurance_status_updated_at', 'insurance_status_source'];
const COL_CHECK = `
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name='prescription_codes' AND column_name = ANY($1::text[])
ORDER BY column_name;`;

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE: insurance_status 컬럼 존재 여부 ──');
  const before = await client.query(COL_CHECK, [COLS]);
  console.table(before.rows);
  console.log(`▶ 존재 컬럼 수 = ${before.rowCount} / 3`);

  if (MODE === 'dry-run') {
    console.log('\n🟡 dry-run 종료 (변경 없음).');
    await client.end();
    process.exit(0);
  }

  console.log('\n── APPLY: ADD COLUMN (additive, 기본 NULL) ──');
  await client.query('BEGIN');
  await client.query(`
    ALTER TABLE public.prescription_codes
      ADD COLUMN IF NOT EXISTS insurance_status TEXT
        CHECK (insurance_status IN ('covered','non_covered','deleted','criteria_changed')),
      ADD COLUMN IF NOT EXISTS insurance_status_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS insurance_status_source TEXT
        CHECK (insurance_status_source IN ('manual','hira'));`);
  await client.query(`COMMENT ON COLUMN public.prescription_codes.insurance_status IS 'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태: covered/non_covered/deleted/criteria_changed. NULL=미설정(게이트 통과=fail-open degrade).';`);
  await client.query(`COMMENT ON COLUMN public.prescription_codes.insurance_status_updated_at IS 'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태 마지막 변경 시각.';`);
  await client.query(`COMMENT ON COLUMN public.prescription_codes.insurance_status_source IS 'T-20260609-foot-DRUG-INSURANCE-GATE 급여상태 출처: manual/hira. Phase1=전부 manual.';`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_prescription_codes_insurance_status ON public.prescription_codes (insurance_status) WHERE insurance_status IS NOT NULL;`);
  await client.query('COMMIT');
  console.log('✅ COMMIT 완료');

  console.log('\n── AFTER: insurance_status 컬럼 검증 ──');
  const after = await client.query(COL_CHECK, [COLS]);
  console.table(after.rows);
  console.log(`▶ 존재 컬럼 수 = ${after.rowCount} / 3  (기대: 3)`);

  // 기존 row 무영향 확인 (전부 NULL 기본값)
  const sample = await client.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE insurance_status IS NULL) AS null_status FROM prescription_codes;`);
  console.log('▶ 기존 prescription_codes row (insurance_status NULL 기본값 확인):', sample.rows[0]);

  await client.end();
  console.log('\n🟢 done.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
