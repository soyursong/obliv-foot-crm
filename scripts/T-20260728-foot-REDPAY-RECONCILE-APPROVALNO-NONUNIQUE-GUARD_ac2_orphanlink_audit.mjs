/**
 * T-20260728-foot-REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD — AC-2 사후감사 (READ-ONLY)
 *
 * 목적(AC-2): approval_no 가 전역 유일이 아님(코밴 공식회신)에 따라, redpay-reconcile EF
 *   Tier 0(approval_no-alone) 이 이미 만들어 놓은 "오링크(false-merge)"를 read-only 로 색출.
 *   오링크 지문 = payments ↔ redpay_raw_transactions 가 같은 approval_no 로 링크됐으나
 *   금액/ tid / 날짜가 서로 다른 경우(무관 별개거래를 한 건으로 오합산).
 *
 * ⚠ SELECT-only. write 0. Supabase Management API READ. 정정(unlink)은 본 티켓 범위 외.
 * 실행: node scripts/T-20260728-foot-REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD_ac2_orphanlink_audit.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('=== T-20260728 REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD AC-2 orphan-link audit (READ-ONLY) ===\n');

// ── Q0: 링크된(matched) redpay_raw ↔ payments 조인 규모 (컨텍스트) ──
const Q0 = `
SELECT count(*) AS linked_rows
FROM public.redpay_raw_transactions rp
JOIN public.payments p ON p.id = rp.matched_payment_id
WHERE rp.matched_payment_id IS NOT NULL;`;

// ── Q1: 핵심 오링크 지문 ──
//   matched_payment_id 로 링크된 raw ↔ payment 쌍에서,
//   같은 approval_no 인데 (금액 다름) OR (tid 다름) OR (KST 날짜 다름) 인 행.
//   = Tier 0 approval_no-alone false-merge 후보.
const Q1 = `
WITH linked AS (
  SELECT
    rp.id                AS raw_id,
    rp.external_trxid    AS raw_trxid,
    rp.approval_no       AS raw_approval_no,
    rp.tid               AS raw_tid,
    rp.amount            AS raw_amount,
    rp.approved_at       AS raw_approved_at,
    (rp.approved_at AT TIME ZONE 'Asia/Seoul')::date AS raw_kst_date,
    p.id                 AS pay_id,
    p.external_approval_no AS pay_approval_no,
    p.external_tid       AS pay_tid,
    p.external_trxid     AS pay_trxid,
    p.amount             AS pay_amount,
    p.created_at         AS pay_created_at,
    (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS pay_kst_date,
    p.reconciled_at      AS pay_reconciled_at
  FROM public.redpay_raw_transactions rp
  JOIN public.payments p ON p.id = rp.matched_payment_id
  WHERE rp.matched_payment_id IS NOT NULL
)
SELECT *,
  (raw_amount IS DISTINCT FROM pay_amount)                        AS amount_mismatch,
  (raw_tid    IS DISTINCT FROM pay_tid)                           AS tid_mismatch,
  (raw_kst_date IS DISTINCT FROM pay_kst_date)                    AS date_mismatch,
  (raw_trxid  IS DISTINCT FROM pay_trxid)                         AS trxid_mismatch
FROM linked
WHERE raw_amount IS DISTINCT FROM pay_amount
   OR raw_tid    IS DISTINCT FROM pay_tid
   OR (raw_kst_date IS DISTINCT FROM pay_kst_date)
ORDER BY raw_approval_no, raw_approved_at;`;

// ── Q2: 총괄 제시 중복 10건 + 동류 dup approval_no census ──
//   같은 approval_no 가 서로 다른 (tid, amount) 조합으로 2건 이상 나타나는 raw 값들.
//   (승인/취소 페어 제외: status 무관하게 tid∧amount 동일이면 정상 페어로 취급)
const Q2 = `
SELECT
  rp.approval_no,
  count(*)                                    AS raw_rows,
  count(DISTINCT rp.tid)                       AS distinct_tid,
  count(DISTINCT rp.amount)                    AS distinct_amount,
  count(DISTINCT (rp.approved_at AT TIME ZONE 'Asia/Seoul')::date) AS distinct_kst_date,
  count(*) FILTER (WHERE rp.matched_payment_id IS NOT NULL) AS matched_rows
FROM public.redpay_raw_transactions rp
WHERE rp.approval_no IS NOT NULL
GROUP BY rp.approval_no
HAVING count(DISTINCT rp.tid) > 1 OR count(DISTINCT rp.amount) > 1
ORDER BY count(*) DESC, rp.approval_no
LIMIT 100;`;

// ── Q3: payments 원장측 approval_no 비유일 census (링크 소스가 되는 external_approval_no) ──
const Q3 = `
SELECT
  p.external_approval_no,
  count(*)                                    AS pay_rows,
  count(DISTINCT p.external_tid)               AS distinct_tid,
  count(DISTINCT p.amount)                     AS distinct_amount,
  count(*) FILTER (WHERE p.reconciled_at IS NOT NULL) AS reconciled_rows
FROM public.payments p
WHERE p.external_approval_no IS NOT NULL
GROUP BY p.external_approval_no
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 100;`;

try {
  const r0 = await q(Q0);
  console.log('── Q0: matched raw↔payment 링크 규모 ──');
  console.log(JSON.stringify(r0), '\n');

  const r1 = await q(Q1);
  console.log('── Q1: ★오링크 지문(같은 approval_no 링크, but 금액/tid/날짜 불일치) ──');
  console.log(`발견: ${r1.length}건`);
  console.log(JSON.stringify(r1, null, 2), '\n');

  const r2 = await q(Q2);
  console.log('── Q2: 비유일 approval_no census(서로 다른 tid/amount 조합 2건+) ──');
  console.log(`approval_no 종류: ${r2.length}`);
  console.log(JSON.stringify(r2, null, 2), '\n');

  const r3 = await q(Q3);
  console.log('── Q3: payments 원장 external_approval_no 비유일 census ──');
  console.log(`approval_no 종류: ${r3.length}`);
  console.log(JSON.stringify(r3, null, 2), '\n');

  console.log('=== VERDICT ===');
  if (r1.length === 0) {
    console.log('AC-2 CLEAN: matched 링크 중 approval_no-alone false-merge 지문 0건.');
  } else {
    console.log(`AC-2 ⚠ 오링크 후보 ${r1.length}건 발견 → P0 승격 + 정정 follow-up(archive-first) 필요.`);
  }
} catch (e) {
  console.error('AUDIT ERROR:', e.message);
  process.exit(1);
}
