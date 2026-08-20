/**
 * T-20260820-foot-CLOSING-TRISURFACE-SALES-BASIS-RECONCILE-DIAG — READ-ONLY census
 *
 * 목적: 일마감의 3-surface(결제내역 / 담당자별 매출=총매출 / 실장별 일별 매출)가 왜 안 맞는지
 *   각 surface 의 read 소스·필터·basis(축)를 코드와 동일하게 재현해 동일 표본일(08-18·08-20)
 *   숫자를 대조하고 delta 가 갈라지는 지점을 특정한다.
 *
 * GATE: READ-ONLY — SELECT only. prod write/DDL/정정 0건. (조사 티켓·산출물 0)
 * auth: Supabase Management API database/query = postgres 슈퍼유저(RLS 미적용) → silent 0-row 회피 인증컨텍스트 명시.
 *
 * 코드 basis 매핑(재현 대상):
 *   Surface A 결제내역 리스트  = enrichedRows:
 *       단건 payments (created_at KST window, status≠'deleted')
 *     + 패키지 package_payments (accounting_date == date)   ← pkgPaymentsForList
 *     + 수기 closing_manual_payments (close_date)
 *       net(refund→음수), method=raw
 *   Surface B 담당자별 매출 소계 = staffTotals: A 를 assigned_staff_id 로 group → Σ B ≡ A (구조 tie-out)
 *   Surface C 합계(결제수단별) 카드 = totals.grossTotal:
 *       단건 payments (created_at window) + 패키지 package_payments (created_at window) + 수기
 *       ← 패키지 축이 A/B(accounting_date)와 다름(created_at). + 오늘 rebucket per-method(display-only, Σ 불변)
 *   Surface D 실장별 일별 매출 = fetchStaffDailyBreakdown(staffRevenue SSOT):
 *       단건 payments (accounting_date, status NOT IN ('cancelled','deleted'))
 *     + 패키지 package_payments (accounting_date, no status filter)
 *       sim 고객 제외, net, 귀속=attributed_staff_id snapshot→live fallback
 */
const REF = 'rxlomoozakkjesdqjtvd'; // foot prod
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('FATAL: SUPABASE_ACCESS_TOKEN 없음'); process.exit(1); }
async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const out = await res.json().catch(() => null);
  if (res.status !== 200 && res.status !== 201) { console.error(`HTTP ${res.status}`, JSON.stringify(out)); process.exit(1); }
  return out;
}
const j = (x) => JSON.stringify(x, null, 2);

// clinic_id 는 foot 단일 클리닉. Closing 은 clinic 컨텍스트로 필터하므로 clinic_id 도 census.
console.log('=== auth-context (postgres/무RLS 여야 함) ===');
console.log(j(await q(`SELECT current_user usr, current_setting('is_superuser') super, now() AT TIME ZONE 'Asia/Seoul' kst;`)));

console.log('\n=== clinic 목록 (foot) ===');
console.log(j(await q(`SELECT id, name, slug FROM clinics ORDER BY created_at;`)));

