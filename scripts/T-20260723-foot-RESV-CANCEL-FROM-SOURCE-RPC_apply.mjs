/**
 * T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC — prod apply (ADDITIVE 신규 callable).
 * 마이그: supabase/migrations/20260723200000_foot_cancel_reservation_from_source_rpc.sql
 *   CREATE FUNCTION cancel_reservation_from_source(text,text,text) + REVOKE(PUBLIC/anon/authenticated) + COMMENT.
 *
 * 흐름:
 *   [PREFLIGHT] 현행 함수 오버로드/ACL 스냅샷(신규 = 부재 기대)
 *   [DRY]       --apply 없으면 미실행(계획만). 무영속 dryrun 은 별도 .dryrun.mjs.
 *   [APPLY]     foot_migration_ledger.applyMigration — DDL 적용 + schema_migrations 원장 기록(단일경로)
 *   [POSTVERIFY] 단일 시그니처(text,text,text)/SECDEF/anon·authenticated EXECUTE 부재/원장 기록 + 스모크
 *      · AC-3 fail-close: 비-dopamine → 예외
 *      · AC-2 멱등: 미존재 external_id → noop_absent (예약 무변경)
 *
 * 실행: node scripts/T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC_apply.mjs           (PREFLIGHT + DRY-only)
 *       node scripts/T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC_apply.mjs --apply    (실적용)
 * author: dev-foot / 2026-07-23
 */
import { applyMigration, query, ledgerVersions } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260723200000';
const FILE = `${VERSION}_foot_cancel_reservation_from_source_rpc.sql`;

const PROC_INTROSPECT = `
  SELECT p.oid,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.pronargs,
         p.prosecdef                               AS security_definer,
         has_function_privilege('anon','public.cancel_reservation_from_source(text,text,text)','EXECUTE')          AS anon_exec,
         has_function_privilege('authenticated','public.cancel_reservation_from_source(text,text,text)','EXECUTE') AS auth_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'cancel_reservation_from_source'
  ORDER BY p.pronargs;`;

// ── 1) PREFLIGHT ──────────────────────────────────────────────────────────────
const pre = await query(PROC_INTROSPECT);
console.log('=== PREFLIGHT: cancel_reservation_from_source overloads ===');
console.log(JSON.stringify(pre, null, 2));
console.log(`PREFLIGHT overload count = ${pre.length} (expect 0 = 신규)`);

if (!APPLY) {
  console.log('\n[DRY-RUN] --apply 없음 → 마이그 미실행. 무영속 검증은 .dryrun.mjs, PREFLIGHT 확인 후 --apply.');
  process.exit(0);
}

// ── 2) APPLY (applyMigration = DDL + 원장 단일경로) ────────────────────────────
console.log('\n=== APPLY: applyMigration (DDL + schema_migrations 원장) ===');
const res = await applyMigration({
  version: VERSION, file: FILE, dryRun: false,
  createdBy: 'T-20260723-foot-RESV-CANCEL-FROM-SOURCE-RPC',
});
console.log(`APPLY: ${JSON.stringify(res)}`);

// ── 3) POSTVERIFY ─────────────────────────────────────────────────────────────
let ok = true;
const post = await query(PROC_INTROSPECT);
console.log('\n=== POSTVERIFY: cancel_reservation_from_source overloads ===');
console.log(JSON.stringify(post, null, 2));

if (post.length !== 1) { console.error(`❌ 오버로드 ${post.length}개 — 기대 1개`); ok = false; }
else {
  const args = post[0].args.replace(/\s+/g, ' ').trim();
  // identity args = "p_source_system text, p_external_id text, p_reason text" → 타입만 추출해 대조
  const types = args.split(',').map((a) => a.trim().split(/\s+/).pop()).join(',');
  if (post[0].pronargs !== 3 || types !== 'text,text,text') {
    console.error(`❌ signature types "${types}" (pronargs=${post[0].pronargs}) ≠ text,text,text`); ok = false;
  } else console.log(`✅ 단일 시그니처 = (${args})`);
  if (post[0].security_definer !== true) { console.error('❌ SECURITY DEFINER 아님'); ok = false; }
  else console.log('✅ SECURITY DEFINER');
  if (post[0].anon_exec === true) { console.error('❌ anon EXECUTE 잔존 (revoke 실패)'); ok = false; }
  else console.log('✅ anon EXECUTE 부재');
  if (post[0].auth_exec === true) { console.error('❌ authenticated EXECUTE 잔존 (revoke 실패)'); ok = false; }
  else console.log('✅ authenticated EXECUTE 부재');
}

// 원장 기록 확인
const ledger = await ledgerVersions();
if (ledger.has(VERSION)) console.log(`✅ LEDGER: schema_migrations 에 ${VERSION} 기록`);
else { console.error(`❌ LEDGER: ${VERSION} 미기록`); ok = false; }

// ── 4) 스모크 (부작용 0 케이스만) ──────────────────────────────────────────────
console.log('\n=== SMOKE ===');
// AC-3 fail-close: 비-dopamine → 예외
try {
  await query(`SELECT public.cancel_reservation_from_source('aicc','smoke-x');`);
  console.error('❌ AC-3: 비-dopamine 가 예외 없이 통과'); ok = false;
} catch (e) {
  console.log(`✅ AC-3 fail-close: 비-dopamine 예외 (${String(e.message).slice(0, 80)}…)`);
}
// AC-2 멱등: 미존재 external_id → noop_absent (예약 무변경)
try {
  const r = await query(`SELECT public.cancel_reservation_from_source('dopamine','smoke-nonexistent-${VERSION}') AS out;`);
  const out = Array.isArray(r) && r[0] ? r[0].out : null;
  const action = out && (out.action || (typeof out === 'string' && JSON.parse(out).action));
  if (String(JSON.stringify(out)).includes('noop_absent')) console.log(`✅ AC-2 멱등: 미존재 → noop_absent (${JSON.stringify(out)})`);
  else { console.error(`❌ AC-2: 미존재 응답 예상밖 = ${JSON.stringify(out)}`); ok = false; }
} catch (e) {
  console.error(`❌ AC-2 smoke 실패: ${e.message}`); ok = false;
}

console.log(ok ? '\n✅ ALL POSTVERIFY PASS' : '\n❌ POSTVERIFY FAIL — 롤백 검토');
process.exit(ok ? 0 : 1);
