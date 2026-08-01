#!/usr/bin/env node
/**
 * T-20260730-foot-REDPAY-APPROVALNO-BACKFILL-405 — guarded prod apply 집행 (dev-foot)
 * supervisor DB-GATE GO: MSG-20260802-051410-iivm (artifact triple fbb4537c).
 *
 * data_correction_backfill_sop 준수, 순서 HARD:
 *  STEP0  read-only pre-probe (인증컨텍스트=service Management API). NULL/filled/total,
 *         ambiguous count, freeze count(=would-UPDATE), 매출·매칭 정합 baseline.
 *  STEP1  20260802050000_..._backfill_405.dryrun.sql (BEGIN..ROLLBACK 무영속) 실행.
 *         Management API 는 RAISE NOTICE 를 echo 하지 않으므로 수치는 STEP0 read-only 로 실측,
 *         dryrun 은 in-SQL assert(would-UPDATE==freeze, NULL 혼입 abort) 의 PASS/RAISE 여부로 검증.
 *  STEP1b post-dryrun no-persistence probe: _backup 대상테이블 부재 + NULL count 불변 확인
 *         (migration_dryrun_no_persistence 준수).
 *  STEP2  (--apply) 20260802050000_..._backfill_405.sql (BEGIN..COMMIT) 원자 apply + ledger 기록.
 *         rows-affected = _backup 스냅샷 count (= UPDATE ROW_COUNT, assert 내장).
 *  STEP3  POSTCHECK: NULL 개선·payments row/sum(amount) 불변·matched 링크 drop 0·ambiguous 목록.
 *
 * usage:
 *   node scripts/T-...-BACKFILL-405_apply.mjs           # STEP0+1+1b 까지 (dry-run only)
 *   node scripts/T-...-BACKFILL-405_apply.mjs --apply   # STEP2+3 실집행
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { query, applyMigration, MIG_DIR } from './lib/foot_migration_ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = '20260802050000';
const UP_FILE = '20260802050000_foot_redpay_approvalno_backfill_405.sql';
const DRYRUN_FILE = '20260802050000_foot_redpay_approvalno_backfill_405.dryrun.sql';
const BACKUP_TBL = '_backup.foot_redpay_approvalno_backfill_405_20260802';
const AMBIG_TBL = '_backup.foot_redpay_approvalno_ambiguous_20260802';
const DO_APPLY = process.argv.includes('--apply');

const one = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
const log = (...a) => console.log(...a);

const Q_AMBIG_CNT = `
SELECT count(*)::int AS c FROM (
  SELECT r.matched_payment_id
  FROM public.redpay_raw_transactions r
  JOIN public.payments p ON p.id = r.matched_payment_id
  WHERE r.matched_payment_id IS NOT NULL AND r.approval_no IS NOT NULL
    AND p.external_approval_no IS NULL
  GROUP BY r.matched_payment_id
  HAVING count(DISTINCT r.approval_no) >= 2
) x;`;

const Q_FREEZE_CNT = `
SELECT count(*)::int AS c
FROM public.payments p
WHERE p.external_approval_no IS NULL
  AND EXISTS (SELECT 1 FROM public.redpay_raw_transactions r
              WHERE r.matched_payment_id = p.id AND r.approval_no IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT r.matched_payment_id AS payment_id
      FROM public.redpay_raw_transactions r
      JOIN public.payments p2 ON p2.id = r.matched_payment_id
      WHERE r.matched_payment_id IS NOT NULL AND r.approval_no IS NOT NULL
        AND p2.external_approval_no IS NULL
      GROUP BY r.matched_payment_id HAVING count(DISTINCT r.approval_no) >= 2
    ) a WHERE a.payment_id = p.id);`;

const Q_NULLSTATS = `
SELECT count(*) FILTER (WHERE external_approval_no IS NULL)::int     AS null_remaining,
       count(*) FILTER (WHERE external_approval_no IS NOT NULL)::int AS filled,
       count(*)::int AS total FROM public.payments;`;

const Q_INVARIANTS = `
SELECT (SELECT count(*)::int FROM public.payments)                                          AS payments_rows,
       (SELECT coalesce(sum(amount),0)::numeric FROM public.payments)                       AS sum_amount,
       (SELECT count(*)::int FROM public.redpay_raw_transactions WHERE matched_payment_id IS NOT NULL) AS matched_links;`;

async function baseline() {
  const nul = one(await query(Q_NULLSTATS));
  const amb = one(await query(Q_AMBIG_CNT));
  const frz = one(await query(Q_FREEZE_CNT));
  const inv = one(await query(Q_INVARIANTS));
  return {
    null_remaining: nul.null_remaining, filled: nul.filled, total: nul.total,
    ambiguous: amb.c, freeze: frz.c,
    payments_rows: inv.payments_rows, sum_amount: inv.sum_amount, matched_links: inv.matched_links,
  };
}

async function step0() {
  log('\n═══ STEP0: read-only pre-probe (Management API service context) ═══');
  const b = await baseline();
  log(`  payments total            = ${b.total}`);
  log(`  external_approval_no NULL  = ${b.null_remaining}  (백필 前)`);
  log(`  external_approval_no 채움  = ${b.filled}`);
  log(`  ── data_correction 대상 산출 ──`);
  log(`  ambiguous(1:N distinct approval_no) 분리 = ${b.ambiguous} 건 → manual 큐(leave NULL)`);
  log(`  freeze-set(대상 payment) = ${b.freeze} 건  (= would-UPDATE 예상, supervisor ★≈214)`);
  log(`  ── 정합 baseline(불변 대상) ──`);
  log(`  payments rows = ${b.payments_rows} / sum(amount) = ${b.sum_amount} / matched_links = ${b.matched_links}`);
  return b;
}

async function step1_dryrun(pre) {
  log('\n═══ STEP1: dryrun.sql (BEGIN..ROLLBACK 무영속) 실행 ═══');
  const sql = readFileSync(join(MIG_DIR, DRYRUN_FILE), 'utf8');
  try {
    await query(sql);
    log('  dryrun 실행 완료 (RAISE EXCEPTION 없음) → in-SQL assert PASS:');
    log('    · ambiguous 분리 완료, freeze-set NULL 혼입 없음');
    log('    · would-UPDATE == freeze (rows-affected assert PASS)');
    log('    · 최종 ROLLBACK 으로 무영속');
  } catch (e) {
    log('  ✗ dryrun ABORT (in-SQL RAISE):', e.message);
    throw new Error('DRYRUN_ABORT');
  }
}

async function step1b_nopersist(pre) {
  log('\n═══ STEP1b: post-dryrun no-persistence probe ═══');
  const bkExists = one(await query(
    `SELECT to_regclass('${BACKUP_TBL}') IS NOT NULL AS e;`)).e;
  const post = one(await query(Q_NULLSTATS));
  log(`  _backup 대상 스냅샷 테이블 존재 = ${bkExists}  (기대 false — dryrun rollback)`);
  log(`  NULL count = ${post.null_remaining}  (기대 = STEP0 ${pre.null_remaining}, 불변)`);
  if (bkExists) throw new Error('NO_PERSIST_VIOLATION: _backup 대상 테이블이 dryrun 후 잔존(영속됨)');
  if (post.null_remaining !== pre.null_remaining)
    throw new Error(`NO_PERSIST_VIOLATION: NULL count 변동 ${pre.null_remaining}→${post.null_remaining}`);
  log('  ✓ 무영속 확인 (데이터 무변)');
}

async function step2_apply(pre) {
  log('\n═══ STEP2: apply.sql (BEGIN..COMMIT) 원자 apply + ledger ═══');
  const res = await applyMigration({
    version: VERSION, file: UP_FILE, dryRun: false,
    createdBy: 'dev-foot:BACKFILL-405:MSG-20260802-051410-iivm',
  });
  log('  applyMigration:', JSON.stringify(res));
  const snap = one(await query(`SELECT count(*)::int AS c FROM ${BACKUP_TBL};`)).c;
  log(`  _backup 스냅샷 count = ${snap}  (= UPDATE ROW_COUNT = rows-affected)`);
  return { snap };
}

async function step3_postcheck(pre, applied) {
  log('\n═══ STEP3: POSTCHECK (판정근거) ═══');
  const post = await baseline();
  const ambList = await query(
    `SELECT payment_id, distinct_approval_cnt, distinct_approval_nos FROM ${AMBIG_TBL} ORDER BY payment_id;`);
  const snapCnt = one(await query(`SELECT count(*)::int AS c FROM ${BACKUP_TBL};`)).c;

  log(`  NULL: ${pre.null_remaining} → ${post.null_remaining}  (개선 ${pre.null_remaining - post.null_remaining})`);
  log(`  filled: ${pre.filled} → ${post.filled}  (증가 ${post.filled - pre.filled})`);
  log(`  payments rows: ${pre.payments_rows} → ${post.payments_rows}  (${pre.payments_rows === post.payments_rows ? '불변 ✓' : '★변동!'})`);
  log(`  sum(amount): ${pre.sum_amount} → ${post.sum_amount}  (${String(pre.sum_amount) === String(post.sum_amount) ? '불변 ✓' : '★변동!'})`);
  log(`  matched_links: ${pre.matched_links} → ${post.matched_links}  (${pre.matched_links === post.matched_links ? 'drop 0 ✓' : '★drop!'})`);
  log(`  ambiguous(manual 큐) = ${Array.isArray(ambList) ? ambList.length : 0} 건 / snapshot(_backup backfill) = ${snapCnt} 건`);

  const filledDelta = post.filled - pre.filled;
  const nullDelta = pre.null_remaining - post.null_remaining;
  const ok = pre.payments_rows === post.payments_rows
    && String(pre.sum_amount) === String(post.sum_amount)
    && pre.matched_links === post.matched_links
    && filledDelta === applied.snap && nullDelta === applied.snap;
  log(`\n  POSTCHECK ${ok ? 'PASS ✓ (dev self-probe — supervisor AC-2 독립검증 대기)' : '✗ FAIL — 검토 필요'}`);

  // 회신용 machine-readable 요약
  log('\n───REPORT-JSON───');
  log(JSON.stringify({
    ticket: 'T-20260730-foot-REDPAY-APPROVALNO-BACKFILL-405',
    dryrun: { ambiguous: pre.ambiguous, freeze: pre.freeze, would_update: pre.freeze, assert: 'PASS' },
    apply: { rows_affected: applied.snap, backup_snapshot_count: snapCnt, version: VERSION },
    invariants: {
      payments_rows: { before: pre.payments_rows, after: post.payments_rows },
      sum_amount: { before: String(pre.sum_amount), after: String(post.sum_amount) },
      matched_links: { before: pre.matched_links, after: post.matched_links },
    },
    null_improvement: { before: pre.null_remaining, after: post.null_remaining, delta: nullDelta },
    ambiguous_list: (Array.isArray(ambList) ? ambList : []),
  }, null, 2));
}

async function main() {
  log(`### BACKFILL-405 집행 (${DO_APPLY ? 'APPLY' : 'DRY-RUN only'}) — ${VERSION}`);
  const pre = await step0();
  await step1_dryrun(pre);
  await step1b_nopersist(pre);
  if (!DO_APPLY) {
    log('\n[--apply 없음] STEP2/3 미실행. QA Lease Guard 통과 후 --apply 로 실집행.');
    return;
  }
  const applied = await step2_apply(pre);
  await step3_postcheck(pre, applied);
}

main().catch((e) => { console.error('\n✗ 집행 중단:', e.message); process.exit(1); });