for (const D of ['2026-08-18', '2026-08-20']) {
  console.log(`\n\n######################## 표본일 ${D} ########################`);

  // KST day window (created_at 축) — dayBoundsISO 재현: [D 00:00 KST, D 23:59:59.999 KST]
  const startUTC = `${D}T00:00:00+09:00`;
  const endUTC   = `${D}T23:59:59.999+09:00`;

  // ── Surface A/B 단건: payments created_at window, status≠'deleted' (raw method, net) ──
  console.log(`\n--- [A/B단건] payments created_at∈[${D}] status≠deleted (결제내역/담당자별 소스) ---`);
  console.log(j(await q(`
    SELECT method,
           count(*) FILTER (WHERE payment_type<>'refund')                         AS pay_rows,
           count(*) FILTER (WHERE payment_type='refund')                          AS refund_rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM payments
    WHERE created_at >= '${startUTC}' AND created_at <= '${endUTC}'
      AND status <> 'deleted'
    GROUP BY method ORDER BY method;`)));

  // ── Surface A/B 패키지: package_payments accounting_date==D (pkgPaymentsForList) ──
  console.log(`\n--- [A/B패키지] package_payments accounting_date=${D} (리스트/담당자별 소스) ---`);
  console.log(j(await q(`
    SELECT method,
           count(*) FILTER (WHERE payment_type<>'refund')                         AS pay_rows,
           count(*) FILTER (WHERE payment_type='refund')                          AS refund_rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM package_payments
    WHERE accounting_date = '${D}'
    GROUP BY method ORDER BY method;`)));

  // ── Surface C 패키지: package_payments created_at window (합계카드 소스, 축이 다름) ──
  console.log(`\n--- [C패키지] package_payments created_at∈[${D}] (합계카드 소스·축=created_at) ---`);
  console.log(j(await q(`
    SELECT method,
           count(*) FILTER (WHERE payment_type<>'refund')                         AS pay_rows,
           count(*) FILTER (WHERE payment_type='refund')                          AS refund_rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM package_payments
    WHERE created_at >= '${startUTC}' AND created_at <= '${endUTC}'
    GROUP BY method ORDER BY method;`)));

  // ── 축 delta: 패키지 accounting_date vs created_at 어긋난 행 census (DIV-5 정량화) ──
  console.log(`\n--- [DIV-5] 패키지 축 어긋난 행 (accounting_date=${D} XOR created_at일자=${D}) ---`);
  console.log(j(await q(`
    WITH pp AS (
      SELECT id, method, amount, payment_type, accounting_date,
             (created_at AT TIME ZONE 'Asia/Seoul')::date AS created_kst
      FROM package_payments
      WHERE accounting_date = '${D}'
         OR ((created_at AT TIME ZONE 'Asia/Seoul')::date = '${D}')
    )
    SELECT
      (accounting_date = '${D}')          AS in_acct_axis,
      (created_kst = DATE '${D}')          AS in_created_axis,
      count(*)                             AS rows,
      COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM pp GROUP BY 1,2 ORDER BY 1,2;`)));

  // ── Surface D 단건: payments accounting_date==D, status NOT IN ('cancelled','deleted') ──
  console.log(`\n--- [D단건] payments accounting_date=${D} status∉(cancelled,deleted) (실장별일별 소스) ---`);
  console.log(j(await q(`
    SELECT method,
           count(*) FILTER (WHERE payment_type<>'refund')                         AS pay_rows,
           count(*) FILTER (WHERE payment_type='refund')                          AS refund_rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM payments
    WHERE accounting_date = '${D}'
      AND status NOT IN ('cancelled','deleted')
    GROUP BY method ORDER BY method;`)));

  // ── DIV-2 status='cancelled' 단건 census (A/B 포함 vs D 제외) ──
  console.log(`\n--- [DIV-2] payments status='cancelled' (accounting_date=${D} 또는 created_at=${D}) — A/B 계상 vs D 제외 ---`);
  console.log(j(await q(`
    SELECT status,
           (accounting_date = '${D}') AS acct_day,
           ((created_at AT TIME ZONE 'Asia/Seoul')::date = '${D}') AS created_day,
           count(*) rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) AS net
    FROM payments
    WHERE (accounting_date = '${D}' OR (created_at AT TIME ZONE 'Asia/Seoul')::date = '${D}')
      AND status = 'cancelled'
    GROUP BY 1,2,3 ORDER BY 1,2,3;`)));

  // ── DIV-1 단건 축 어긋남: accounting_date≠created_at일자 census ──
  console.log(`\n--- [DIV-1] payments 단건 축 어긋남 (accounting_date=${D} XOR created_kst=${D}, status≠deleted) ---`);
  console.log(j(await q(`
    WITH pp AS (
      SELECT id, amount, payment_type, accounting_date, status,
             (created_at AT TIME ZONE 'Asia/Seoul')::date AS created_kst
      FROM payments
      WHERE status <> 'deleted'
        AND (accounting_date = '${D}' OR (created_at AT TIME ZONE 'Asia/Seoul')::date = '${D}')
    )
    SELECT (accounting_date='${D}') in_acct, ((created_kst)=DATE '${D}') in_created,
           count(*) rows,
           COALESCE(SUM(CASE WHEN payment_type='refund' THEN -amount ELSE amount END),0) net
    FROM pp GROUP BY 1,2 ORDER BY 1,2;`)));

  // ── DIV-3 sim(테스트) 고객 결제 census (A/B 포함 vs D 제외) — simulation flag 확인 ──
  console.log(`\n--- [DIV-3] sim/test 고객 여부 컬럼 존재 확인 ---`);
  console.log(j(await q(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='customers' AND (column_name ILIKE '%sim%' OR column_name ILIKE '%test%');`)));

  // ── 수기결제 ──
  console.log(`\n--- [수기] closing_manual_payments close_date=${D} ---`);
  console.log(j(await q(`
    SELECT method, count(*) rows, COALESCE(SUM(amount),0) net
    FROM closing_manual_payments
    WHERE close_date = '${D}'
    GROUP BY method ORDER BY method;`)));

  // ── DIV-4 귀속축: assigned_staff_id(live) vs attributed_staff_id(snapshot) 어긋난 행 census ──
  console.log(`\n--- [DIV-4] 단건 귀속축 어긋남 (attributed_staff_id ≠ live assigned_staff_id), accounting_date=${D} ---`);
  console.log(j(await q(`
    SELECT count(*) rows,
           count(*) FILTER (WHERE p.attributed_staff_id IS NULL) AS attr_null,
           count(*) FILTER (WHERE p.attributed_staff_id IS DISTINCT FROM c.assigned_staff_id) AS axis_mismatch
    FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.accounting_date='${D}' AND p.status NOT IN ('cancelled','deleted');`)));
}

console.log('\n\n=== 완료 (READ-ONLY, prod write 0) ===');
