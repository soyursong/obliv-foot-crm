/**
 * T-20260610-foot-DXBUNDLE-SAVE-FAIL — 묶음상병 세트 prod 부재 해소
 * supervisor GATE-RESULT GO_WARN (MSG-20260610-234142-p1ca) 수신 후 실행.
 *
 * 적용 순서(필수):
 *   1) supabase/migrations/20260608120000_diagnosis_sets.sql       (diagnosis_sets/_items + RLS)
 *   2) supabase/migrations/20260609120000_diagnosis_sets_is_favorite.sql (is_favorite ADD COLUMN)
 *
 * ADDITIVE ONLY / 무손실 / idempotent. (dev-foot 직접 실행 정책 / 대시보드 수동 금지)
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

const MIGS = [
  'supabase/migrations/20260608120000_diagnosis_sets.sql',
  'supabase/migrations/20260609120000_diagnosis_sets_is_favorite.sql',
];

console.log('🚀 diagnosis_sets prod 적용 (T-20260610-foot-DXBUNDLE-SAVE-FAIL)');

try {
  await client.connect();
  console.log('✅ DB 연결 성공 (prod rxlomoozakkjesdqjtvd)');

  // ── PRE: 부재 재확인 (AC-1 실측) ─────────────────────────────
  const pre = await client.query(`
    SELECT
      to_regclass('public.diagnosis_sets')      AS sets,
      to_regclass('public.diagnosis_set_items') AS items,
      (SELECT column_name FROM information_schema.columns
        WHERE table_name='diagnosis_sets' AND column_name='is_favorite') AS is_favorite`);
  console.log('  [PRE] sets=%s items=%s is_favorite=%s',
    pre.rows[0].sets, pre.rows[0].items, pre.rows[0].is_favorite);

  // ── 적용: 순서대로 각각 트랜잭션 ─────────────────────────────
  for (const path of MIGS) {
    const sql = fs.readFileSync(path, 'utf8');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ 적용 완료:', path);
  }

  // ── POST 검증 ────────────────────────────────────────────────
  const post = await client.query(`
    SELECT
      to_regclass('public.diagnosis_sets')      AS sets,
      to_regclass('public.diagnosis_set_items') AS items`);
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='diagnosis_sets'
       AND column_name='is_favorite'`);
  const pol = await client.query(`
    SELECT tablename, policyname FROM pg_policies
     WHERE tablename IN ('diagnosis_sets','diagnosis_set_items')
     ORDER BY tablename, policyname`);
  const idx = await client.query(`
    SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename IN ('diagnosis_sets','diagnosis_set_items')
     ORDER BY indexname`);

  console.log('\n── POST 검증 ──────────────────────────');
  console.log('  diagnosis_sets      =', post.rows[0].sets);
  console.log('  diagnosis_set_items =', post.rows[0].items);
  console.log('  is_favorite 컬럼     =', cols.rows.length ? '존재' : '없음');
  console.log('  RLS 정책            =', pol.rows.map(p => `${p.tablename}.${p.policyname}`).join(', '));
  console.log('  인덱스              =', idx.rows.map(i => i.indexname).join(', '));

  if (!post.rows[0].sets || !post.rows[0].items || cols.rows.length === 0) {
    throw new Error('검증 실패 — 테이블/컬럼 미생성');
  }

  // ── AC-3 재현: 세트 추가 round-trip (insert→select→cleanup) ──
  const clinicQ = await client.query(`SELECT id FROM public.clinics ORDER BY created_at LIMIT 1`);
  if (clinicQ.rows.length) {
    const clinicId = clinicQ.rows[0].id;
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO public.diagnosis_sets (clinic_id, name, is_favorite)
       VALUES ($1, $2, true) RETURNING id, name, is_favorite`,
      [clinicId, '__SMOKE_TEST_DXSET__']);
    const setId = ins.rows[0].id;
    // 항목 추가(상병 service 1건이 있으면)
    const svc = await client.query(
      `SELECT id FROM public.services WHERE category_label='상병' AND clinic_id=$1 LIMIT 1`, [clinicId]);
    let itemOk = 'skip(상병 service 없음)';
    if (svc.rows.length) {
      await client.query(
        `INSERT INTO public.diagnosis_set_items (diagnosis_set_id, service_id, diagnosis_type)
         VALUES ($1, $2, 'primary')`, [setId, svc.rows[0].id]);
      itemOk = 'ok';
    }
    const back = await client.query(`SELECT id, name, is_favorite FROM public.diagnosis_sets WHERE id=$1`, [setId]);
    await client.query('ROLLBACK'); // smoke 데이터 정리
    console.log('\n── AC-3 round-trip (rolled back) ──────');
    console.log('  insert set    =', back.rows[0].name, 'fav=', back.rows[0].is_favorite);
    console.log('  insert item   =', itemOk);
    console.log('  저장 재현      = ✅ 성공 (smoke 데이터는 ROLLBACK으로 미반영)');
  } else {
    console.log('\n  [AC-3] clinics 0건 → round-trip skip');
  }

  console.log('\n🎉 적용+검증 완료.');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch { /* noop */ }
  console.error('❌ 실패:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
