/**
 * T-20260715-foot-DAYCLOSE-PAYGATE-RC-REPRO — READ-ONLY RC 재현 probe.
 * 가설: 완료('done') 전환만으로는 payments/package_payments 어느 행도 생성되지 않으므로
 *   일마감 결제목록(enrichedRows = payments|package_payments|closing_manual_payments, created_at 윈도잉)에
 *   '수납 미클릭 done' 건은 뜰 수 없다. 현장이 본 '실금액'은 별도 명시 결제행(패키지/단건/잔금)일 것.
 * 검증: 최근 14일 done 체크인 중 "같은 날 결제행이 전혀 없는" 건 수 vs "결제행 있는" 건 수.
 *   전자가 일마감 결제목록에 0건으로 안 뜨면 = 합성행 부재 = write-path RC 코드상 부재 확정.
 * READ-ONLY (SELECT only).
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
const out = {};

// 1) 최근 14일 done 체크인 총수 + 같은 KST일(created_at 윈도)에 payments/package_payments/manual 결제행 존재 여부
out.done_vs_pay = await q(`
  WITH d AS (
    SELECT ci.id, ci.customer_id, ci.clinic_id,
           (ci.completed_at AT TIME ZONE 'Asia/Seoul')::date AS done_day
    FROM check_ins ci
    WHERE ci.status='done'
      AND ci.completed_at >= now() - interval '14 days'
  )
  SELECT
    COUNT(*) AS done_total,
    COUNT(*) FILTER (WHERE p.has_pay) AS done_with_payment_row,
    COUNT(*) FILTER (WHERE NOT p.has_pay) AS done_without_any_payment_row
  FROM d
  LEFT JOIN LATERAL (
    SELECT (
      EXISTS(SELECT 1 FROM payments pm
             WHERE pm.check_in_id=d.id AND pm.status IS DISTINCT FROM 'deleted')
      OR EXISTS(SELECT 1 FROM payments pm
             WHERE pm.customer_id=d.customer_id AND pm.check_in_id IS NULL
               AND (pm.created_at AT TIME ZONE 'Asia/Seoul')::date=d.done_day
               AND pm.status IS DISTINCT FROM 'deleted')
      OR EXISTS(SELECT 1 FROM package_payments pp
             WHERE pp.customer_id=d.customer_id
               AND (pp.created_at AT TIME ZONE 'Asia/Seoul')::date=d.done_day)
    ) AS has_pay
  ) p ON true;
`);

// 2) done 체크인에 직접 연결된(check_in_id) payments 행이 done 전환과 같은 순간에 생기는지 —
//    payment.created_at 과 check_in.completed_at 시차 분포 (동일순간이면 '완료가 결제 생성' 의심신호)
out.pay_vs_complete_gap = await q(`
  SELECT
    COUNT(*) AS linked_payments,
    COUNT(*) FILTER (WHERE abs(extract(epoch FROM (pm.created_at - ci.completed_at))) <= 3) AS within_3s_of_complete
  FROM payments pm
  JOIN check_ins ci ON ci.id = pm.check_in_id
  WHERE ci.status='done' AND ci.completed_at >= now() - interval '14 days'
    AND pm.status IS DISTINCT FROM 'deleted';
`);

// 3) deduct_session_atomic 는 package_payments 를 만들지 않음을 데이터로 재확인:
//    최근 package_sessions(used) 소진 시각과 같은 순간(±3s)에 생성된 package_payments 존재 여부
out.session_creates_pkgpay = await q(`
  SELECT COUNT(*) AS pkgpay_within_3s_of_session_use
  FROM package_sessions ps
  JOIN package_payments pp ON pp.package_id = ps.package_id
  WHERE ps.status='used' AND ps.created_at >= now() - interval '14 days'
    AND abs(extract(epoch FROM (pp.created_at - ps.created_at))) <= 3;
`);

console.log(JSON.stringify(out, null, 2));
