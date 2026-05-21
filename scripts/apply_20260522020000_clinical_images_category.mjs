/**
 * T-20260522-foot-PHOTO-CAPTURE
 * clinical_images 테이블 + category 컬럼 추가
 *
 * 실행: node scripts/apply_20260522020000_clinical_images_category.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

const MIGRATION_SQL = `
-- [1] clinical_images 테이블 생성 (없을 경우)
CREATE TABLE IF NOT EXISTS clinical_images (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  check_in_id  UUID        REFERENCES check_ins(id) ON DELETE SET NULL,
  storage_path TEXT        NOT NULL,
  category     TEXT        CHECK (category IN ('before', 'after', 'photo')),
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- [2] category 컬럼 보장 (테이블이 이미 존재했으나 category 없던 경우 패치)
ALTER TABLE clinical_images
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('before', 'after', 'photo'));

-- [3] RLS 활성화
ALTER TABLE clinical_images ENABLE ROW LEVEL SECURITY;

-- [4] auth_all 정책 (기존 패턴 동일)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clinical_images' AND policyname = 'auth_all'
  ) THEN
    EXECUTE 'CREATE POLICY "auth_all" ON clinical_images FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- [5] 인덱스
CREATE INDEX IF NOT EXISTS clinical_images_customer_id_created_at_idx
  ON clinical_images (customer_id, created_at DESC);
`;

async function runQuery(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status} [${label}]: ${text}`);
  }
  return resp.json();
}

async function run() {
  console.log('🚀 T-20260522-foot-PHOTO-CAPTURE: clinical_images 테이블 + category 컬럼 추가 중...');

  await runQuery(MIGRATION_SQL, 'migration');
  console.log('✅ 마이그레이션 실행 완료');

  // 검증 [1]: clinical_images 테이블 존재 확인
  const tableCheck = await runQuery(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'clinical_images';`,
    'verify-table'
  );
  if (tableCheck?.length > 0) {
    console.log('✅ clinical_images 테이블 확인:', JSON.stringify(tableCheck));
  } else {
    throw new Error('clinical_images 테이블 생성 실패');
  }

  // 검증 [2]: category 컬럼 존재 확인
  const colCheck = await runQuery(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'clinical_images'
       AND column_name = 'category';`,
    'verify-category-column'
  );
  if (colCheck?.length > 0) {
    console.log('✅ category 컬럼 확인:', JSON.stringify(colCheck));
  } else {
    throw new Error('category 컬럼 확인 실패');
  }

  // 검증 [3]: RLS 활성화 확인
  const rlsCheck = await runQuery(
    `SELECT rowsecurity FROM pg_tables
     WHERE schemaname = 'public' AND tablename = 'clinical_images';`,
    'verify-rls'
  );
  console.log('✅ RLS 상태:', JSON.stringify(rlsCheck));

  console.log('🎉 전체 완료 — clinical_images 테이블 + category 컬럼 추가 완료');
}

run().catch(err => {
  console.error('❌ 예외:', err);
  process.exit(1);
});
