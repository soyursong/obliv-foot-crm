/**
 * T-20260612-foot-PROGRESSPLAN-TAB-LOAD-FAIL — prod DB 진단 (read-only)
 * 가설: progress_plans_tier_model 마이그 미적용 → session_count_tier 컬럼 부재 → FE .order() 실패.
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

const c = conn();
await c.connect();
console.log(`✅ DB 연결  ${new Date().toISOString()}\n`);

// 1) 컬럼 존재 여부
const cols = await c.query(`SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='package_progress_plans'
  ORDER BY ordinal_position`);
console.log('── package_progress_plans 컬럼 ──');
console.table(cols.rows);
const hasTier = cols.rows.some(r => r.column_name === 'session_count_tier');
console.log(`\n★ session_count_tier 컬럼: ${hasTier ? 'EXISTS ✅' : 'MISSING ❌ (마이그 미적용 확정)'}\n`);

// 2) 행 수 + tier 분포 (컬럼 있을 때만)
const cnt = await c.query(`SELECT count(*)::int AS n FROM public.package_progress_plans`);
console.log(`총 row: ${cnt.rows[0].n}`);
if (hasTier) {
  const dist = await c.query(`SELECT session_count_tier, count(*)::int n,
      array_agg(session_milestone ORDER BY session_milestone) ms
    FROM public.package_progress_plans GROUP BY session_count_tier ORDER BY session_count_tier`);
  console.log('── tier 분포 ──'); console.table(dist.rows);
} else {
  // 레거시 package_type 분포
  const lp = await c.query(`SELECT package_type, count(*)::int n FROM public.package_progress_plans GROUP BY package_type ORDER BY package_type`);
  console.log('── 레거시 package_type 분포 ──'); console.table(lp.rows);
}

// 3) RLS 정책 (select)
const pol = await c.query(`SELECT policyname, cmd, roles::text, qual
  FROM pg_policies WHERE schemaname='public' AND tablename='package_progress_plans' ORDER BY cmd`);
console.log('── RLS 정책 ──'); console.table(pol.rows);

// 4) FE 쿼리 시뮬레이션 (실제 실패 재현)
console.log('\n── FE 쿼리 시뮬레이션 (.order session_count_tier) ──');
try {
  await c.query(`SELECT * FROM public.package_progress_plans
    ORDER BY session_count_tier ASC, session_milestone ASC LIMIT 1`);
  console.log('✅ ORDER BY session_count_tier 성공');
} catch (e) {
  console.log(`❌ 재현됨: ${e.message}`);
}

await c.end();
