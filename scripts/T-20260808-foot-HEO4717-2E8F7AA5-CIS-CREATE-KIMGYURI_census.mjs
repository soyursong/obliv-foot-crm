/**
 * T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI — DA CONSULT 근거 census.
 * 목적: cis 신규 CREATE(무→유)가 이중계상을 유발하는지 판정하기 위한 매출-뷰 topology + 값 provenance 실측.
 * ★dispositive: check_in_services 가 v_daily_revenue(또는 총매출/일마감 뷰)에 이미 계상된 payment 2e8f7aa5 와
 *   같은 축으로 흘러가는가? (흘러가면 cis CREATE = 이중계상 → NO-GO)
 * READ-ONLY (SELECT / introspection only). prod write/DDL 0.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const out={};

// [1] payment 2e8f7aa5 실재 + check_in 결속 재확인
out['1_payment_2e8f7aa5'] = await q(`
  SELECT p.id, p.amount, p.method, p.payment_type, p.status, p.is_simulation,
         p.clinic_id, p.accounting_date,
         (p.created_at AT TIME ZONE 'Asia/Seoul') AS created_kst,
         p.check_in_id, p.customer_id, p.package_id, p.service_charge_id,
         cu.name AS customer_name, cu.chart_number
  FROM payments p LEFT JOIN customers cu ON cu.id=p.customer_id
  WHERE p.id::text LIKE '2e8f7aa5%';`);

// [2] 부모 check_in c33dfc76 + therapist + 방문시각(월축 = checked_in_at)
out['2_checkin_c33dfc76'] = await q(`
  SELECT ci.id, ci.customer_id, ci.therapist_id,
         (ci.checked_in_at AT TIME ZONE 'Asia/Seoul') AS checked_in_kst,
         ci.status, cu.name AS customer_name, cu.chart_number,
         th.name AS therapist_name
  FROM check_ins ci
  LEFT JOIN customers cu ON cu.id=ci.customer_id
  LEFT JOIN staff th ON th.id=ci.therapist_id
  WHERE ci.id::text LIKE 'c33dfc76%';`);

// [3] 김규리 staff row (동명이인 방지) — seller_staff_id 확정용
out['3_kimgyuri_staff'] = await q(`
  SELECT id, name, role, active, clinic_id
  FROM staff WHERE name LIKE '%김규리%' ORDER BY active DESC;`);

// [4] Care Toe Band service e17ba3a3 (값 provenance: 품목/정가/카테고리)
out['4_ctb_service'] = await q(`
  SELECT id, name, price, category, category_label
  FROM services WHERE id::text LIKE 'e17ba3a3%';`);

// [5] check_in c33dfc76 에 딸린 기존 cis 라인 (CTB cis 0건 재확인 + 다른 라인 존재양상)
out['5_cis_on_c33dfc76'] = await q(`
  SELECT cis.id, cis.service_id, cis.service_name, cis.price,
         cis.seller_staff_id, cis.voided_at,
         s.category, s.category_label, st.name AS seller_name
  FROM check_in_services cis
  LEFT JOIN services s ON s.id=cis.service_id
  LEFT JOIN staff st ON st.id=cis.seller_staff_id
  WHERE cis.check_in_id::text LIKE 'c33dfc76%'
  ORDER BY cis.created_at;`);

// [6] check_in_services 실 컬럼 구조 (seller_staff_id / quantity / price 등 write target 스키마)
out['6_cis_columns'] = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_name='check_in_services' AND table_schema='public'
  ORDER BY ordinal_position;`);

// [7] ★DISPOSITIVE — v_daily_revenue 뷰 정의: payments 만 읽는가, cis/service_charges 도 읽는가?
out['7_v_daily_revenue_def'] = await q(`
  SELECT pg_get_viewdef('public.v_daily_revenue'::regclass, true) AS def;`);

// [8] ★DISPOSITIVE — check_in_services 를 소스로 참조하는 모든 뷰 (총매출/일마감/명세 계열이 있는지)
out['8_views_referencing_cis'] = await q(`
  SELECT DISTINCT v.relname AS view_name
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class v ON v.oid=r.ev_class
  JOIN pg_class src ON src.oid=d.refobjid
  WHERE src.relname='check_in_services' AND v.relkind IN ('v','m')
  ORDER BY 1;`);

// [9] ★DISPOSITIVE — payments 를 소스로 참조하는 모든 뷰 (2e8f7aa5 가 계상되는 축 열거)
out['9_views_referencing_payments'] = await q(`
  SELECT DISTINCT v.relname AS view_name
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid=d.objid
  JOIN pg_class v ON v.oid=r.ev_class
  JOIN pg_class src ON src.oid=d.refobjid
  WHERE src.relname='payments' AND v.relkind IN ('v','m')
  ORDER BY 1;`);

// [10] 2e8f7aa5 가 v_daily_revenue 07-28 매출에 실제 녹아있는지 (계상축 확인)
out['10_2e8f7aa5_in_daily_revenue'] = await q(`
  SELECT p.id, p.status, (p.status='active' AND p.clinic_id IS NOT NULL) AS counted_predicate,
         (p.created_at AT TIME ZONE 'Asia/Seoul')::date AS revenue_dt, p.amount
  FROM payments p WHERE p.id::text LIKE '2e8f7aa5%';`);

// [11] service_charges 에 CTB 대응 명세가 있는지 (명세 grain 이중계상 후보)
out['11_service_charges_c33dfc76'] = await q(`
  SELECT sc.*
  FROM service_charges sc
  WHERE sc.check_in_id::text LIKE 'c33dfc76%';`);

console.log(JSON.stringify(out,null,2));
