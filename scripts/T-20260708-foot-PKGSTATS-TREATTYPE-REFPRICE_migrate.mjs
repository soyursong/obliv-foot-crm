/**
 * T-20260708-foot-PKGSTATS-DIRECTINPUT-TREATTYPE-REFPRICE — 마이그 dry-run / real-apply 하니스
 * (Supabase Management API /database/query — SUPABASE_ACCESS_TOKEN)
 *
 *   node scripts/T-20260708-foot-PKGSTATS-TREATTYPE-REFPRICE_migrate.mjs           # DRY-RUN (forward+멱등+rollback tx ROLLBACK → prod 무변경)
 *   node scripts/T-20260708-foot-PKGSTATS-TREATTYPE-REFPRICE_migrate.mjs --apply   # REAL APPLY (forward COMMIT) — supervisor DDL-diff 후에만
 *
 * 전량 ADDITIVE(packages 2 nullable col + treatment_standard_prices 신규 테이블). 멱등 가드. 롤백 SQL 동봉.
 */
import fs from 'fs';

const REF = 'rxlomoozakkjesdqjtvd';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error('SUPABASE_ACCESS_TOKEN 필요'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const base = 'supabase/migrations/20260708220000_foot_pkg_treatment_type_reference_price';
const fwd = fs.readFileSync(`${base}.sql`, 'utf8');
const rbk = fs.readFileSync(`${base}.rollback.sql`, 'utf8');

let pass = true;
const chk = (c, l) => { console.log(`  ${c ? '✅' : '❌'} ${l}`); if (!c) pass = false; };

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  return JSON.parse(text);
}

// to_regclass / pg_class string-filter 로 테이블 부재 시에도 parse 안전(직접 참조 없음).
const probe = () => q(
  "SELECT " +
  "(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='treatment_type')::int AS pkg_tt, " +
  "(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='packages' AND column_name='reference_price')::int AS pkg_rp, " +
  "(to_regclass('public.treatment_standard_prices') IS NOT NULL)::int AS tsp_tbl, " +
  "(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='treatment_standard_prices')::int AS tsp_rls, " +
  "COALESCE((SELECT relrowsecurity FROM pg_class WHERE relname='treatment_standard_prices' AND relnamespace='public'::regnamespace), false) AS tsp_rls_on, " +
  "(SELECT count(*) FROM public.clinics)::int AS clinics;"
);

console.log(`\n=== T-20260708 PKGSTATS TREATTYPE/REFPRICE migrate (${APPLY ? 'REAL APPLY' : 'DRY-RUN'}) ===\n`);
try {
  const pre = (await probe())[0];
  console.log(`── PRE ──  packages.treatment_type=${pre.pkg_tt}  packages.reference_price=${pre.pkg_rp}  tsp_table=${pre.tsp_tbl}  clinics=${pre.clinics}\n`);

  if (!APPLY) {
    // DRY-RUN: forward + 멱등 재실행 + rollback 을 한 tx(단일 세션) 안에서 실행 후 ROLLBACK → prod 무변경.
    await q(`BEGIN;\n${fwd}\n${fwd}\n${rbk}\nROLLBACK;`);
    console.log('  ✅ tx(forward→forward멱등→rollback) 무오류 실행 후 ROLLBACK');
    const post = (await probe())[0];
    // prod 무변경 = 왕복 후 PRE 대조 원상.
    chk(post.pkg_tt === pre.pkg_tt && post.pkg_rp === pre.pkg_rp && post.tsp_tbl === pre.tsp_tbl,
      `ROLLBACK 후 prod 무변경(PRE 대조): pkg_tt ${pre.pkg_tt}→${post.pkg_tt}, pkg_rp ${pre.pkg_rp}→${post.pkg_rp}, tsp ${pre.tsp_tbl}→${post.tsp_tbl}`);
    console.log(`\n${pass ? '✅ DRY-RUN ALL-PASS (forward+멱등+rollback 왕복, prod 무변경)' : '❌ DRY-RUN FAIL'}\n`);
  } else {
    await q(fwd);
    console.log('  ✅ FORWARD COMMIT (management API auto-commit)');
    await q(fwd); // 멱등 재확인
    console.log('  ✅ FORWARD 멱등 재실행 무오류');
    const post = (await probe())[0];
    chk(post.pkg_tt === 1, 'packages.treatment_type 존재');
    chk(post.pkg_rp === 1, 'packages.reference_price 존재');
    chk(post.tsp_tbl === 1, 'treatment_standard_prices 테이블 존재');
    chk(post.tsp_rls_on === true, 'treatment_standard_prices RLS enabled');
    chk(post.tsp_rls >= 1, `treatment_standard_prices RLS 정책 (${post.tsp_rls})`);
    const rows = (await q('SELECT count(*)::int AS n FROM public.treatment_standard_prices'))[0].n;
    chk(rows === post.clinics * 5, `seed = clinics×5 (${rows} = ${post.clinics}×5)`);
    const led = await q(`SELECT version,name FROM supabase_migrations.schema_migrations WHERE version='20260708220000'`);
    chk(led.length === 1, `ledger row 등재 (${JSON.stringify(led[0] || null)})`);
    console.log(`\n${pass ? '✅ REAL APPLY ALL-PASS' : '❌ APPLY FAIL'}\n`);
  }
} catch (e) {
  console.error('❌ 오류:', e.message);
  pass = false;
}
process.exit(pass ? 0 : 1);
