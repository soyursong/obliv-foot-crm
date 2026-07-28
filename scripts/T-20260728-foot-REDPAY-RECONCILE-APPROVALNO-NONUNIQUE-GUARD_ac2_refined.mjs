/**
 * T-20260728-foot-REDPAY-RECONCILE-APPROVALNO-NONUNIQUE-GUARD — AC-2 사후감사 REFINED (READ-ONLY)
 *
 * 초판 Q1의 tid_mismatch 는 위양성: payments 는 external_tid 를 대개 NULL 로 두고 external_trxid
 *   만 저장 → pay_tid=NULL 이 정상. 또한 매처가 링크 시 payments.external_trxid = raw.external_trxid
 *   로 덮어씀(index.ts L641) → trxid_mismatch 는 링크 후 항상 false.
 * ⇒ 내구성 있는 false-merge 지문 = amount_mismatch OR date_mismatch (이 두 payment 필드는
 *   매처가 절대 덮어쓰지 않음 → 원 CRM 거래 그대로). approval_no-alone 오링크면 금액/날짜가 어긋남.
 *
 * ⚠ SELECT-only. write 0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

console.log('=== AC-2 REFINED — 내구성 false-merge 지문(amount/date mismatch) ===\n');

// Q1R: 링크된 raw↔payment 중 금액 또는 KST날짜가 어긋난 건 (진짜 오링크 후보)
const Q1R = `
WITH linked AS (
  SELECT rp.id AS raw_id, rp.external_trxid AS raw_trxid, rp.approval_no AS raw_approval_no,
         rp.tid AS raw_tid, rp.amount AS raw_amount,
         (rp.approved_at AT TIME ZONE 'Asia/Seoul')::date AS raw_kst_date,
         p.id AS pay_id, p.amount AS pay_amount,
         (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS pay_kst_date,
         p.reconciled_at
  FROM public.redpay_raw_transactions rp
  JOIN public.payments p ON p.id = rp.matched_payment_id
  WHERE rp.matched_payment_id IS NOT NULL
)
SELECT * FROM linked
WHERE raw_amount IS DISTINCT FROM pay_amount
   OR raw_kst_date IS DISTINCT FROM pay_kst_date
ORDER BY raw_approval_no;`;

// Q4: 총괄 제시 실중복 approval_no(예: 30024107) 가 우리 raw 에 존재하나?
const Q4 = `
SELECT rp.approval_no, rp.external_trxid, rp.tid, rp.amount, rp.external_status,
       (rp.approved_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
       rp.matched_payment_id
FROM public.redpay_raw_transactions rp
WHERE rp.approval_no = '30024107'
ORDER BY rp.approved_at;`;

// Q5: raw측 approval_no 비유일이면서 서로 다른 amount 를 갖는 값 중, 2개 이상이 matched 된 경우
//     (같은 approval_no 로 서로 다른 금액 거래가 둘 다 payments 에 링크됨 = 교차오염 위험 실현)
const Q5 = `
WITH m AS (
  SELECT rp.approval_no, rp.amount, rp.matched_payment_id
  FROM public.redpay_raw_transactions rp
  WHERE rp.approval_no IS NOT NULL AND rp.matched_payment_id IS NOT NULL
)
SELECT approval_no,
       count(*) AS matched_rows,
       count(DISTINCT amount) AS distinct_amount,
       count(DISTINCT matched_payment_id) AS distinct_pay
FROM m
GROUP BY approval_no
HAVING count(DISTINCT amount) > 1
ORDER BY count(*) DESC;`;

try {
  const r1 = await q(Q1R);
  console.log(`── Q1R: 금액/날짜 어긋난 링크(진짜 오링크 후보): ${r1.length}건 ──`);
  console.log(JSON.stringify(r1, null, 2), '\n');

  const r4 = await q(Q4);
  console.log(`── Q4: 총괄 예시 approval_no=30024107 raw 존재: ${r4.length}건 ──`);
  console.log(JSON.stringify(r4, null, 2), '\n');

  const r5 = await q(Q5);
  console.log(`── Q5: matched 중 같은 approval_no·다른 금액 링크(교차오염 실현): ${r5.length}건 ──`);
  console.log(JSON.stringify(r5, null, 2), '\n');

  console.log('=== VERDICT ===');
  if (r1.length === 0 && r5.length === 0) {
    console.log('AC-2 CLEAN: amount/date-durable false-merge 0건, 교차오염 실현 0건.');
  } else {
    console.log(`AC-2 ⚠ Q1R=${r1.length}, Q5=${r5.length} → 정밀 검토 필요.`);
  }
} catch (e) { console.error('ERROR:', e.message); process.exit(1); }
