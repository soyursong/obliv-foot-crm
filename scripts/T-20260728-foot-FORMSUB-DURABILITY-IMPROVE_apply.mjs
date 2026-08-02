#!/usr/bin/env node
/**
 * T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A, db_only) — guarded PROD apply (dev-foot)
 *
 * supervisor DDL-diff GO: MSG-20260802-094821-b22y (verdict GO · ADDITIVE 확정 · 회귀0).
 *   → dev-foot 직접 PROD apply(db_only) 인가. apply 후 applied_at+deployed 마킹 → merge.
 *
 * mig: supabase/migrations/20260802150000_foot_form_submissions_softdelete_audit.sql
 * rollback: 20260802150000_foot_form_submissions_softdelete_audit.rollback.sql
 *
 * 순서 (HARD):
 *   STEP0  LEASE GUARD — 원장에 20260802150000 이미 기록? + 신규 오브젝트(deleted_at 등) 이미 실재?
 *          → 둘 다 있으면 byte-identical 재apply 회피(idempotent no-op) 후 POSTCHECK 만.
 *   STEP1  PRE-APPLY OOB STOMP 재확인 — immutable_guard prod 현정의 = 20260616 원본(published-only,
 *          DELETE→RETURN OLD, TG_OP DELETE 전면차단 없음)과 일치. 불일치 시 ABORT(외부개입 의심).
 *   STEP2  (--apply) 마이그 원자 apply + 원장 기록 (foot_migration_ledger.applyMigration).
 *   STEP3  POSTCHECK (supervisor 지정 7항):
 *          (a) soft-delete 4컬럼 실재 (deleted_at/deleted_by/delete_reason/is_deleted[GENERATED])
 *          (b) form_submissions_audit_log 테이블 + RLS(SELECT=director/admin · UPDATE/DELETE 정책 부재)
 *          (c) trg_form_submissions_body_audit 트리거
 *          (d) immutable_guard prosrc 에 TG_OP='DELETE' RAISE + published 불변 실재
 *          (e) fs_deleted_rows_director_only RESTRICTIVE(deleted_at 술어)
 *          (f) form_submissions_update published 이중방어 무변
 *          (g) schema_migrations 20260802150000 recorded
 *
 * usage:
 *   node scripts/T-20260728-foot-FORMSUB-DURABILITY-IMPROVE_apply.mjs           # STEP0+1 read-only (pre-check)
 *   node scripts/T-20260728-foot-FORMSUB-DURABILITY-IMPROVE_apply.mjs --apply   # STEP2+3 실집행
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const VERSION = '20260802150000';
const UP_FILE = '20260802150000_foot_form_submissions_softdelete_audit.sql';
const DO_APPLY = process.argv.includes('--apply');

const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
const log = (...a) => console.log(...a);

async function step0_lease() {
  log('\n═══ STEP0: LEASE GUARD (idempotent 재apply 회피) ═══');
  const inLedger = one(await query(
    `SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${VERSION}') AS e;`)).e;
  const colExists = one(await query(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='form_submissions' AND column_name='deleted_at') AS e;`)).e;
  const tblExists = one(await query(
    `SELECT to_regclass('public.form_submissions_audit_log') IS NOT NULL AS e;`)).e;
  log(`  ledger 20260802150000 기록됨 = ${inLedger}`);
  log(`  form_submissions.deleted_at 실재 = ${colExists}`);
  log(`  form_submissions_audit_log 실재 = ${tblExists}`);
  const alreadyApplied = inLedger && colExists && tblExists;
  const partial = (inLedger || colExists || tblExists) && !alreadyApplied;
  if (partial) {
    log('  ⚠ PARTIAL STATE 감지 — 일부만 존재. 자동 apply 중단(수동 검토 필요).');
    throw new Error('LEASE_GUARD_PARTIAL_STATE');
  }
  if (alreadyApplied) log('  → 이미 완전 적용됨. STEP2 skip, POSTCHECK 만 수행(no-op).');
  else log('  → 미적용(clean). apply 진행 가능.');
  return { alreadyApplied };
}

async function step1_oob(alreadyApplied) {
  log('\n═══ STEP1: PRE-APPLY OOB STOMP 재확인 (immutable_guard) ═══');
  const def = one(await query(
    `SELECT pg_get_functiondef(oid) AS d FROM pg_proc WHERE proname='form_submissions_published_immutable_guard';`)).d;
  if (!def) {
    log('  ⚠ immutable_guard 함수 부재 — 예상외 상태.');
    throw new Error('OOB_GUARD_ABSENT');
  }
  const hasPublished = /published/.test(def);
  const hasHardDeleteBlock = /TG_OP\s*=\s*'DELETE'[\s\S]*RAISE\s+EXCEPTION/i.test(def);
  const hasDeleteReturnOld = /TG_OP\s*=\s*'DELETE'[\s\S]*RETURN\s+OLD/i.test(def);
  log(`  guard 에 published 불변 = ${hasPublished}`);
  log(`  guard 에 TG_OP='DELETE' 전면차단(RAISE) = ${hasHardDeleteBlock}`);
  log(`  guard 에 DELETE→RETURN OLD(원본형) = ${hasDeleteReturnOld}`);
  if (alreadyApplied) {
    // 이미 적용된 상태라면 guard 는 강화형(hard-DELETE RAISE)이어야 정상.
    if (!hasHardDeleteBlock) throw new Error('OOB_POST_APPLY_GUARD_MISMATCH');
    log('  → 이미 적용 상태: guard 강화형 확인 OK.');
    return;
  }
  // 미적용 상태: guard 는 20260616 원본형(published-only + DELETE→RETURN OLD, hard-DELETE RAISE 없음)이어야 함.
  if (hasHardDeleteBlock) {
    log('  ⚠ 미적용인데 guard 가 이미 hard-DELETE 차단형 — OOB 개입 의심.');
    throw new Error('OOB_STOMP_DETECTED');
  }
  if (!hasPublished) throw new Error('OOB_GUARD_UNEXPECTED_SHAPE');
  log('  → 미적용 + guard = 20260616 원본형(published-only) 확인. OOB stomp 무. apply 안전.');
}

async function step2_apply() {
  log('\n═══ STEP2: 마이그 원자 apply + 원장 기록 ═══');
  const res = await applyMigration({
    version: VERSION, file: UP_FILE, dryRun: false,
    createdBy: 'dev-foot:FORMSUB-DURABILITY-IMPROVE:MSG-20260802-094821-b22y',
  });
  log('  applyMigration:', JSON.stringify(res));
}

async function step3_postcheck() {
  log('\n═══ STEP3: POSTCHECK (supervisor 지정 7항) ═══');
  const results = {};

  // (a) soft-delete 4컬럼 + is_deleted GENERATED
  const cols = await query(
    `SELECT column_name, is_generated FROM information_schema.columns
     WHERE table_schema='public' AND table_name='form_submissions'
       AND column_name IN ('deleted_at','deleted_by','delete_reason','is_deleted') ORDER BY column_name;`);
  const colMap = Object.fromEntries((cols || []).map((c) => [c.column_name, c.is_generated]));
  results.a_cols_4 = ['deleted_at', 'deleted_by', 'delete_reason', 'is_deleted'].every((c) => c in colMap);
  results.a_is_deleted_generated = colMap['is_deleted'] === 'ALWAYS';
  log(`  (a) 4컬럼 실재 = ${results.a_cols_4} ${JSON.stringify(colMap)}`);
  log(`      is_deleted GENERATED(ALWAYS) = ${results.a_is_deleted_generated}`);

  // (b) audit_log 테이블 + RLS
  results.b_table = one(await query(
    `SELECT to_regclass('public.form_submissions_audit_log') IS NOT NULL AS e;`)).e;
  const auditPolicies = await query(
    `SELECT policyname, cmd, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='form_submissions_audit_log' ORDER BY policyname;`);
  const selPol = (auditPolicies || []).find((p) => p.cmd === 'SELECT');
  results.b_select_director_admin = !!selPol && /director/.test(selPol.qual || '') && /admin/.test(selPol.qual || '') && !/is_approved_user/.test(selPol.qual || '');
  results.b_no_update_delete = !(auditPolicies || []).some((p) => p.cmd === 'UPDATE' || p.cmd === 'DELETE');
  const rlsEnabled = one(await query(
    `SELECT relrowsecurity AS e FROM pg_class WHERE oid='public.form_submissions_audit_log'::regclass;`)).e;
  results.b_rls_enabled = rlsEnabled === true || rlsEnabled === 't';
  log(`  (b) audit_log 테이블 = ${results.b_table} / RLS enabled = ${results.b_rls_enabled}`);
  log(`      SELECT=director/admin(not approved) = ${results.b_select_director_admin} / UPDATE·DELETE 정책 부재 = ${results.b_no_update_delete}`);
  log(`      policies = ${JSON.stringify(auditPolicies)}`);

  // (c) body_audit 트리거
  results.c_trigger = one(await query(
    `SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       WHERE c.relname='form_submissions' AND t.tgname='trg_form_submissions_body_audit' AND NOT t.tgisinternal) AS e;`)).e;
  log(`  (c) trg_form_submissions_body_audit = ${results.c_trigger}`);

  // (d) immutable_guard prosrc: TG_OP='DELETE' RAISE + published
  const guardDef = one(await query(
    `SELECT pg_get_functiondef(oid) AS d FROM pg_proc WHERE proname='form_submissions_published_immutable_guard';`)).d || '';
  results.d_hard_delete_block = /TG_OP\s*=\s*'DELETE'[\s\S]*RAISE\s+EXCEPTION/i.test(guardDef);
  results.d_published = /published/.test(guardDef);
  log(`  (d) guard hard-DELETE 전면차단(RAISE) = ${results.d_hard_delete_block} / published 불변 = ${results.d_published}`);

  // (e) fs_deleted_rows_director_only RESTRICTIVE (deleted_at 술어)
  const restr = one(await query(
    `SELECT permissive, qual FROM pg_policies
     WHERE schemaname='public' AND tablename='form_submissions' AND policyname='fs_deleted_rows_director_only';`));
  results.e_restrictive = restr.permissive === 'RESTRICTIVE' && /deleted_at/.test(restr.qual || '');
  log(`  (e) fs_deleted_rows_director_only RESTRICTIVE+deleted_at = ${results.e_restrictive} (${restr.permissive})`);

  // (f) form_submissions_update published 이중방어
  const updPol = one(await query(
    `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='form_submissions' AND policyname='form_submissions_update';`));
  results.f_update_published = /published/.test(updPol.qual || '');
  log(`  (f) form_submissions_update published 이중방어 = ${results.f_update_published}`);

  // (g) ledger
  results.g_ledger = one(await query(
    `SELECT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='${VERSION}') AS e;`)).e;
  log(`  (g) schema_migrations ${VERSION} recorded = ${results.g_ledger}`);

  const bool = (v) => v === true || v === 't' || v === 'true';
  const allPass = Object.values(results).every((v) => bool(v));
  log(`\n  POSTCHECK ${allPass ? 'PASS ✓ (dev self-probe — supervisor 사후 read-only 재검증 대기)' : '✗ FAIL — 검토 필요'}`);
  log('\n───REPORT-JSON───');
  log(JSON.stringify({ ticket: 'T-20260728-foot-FORMSUB-DURABILITY-IMPROVE', version: VERSION, apply: DO_APPLY, postcheck: results, all_pass: allPass }, null, 2));
  if (!allPass) process.exit(2);
}

async function main() {
  log(`### FORMSUB-DURABILITY-IMPROVE 트랙A apply (${DO_APPLY ? 'APPLY' : 'PRE-CHECK only'}) — ${VERSION}`);
  const { alreadyApplied } = await step0_lease();
  await step1_oob(alreadyApplied);
  if (!DO_APPLY) {
    if (alreadyApplied) { log('\n[--apply 없음] 이미 적용상태 — POSTCHECK 수행:'); await step3_postcheck(); }
    else log('\n[--apply 없음] STEP2/3 미실행. --apply 로 실집행.');
    return;
  }
  if (!alreadyApplied) await step2_apply();
  else log('\n[LEASE] 이미 적용 — STEP2 skip.');
  await step3_postcheck();
}

main().catch((e) => { console.error('\n✗ 집행 중단:', e.message); process.exit(1); });
