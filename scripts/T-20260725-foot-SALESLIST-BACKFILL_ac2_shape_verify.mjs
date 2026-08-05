/**
 * AC-2 READ-ONLY: INSERT shape 정합 검증 (기존 F-4906 CTB 거래를 golden template로).
 *   - F-4906 line f519496a / payment 853cbcec 의 전 컬럼 dump → 신규 INSERT 컬럼값 정합
 *   - CTB(비급여 화장품)에 service_charges 브릿지 필요 여부
 *   - payments NOT NULL / default 제약 (clinic_id, is_simulation, status)
 *   - 다른 화장품 seller-attributed 라인의 payment 연계 패턴
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const p = (...a) => console.log(...a);

async function main() {
  p('=== F-4906 golden line f519496a (full) ===');
  const { data: line } = await sb.from('check_in_services').select('*').eq('id', 'f519496a-e90f-4961-bed6-087e882ee18d');
  p(JSON.stringify(line?.[0], null, 2));

  p('\n=== F-4906 golden payment 853cbcec (full) ===');
  const { data: pay } = await sb.from('payments').select('*').eq('id', '853cbcec-08e0-4c12-a7b4-d11ffbd4e17d');
  p(JSON.stringify(pay?.[0], null, 2));

  p('\n=== CTB(e17ba3a3) 화장품 라인들 → 연계 payment/service_charge 패턴 (샘플 8) ===');
  const { data: ctbLines } = await sb.from('check_in_services')
    .select('id, check_in_id, price, seller_staff_id, service_id')
    .eq('service_id', 'e17ba3a3-4842-4097-87bc-0778a64d2755').limit(8);
  for (const l of ctbLines ?? []) {
    const { data: pm } = await sb.from('payments').select('id, amount, method, accounting_date, service_charge_id').eq('check_in_id', l.check_in_id);
    p(`  line=${l.id} ci=${l.check_in_id} seller=${l.seller_staff_id} → payments: ${JSON.stringify(pm)}`);
  }

  p('\n=== service_charges: CTB(비급여) 라인 연계 존재? (임의 CTB check_in 조회) ===');
  const ciIds = (ctbLines ?? []).map((l) => l.check_in_id);
  if (ciIds.length) {
    const { data: sc, error } = await sb.from('service_charges').select('*').in('check_in_id', ciIds).limit(20);
    p('service_charges rows:', sc?.length ?? 0, error ? `(err ${error.message})` : '');
    if (sc?.length) p(JSON.stringify(sc.slice(0,3), null, 2));
  }

  p('\n=== payments 컬럼 NOT NULL / default (information_schema) ===');
  const { data: cols, error: cErr } = await sb.rpc('exec_sql_ro', {}).then(() => ({data:null,error:'no-rpc'})).catch(()=>({data:null,error:'no-rpc'}));
  // fallback: sample a few rows to infer is_simulation/status defaults
  const { data: samp } = await sb.from('payments').select('id, clinic_id, is_simulation, status, installment, payment_type').limit(5);
  p('sample rows (clinic_id/is_simulation/status/installment/payment_type):');
  p(JSON.stringify(samp, null, 2));
}
main().then(()=>{p('\n[shape-verify done]');process.exit(0);}).catch((e)=>{console.error(e);process.exit(1);});
