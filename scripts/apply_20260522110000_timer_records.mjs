/**
 * T-20260522-foot-LASER-TIMER AC-3/4
 * timer_records 신규 테이블 생성 (방안 B: 별도 테이블 — 이력 보존)
 * 기존 check_ins 테이블 무변경.
 * 실행: SUPABASE_ACCESS_TOKEN=xxx node scripts/apply_20260522110000_timer_records.mjs
 */

const PROJECT_ID = 'rxlomoozakkjesdqjtvd';
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌ SUPABASE_ACCESS_TOKEN 환경변수 필요');
  process.exit(1);
}

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

const SQL_CREATE = `
CREATE TABLE IF NOT EXISTS public.timer_records (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id       uuid        NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,
  clinic_id         text        NOT NULL,
  duration_minutes  int         NOT NULL CHECK (duration_minutes IN (5, 15, 20)),
  started_at        timestamptz NOT NULL DEFAULT now(),
  ends_at           timestamptz NOT NULL,
  stopped_at        timestamptz,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
`;

const SQL_IDX1 = `
CREATE INDEX IF NOT EXISTS idx_timer_records_check_in_id
  ON public.timer_records (check_in_id);
`;

const SQL_IDX2 = `
CREATE INDEX IF NOT EXISTS idx_timer_records_clinic_active
  ON public.timer_records (clinic_id, stopped_at)
  WHERE stopped_at IS NULL;
`;

const SQL_RLS_ENABLE = `
ALTER TABLE public.timer_records ENABLE ROW LEVEL SECURITY;
`;

const SQL_RLS_SELECT = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='timer_records' AND policyname='timer_records_authenticated_select'
  ) THEN
    CREATE POLICY "timer_records_authenticated_select"
      ON public.timer_records FOR SELECT
      TO authenticated USING (true);
  END IF;
END $$;
`;

const SQL_RLS_INSERT = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='timer_records' AND policyname='timer_records_authenticated_insert'
  ) THEN
    CREATE POLICY "timer_records_authenticated_insert"
      ON public.timer_records FOR INSERT
      TO authenticated WITH CHECK (true);
  END IF;
END $$;
`;

const SQL_RLS_UPDATE = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='timer_records' AND policyname='timer_records_authenticated_update'
  ) THEN
    CREATE POLICY "timer_records_authenticated_update"
      ON public.timer_records FOR UPDATE
      TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

// Realtime 활성화 (INSERT/UPDATE 이벤트 전파)
const SQL_REALTIME = `
ALTER PUBLICATION supabase_realtime ADD TABLE public.timer_records;
`;

const SQL_VERIFY = `
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='timer_records') AS tbl_exists;
`;

async function run() {
  console.log('🚀 T-20260522-foot-LASER-TIMER: timer_records 마이그레이션 시작...');

  console.log('\n[1/7] 테이블 생성...');
  await runQuery(SQL_CREATE, 'create-table');
  console.log('✅ 테이블 생성 완료');

  console.log('\n[2/7] 인덱스 (check_in_id)...');
  await runQuery(SQL_IDX1, 'idx1');
  console.log('✅ 완료');

  console.log('\n[3/7] 인덱스 (clinic_active)...');
  await runQuery(SQL_IDX2, 'idx2');
  console.log('✅ 완료');

  console.log('\n[4/7] RLS 활성화...');
  await runQuery(SQL_RLS_ENABLE, 'rls-enable');
  console.log('✅ 완료');

  console.log('\n[5/7] RLS 정책 (SELECT/INSERT/UPDATE)...');
  await runQuery(SQL_RLS_SELECT, 'rls-select');
  await runQuery(SQL_RLS_INSERT, 'rls-insert');
  await runQuery(SQL_RLS_UPDATE, 'rls-update');
  console.log('✅ 완료');

  console.log('\n[6/7] Realtime 활성화...');
  try {
    await runQuery(SQL_REALTIME, 'realtime');
    console.log('✅ 완료');
  } catch (e) {
    // 이미 추가돼 있어도 무해
    console.log(`ℹ️  Realtime: ${e.message} (무시)`);
  }

  console.log('\n[7/7] 검증...');
  const result = await runQuery(SQL_VERIFY, 'verify');
  const tblExists = result[0]?.tbl_exists === '1' || result[0]?.tbl_exists === 1;
  console.log(`  timer_records 테이블: ${tblExists ? '✅' : '❌'}`);
  if (!tblExists) throw new Error('❌ 검증 실패 — 테이블 없음');

  console.log('\n🎉 T-20260522-foot-LASER-TIMER: timer_records 마이그레이션 완료');
}

run().catch(err => {
  console.error('❌ 예외:', err.message);
  process.exit(1);
});
