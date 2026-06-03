/**
 * T-20260603-foot-RX-CHART-ENHANCE — DB 마이그 일괄 적용 (전부 additive)
 *   1) prescription_sets.folder TEXT nullable (AC-1)
 *   2) 처방항목 JSONB shape COMMENT (AC-5, prescription_code_id/classification)
 *   3) prescription_contraindications 테이블 + RLS (AC-2)
 * node-pg pooler 직접 연결. 각 단계 dry-run 검증. 멱등(재실행 안전).
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

console.log('🚀 RX-CHART-ENHANCE 마이그 (AC-1/AC-5/AC-2)');
try {
  await client.connect();
  console.log('✅ DB 연결');

  // ── 1) AC-1: prescription_sets.folder ──────────────────────────────
  await client.query(`ALTER TABLE prescription_sets ADD COLUMN IF NOT EXISTS folder TEXT;`);
  await client.query(`COMMENT ON COLUMN prescription_sets.folder IS 'AC-1 처방세트 폴더명 (nullable). NULL=미분류. 동일 문자열로 그룹핑.';`);
  const f = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='prescription_sets' AND column_name='folder';`);
  console.log(`✅ (1) prescription_sets.folder ${f.rows.length ? '존재' : '실패'}`);

  // ── 2) AC-5: 처방항목 JSONB shape COMMENT ──────────────────────────
  await client.query(`COMMENT ON COLUMN prescription_sets.items IS '처방항목 JSONB 배열. 원소 shape: {name,dosage,route,frequency,days,notes, prescription_code_id?:UUID(nullable, prescription_codes 참조), classification?:TEXT(스냅샷)}';`);
  await client.query(`COMMENT ON COLUMN medical_charts.prescription_items IS '처방내역 JSONB 배열. 원소 shape: {name,dosage,route,frequency,days,notes, prescription_code_id?:UUID(nullable), classification?:TEXT}. AC-2 금기증 게이트는 prescription_code_id 기준 매칭.';`);
  console.log('✅ (2) 처방항목 JSONB shape COMMENT 갱신');

  // ── 3) AC-2: prescription_contraindications ────────────────────────
  await client.query(`
    CREATE TABLE IF NOT EXISTS prescription_contraindications (
      id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      prescription_code_id  UUID NOT NULL REFERENCES prescription_codes(id) ON DELETE CASCADE,
      contraindication_text TEXT NOT NULL,
      severity              TEXT,
      created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
      created_by_name       TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_rx_contra_code ON prescription_contraindications(prescription_code_id);`);
  await client.query(`ALTER TABLE prescription_contraindications ENABLE ROW LEVEL SECURITY;`);
  await client.query(`DROP POLICY IF EXISTS rx_contra_read ON prescription_contraindications;`);
  await client.query(`CREATE POLICY rx_contra_read ON prescription_contraindications FOR SELECT TO authenticated USING (true);`);
  await client.query(`DROP POLICY IF EXISTS rx_contra_admin_write ON prescription_contraindications;`);
  await client.query(`CREATE POLICY rx_contra_admin_write ON prescription_contraindications FOR ALL TO authenticated USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');`);
  await client.query(`COMMENT ON TABLE prescription_contraindications IS 'AC-2 약품 금기증 (1약품 N금기). prescription_code_id 기준 수기등록. 처방 추가 시 FE 확인 팝업 게이트.';`);
  const t = await client.query(`SELECT to_regclass('public.prescription_contraindications') t;`);
  console.log(`✅ (3) prescription_contraindications ${t.rows[0].t ? '존재' : '실패'}`);

  // ── dry-run: 금기증 insert→rollback (스키마 무결성 확인) ────────────
  await client.query('BEGIN');
  try {
    const code = await client.query(`SELECT id FROM prescription_codes LIMIT 1;`);
    if (code.rows.length) {
      await client.query(
        `INSERT INTO prescription_contraindications (prescription_code_id, contraindication_text, severity) VALUES ($1,$2,$3);`,
        [code.rows[0].id, 'DRYRUN 금기 테스트', '주의']);
      console.log('✅ dry-run: 금기증 insert OK (롤백 예정)');
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
