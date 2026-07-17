/**
 * T-20260619-foot-CATSTAT-PKGITEM-SOURCE (reconcile / FIX batch2 재이식) — prod forward-apply
 *
 * supervisor DB-GATE = GO (green) — MSG-20260718-000945-ndbu (재발송, 직전 MSG-20260718-000903-i2p9).
 *   DDL-diff 재QA 전항목 PASS. base 정정 실측 확증(prod live = 20260715140000, R5 아님).
 *   근거: CREATE OR REPLACE 1종·시그니처 3컬럼 불변(42P13 불가)·rollback body=20260715140000 정본 일치·
 *         권한 INVOKER/authenticated·non-persistence(dry-run 무영속)·iv-exclude(패키지 브랜치 신규도입)·
 *         source-swap(single_paid 무변경, 차이=패키지 브랜치만 booking≠performance G2 known-limit).
 *         base parity 실측: prod prosrc md5 = 623999a0e12998f2080b976d3c938731 = 20260715140000.
 *         DA GO_WARN(sg37) + G1(김주연 2-A confirm) 유효. Cross-CRM Contract N/A(foot-local).
 *
 * 절차 (supervisor DB-GATE body 4단계):
 *   (1) BEFORE: prod foot_stats_by_category prosrc md5 스냅샷 (기대 = 623999a0e12998f2080b976d3c938731)
 *   (2) applyMigration: mig 20260717190000 CREATE OR REPLACE prod 적용 + schema_migrations version stamp (Track3 단일경로)
 *   (3) AFTER post-probe: 신 prosrc md5(≠623999a0) live 확인 + NEW 결과에 category='iv' 부재 재확인
 *   (4) PASS 시 → deploy-ready/deployed 마킹 + bus deployed 이벤트 (호출부에서)
 *   이상 시 → 20260717190000_*.rollback.sql 즉시 역전.
 *
 * 사용:  node scripts/T-20260619-foot-CATSTAT-PKGITEM-SOURCE_apply.mjs           # dry-run (스냅샷만, write 0)
 *        node scripts/T-20260619-foot-CATSTAT-PKGITEM-SOURCE_apply.mjs --apply   # PROD forward-apply (supervisor GO 후)
 *
 * author: dev-foot / 2026-07-18
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260717190000';
const FILE = '20260717190000_foot_stats_by_category_pkg_created_reconcile.sql';
const BASE_MD5 = '623999a0e12998f2080b976d3c938731'; // 정본 = 현행 prod live(20260715140000)
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브의원 서울오리진점 (foot active)

const MD5_SQL = `SELECT md5(pg_get_functiondef(p.oid)) AS h
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'foot_stats_by_category';`;

// iv 부재 재확인용: 신 RPC 를 직접 호출해 category='iv' 행이 없는지 확인(패키지 브랜치 배제).
const IV_PROBE_SQL = `SELECT category FROM foot_stats_by_category('${CLINIC}', '2026-05-01', '2026-07-31')
  WHERE category = 'iv';`;

function nowKst() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }) + ' KST';
}

async function md5(label) {
  const rows = await query(MD5_SQL);
  const h = (Array.isArray(rows) ? rows : [])[0]?.h;
  console.log(`[${label}] prod foot_stats_by_category prosrc md5 = ${h}  (${nowKst()})`);
  return h;
}

console.log(`=== T-20260619-foot-CATSTAT-PKGITEM-SOURCE ${APPLY ? 'APPLY' : 'DRY-RUN'} ===`);
console.log(`project: rxlomoozakkjesdqjtvd (obliv-foot-crm prod)`);
console.log(`mig: ${FILE}\n`);

// (1) BEFORE — base parity 확인
const before = await md5('BEFORE');
const baseOk = before === BASE_MD5;
console.log(`  base parity: ${baseOk ? '✅' : '❌'} ${baseOk ? '일치' : '불일치'} (기대 ${BASE_MD5})`);
if (!baseOk) {
  console.log('\n❌ ABORT — base md5 불일치. prod live 가 정본(20260715140000) 아님. 적용 중단, planner/supervisor 확인 필요.');
  process.exit(1);
}

// (2) applyMigration — DDL + 원장 stamp (단일경로)
const res = await applyMigration({
  version: VERSION,
  file: FILE,
  dryRun: !APPLY,
  createdBy: 'T-20260619-foot-CATSTAT-PKGITEM-SOURCE',
});
console.log(`\napplyMigration:`, JSON.stringify(res));

if (!APPLY) {
  console.log('\n(dry-run — SQL·원장 미실행. --apply 로 실적용)');
  process.exit(0);
}

// (3) AFTER post-probe — 신 md5(≠base) 영속 + iv 부재
const after = await md5('AFTER');
const swapped = after && after !== BASE_MD5;
const ivRows = await query(IV_PROBE_SQL);
const ivAbsent = (Array.isArray(ivRows) ? ivRows : []).length === 0;

console.log('\n── 사후검증 (post-probe) ──');
console.log(`  ${swapped ? '✅' : '❌'} prosrc md5 전환 (신 ${after} ≠ base ${BASE_MD5})`);
console.log(`  ${ivAbsent ? '✅' : '❌'} category='iv' 부재 (2026-05~07, 패키지 브랜치 iv-exclude 확인)`);

// 원장 stamp 확인
const ledger = await query(`SELECT version FROM supabase_migrations.schema_migrations WHERE version = '${VERSION}';`);
const stamped = (Array.isArray(ledger) ? ledger : []).length === 1;
console.log(`  ${stamped ? '✅' : '❌'} schema_migrations version ${VERSION} stamped`);

const pass = swapped && ivAbsent && stamped;
console.log(pass
  ? `\n✅✅ PASS — forward-apply 완료. 신 md5=${after} (applied_at=${nowKst()})`
  : '\n❌ FAIL — 사후검증 실패. 20260717190000_*.rollback.sql 즉시 역전 필요.');
process.exit(pass ? 0 : 1);
