/**
 * T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY — payment-layer 실측 (FIX-REQUEST if4s).
 * 목적: payment 2e8f7aa5 실측 + v_daily_revenue 반영 여부 + (a/b) 판정근거 + 김병완 F-4741 구조대조.
 * READ-ONLY (SELECT only). prod write/DDL 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};

// [1] payment 2e8f7aa5 FULL 실측 (실재 컬럼만: pg_provider/seller_staff_id 컬럼 부재)
out['1_payment_2e8f7aa5'] = await q(`
  SELECT p.id, p.amount, p.method, p.payment_type, p.status, p.is_simulation,
         p.external_status, p.external_approval_no, p.appr_info, p.merchant_no,
         p.card_no_masked, p.clinic_id, p.accounting_date,
         p.created_at AT TIME ZONE 'Asia/Seoul' AS created_kst,
         p.check_in_id, p.customer_id, p.package_id, p.service_charge_id,
         p.created_by, p.memo,
         cu.name AS customer_name, cu.chart_number,
         cb.name AS created_by_name
  FROM payments p
  LEFT JOIN customers cu ON cu.id = p.customer_id
  LEFT JOIN staff cb ON cb.id = p.created_by
  WHERE p.id::text LIKE '2e8f7aa5%';`);

// [2] v_daily_revenue 반영 여부 — 2e8f7aa5 가 집계 술어(status=active AND clinic_id NOT NULL)를 만족하는지
out['2_revenue_inclusion_predicate'] = await q(`
  SELECT p.id, p.status, p.clinic_id IS NOT NULL AS has_clinic,
         (p.status='active' AND p.clinic_id IS NOT NULL) AS counted_in_v_daily_revenue,
         p.payment_type, p.amount,
         (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS revenue_dt
  FROM payments p WHERE p.id::text LIKE '2e8f7aa5%';`);

// [2b] 실제 그 날짜 clinic 매출에 amount가 녹아있는지 교차확인
out['2b_daily_revenue_row'] = await q(`
  SELECT vdr.dt, vdr.clinic_id, vdr.single_revenue, vdr.net_revenue
  FROM v_daily_revenue vdr
  WHERE (vdr.dt, vdr.clinic_id) IN (
    SELECT (p.created_at AT TIME ZONE 'Asia/Seoul')::date, p.clinic_id
    FROM payments p WHERE p.id::text LIKE '2e8f7aa5%');`);

// [3] 판매자 귀속축: payments엔 seller_staff_id 컬럼 없음 → cis 라인이 판매자별 화장품표 소스
//     2e8f7aa5의 check_in 에 대응하는 cis 판매라인 유무
out['3_cis_lines_on_checkin'] = await q(`
  SELECT cis.id, cis.check_in_id, cis.service_id, cis.service_name, cis.price,
         cis.seller_staff_id, cis.voided_at, cis.created_at,
         s.category, s.category_label, st.name AS seller_name
  FROM check_in_services cis
  LEFT JOIN services s ON s.id = cis.service_id
  LEFT JOIN staff st ON st.id = cis.seller_staff_id
  WHERE cis.check_in_id = (SELECT check_in_id FROM payments WHERE id::text LIKE '2e8f7aa5%')
  ORDER BY cis.created_at;`);

// [3b] 현은호 전체 풋화장품 cis 라인 (0건 재확인)
out['3b_hyuneunho_cosmetic_cis'] = await q(`
  SELECT cis.id, cis.service_name, cis.price, cis.seller_staff_id, cis.voided_at,
         s.category, s.category_label
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  JOIN customers cu ON cu.id = ci.customer_id
  LEFT JOIN services s ON s.id = cis.service_id
  WHERE cu.name='현은호' AND (s.category='풋화장품' OR s.category_label='풋화장품')
  ORDER BY ci.checked_in_at;`);

// [4] 김병완 F-4741 (b7ab6496) 구조대조 — cis wipe vs 현은호 애초 미생성 구분
out['4_kim_payment'] = await q(`
  SELECT p.id, p.amount, p.method, p.payment_type, p.status,
         p.check_in_id, p.customer_id,
         (p.created_at AT TIME ZONE 'Asia/Seoul') AS created_kst,
         cu.name, cu.chart_number
  FROM payments p LEFT JOIN customers cu ON cu.id=p.customer_id
  WHERE cu.chart_number='F-4741' ORDER BY p.created_at;`);
out['4b_kim_cosmetic_cis'] = await q(`
  SELECT cis.id, cis.service_name, cis.price, cis.seller_staff_id, cis.voided_at,
         cis.created_at, s.category, s.category_label
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id=cis.check_in_id
  JOIN customers cu ON cu.id=ci.customer_id
  LEFT JOIN services s ON s.id=cis.service_id
  WHERE cu.chart_number='F-4741'
  ORDER BY cis.created_at;`);

console.log(JSON.stringify(out,null,2));
