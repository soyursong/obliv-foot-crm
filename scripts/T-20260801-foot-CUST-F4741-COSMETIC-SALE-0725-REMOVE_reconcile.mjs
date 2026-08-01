// T-20260801 F-4741 payments 그레인 정합 READ-ONLY.
// 목적: 기존 provenance(payments 30a9ac47, 10,500 VAN 7/25)와 화장품판매(check_in_services) 그레인 정합.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n').filter((l)=>l&&!l.trimStart().startsWith('#')&&l.includes('=')).map((l)=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const won=(n)=>(n??0).toLocaleString('ko-KR')+'원';
const CUST='259abd32-d784-4c45-b59e-1ccae1b69492';
async function main(){
  // 1) payments 전 컬럼 — customer_id 링크가 있으면 그걸로도 조회
  const { data: pcols, error: e1 } = await sb.from('payments').select('*').eq('id','30a9ac47-0000-0000-0000-000000000000').limit(1);
  // 실제 30a9ac47 full id 모름 → prefix 검색은 불가. customer 기준 전량 조회.
  // payments에 customer_id 컬럼 있는지 확인 위해 1행 샘플
  const { data: sample } = await sb.from('payments').select('*').limit(1);
  console.log('=== payments 컬럼 ===');
  console.log('  ', sample?.[0] ? Object.keys(sample[0]).join(', ') : '(no rows)');

  // 2) customer_id 로 payments 조회 (컬럼 있으면)
  const hasCustCol = sample?.[0] && 'customer_id' in sample[0];
  if (hasCustCol) {
    const { data: pByCust } = await sb.from('payments').select('*').eq('customer_id', CUST).order('created_at',{ascending:true});
    console.log(`\n=== payments by customer_id ${pByCust?.length??0}건 ===`);
    (pByCust??[]).forEach((p)=>console.log(`  id=${p.id.slice(0,8)} | ci=${(p.check_in_id??'').slice(0,8)||'(null)'} | ${won(p.amount)} | ${p.method} | status=${p.status} | approval=${p.approval_number??p.approval_no??'-'} | created=${p.created_at?.slice(0,19)}`));
  } else {
    console.log('\n(payments에 customer_id 컬럼 없음 — check_in_id 링크만 존재)');
  }

  // 3) 7/25 하루 전체 payments 중 10,500 / VAN / approval 72050852 탐색
  const { data: p725 } = await sb.from('payments').select('*').gte('created_at','2026-07-25T00:00:00+09:00').lte('created_at','2026-07-25T23:59:59+09:00');
  const hit = (p725??[]).filter((p)=> p.amount===10500 || String(p.approval_number??p.approval_no??'').includes('72050852') || String(p.id).startsWith('30a9ac47'));
  console.log(`\n=== 7/25 전체 payments 중 10,500/72050852/30a9ac47 매칭 ${hit.length}건 ===`);
  hit.forEach((p)=>console.log(`  id=${p.id} | ci=${p.check_in_id??'(null)'} | ${won(p.amount)} | ${p.method} | approval=${p.approval_number??p.approval_no??'-'} | created=${p.created_at?.slice(0,19)} | 전체=${JSON.stringify(p)}`));

  // 4) receipts / van 매칭 테이블 존재 시 (auto_matched)
  console.log('\n__DONE_RECON__');
}
main().catch((e)=>{console.error('ERR',e.message);process.exit(1);});
