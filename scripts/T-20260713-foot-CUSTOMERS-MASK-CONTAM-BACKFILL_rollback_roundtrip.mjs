/**
 * 롤백 라운드트립 검증 (단일 txn 무영속): forward body → rollback body → 상태복원 assert → sentinel 롤백.
 * 목적: rollback.sql 이 forward 를 정확히 역주행하는지 apply 前 실증(supervisor MIG-GATE 보강).
 * ★ 무영속. author: dev-foot / 2026-07-14
 */
import { readFileSync } from 'node:fs';
const REF='rxlomoozakkjesdqjtvd';
let TOKEN=process.env.SUPABASE_ACCESS_TOKEN;
if(!TOKEN){try{TOKEN=(readFileSync('.env.local','utf8').match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)||[])[1]?.trim().replace(/^["']|["']$/g,'');}catch{}}
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});return {ok:r.ok,text:await r.text()};}
const strip=s=>s.replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,'');
const fwdClean=strip(readFileSync('supabase/migrations/20260714020000_foot_customers_mask_contam_backfill.sql','utf8'));
const rb=strip(readFileSync('supabase/migrations/20260714020000_foot_customers_mask_contam_backfill.rollback.sql','utf8'));

const PH=['0356b229-e8c7-4655-aa6e-651b15370c1f','512998d0-d51a-42c4-947e-b0cb2cc69da4','67ea1793-05e5-4d4a-b5c1-1ec73486e317','bd307dfe-79f0-4fea-86a6-0957cea492cd','44a6a076-ca66-458a-bdc5-e0a3a12c2e67','2dc21d1c-6e9f-4643-a733-dca92252d830'];

// 단일 txn: forward(마이그 body) → rollback(rb body) → assert → sentinel 롤백
const roundtrip = `
${fwdClean}
${rb}
DO $chk$
DECLARE nph int; nchild int;
BEGIN
  -- 롤백 후 phantom 6건 복원됐는지
  SELECT count(*) INTO nph FROM customers WHERE id IN (${PH.map(p=>`'${p}'`).join(',')});
  -- 롤백 후 check_ins 가 다시 phantom 을 참조하는지(대표 1건: 이동됐던 자식이 되돌아왔는지)
  SELECT count(*) INTO nchild FROM check_ins WHERE customer_id IN (${PH.map(p=>`'${p}'`).join(',')});
  RAISE EXCEPTION 'ROUNDTRIP_SENTINEL:{"phantom_restored":%,"checkins_back_on_phantom":%}', nph, nchild;
END $chk$;`;

console.log('── 롤백 라운드트립 (forward→rollback→assert, sentinel 롤백) ──');
const res=await q(roundtrip);
if(res.ok){console.error('❌ sentinel 없이 성공 — 영속 위험');process.exit(1);}
const m=res.text.match(/ROUNDTRIP_SENTINEL:(\{.*?\})/);
if(!m){console.error('  ⚠ 라운드트립 중 ABORT(에러):\n'+res.text.slice(0,900));process.exit(1);}
const s=JSON.parse(m[1].replace(/\\"/g,'"'));
console.log('  결과:',JSON.stringify(s));
const pass = s.phantom_restored===6 && s.checkins_back_on_phantom>=6;
console.log(`  phantom 복원=${s.phantom_restored}/6  ·  check_ins phantom 복귀=${s.checkins_back_on_phantom}(≥6 기대)  ${pass?'✅':'❌'}`);
// post-probe: 여전히 phantom 잔존(무영속)
const pp=await q(`SELECT count(*) n FROM customers WHERE id IN (${PH.map(p=>`'${p}'`).join(',')});`);
const nn=JSON.parse(pp.text)[0].n;
console.log(`  post-probe phantom 잔존(무영속 기대=6): ${nn}  ${nn==6?'✅':'❌'}`);
console.log('ROUNDTRIP_RESULT:',JSON.stringify({rollback_correct:pass,persistence:nn==6?'NONE':'LEAKED'}));
process.exit(pass&&nn==6?0:1);
