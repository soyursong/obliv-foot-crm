/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 1 blast-radius + freeze 검증 (READ-ONLY).
 * freeze 후보: pkg A 3bde69cb (12회권 refunded) + package_payments 4 (1d865046,c6fcbb7b,e064d498,6f1a5f98)
 * KEEP: pkg B 9a553cbd (active) + pp bc58d34e + payments 01299d6c(10k 단건)
 * 목적: 삭제 대상의 모든 자식 접점 census + KEEP 대상 무접점 확인 + 12회권 템플릿 확인. SELECT only.
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const PKG_A = '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';
const PP_A  = "'1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86','e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650'";
const PKG_B = '9a553cbd-621b-435e-ae20-aabc035e363e';
const PP_B  = 'bc58d34e-0ac8-422c-8a83-c8b6000e0a6d';
const PM_STRAY = '01299d6c-d7e1-45bb-894b-ead27c80ac36';
const out = {};

// 1) 삭제대상 pkg A 자식 census (packages 자식표면 전부: check_ins[a], package_payments[c], package_sessions[c], packages.transferred_from[a])
out.A_checkins   = await q(`SELECT count(*) n FROM check_ins WHERE package_id='${PKG_A}';`);
out.A_pkgpay     = await q(`SELECT count(*) n FROM package_payments WHERE package_id='${PKG_A}';`);
out.A_sessions   = await q(`SELECT count(*) n FROM package_sessions WHERE package_id='${PKG_A}';`);
out.A_transfer   = await q(`SELECT count(*) n FROM packages WHERE transferred_from='${PKG_A}' OR transferred_to='${PKG_A}';`);
// package_payments A 의 자식 (claim_diagnoses[c], parent_payment 참조[a])
out.A_pp_claimdx = await q(`SELECT count(*) n FROM claim_diagnoses WHERE package_payment_id IN (${PP_A});`);
out.A_pp_asparent= await q(`SELECT id, parent_payment_id FROM package_payments WHERE parent_payment_id IN (${PP_A});`);

// 2) KEEP 대상 무접점 확인 — 삭제대상이 KEEP을 참조하거나 KEEP이 삭제대상 참조하지 않는지
out.B_pkgpay     = await q(`SELECT id, amount, payment_type, parent_payment_id FROM package_payments WHERE package_id='${PKG_B}';`);
out.stray_pm     = await q(`SELECT id, check_in_id, amount, payment_type, status, parent_payment_id, linked_payment_id FROM payments WHERE id='${PM_STRAY}';`);
// 혼선 방지: 삭제대상 pp 4건 중 parent가 KEEP을 가리키거나, KEEP pp가 삭제대상을 parent로 갖는지
out.cross_parent = await q(`
  SELECT id, package_id, parent_payment_id, payment_type FROM package_payments
  WHERE parent_payment_id IN (${PP_A}) OR id IN (${PP_A}) OR package_id IN ('${PKG_A}','${PKG_B}')
  ORDER BY created_at;`);
// stray payment 자식 (payment_items[c], claim_diagnoses[c], 참조들)
out.stray_items  = await q(`SELECT count(*) n FROM payment_items WHERE payment_id='${PM_STRAY}';`);
out.stray_claimdx= await q(`SELECT count(*) n FROM claim_diagnoses WHERE payment_id='${PM_STRAY}';`);

// 3) 12회권 템플릿 확인 (RC narrative: 12회권 템플릿인데 total_sessions=8 로 저장된 정황)
out.tmpl = await q(`SELECT id, template_name, total_sessions FROM package_templates WHERE id='a97a74f6-8c87-47dd-9519-e7e277179899';`).catch(e=>({err:String(e)}));

// 4) 동명이인/2번차트 재확인 — 한정수 관련 customers 전수 (phone 포함)
out.all_hanjs = await q(`SELECT id, chart_number, name, phone, visit_type, created_at FROM customers WHERE name LIKE '%한정수%' ORDER BY created_at;`);

console.log(JSON.stringify(out, null, 2));
