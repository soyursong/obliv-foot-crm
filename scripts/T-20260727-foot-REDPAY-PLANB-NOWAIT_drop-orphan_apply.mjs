#!/usr/bin/env node
/**
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD
 * orphan payment_preempts DROP — supervisor DDL-GATE GO (MSG-20260727-094512-61ir) 집행.
 *
 * supervisor apply 조건 4단계 그대로:
 *  1) dryrun.sql 를 prod 에서 먼저 실행 → rows=0/inbound FK=0/DROP 성공/txn 내 부재/ROLLBACK 무영속.
 *     ABORT(RAISE EXCEPTION) 시 즉시 중단·회신.
 *  2) dryrun 무영속 통과 시에만 up.sql 원자 apply. 가드 abort 시 강제 금지·수동검토 회신.
 *  3) ledger 20260727090000 forward 기록(20260725040000 정직 유지).
 *  4) POSTCHECK: to_regclass NULL + ledger 실재 + canonical pending_payment 무손상(11컬럼).
 *
 * transport: Supabase Management API /database/query (foot canonical). read-only 프로브는 자율.
 * usage: node scripts/T-20260727-foot-REDPAY-PLANB-NOWAIT_drop-orphan_apply.mjs [--apply]
 *   (--apply 없으면 STEP1 dryrun + 프로브까지만. --apply 시 STEP2~4 실집행)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, recordLedger } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../supabase/migrations');
const VERSION = '20260727090000';
const UP_FILE = '20260727090000_foot_drop_orphan_payment_preempts.sql';
const DRYRUN_FILE = '20260727090000_foot_drop_orphan_payment_preempts.dryrun.sql';
const TICKET = 'T-20260727-foot-REDPAY-PLANB-NOWAIT';
const DO_APPLY = process.argv.includes('--apply');

const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
const log = (...a) => console.log(...a);

async function preProbe() {
  log('\n═══ STEP 0: 사전 프로브 (read-only) ═══');
  const exists = one(await query(
    `SELECT to_regclass('public.payment_preempts') IS NOT NULL AS exists;`));
  log(`  payment_preempts 실재      = ${exists.exists}`);
  let rows = { c: 'n/a' }, inbound = { c: 'n/a' };
  if (exists.exists) {
    rows = one(await query(`SELECT count(*)::int AS c FROM public.payment_preempts;`));
    inbound = one(await query(
      `SELECT count(*)::int AS c FROM pg_constraint
        WHERE contype='f' AND confrelid='public.payment_preempts'::regclass;`));
    log(`  payment_preempts row count = ${rows.c}  (기대 0)`);
    log(`  inbound FK 참조            = ${inbound.c}  (기대 0)`);
  }
  const pp = one(await query(
    `SELECT to_regclass('public.pending_payment') IS NOT NULL AS exists;`));
  const ppCols = one(await query(
    `SELECT count(*)::int AS c FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pending_payment';`));
  log(`  canonical pending_payment  = 실재 ${pp.exists}, 컬럼수 ${ppCols.c} (기대 11)`);
  const led = one(await query(
    `SELECT count(*)::int AS c FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`));
  log(`  ledger ${VERSION} 사전존재  = ${led.c}`);
  return { exists: exists.exists, rows: rows.c, inbound: inbound.c, ppCols: ppCols.c, ledger: led.c };
}

async function step1Dryrun() {
  log('\n═══ STEP 1: dryrun.sql 무영속 실행 (prod) ═══');
  const sql = readFileSync(join(MIG_DIR, DRYRUN_FILE), 'utf8');
  try {
    await query(sql);
    log('  dryrun 실행 성공 (RAISE EXCEPTION 없음 = 가드 통과 + DROP 성공 + ROLLBACK).');
  } catch (e) {
    log(`  ✗ dryrun ABORT/error: ${e.message}`);
    throw new Error(`STEP1 dryrun 실패 — 중단. (${e.message})`);
  }
  // post-probe: ROLLBACK 이후 테이블 여전히 실재해야 무영속 증명
  const after = one(await query(
    `SELECT to_regclass('public.payment_preempts') IS NOT NULL AS exists;`));
  log(`  post-probe: payment_preempts 실재 = ${after.exists} (기대 true = ROLLBACK 무영속 확인)`);
  if (!after.exists) throw new Error('STEP1 무영속 위반 — dryrun 이 실제로 DROP 을 영속시킴. 중단.');
  log('  ✓ STEP1 무영속 통과.');
}

async function step2Apply() {
  log('\n═══ STEP 2: up.sql 원자 apply + STEP 3: ledger forward ═══');
  const r = await applyMigration({ version: VERSION, file: UP_FILE, dryRun: false, createdBy: TICKET });
  log(`  ✓ applyMigration 완료: ${r.version} = ${r.name} (원장 기록 포함)`);
}

async function step4Postcheck() {
  log('\n═══ STEP 4: POSTCHECK ═══');
  const gone = one(await query(
    `SELECT to_regclass('public.payment_preempts') IS NULL AS is_null;`));
  const led = one(await query(
    `SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${VERSION}';`));
  const led725 = one(await query(
    `SELECT count(*)::int AS c FROM supabase_migrations.schema_migrations WHERE version='20260725040000';`));
  const pp = one(await query(
    `SELECT to_regclass('public.pending_payment') IS NOT NULL AS exists;`));
  const ppCols = one(await query(
    `SELECT count(*)::int AS c FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pending_payment';`));
  log(`  ① payment_preempts to_regclass IS NULL = ${gone.is_null}`);
  log(`  ② ledger ${VERSION} = ${led.version ? `${led.name} (by ${led.created_by})` : 'ABSENT'}`);
  log(`     ledger 20260725040000 유지 = ${led725.c === 1 ? 'YES (정직 유지)' : 'ABSENT'}`);
  log(`  ③ canonical pending_payment 실재 ${pp.exists} / 컬럼수 ${ppCols.c} (기대 11 무손상)`);
  const ok = gone.is_null === true && !!led.version && pp.exists === true && ppCols.c === 11;
  log(`\n  POSTCHECK ${ok ? '✓ PASS' : '✗ FAIL'}`);
  return { ok, gone: gone.is_null, ledger: led.version || null, led725: led725.c, ppExists: pp.exists, ppCols: ppCols.c };
}

(async () => {
  const pre = await preProbe();
  await step1Dryrun();
  if (!DO_APPLY) {
    log('\n[--apply 미지정] STEP1 까지만 실행. 실집행하려면 --apply 로 재실행.');
    return;
  }
  await step2Apply();
  const post = await step4Postcheck();
  log('\n════════ 결과 요약(JSON) ════════');
  log(JSON.stringify({ pre, post }, null, 2));
  if (!post.ok) process.exit(2);
})().catch((e) => { console.error('\n✗ 실패:', e.message); process.exit(1); });
