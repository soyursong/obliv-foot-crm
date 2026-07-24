/**
 * (A) 박민석 F-4790 — 확장 FK-closure READ-ONLY freeze/archive (WRITE 0).
 * dry-run 원본이 누락한 check_ins 자식 3종(status_transitions/form_submissions/check_in_services) id 명시 동결 + archive.
 * planner 확장승인 시 이 id셋으로만 FK-safe DELETE. 필터 재실행 금지.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url),'utf8').split('\n')) {
  const m=line.match(/^([A-Z_]+)=(.*)$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
const sb=createClient('https://rxlomoozakkjesdqjtvd.supabase.co',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const CI=['9fa4be59-2b48-47f7-beed-561d5483377d','32c1431c-23e9-465b-8575-164f8a763ee3','4c0f40b6-e674-473d-bb48-0f5bb7757ad9','4a406e80-16f4-428e-8f8e-6fa08e0bdc9a'];
const out={ ticket:'T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL', part:'A_extended_children',
  mode:'READ-ONLY FREEZE (WRITE 0)', note:'dry-run 누락 FK 자식 확장동결. ledger(payments/service_charges/package_sessions)=0 재확인.',
  parent_check_ins:CI, archive:{}, freeze_ids:{}, ledger_recheck:{} };
for (const t of ['status_transitions','form_submissions','check_in_services']) {
  const { data } = await sb.from(t).select('*').in('check_in_id', CI);
  out.archive[t]=data??[]; out.freeze_ids[t]=(data??[]).map(r=>r.id);
}
for (const t of ['payments','service_charges','package_sessions','payment_items','insurance_receipts','insurance_claims']) {
  const { data } = await sb.from(t).select('id').in('check_in_id', CI);
  out.ledger_recheck[t]=(data??[]).length;
}
out.counts=Object.fromEntries(Object.entries(out.freeze_ids).map(([k,v])=>[k,v.length]));
writeFileSync(new URL('./T-20260724-foot-ASSIGN-KIMJUYEON-TODAY-TESTDATA-DEL_FREEZE_A_EXTENDED.json', import.meta.url), JSON.stringify(out,null,2));
console.log('확장 freeze counts:', JSON.stringify(out.counts));
console.log('ledger 재확인:', JSON.stringify(out.ledger_recheck));
