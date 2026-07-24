/**
 * T-20260720-foot-DAYCLOSE-MANUALPAY-SPLITPAY-SYNC — 파트1 preflight snapshot + dry-run projection
 * READ-ONLY. 실제 mutation 없음 — 정정 전 스냅샷 + 적용 후 예상값을 순수 SELECT 로 투영.
 *
 * 대상(F-4717 현은호, 지문 교집합):
 *   customer  6412fbf7-8a53-4d49-af7a-491e1d731b4c (F-4717 / 현은호)
 *   package   9455ca84-5798-413b-bd45-7457616d7f55 (24회권 total 5,760,000)
 *   manual    d38b38fb-a60d-41b1-91fa-05548c9f51bf (close 2026-07-20, transfer 1,260,000, voided_at NULL)
 *
 * 정정 요지: 이체 leg 1,260,000 이 closing_manual_payments 에만 있고 canonical(package_payments) 미생성 → phantom 미수.
 *   apply = (1) package_payments transfer INSERT (2) paid_amount 재집계 (3) manual 행 soft-void → net-zero.
 * author: dev-foot / 2026-07-20
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const CUST = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';
const PKG  = '9455ca84-5798-413b-bd45-7457616d7f55';
const MANUAL = 'd38b38fb-a60d-41b1-91fa-05548c9f51bf';
const LEG_AMOUNT = 1260000;
const out = {};

// ── 1) 정정 전 스냅샷 ──────────────────────────────────────────
out.snapshot_package = await q(`
  SELECT id, package_name, status, total_amount, paid_amount,
         (total_amount - paid_amount) AS due_before
  FROM public.packages WHERE id='${PKG}';`);

out.snapshot_package_payments = await q(`
  SELECT id, amount, method, payment_type, fee_kind, memo, created_at
  FROM public.package_payments WHERE package_id='${PKG}' ORDER BY created_at;`);

out.snapshot_manual = await q(`
  SELECT id, close_date, pay_time, chart_number, customer_name, amount, method, memo, voided_at
  FROM public.closing_manual_payments WHERE id='${MANUAL}';`);

// ── 2) 일마감 대조 (2026-07-20 현은호 카드/이체 leg 실재·합계) ──
out.dayclose_legs = await q(`
  SELECT 'closing_manual' AS src, method, amount FROM public.closing_manual_payments
    WHERE chart_number='F-4717' AND close_date='2026-07-20' AND voided_at IS NULL
  UNION ALL
  SELECT 'package_payments' AS src, method, amount FROM public.package_payments
    WHERE package_id='${PKG}'
  ORDER BY src, method;`);

// ── 3) 대상 freeze 지문 교집합 검증 (단일 count UPDATE 금지) ──
//   manual 행이 정확히 이 지문(id + amount + method + chart + close_date + voided NULL)으로 1건인지.
out.freeze_manual_fingerprint = await q(`
  SELECT count(*) AS n FROM public.closing_manual_payments
  WHERE id='${MANUAL}' AND amount=${LEG_AMOUNT} AND method='transfer'
    AND chart_number='F-4717' AND close_date='2026-07-20' AND voided_at IS NULL;`);

// double-apply 가드: 이미 canonical transfer leg 가 존재하면 안 됨(0 이어야 apply 안전)
out.freeze_no_existing_canonical = await q(`
  SELECT count(*) AS n FROM public.package_payments
  WHERE package_id='${PKG}' AND amount=${LEG_AMOUNT} AND method='transfer';`);

// ── 4) RETRO-BACKFILL 대상셋 중복 여부 (double-canonicalize 방지) ──
//   RETRO 정본화 행 memo 지문 검색 — 이 package 에 RETRO 가 만든 행이 있으면 겹침.
out.retro_overlap = await q(`
  SELECT id, amount, method, memo, created_at FROM public.package_payments
  WHERE package_id='${PKG}' AND (memo ILIKE '%RETRO%' OR memo ILIKE '%정본화%' OR memo ILIKE '%opt-A%' OR memo ILIKE '%DAYCLOSE%');`);

// ── 5) DRY-RUN projection (순수 계산, mutation 없음) ──
out.dryrun_projection = await q(`
  WITH cur AS (
    SELECT total_amount,
           COALESCE(SUM(CASE WHEN pp.payment_type='refund' THEN -pp.amount ELSE pp.amount END),0) AS paid_now
    FROM public.packages pk
    LEFT JOIN public.package_payments pp ON pp.package_id=pk.id
    WHERE pk.id='${PKG}'
    GROUP BY pk.total_amount
  )
  SELECT total_amount,
         paid_now                        AS paid_before,
         (total_amount - paid_now)        AS due_before,
         paid_now + ${LEG_AMOUNT}         AS paid_after_projected,
         (total_amount - (paid_now + ${LEG_AMOUNT})) AS due_after_projected
  FROM cur;`);

console.log(JSON.stringify(out, null, 2));
console.log('\n─────────── DRY-RUN 판정 ───────────');
const fp = out.freeze_manual_fingerprint[0].n;
const noCanon = out.freeze_no_existing_canonical[0].n;
const proj = out.dryrun_projection[0];
console.log(`freeze manual 지문 매칭: ${fp}건 (기대 1)`);
console.log(`기존 canonical transfer leg: ${noCanon}건 (기대 0 = double-apply 없음)`);
console.log(`RETRO 겹침 행: ${out.retro_overlap.length}건 (기대 0)`);
console.log(`due_before=${proj.due_before} → due_after_projected=${proj.due_after_projected} (기대 0)`);
const ok = fp === 1 && noCanon === 0 && out.retro_overlap.length === 0 && Number(proj.due_after_projected) === 0;
console.log(ok ? '✅ APPLY 안전 (net-zero, 미수 0 수렴)' : '⛔ ABORT — 지문/투영 불일치');
process.exit(ok ? 0 : 2);
