/**
 * T-20260605-foot-HANDOVER-DBFIX (P0) — handover_notes / handover_checklist_items 테이블 직접 적용
 *
 * 현장 에러: "Could not find the table 'public.handover_notes' in the schema cache" (load+save 100% 불능).
 * 원인: supabase/migrations/20260605130000_handover_notes.sql 미적용.
 *
 * 실행:
 *   node scripts/apply_20260605130000_handover_notes_pg.mjs --apply
 *
 * node-pg pooler 직접 연결. 멱등(CREATE IF NOT EXISTS, 정책 drop&create). 적용 후 실제 INSERT 1건 테스트 → 정리.
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

const MIGRATION_SQL = fs.readFileSync('supabase/migrations/20260605130000_handover_notes.sql', 'utf8');

async function tableExists(name) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]);
  return r.rowCount > 0;
}

try {
  await client.connect();
  console.log(`✅ DB 연결 (mode=${MODE})  ${new Date().toISOString()}`);

  console.log('\n── BEFORE ──');
  console.log(`  handover_notes 존재          : ${await tableExists('handover_notes') ? 'YES' : 'NO'}`);
  console.log(`  handover_checklist_items 존재 : ${await tableExists('handover_checklist_items') ? 'YES' : 'NO'}`);

  if (MODE === 'dry-run') { console.log('\n🟡 dry-run 종료 (변경 없음).'); await client.end(); process.exit(0); }

  // ── APPLY (트리거/정책 create 는 멱등이 아니라서 사전 drop — 단, 테이블 존재할 때만) ──
  console.log('\n── APPLY: 마이그레이션 SQL 실행 ──');
  if (await tableExists('handover_notes')) {
    await client.query(`DROP TRIGGER IF EXISTS handover_notes_updated_at ON public.handover_notes;`);
    for (const pol of ['handover_notes_select','handover_notes_insert','handover_notes_update','handover_notes_delete']) {
      await client.query(`DROP POLICY IF EXISTS "${pol}" ON public.handover_notes;`).catch(() => {});
    }
  }
  if (await tableExists('handover_checklist_items')) {
    for (const pol of ['handover_checklist_select','handover_checklist_insert','handover_checklist_update','handover_checklist_delete']) {
      await client.query(`DROP POLICY IF EXISTS "${pol}" ON public.handover_checklist_items;`).catch(() => {});
    }
  }
  await client.query(MIGRATION_SQL);
  console.log('✅ 마이그레이션 적용 완료');

  // ── 검증: 테이블 / RLS / 정책 / 트리거 ──
  console.log('\n── POST-APPLY 검증 ──');
  console.log(`  handover_notes 존재          : ${await tableExists('handover_notes') ? 'YES' : 'NO'}`);
  console.log(`  handover_checklist_items 존재 : ${await tableExists('handover_checklist_items') ? 'YES' : 'NO'}`);

  const rls = await client.query(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('handover_notes','handover_checklist_items') AND relnamespace='public'::regnamespace;`);
  console.table(rls.rows);

  const pol = await client.query(`
    SELECT tablename, policyname, cmd FROM pg_policies
    WHERE tablename IN ('handover_notes','handover_checklist_items') ORDER BY tablename, cmd;`);
  console.table(pol.rows);
  console.log(`▶ 정책 수 = ${pol.rowCount} (기대: 8)`);

  const trg = await client.query(`SELECT tgname FROM pg_trigger WHERE tgname='handover_notes_updated_at';`);
  console.log(`▶ 트리거 handover_notes_updated_at 존재: ${trg.rowCount > 0 ? 'YES' : 'NO'}`);

  // ── 실제 저장 1건 테스트 (INSERT note + checklist → SELECT 조인 → 정리) ──
  console.log('\n── 실제 저장 1건 테스트 ──');
  const clinic = await client.query(`SELECT id, name FROM public.clinics ORDER BY created_at LIMIT 1;`);
  if (clinic.rowCount === 0) { console.log('⚠️ clinics 없음 — 저장 테스트 skip'); }
  else {
    const clinicId = clinic.rows[0].id;
    await client.query('BEGIN');
    const ins = await client.query(`
      INSERT INTO public.handover_notes (clinic_id, part_code, target_date, author_id, author_name, memo)
      VALUES ($1, 'therapist', current_date, NULL, 'DBFIX-SMOKE', 'P0 검증용 임시 — 자동삭제')
      RETURNING id;`, [clinicId]);
    const noteId = ins.rows[0].id;
    await client.query(`
      INSERT INTO public.handover_checklist_items (handover_id, label, is_checked, sort_order)
      VALUES ($1, '검증 체크 항목', false, 0);`, [noteId]);
    const joined = await client.query(`
      SELECT hn.id, hn.part_code, hn.memo,
             (SELECT count(*) FROM public.handover_checklist_items c WHERE c.handover_id = hn.id) AS items
      FROM public.handover_notes hn WHERE hn.id = $1;`, [noteId]);
    console.table(joined.rows);
    console.log(`▶ INSERT note + checklist 성공 (note=${noteId}, items=${joined.rows[0].items})`);
    await client.query('ROLLBACK'); // 검증용 데이터는 남기지 않음
    console.log('▶ ROLLBACK — 검증 데이터 정리 완료 (실데이터 0건 유지)');
  }

  await client.end();
  console.log('\n🟢 done — handover_notes 기능 복구.');
} catch (e) {
  try { await client.query('ROLLBACK'); } catch {}
  console.error('❌ 실패:', e.message);
  await client.end().catch(() => {});
  process.exit(1);
}
