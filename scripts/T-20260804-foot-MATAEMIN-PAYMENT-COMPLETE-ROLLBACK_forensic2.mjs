/**
 * T-20260804-foot-MATAEMIN-PAYMENT-COMPLETE-ROLLBACK — FORENSIC 2 (READ-ONLY)
 * 매출영향·명세·직전상태·오클릭주체 심층 규명. 순수 SELECT.
 */
import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
const j = (o) => JSON.stringify(o, null, 2);

const CUST = 'c18b7fd4-1183-4fa1-8aa3-442a65ee24d2';
const CHECKIN = '3c69ac66-63e3-451d-ae42-33a8ef88a1b3';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const PAY_IDS = ['9d8c6f77-dbe0-40c1-a024-5b33b23fb035','d05b5a95-4de3-4f71-a018-932e1ef11adf','4385ba22-be39-48f4-9386-ddcc7086c22a','88e504d0-ffe6-446d-b54b-da0e594e2019','5c642195-251e-47c2-bd31-392bf0b057cf'];

// (A) service_charges — 이 방문의 청구 명세(기대 청구액)
const { data: sc, error: sce } = await sb.from('service_charges')
  .select('*').or(`check_in_id.eq.${CHECKIN},customer_id.eq.${CUST}`).order('created_at',{ascending:true}).limit(50);
console.log('===== (A) service_charges (마태민 청구 명세) =====');
console.log('count:', sc?.length, 'err:', sce?.message);
console.log(j(sc));

// (B) 전체 payments 상세(모든 컬럼) — 오클릭 주체/외부승인 추적
const { data: payFull, error: pfe } = await sb.from('payments').select('*').in('id', PAY_IDS).order('created_at',{ascending:true});
console.log('\n===== (B) payments 전체컬럼 (5행) =====');
console.log('err:', pfe?.message);
console.log(j(payFull));

// (C) daily_closings — 08-03/08-04 마감 상태 (결제완료가 마감에 잠겼는지)
const { data: dc, error: dce } = await sb.from('daily_closings')
  .select('id, clinic_id, close_date, status, closed_at, system_card_total, actual_card_total, difference, revision, dirty, confirmed_by')
  .eq('clinic_id', CLINIC).in('close_date', ['2026-08-03','2026-08-04']);
console.log('\n===== (C) daily_closings 08-03/04 =====');
console.log('count:', dc?.length, 'err:', dce?.message);
console.log(j(dc));

// (D) v_daily_revenue — 08-03/04 clinic 매출집계 반영
const { data: rev, error: reve } = await sb.from('v_daily_revenue')
  .select('*').eq('clinic_id', CLINIC).in('dt', ['2026-08-03','2026-08-04']);
console.log('\n===== (D) v_daily_revenue 08-03/04 =====');
console.log('count:', rev?.length, 'err:', reve?.message);
console.log(j(rev));

// (E) audit_logs 범용 테이블 탐색(있으면) — 오클릭 주체
for (const t of ['audit_logs','activity_logs','check_in_status_logs','check_in_logs']) {
  const { data, error } = await sb.from(t).select('*').limit(1);
  if (!error) {
    const { data: rows } = await sb.from(t).select('*').or(`check_in_id.eq.${CHECKIN}`).limit(20).catch?.(()=>({data:null})) || {};
    console.log(`\n(E) table '${t}' EXISTS. cols:`, data[0]?Object.keys(data[0]).join(', '):'(empty)');
  }
}

// (F) closing_manual_payments — 수기 조정 반영 여부
const { data: cmp, error: cmpe } = await sb.from('closing_manual_payments')
  .select('*').eq('clinic_id', CLINIC).gte('created_at','2026-08-03').lte('created_at','2026-08-05').limit(20);
if (!cmpe) { console.log('\n===== (F) closing_manual_payments 08-03~04 ====='); console.log('count:', cmp?.length); console.log(j(cmp)); }
else console.log('\n(F) closing_manual_payments:', cmpe.message);

console.log('\n===== FORENSIC2 COMPLETE (READ-ONLY) =====');
