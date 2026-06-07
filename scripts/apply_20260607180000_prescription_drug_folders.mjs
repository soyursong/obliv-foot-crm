/**
 * T-20260606-foot-RX-SET-REDESIGN AC-R1
 * prescription_folders + prescription_code_folders 신설 (약품 폴더 트리).
 * supabase/migrations/20260607180000_prescription_drug_folders.sql 을 그대로 적용.
 * node-pg 직접 연결. dev-foot DB 직접 실행 정책 준수.
 *
 * 재실행 안전: 테이블/인덱스는 IF NOT EXISTS. 정책은 CREATE POLICY 가 비멱등이므로
 *   사전 DROP POLICY IF EXISTS 로 가드 후 재생성.
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
  port: 5432,
  database: 'postgres',
  user: 'postgres.rxlomoozakkjesdqjtvd',
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

console.log('🚀 prescription_folders / prescription_code_folders 적용 (T-20260606-foot-RX-SET-REDESIGN AC-R1)');

const POLICY_GUARD = `
  DROP POLICY IF EXISTS "prescription_folders_read_all" ON prescription_folders;
  DROP POLICY IF EXISTS "prescription_folders_write_auth" ON prescription_folders;
  DROP POLICY IF EXISTS "prescription_code_folders_read_all" ON prescription_code_folders;
  DROP POLICY IF EXISTS "prescription_code_folders_write_auth" ON prescription_code_folders;
`;

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  const sql = fs.readFileSync('supabase/migrations/20260607180000_prescription_drug_folders.sql', 'utf8');

  // 1) 테이블/인덱스 + RLS enable + 정책: 정책 비멱등 가드를 위해 사전 DROP.
  //    (테이블이 아직 없으면 DROP POLICY 는 relation 없음으로 실패 → 무시하고 본문에서 생성)
  await client.query('BEGIN');
  await client.query(`
    CREATE TABLE IF NOT EXISTS prescription_folders (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id   UUID REFERENCES prescription_folders(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_prescription_folders_parent ON prescription_folders(parent_id);
    CREATE TABLE IF NOT EXISTS prescription_code_folders (
      prescription_code_id UUID PRIMARY KEY REFERENCES prescription_codes(id) ON DELETE CASCADE,
      folder_id            UUID NOT NULL REFERENCES prescription_folders(id) ON DELETE CASCADE,
      sort_order           INT NOT NULL DEFAULT 0,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_prescription_code_folders_folder ON prescription_code_folders(folder_id);
    ALTER TABLE prescription_folders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prescription_code_folders ENABLE ROW LEVEL SECURITY;
  `);
  await client.query(POLICY_GUARD);
  await client.query(`
    CREATE POLICY "prescription_folders_read_all" ON prescription_folders FOR SELECT TO authenticated USING (true);
    CREATE POLICY "prescription_folders_write_auth" ON prescription_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "prescription_code_folders_read_all" ON prescription_code_folders FOR SELECT TO authenticated USING (true);
    CREATE POLICY "prescription_code_folders_write_auth" ON prescription_code_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);
    COMMENT ON TABLE prescription_folders IS 'T-20260606-foot-RX-SET-REDESIGN 약품 폴더 트리(자기참조 다단계). 현장용어 "폴더". 어드민 관리.';
    COMMENT ON TABLE prescription_code_folders IS 'T-20260606-foot-RX-SET-REDESIGN 약품↔폴더 매핑(PK=code_id → 약 1건당 폴더 1개). 미분류=행 없음.';
  `);
  await client.query('COMMIT');
  console.log('✅ DDL + RLS + 정책 적용 완료');
  void sql; // 원본 SQL 파일은 SSOT 기록용 (위 인라인과 동일 내용)

  // 검증
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('prescription_folders','prescription_code_folders')
    ORDER BY table_name;
  `);
  const found = rows.map(r => r.table_name);
  if (!found.includes('prescription_folders') || !found.includes('prescription_code_folders')) {
    throw new Error(`테이블 검증 실패 — found=${JSON.stringify(found)}`);
  }
  const { rows: pol } = await client.query(`
    SELECT tablename, policyname FROM pg_policies
    WHERE tablename IN ('prescription_folders','prescription_code_folders')
    ORDER BY tablename, policyname;
  `);
  console.log('✅ 검증 완료 — tables:', found);
  console.log('✅ 정책:', pol.map(p => `${p.tablename}.${p.policyname}`).join(', '));
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  console.error('❌ 실패:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
