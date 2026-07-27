#!/usr/bin/env node
/**
 * T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD
 * pending_payment TTL/lock/failure 축 ADDITIVE apply — supervisor DDL-diff GATE GO
 * (MSG-20260727-102112-3z3t, commit d663371c) 집행.
 *
 * supervisor apply-time 필수 가드 (위반 시 ABORT):
 *  (a) prod pending_payment 0-row 재확인.
 *  (b) 별건 orphan payment_preempts DROP(20260727090000): 0-row + inbound-FK 0 재확인 후 원자 apply(idempotent).
 *  (c) dryrun 무영속(No-Persistence) 확인 후 up.sql 원자 apply → ledger forward 기록.
 *  사후: POSTCHECK(신규컬럼3 실재 + widen CHECK 5값 + ledger) 보고 → supervisor 사후검증.
 *
 * transport: Supabase Management API /database/query (foot canonical). read-only 프로브는 자율.
 * usage: node scripts/T-20260727-foot-REDPAY-PLANB-NOWAIT_ttl_apply.mjs [--apply]
 *   (--apply 없으면 가드(a)(b-probe)(c-dryrun)까지만. --apply 시 실집행)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';
import { runDryrun, columnAbsent } from './dryrun_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../supabase/migrations');

const TTL_VERSION = '20260727100000';
const TTL_UP = '20260727100000_foot_redpay_planb_pending_payment_ttl.sql';
const ORPHAN_VERSION = '20260727090000';
const ORPHAN_UP = '20260727090000_foot_drop_orphan_payment_preempts.sql';
const ORPHAN_DRYRUN = '20260727090000_foot_drop_orphan_payment_preempts.dryrun.sql';
const TICKET = 'T-20260727-foot-REDPAY-PLANB-NOWAIT-PAYPAGE-BUILD';
const DO_APPLY = process.argv.includes('--apply');

const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
const log = (...a) => console.log(...a);

// ── Guard (a): prod pending_payment 0-row + 현재 상태 실측 ─────────────────────
async function guardA() {
  log('\n═══ GUARD (a): prod pending_payment 0-row 재확인 ═══');
  const cnt = one(await query(`SELECT count(*)::int AS c FROM public.pending_payment;`));
  const cols = one(await query(
    `SELECT count(*)::int AS c FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pending_payment';`));
  const chk = one(await query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid='public.pending_payment'::regclass AND conname='pending_payment_status_check';`));
  const failedRows = one(await query(
    `SELECT count(*)::int AS c FROM public.pending_payment WHERE status='failed';`));
  log(`  pending_payment row count   = ${cnt.c}  (기대 0)`);
  log(`  현재 컬럼수                 = ${cols.c}  (apply 전 11 / apply 후 14)`);
  log(`  현재 status CHECK def        = ${chk.def || '(none)'}`);
  log(`  status='failed' 행           = ${failedRows.c}`);
  if (cnt.c !== 0) {
    throw new Error(`GUARD(a) ABORT — pending_payment 0-row 아님(${cnt.c}). backfill 안전성 미확보. 중단.`);
  }
  log('  ✓ GUARD(a) PASS — 0-row 확인 (ADDITIVE NOT NULL DEFAULT backfill-safe).');
  return { rows: cnt.c, cols: cols.c, checkDef: chk.def || null, failedRows: failedRows.c };
}

// ── Guard (b): orphan payment_preempts DROP — 재확인 + idempotent apply ────────
async function guardB() {
  log('\n═══ GUARD (b): 별건 orphan payment_preempts DROP(20260727090000) 재확인 ═══');
  const exists = one(await query(
    `SELECT to_regclass('public.payment_preempts') IS NOT NULL AS exists;`));
  log(`  payment_preempts 실재       = ${exists.exists}`);
  const led = one(await query(
    `SELECT count(*)::int AS c FROM supabase_migrations.schema_migrations WHERE version='${ORPHAN_VERSION}';`));
  log(`  ledger ${ORPHAN_VERSION} 존재  = ${led.c}`);

  if (!exists.exists) {
    log('  ✓ GUARD(b) — payment_preempts 이미 부재 = 선행 DROP 완료(idempotent no-op).');
    if (led.c !== 1) {
      log(`  ⚠ ledger ${ORPHAN_VERSION} 미기록 — forward 보정 필요.`);
      if (DO_APPLY) {
        await applyMigration({ version: ORPHAN_VERSION, file: ORPHAN_UP, dryRun: false, createdBy: TICKET });
        log(`  ✓ ledger forward 보정 완료 (테이블 이미 부재, DROP IF EXISTS no-op + 원장 기록).`);
      }
    }
    return { existed: false, applied: false, ledger: led.c };
  }

  // 아직 존재 → 0-row + inbound-FK 0 재확인 후 apply
  const rows = one(await query(`SELECT count(*)::int AS c FROM public.payment_preempts;`));
  const inbound = one(await query(
    `SELECT count(*)::int AS c FROM pg_constraint
      WHERE contype='f' AND confrelid='public.payment_preempts'::regclass;`));
  log(`  payment_preempts row count  = ${rows.c}  (기대 0)`);
  log(`  inbound FK 참조             = ${inbound.c}  (기대 0)`);
  if (rows.c !== 0 || inbound.c !== 0) {
    throw new Error(`GUARD(b) ABORT — payment_preempts rows=${rows.c}/inboundFK=${inbound.c} (기대 0/0). 중단.`);
  }
  if (!DO_APPLY) {
    log('  [--apply 미지정] GUARD(b) 프로브까지만 (0/0 확인). 실집행은 --apply.');
    return { existed: true, applied: false, ledger: led.c };
  }
  await applyMigration({ version: ORPHAN_VERSION, file: ORPHAN_UP, dryRun: false, createdBy: TICKET });
  const gone = one(await query(`SELECT to_regclass('public.payment_preempts') IS NULL AS is_null;`));
  log(`  ✓ GUARD(b) apply 완료 — payment_preempts DROP (to_regclass IS NULL = ${gone.is_null}) + ledger forward.`);
  return { existed: true, applied: true, ledger: 1 };
}

// ── Guard (c): TTL up.sql dryrun 무영속 확인 후 apply + ledger forward ─────────
async function guardCDryrun() {
  log('\n═══ GUARD (c-1): TTL up.sql dryrun 무영속 (No-Persistence) 검증 ═══');
  const UP = join(MIG_DIR, TTL_UP);
  const widenCheckAbsent = {
    label: "CHECK widen 'failed' on pending_payment (non-persistent)",
    sql: `SELECT NOT EXISTS(
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.pending_payment'::regclass
              AND contype = 'c'
              AND pg_get_constraintdef(oid) ILIKE '%failed%'
          ) AS absent;`,
  };
  const res = await runDryrun({
    upPath: UP,
    assertAbsent: [
      columnAbsent('pending_payment', 'expires_at'),
      columnAbsent('pending_payment', 'locked_until'),
      columnAbsent('pending_payment', 'fail_reason'),
      widenCheckAbsent,
    ],
    passNote: '(expires_at/locked_until/fail_reason + failed CHECK widen 무영속 검증)',
    exitProcess: false,
  });
  if (!res.pass) {
    throw new Error(`GUARD(c) ABORT — dryrun 무영속 검증 실패 (code=${res.code}). 중단.`);
  }
  log('  ✓ GUARD(c-1) PASS — dryrun 무영속 통과.');
  return res;
}

async function guardCApply() {
  log('\n═══ GUARD (c-2): TTL up.sql 원자 apply + ledger forward ═══');
  const r = await applyMigration({ version: TTL_VERSION, file: TTL_UP, dryRun: false, createdBy: TICKET });
  log(`  ✓ applyMigration 완료: ${r.version} = ${r.name} (원자 apply + 원장 기록).`);
}

// ── POSTCHECK: 신규 컬럼3 실재 + widen CHECK 5값 + ledger ──────────────────────
async function postcheck() {
  log('\n═══ POSTCHECK ═══');
  const colRows = await query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pending_payment'
        AND column_name IN ('expires_at','locked_until','fail_reason')
      ORDER BY column_name;`);
  const colNames = (Array.isArray(colRows) ? colRows : []).map((r) => r.column_name);
  const cols3 = ['expires_at', 'fail_reason', 'locked_until'].every((c) => colNames.includes(c));
  const chk = one(await query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid='public.pending_payment'::regclass AND conname='pending_payment_status_check';`));
  const def = chk.def || '';
  const widen5 = ['open', 'matched', 'expired', 'failed', 'cancelled'].every((v) => def.includes(`'${v}'`));
  const totalCols = one(await query(
    `SELECT count(*)::int AS c FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pending_payment';`));
  const led = one(await query(
    `SELECT version, name, created_by FROM supabase_migrations.schema_migrations WHERE version='${TTL_VERSION}';`));
  const ledOrphan = one(await query(
    `SELECT count(*)::int AS c FROM supabase_migrations.schema_migrations WHERE version='${ORPHAN_VERSION}';`));

  log('  ① 신규 컬럼 3종:');
  for (const r of (Array.isArray(colRows) ? colRows : [])) {
    log(`     - ${r.column_name} : ${r.data_type} nullable=${r.is_nullable} default=${r.column_default || '(none)'}`);
  }
  log(`     3종 모두 실재 = ${cols3}`);
  log(`  ② status CHECK def = ${def}`);
  log(`     widen 5값(open|matched|expired|failed|cancelled) = ${widen5}`);
  log(`  ③ pending_payment 총 컬럼수 = ${totalCols.c} (기대 14 = 11 + 3)`);
  log(`  ④ ledger ${TTL_VERSION} = ${led.version ? `${led.name} (by ${led.created_by})` : 'ABSENT'}`);
  log(`     ledger ${ORPHAN_VERSION}(orphan drop) = ${ledOrphan.c === 1 ? 'YES' : 'ABSENT'}`);

  const ok = cols3 && widen5 && totalCols.c === 14 && !!led.version && ledOrphan.c === 1;
  log(`\n  POSTCHECK ${ok ? '✓ PASS' : '✗ FAIL'}`);
  return { ok, cols3, widen5, totalCols: totalCols.c, ledgerTtl: led.version || null, ledgerOrphan: ledOrphan.c };
}

(async () => {
  const a = await guardA();
  const b = await guardB();
  const c = await guardCDryrun();
  if (!DO_APPLY) {
    log('\n[--apply 미지정] 가드(a)+(b-probe)+(c-dryrun)까지만 실행. 실집행하려면 --apply.');
    log(JSON.stringify({ guardA: a, guardB: b, guardCDryrun: { pass: c.pass } }, null, 2));
    return;
  }
  await guardCApply();
  const post = await postcheck();
  log('\n════════ 결과 요약(JSON) ════════');
  log(JSON.stringify({ guardA: a, guardB: b, postcheck: post }, null, 2));
  if (!post.ok) process.exit(2);
})().catch((e) => { console.error('\n✗ 실패:', e.message); process.exit(1); });
