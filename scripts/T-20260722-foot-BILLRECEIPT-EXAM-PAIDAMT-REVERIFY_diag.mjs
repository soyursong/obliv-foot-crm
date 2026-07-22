/**
 * T-20260722-foot-BILLRECEIPT-EXAM-PAIDAMT-REVERIFY — diagnose-first (라이브 무접촉, READ-ONLY)
 *
 * 목적: '진료비 계산서·영수증'(bill_receipt_new) 출력 갭 2건 실측 근거 수집.
 *   ① 검사료 미분리 — foot 검사 서비스가 급여/비급여? footBillDetailCategory 매핑 대상?
 *   ② 납부금액 미표기 — (코드분석은 별도) 여기선 payments 존재 여부만 참고.
 * READ-ONLY. side-effect 0.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('env 필요'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

// 1) 서비스 카테고리 분포 — 검사 계열 서비스의 급여여부
const { data: svcs, error: e1 } = await sb
  .from('services')
  .select('id,name,category_label,is_insurance_covered,hira_category,service_code')
  .order('category_label', { nullsFirst: false });
if (e1) { log('services err', e1.message); }
else {
  const byCat = {};
  for (const s of svcs) {
    const c = s.category_label ?? '(null)';
    byCat[c] = byCat[c] || { total: 0, covered: 0, uncovered: 0, hira: new Set(), examples: [] };
    byCat[c].total++;
    if (s.is_insurance_covered) byCat[c].covered++; else byCat[c].uncovered++;
    byCat[c].hira.add(s.hira_category ?? '(null)');
    if (byCat[c].examples.length < 4) byCat[c].examples.push(`${s.name}[cov=${s.is_insurance_covered}]`);
  }
  log('=== [1] services category_label 분포 (검사료 매핑 대상 = category_label 검사) ===');
  for (const [c, v] of Object.entries(byCat)) {
    log(`  ${c}: 총${v.total} 급여${v.covered}/비급여${v.uncovered} hira={${[...v.hira].join(',')}} ex: ${v.examples.join(', ')}`);
  }
}

// 2) 검사 계열 서비스가 실제 청구(service_charges)에 얼마나 급여로 기록되나
const { data: exSvcs } = await sb.from('services').select('id,name,category_label,is_insurance_covered').eq('category_label', '검사');
const exIds = (exSvcs ?? []).map((s) => s.id);
log(`\n=== [2] '검사' category 서비스 ${exIds.length}건: ${(exSvcs??[]).map(s=>`${s.name}(cov=${s.is_insurance_covered})`).join(', ')} ===`);

// 3) 최근 service_charges 중 검사 항목 급여여부 실측
if (exIds.length) {
  const { data: chg } = await sb
    .from('service_charges')
    .select('id,service_id,is_insurance_covered,base_amount,copayment_amount,created_at')
    .in('service_id', exIds)
    .order('created_at', { ascending: false })
    .limit(20);
  log(`\n=== [3] 최근 검사 service_charges ${chg?.length ?? 0}건 (급여여부 실측) ===`);
  for (const c of (chg ?? [])) {
    log(`  chg ${c.id.slice(0,8)} cov=${c.is_insurance_covered} base=${c.base_amount} copay=${c.copayment_amount} @${c.created_at?.slice(0,10)}`);
  }
}

// 4) 최근 check_in 하나에 대해 check_in_services 존재 여부 (footFb 경로 가용성)
const { data: recentCharges } = await sb
  .from('service_charges')
  .select('check_in_id,service_id,is_insurance_covered,base_amount,service:services(name,category_label)')
  .order('created_at', { ascending: false })
  .limit(200);
const byCheckIn = {};
for (const c of (recentCharges ?? [])) {
  if (!c.check_in_id) continue;
  byCheckIn[c.check_in_id] = byCheckIn[c.check_in_id] || [];
  byCheckIn[c.check_in_id].push(c);
}
// 검사 항목이 포함된 방문 찾기
const withExam = Object.entries(byCheckIn).find(([, items]) =>
  items.some((i) => (Array.isArray(i.service)?i.service[0]:i.service)?.category_label === '검사'));
log(`\n=== [4] 검사 항목 포함 최근 방문 ${withExam ? '발견' : '없음(최근200 charge 내)'} ===`);
if (withExam) {
  const [cid, items] = withExam;
  log(`  check_in ${cid.slice(0,8)} — service_charges ${items.length}건:`);
  for (const i of items) {
    const svc = Array.isArray(i.service)?i.service[0]:i.service;
    log(`    ${svc?.name} [${svc?.category_label}] cov=${i.is_insurance_covered} base=${i.base_amount}`);
  }
  const { data: cis } = await sb.from('check_in_services').select('id,service_id,quantity').eq('check_in_id', cid);
  log(`  check_in_services(footFb 경로): ${cis?.length ?? 0}건 → footFb ${cis?.length ? '가용(정상 category 매핑)' : '부재(serviceItems 폴백)'}`);
  const { data: pays } = await sb.from('payments').select('id,amount,status,method').eq('check_in_id', cid);
  log(`  payments: ${pays?.length ?? 0}건 ${(pays??[]).map(p=>`${p.amount}(${p.status}/${p.method})`).join(', ')}`);
}

fs.writeFileSync('evidence_T-20260722_diag.txt', out.join('\n'));
console.log('\n[done] evidence_T-20260722_diag.txt');
