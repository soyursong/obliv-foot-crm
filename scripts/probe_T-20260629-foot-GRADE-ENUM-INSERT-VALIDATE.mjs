/**
 * probe_T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY 증거기반 prod probe (pre/post 공용) — 대상 테이블에 기대 스키마/행 실재 확인.
 * 티켓: T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE
 * 실행: node scripts/probe_T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE.mjs [--label pre|post]
 * write/DDL 0 — pg SELECT/introspection 만.
 */
import { query, PROJ_REF } from './lib/foot_migration_ledger.mjs';

const LABEL = (process.argv.find((a) => a.startsWith('--label='))?.split('=')[1])
  || (process.argv.includes('--post') ? 'post' : 'pre');

function rows(r) { return (r && (r.result || r)) || []; }

console.log(`\n=== PROBE [${LABEL}] prod=${PROJ_REF} @ ${new Date().toISOString()} ===\n`);

// 1) CHECK 제약 (customers.insurance_grade) — 값-집합 near_poor/veteran 포함?
const c1 = await query(`
  SELECT c.conname, pg_get_constraintdef(c.oid) AS def
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname='customers' AND c.contype='c'
    AND pg_get_constraintdef(c.oid) ILIKE '%insurance_grade %'
    AND pg_get_constraintdef(c.oid) NOT ILIKE '%insurance_grade_source%'`);
const def = rows(c1)[0]?.def || '(제약 없음)';
const hasNP = /near_poor/.test(def), hasVet = /veteran/.test(def);
console.log(`[1] customers.insurance_grade CHECK: name=${rows(c1)[0]?.conname}`);
console.log(`    near_poor=${hasNP} veteran=${hasVet}`);
console.log(`    def=${def}\n`);

// 2) update_insurance_grade RPC — prosrc md5 + allowlist 값-집합
const c2 = await query(`
  SELECT p.oid::regprocedure::text AS sig, p.prosecdef, md5(p.prosrc) AS md5,
         length(p.prosrc) AS len,
         (p.prosrc ILIKE '%''near_poor''%') AS has_np,
         (p.prosrc ILIKE '%''veteran''%')   AS has_vet
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname='update_insurance_grade' AND n.nspname='public'`);
rows(c2).forEach((r) => console.log(
  `[2] ${r.sig} secdef=${r.prosecdef} md5=${r.md5} len=${r.len} np=${r.has_np} vet=${r.has_vet}`));
console.log('');

// 3) BEFORE INSERT 트리거 실재?
const c3 = await query(`
  SELECT tgname, tgenabled, pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relname='service_charges' AND tgname='trg_service_charges_grade_rate_guard'`);
console.log(`[3] trg_service_charges_grade_rate_guard 실재: ${rows(c3).length} 건`);
rows(c3).forEach((r) => console.log(`    ${r.def}`));
console.log('');

// 3b) guard function 실재?
const c3b = await query(`
  SELECT proname, md5(prosrc) AS md5 FROM pg_proc
  WHERE proname='foot_service_charges_grade_rate_guard'`);
console.log(`[3b] foot_service_charges_grade_rate_guard() 실재: ${rows(c3b).length} 건 ${rows(c3b)[0]?.md5||''}\n`);

// 4) service_charges legacy 'manual' 등급 census (backfill 대상 지문)
const c4 = await query(`
  SELECT
    count(*) FILTER (WHERE customer_grade_at_charge='manual') AS manual_all,
    count(*) FILTER (WHERE customer_grade_at_charge='manual'
       AND is_insurance_covered=false AND copayment_rate_at_charge=1.0) AS manual_fingerprint,
    count(*) FILTER (WHERE customer_grade_at_charge='unverified') AS unverified_all
  FROM service_charges`);
const s = rows(c4)[0] || {};
console.log(`[4] service_charges: manual(전체)=${s.manual_all} manual(지문일치)=${s.manual_fingerprint} unverified(전체)=${s.unverified_all}\n`);

// 4b) freeze 아카이브 테이블 실재/행수
const c4b = await query(`
  SELECT count(*) AS n FROM information_schema.tables
  WHERE table_name='_backfill_sc_manual_grade_20260806'`);
if ((rows(c4b)[0]?.n || 0) > 0) {
  const cnt = await query(`SELECT count(*) AS n FROM _backfill_sc_manual_grade_20260806`);
  console.log(`[4b] freeze 아카이브 _backfill_sc_manual_grade_20260806: 실재, ${rows(cnt)[0]?.n} 행\n`);
} else {
  console.log(`[4b] freeze 아카이브 _backfill_sc_manual_grade_20260806: 부재\n`);
}

// 5) schema_migrations 원장 (3 version)
const c5 = await query(`
  SELECT version FROM supabase_migrations.schema_migrations
  WHERE version IN ('20260806194000','20260806194100','20260806194200')
  ORDER BY version`);
console.log(`[5] schema_migrations 원장 3버전: [${rows(c5).map((r)=>r.version).join(', ')||'(없음)'}]\n`);

console.log(`=== PROBE [${LABEL}] 완료 ===`);
