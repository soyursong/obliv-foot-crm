/**
 * T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — dev-foot POSTCHECK (READ-ONLY)
 *   supervisor 요청(MSG-20260805-230425-jwv9): SalesStaffTab(담당치료사별 화장품 매출집계)에서
 *   김규리 CTB 3건(45,000) 반영·귀속 표시 확인. 브라우저 render 를 뒷받침하는 DB-side 대사.
 *   SalesStaffTab.tsx cosmeticLines 쿼리·버킷 로직(COALESCE(seller_staff_id, therapist_id),
 *   풋화장품 category, voided_at IS NULL, price>0)을 SQL 로 그대로 재현한다. WRITE 없음.
 */
import fs from 'fs';
const REF = 'rxlomoozakkjesdqjtvd';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local'))
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/); if (m) TOKEN = m[1].trim().replace(/^["']|["']$/g, ''); }
if (!TOKEN) { console.error('❌ SUPABASE_ACCESS_TOKEN 미제공'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}
const KIMGYURI = '3a0c6774-2bd9-4018-bb38-ef6fab75d04b';

async function main() {
  // 1) SalesStaffTab cosmeticLines 재현: 풋화장품 라인 + check_ins 조인 + 버킷 = COALESCE(seller_staff_id, therapist_id)
  console.log('=== [1] SalesStaffTab 재현: 김규리 버킷 화장품 라인 (풋화장품 · voided_at NULL · price>0) ===');
  const lines = await q(`
    SELECT cis.id, cust.chart_number, cust.name AS patient, cis.service_name, cis.price,
           cis.seller_staff_id::text AS seller, ci.therapist_id::text AS therapist,
           COALESCE(cis.seller_staff_id, ci.therapist_id)::text AS bucket,
           (ci.checked_in_at AT TIME ZONE 'Asia/Seoul')::date AS visit_date
    FROM public.check_in_services cis
    JOIN public.check_ins ci ON ci.id = cis.check_in_id
    LEFT JOIN public.customers cust ON cust.id = ci.customer_id
    JOIN public.services svc ON svc.id = cis.service_id
      AND (svc.category = '풋화장품' OR svc.category_label = '풋화장품')
    WHERE COALESCE(cis.seller_staff_id, ci.therapist_id) = '${KIMGYURI}'
      AND cis.voided_at IS NULL AND cis.price > 0
      AND cust.chart_number IN ('F-4550','F-5016','F-4906')
    ORDER BY cust.chart_number;`);
  console.table(lines);

  const sum = lines.reduce((a, r) => a + Number(r.price || 0), 0);
  console.log(`\n김규리 버킷 CTB 대상 3차트 라인수=${lines.length}, 합계=${sum.toLocaleString()}원`);

  // 2) 신규 card payment 2건 (F-4550/F-5016) + F-4906 기존 payment 링크(이중계상 0)
  console.log('\n=== [2] payments 결제수단 = card 확인 (INFO 3hpw 확정값) ===');
  const pays = await q(`
    SELECT id, amount, method, payment_type, is_simulation
    FROM public.payments
    WHERE id IN ('7a0935ed-f4ac-491d-86c0-8d09d0d9440f','16729866-5bc8-40d6-9fc9-dc1286f692b8')
    ORDER BY id;`);
  console.table(pays);

  // 3) 전체 김규리 버킷 화장품 집계 (SalesStaffTab 칸 표시금액과 동일 산식, 참고)
  console.log('\n=== [3] 김규리 전체 화장품 버킷 집계 (SalesStaffTab 칸 표시금액 재현, 전기간) ===');
  const agg = await q(`
    SELECT COALESCE(cis.seller_staff_id, ci.therapist_id)::text AS bucket,
           count(*)::int AS cnt, sum(cis.price)::int AS amount
    FROM public.check_in_services cis
    JOIN public.check_ins ci ON ci.id = cis.check_in_id
    JOIN public.services svc ON svc.id = cis.service_id
      AND (svc.category = '풋화장품' OR svc.category_label = '풋화장품')
    WHERE cis.voided_at IS NULL AND cis.price > 0
      AND COALESCE(cis.seller_staff_id, ci.therapist_id) = '${KIMGYURI}'
    GROUP BY 1;`);
  console.table(agg);

  const ok3 = lines.length === 3 && sum === 45000;
  const okCard = pays.length === 2 && pays.every((p) => p.method === 'card' && Number(p.amount) === 15000 && p.payment_type === 'payment' && p.is_simulation === false);
  console.log(`\n${ok3 ? '✅' : '❌'} 김규리 CTB 3건=45,000 SalesStaffTab 버킷 귀속 ${ok3 ? 'PASS' : 'FAIL'}`);
  console.log(`${okCard ? '✅' : '❌'} 신규 결제 2건 card/15,000 ${okCard ? 'PASS' : 'FAIL'}`);
  if (!ok3 || !okCard) process.exit(5);
  console.log('\n✅ POSTCHECK PASS — 브라우저 SalesStaffTab 김규리 칸에 3건/45,000 render 근거 확정.');
}
main().catch((e) => { console.error('❌ POSTCHECK ERROR:', e.message); process.exit(1); });
