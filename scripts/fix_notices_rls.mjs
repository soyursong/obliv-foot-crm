/**
 * T-20260516-foot-NOTICE-SAVE-FAIL P0 hotfix
 * notices SELECT/UPDATE/DELETE RLS 정책 수정
 * rollback: 각 DROP/CREATE를 반전
 */
import pkg from 'pg';
const { Client } = pkg;

// Supabase Direct DB (Session mode) — host: db.{project-ref}.supabase.co  port: 5432
// 자격증명 env 주입 (평문 fallback 금지 — 미설정 시 throw). T-20260629-foot-TESTCRED-FIXTURE-CLEAN
const DB_PASSWORD = (process.env.SUPABASE_DB_PASSWORD || (() => { throw new Error('SUPABASE_DB_PASSWORD env required (no plaintext fallback)'); })());

const client = new Client({
  host: 'db.rxlomoozakkjesdqjtvd.supabase.co', port: 5432,
  database: 'postgres', user: 'postgres', password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log('✅ DB 연결 성공');

  // 1. 현행 정책 확인
  const { rows: before } = await client.query(
    "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notices' ORDER BY policyname"
  );
  console.log('현행 notices RLS 정책:', before);

  // 2. broken 정책 DROP
  await client.query(`DROP POLICY IF EXISTS "notices_select" ON public.notices`);
  await client.query(`DROP POLICY IF EXISTS "notices_update" ON public.notices`);
  await client.query(`DROP POLICY IF EXISTS "notices_delete" ON public.notices`);
  console.log('✅ broken 정책 DROP 완료');

  // 3. 새 정책 생성
  await client.query(`
    CREATE POLICY "notices_select_for_authenticated" ON public.notices
      FOR SELECT TO authenticated
      USING (true)
  `);
  await client.query(`
    CREATE POLICY "notices_update_for_authenticated" ON public.notices
      FOR UPDATE TO authenticated
      USING (true)
      WITH CHECK (true)
  `);
  await client.query(`
    CREATE POLICY "notices_delete_for_authenticated" ON public.notices
      FOR DELETE TO authenticated
      USING (true)
  `);
  console.log('✅ 새 정책 생성 완료');

  // 4. 적용 후 정책 확인
  const { rows: after } = await client.query(
    "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notices' ORDER BY policyname"
  );
  console.log('적용 후 notices RLS 정책:', after);

} catch (err) {
  console.error('❌ 실패:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
