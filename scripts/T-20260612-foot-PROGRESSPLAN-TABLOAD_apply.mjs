/**
 * T-20260612-foot-PROGRESSPLAN-TAB-LOAD-FAIL — APPLY (영속, P0 회귀 핫픽스)
 * 원인: 20260612000000_progress_plans_tier_model.sql 마이그가 prod 미적용 →
 *       session_count_tier 컬럼 부재 → a24fe86 FE .order() 실패 → 경과분석 플랜 탭 "로딩 실패".
 * 처방: 누락 마이그를 prod에 직접 apply (foot DB 직접 실행 정책).
 *       마이그는 BEGIN/COMMIT 내장 + idempotent(ADD IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP IF EXISTS).
 *       실패/회귀 시 rollback: 20260612000000_progress_plans_tier_model.rollback.sql
 * 데이터 무손실: 레거시 10행 → package1→tier_12, blelabel→tier_36, special(미사용 2)→DELETE (confirm 매핑).
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;
let DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;
if (!DB_PASSWORD && fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^SUPABASE_DB_PASSWORD=(.*)$/); if (m) DB_PASSWORD = m[1].trim();
  }
}
const conn = () => new Client({ host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
  database: 'postgres', user: 'postgres.rxlomoozakkjesdqjtvd', password: DB_PASSWORD, ssl: { rejectUnauthorized: false } });

const migPath = 'supabase/migrations/20260612000000_progress_plans_tier_model.sql';
const sql = fs.readFileSync(migPath, 'utf8');

// ── 0) PRE 스냅샷 ──
const c0 = conn(); await c0.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}\n`);
const preCols = await c0.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_progress_plans' AND column_name='session_count_tier'`);
const preCnt = await c0.query(`SELECT package_type, count(*)::int n FROM public.package_progress_plans GROUP BY package_type ORDER BY package_type`);
console.log(`PRE session_count_tier 존재: ${preCols.rows.length > 0}`);
console.log('PRE package_type 분포:'); console.table(preCnt.rows);
await c0.end();

if (preCols.rows.length > 0) {
  console.log('⚠ 이미 session_count_tier 존재 — 멱등 재실행(스킵 안 함, IF NOT EXISTS로 안전).');
}

// ── 1) APPLY ──
const c1 = conn(); await c1.connect();
try {
  await c1.query(sql); // 파일 내 BEGIN..COMMIT
  console.log('\n✅ 마이그 실행 완료 (COMMIT).');
} catch (e) {
  console.error('❌ APPLY 실패:', e.message);
  await c1.end();
  process.exit(1);
}
await c1.end();

// ── 2) 별도 연결로 영속 검증 ──
const c2 = conn(); await c2.connect();
const colOk = await c2.query(`SELECT data_type, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_progress_plans' AND column_name='session_count_tier'`);
console.log(`\n★ session_count_tier: ${colOk.rows.length ? 'EXISTS ✅ ('+colOk.rows[0].data_type+', nullable='+colOk.rows[0].is_nullable+')' : 'MISSING ❌'}`);

const dist = await c2.query(`SELECT session_count_tier, count(*)::int n,
    array_agg(session_milestone ORDER BY session_milestone) ms
  FROM public.package_progress_plans GROUP BY session_count_tier ORDER BY session_count_tier`);
console.log('── tier 분포 (기대 6→[6],12→[6,12],...,48→[..48]) ──'); console.table(dist.rows);

// FE 쿼리 시뮬레이션
try {
  const r = await c2.query(`SELECT * FROM public.package_progress_plans
    ORDER BY session_count_tier ASC, session_milestone ASC LIMIT 3`);
  console.log(`✅ FE 쿼리 시뮬 성공 (rows=${r.rowCount})`);
} catch (e) { console.log(`❌ FE 쿼리 시뮬 실패: ${e.message}`); }

// 무결성 제약
const cons = await c2.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.package_progress_plans'::regclass AND conname IN ('chk_ppp_tier_positive','uq_ppp_clinic_tier_milestone')`);
console.log('신규 제약:', cons.rows.map(r => r.conname).join(', ') || '(없음 ❌)');

await c2.end();
console.log('\n✅ DONE');
