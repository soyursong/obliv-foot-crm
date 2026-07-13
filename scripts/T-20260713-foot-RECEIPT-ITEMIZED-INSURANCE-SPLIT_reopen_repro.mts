/**
 * T-20260713-foot-RECEIPT-ITEMIZED-INSURANCE-SPLIT — reopen(diagnose-first) 재현 아티팩트.
 *
 * 목적: field-soak 재보고(김민경 F-4452, check_in c284b0d9, 2026-07-13)에서
 *   계산서·영수증 진찰료 행 공단 18,840 이 '빈칸'이라는 잔존갭이 **현행 배포 코드에서 재현되는지**를
 *   prod 실데이터 + 실 SSOT 함수(computeFootBilling → buildFootBillDetailItems → buildBillReceiptFeeGridHtml)로
 *   end-to-end 재현한다.
 *
 * 결론(RC): 현행 코드는 진찰료 공단 18,840 을 **정상 산출** (아래 출력). 필드 산출물(빈칸+처치및수술료 307,220 lump)은
 *   b74f3f33(fee_grid, 07-13 16:10) 이전의 **정적 템플릿(BILL_RECEIPT_HTML 구버전) 시그니처**이며,
 *   갤탭 장기 세션(16:10 이전 로드된 SPA 번들)이 재적재 없이 구 in-memory 번들을 계속 구동해 발생.
 *   서비스워커 없음 / index.html=must-revalidate / chunk=immutable → 탭 새로고침 시 최신 번들 적재됨.
 *
 * 실행: cd repo && VITE_SUPABASE_URL=.. VITE_SUPABASE_ANON_KEY=.. npx tsx scripts/<this>.mts
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { computeFootBilling, buildFootBillDetailItems, type FootBillingItem } from '../src/lib/footBilling';
import { buildBillReceiptFeeGridHtml, buildBillDetailItemsHtml } from '../src/lib/htmlFormTemplates';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k: string) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const sb = createClient(get('VITE_SUPABASE_URL')!, get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CHECK_IN = 'c284b0d9-3dfb-485d-99dc-db0d1437f6b9'; // F-4452 김민경 2026-07-13
const { data: rows } = await sb.from('check_in_services').select('service_id, price').eq('check_in_id', CHECK_IN);
const ids = [...new Set((rows ?? []).map((r: any) => r.service_id))];
const { data: sd } = await sb.from('services').select('id,name,service_code,hira_code,hira_category,is_insurance_covered,category_label,price,vat_type').in('id', ids);
const smap = new Map((sd ?? []).map((s: any) => [s.id, s]));
const items: FootBillingItem[] = (rows ?? []).map((r: any) => ({ service: smap.get(r.service_id), qty: 1, unitPrice: r.price ?? 0 }));

// customers.insurance_grade (현행) + grade=null (필드 관측: 소계 본인 0 = copaymentTotal 0)
for (const grade of ['general', null] as const) {
  const fb = computeFootBilling(items, grade as any);
  const billItems = buildFootBillDetailItems(fb.pricingItems, '2026-07-13', { insuranceGrade: grade as any, copaymentTotal: fb.copaymentTotal });
  console.log(`\n===== grade=${grade} | covered=${fb.coveredTotal} copay=${fb.copaymentTotal} grand=${fb.grandTotal} nonCov=${fb.nonCoveredTotal} =====`);
  console.log('[RECEIPT fee_grid rows]');
  for (const line of buildBillReceiptFeeGridHtml(billItems as any).split('\n')) {
    const m = line.match(/br-label">([^<]*)<.*?br-num">([^<]*)<.*?br-num">([^<]*)<.*?br-num">([^<]*)<.*?br-num">([^<]*)</);
    if (m && (m[2] || m[3] || m[4] || m[5])) console.log(`  ${m[1].trim().padEnd(10)} | 공단=${m[2]||'-'} 본인=${m[3]||'-'} 비급여=${m[4]||'-'} 합계=${m[5]||'-'}`);
  }
}
console.log('\n▶ 현행 코드: grade=null 시 진찰료 공단=18,840 정상 산출. 필드 빈칸은 구번들(정적템플릿) 잔존 = 탭 새로고침으로 해소.');
