/**
 * T-20260525-foot-FEE-SET-TEMPLATE AC-3
 * fee_set_templates 테이블 생성 + RLS
 * node-pg 직접 연결 방식 (pooler port 5432)
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'aws-0-ap-northeast-2.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })()),
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 fee_set_templates 테이블 생성 (T-20260525-foot-FEE-SET-TEMPLATE AC-3)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // 1. 테이블 생성
  await client.query(`
    CREATE TABLE IF NOT EXISTS fee_set_templates (
      id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
      clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      set_name    TEXT        NOT NULL CHECK (char_length(trim(set_name)) > 0),
      items       JSONB       NOT NULL DEFAULT '[]'::jsonb,
      is_active   BOOLEAN     NOT NULL DEFAULT true,
      sort_order  INTEGER     NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('✅ fee_set_templates 테이블 생성 (IF NOT EXISTS)');

  // 2. 인덱스
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_name
      ON fee_set_templates(clinic_id, set_name)
      WHERE is_active = true;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_fee_set_templates_clinic_active
      ON fee_set_templates(clinic_id, is_active, sort_order);
  `);
  console.log('✅ 인덱스 생성 완료');

  // 3. 코멘트
  await client.query(`
    COMMENT ON TABLE fee_set_templates IS
      'T-20260525-foot-FEE-SET-TEMPLATE: 결제 미니창 수가항목 세트코드 템플릿. clinic_id 격리.';
  `);
  await client.query(`
    COMMENT ON COLUMN fee_set_templates.items IS
      'JSONB 배열: [{"service_id": "uuid", "sort_order": N}]. services 테이블 FK 역할.';
  `);

  // 4. RLS 활성화
  await client.query(`ALTER TABLE fee_set_templates ENABLE ROW LEVEL SECURITY;`);
  console.log('✅ RLS 활성화');

  // 5. RLS 정책
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'fee_set_templates' AND policyname = 'auth_all'
      ) THEN
        EXECUTE 'CREATE POLICY "auth_all" ON fee_set_templates FOR ALL TO authenticated USING (true) WITH CHECK (true)';
      END IF;
    END
    $$;
  `);
  console.log('✅ RLS 정책 생성 (auth_all)');

  // 6. 검증
  const { rows } = await client.query(
    "SELECT count(*) FROM fee_set_templates"
  );
  console.log(`✅ 검증 OK — fee_set_templates 행 수: ${rows[0].count}`);

  console.log('\n🎉 fee_set_templates 마이그레이션 완료 (T-20260525-foot-FEE-SET-TEMPLATE AC-3)');
} catch (err) {
  console.error('❌ 오류:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
