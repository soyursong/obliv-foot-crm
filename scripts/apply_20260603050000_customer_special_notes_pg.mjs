/**
 * T-20260603-foot-CHART-SPECIAL-NOTE — 특이사항 공용 누적칸 테이블 적용 (AC-1)
 *   customer_special_notes: 환자 단위 특이사항 공용 누적(append) + 기록자/작성일시.
 *   날짜/방문 분기 없음. RLS = current_user_clinic_id() 격리 (ctm 동일 표준).
 *   본인 작성분 한정 UPDATE/DELETE (타인 항목 불변 보장).
 * node-pg pooler 직접 연결. 멱등(재실행 안전). dry-run insert→rollback 검증.
 * supabase/migrations/20260603050000_customer_special_notes.sql 과 동일 정의.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

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

console.log('🚀 CHART-SPECIAL-NOTE 마이그 (AC-1 customer_special_notes)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_special_notes (
      id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      clinic_id       uuid        NOT NULL REFERENCES clinics(id)   ON DELETE CASCADE,
      content         text        NOT NULL,
      created_by      text,
      created_by_name text,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_csn_customer_id ON customer_special_notes(customer_id, created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_csn_clinic_id   ON customer_special_notes(clinic_id);`);
  await client.query(`ALTER TABLE customer_special_notes ENABLE ROW LEVEL SECURITY;`);

  await client.query(`DROP POLICY IF EXISTS "clinic_isolation_csn_select" ON customer_special_notes;`);
  await client.query(`CREATE POLICY "clinic_isolation_csn_select" ON customer_special_notes FOR SELECT TO authenticated USING (clinic_id = current_user_clinic_id());`);
  await client.query(`DROP POLICY IF EXISTS "clinic_isolation_csn_insert" ON customer_special_notes;`);
  await client.query(`CREATE POLICY "clinic_isolation_csn_insert" ON customer_special_notes FOR INSERT TO authenticated WITH CHECK (clinic_id = current_user_clinic_id());`);
  await client.query(`DROP POLICY IF EXISTS "own_update_csn" ON customer_special_notes;`);
  await client.query(`CREATE POLICY "own_update_csn" ON customer_special_notes FOR UPDATE TO authenticated USING (created_by = auth.jwt()->>'email') WITH CHECK (created_by = auth.jwt()->>'email');`);
  await client.query(`DROP POLICY IF EXISTS "own_delete_csn" ON customer_special_notes;`);
  await client.query(`CREATE POLICY "own_delete_csn" ON customer_special_notes FOR DELETE TO authenticated USING (created_by = auth.jwt()->>'email');`);

  await client.query(`COMMENT ON TABLE customer_special_notes IS '환자 단위 특이사항 공용 누적칸 (T-20260603-foot-CHART-SPECIAL-NOTE). 날짜 분기 없이 누적(append), 항목별 기록자/작성일시 보존.';`);

  const t = await client.query(`SELECT to_regclass('public.customer_special_notes') t;`);
  console.log(`✅ customer_special_notes ${t.rows[0].t ? '존재' : '실패'}`);

  // dry-run: insert→rollback (스키마 무결성 + FK + RLS 미설정 경로 검증)
  await client.query('BEGIN');
  try {
    const cust = await client.query(`SELECT id, clinic_id FROM customers WHERE clinic_id IS NOT NULL LIMIT 1;`);
    if (cust.rows.length) {
      await client.query(
        `INSERT INTO customer_special_notes (customer_id, clinic_id, content, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5);`,
        [cust.rows[0].id, cust.rows[0].clinic_id, 'DRYRUN 특이사항 테스트', 'dryrun@test', '테스트']);
      console.log('✅ dry-run: 특이사항 insert OK (롤백 예정)');
    } else {
      console.log('⚠️  dry-run skip: 고객 데이터 없음');
    }
  } finally {
    await client.query('ROLLBACK');
    console.log('↩️  dry-run 롤백 완료 (실데이터 무변경)');
  }
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log('🏁 완료');
}
