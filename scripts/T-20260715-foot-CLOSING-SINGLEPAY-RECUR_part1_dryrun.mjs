/**
 * T-20260715-foot-CLOSING-SINGLEPAY-F4716-CHARTMATCH-RECUR — Part1/Part0 정정 DRY-RUN (READ-ONLY, NO APPLY)
 * data_correction_backfill_sop 준수: freeze셋 지문 교집합 + dry-run preview + rollback SQL 생성.
 *   ★apply 금지 — 김주연 총괄 현장 확인 게이트 통과 후 별도 _apply.mjs 로만 실행.
 *
 * 정정 대상(오늘 07-15 실 미수 2건, 전수 조회 결과):
 *   F-4716 김희정 — 활성 pkg 3f4d3ec6(내성체험권) paid_amount 0→59000 (결제 a72eea54 이미 payments 존재, 패키지 재생성으로 credit 유실).
 *   F-4666 김지민 — 활성 pkg(무좀체험권) paid_amount 0→10000 (결제 single 귀속, 패키지 무접점).
 * 원리: 결제행(payments)은 이미 존재·매출 계상됨 → paid_amount(미수 파생 denormalized)만 정합화. net-zero(매출 불변).
 * author: dev-foot / 2026-07-15
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const fails = [];
const applySql = [];
const rollbackSql = [];

// 대상: 오늘 활성 패키지 중 (due>0) & 동일 고객이 오늘 payments 로 (pkg.total_amount 와 동일액) 결제 존재.
//   지문 교집합: clinic + active pkg + paid_amount=0 + total_amount==오늘 payment amount + 결제 today.
const targets = await q(`
  SELECT pk.id AS pkg_id, pk.package_name, pk.customer_id, pk.total_amount, pk.paid_amount, pk.status,
         c.chart_number, c.name AS cust_name,
         (SELECT COALESCE(SUM(CASE WHEN p.payment_type='refund' THEN -p.amount ELSE p.amount END),0)
            FROM public.payments p
            WHERE p.customer_id = pk.customer_id
              AND p.created_at >= '2026-07-15T00:00:00+09:00' AND p.created_at < '2026-07-16T00:00:00+09:00'
         ) AS today_pay_net
  FROM public.packages pk
  JOIN public.customers c ON c.id = pk.customer_id
  WHERE pk.clinic_id = '${CLINIC}'
    AND pk.status = 'active'
    AND pk.paid_amount = 0
    AND (pk.total_amount - pk.paid_amount) > 0
    AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.customer_id = pk.customer_id
        AND p.created_at >= '2026-07-15T00:00:00+09:00' AND p.created_at < '2026-07-16T00:00:00+09:00'
    )
  ORDER BY c.chart_number;`);

console.log('======== DRY-RUN 정정 대상 freeze셋 (READ-ONLY) ========\n');
console.table(targets.map(t=>({chart:t.chart_number,name:t.cust_name,pkg:t.package_name,total:t.total_amount,paid:t.paid_amount,due:t.total_amount-t.paid_amount,today_pay_net:t.today_pay_net})));

for (const t of targets) {
  // abort-guard: 오늘 결제 순합이 패키지 total_amount 와 정확히 일치하는지(오귀속·부분결제 방지)
  if (Number(t.today_pay_net) !== Number(t.total_amount)) {
    fails.push(`${t.chart_number} ${t.cust_name}: 오늘 결제순합(${t.today_pay_net}) != pkg total(${t.total_amount}) — 자동정정 제외(수동판단 필요)`);
    continue;
  }
  applySql.push(`UPDATE public.packages SET paid_amount = ${t.total_amount} WHERE id = '${t.pkg_id}' AND paid_amount = 0; -- ${t.chart_number} ${t.cust_name} ${t.package_name}`);
  rollbackSql.push(`UPDATE public.packages SET paid_amount = 0 WHERE id = '${t.pkg_id}'; -- rollback ${t.chart_number}`);
}

console.log('\n======== abort-guard 결과 ========');
if (fails.length) { console.log('⚠️ 자동정정 제외(수동판단):'); fails.forEach(f=>console.log('  - '+f)); }
else console.log('✅ 모든 대상 지문 정합(오늘 결제순합 == pkg total)');

console.log('\n======== APPLY SQL (미실행 — 현장 확인 게이트 후 별도 실행) ========');
applySql.forEach(s=>console.log(s));
console.log('\n======== ROLLBACK SQL ========');
rollbackSql.forEach(s=>console.log(s));

console.log('\n======== 불변식(apply 후 postverify 예정) ========');
console.log('V1: 각 대상 pkg due = 0 (미수 해소)');
console.log('V2: payments 행수/합계 불변 (신규 결제 write 0, 매출 net-zero)');
console.log('V3: closing_manual_payments 무접점, daily_closings 무접점 (원장 무접점)');
console.log('V4: 대상외 패키지 paid_amount 무접점');
console.log('\n※ paid_amount 재생성 유실 = 코드 근본수정 별건(Part2). 본 정정은 현 미수 해소만.');
