/**
 * DIAG3 (READ-ONLY) — 실 신고자 김주연 총괄 계정이 caller-clinic 게이트(후보①)에 막히는지 확정.
 * 서울오리진점 = jongno-foot = 74967aea. 게이트 통과조건: clinic_id==74967aea OR (clinic_id NULL & HQ role).
 * auth 조회 id 기준(email 단독신뢰 금지).
 */
import fs from 'fs';
let TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN && fs.existsSync('.env.local')) for (const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/);if(m)TOKEN=m[1].trim().replace(/^["']|["']$/g,'');}
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json();}
const p=(l,r)=>{console.log(`\n─── ${l} ───`);console.log(JSON.stringify(r,null,2));};
const JONGNO='74967aea-a60b-4da3-a0e7-9c997a930bc8';

// 김주연 총괄 후보 계정 (이름/HQ role) — 게이트 통과여부 판정 컬럼 동봉
p('E. 김주연 후보 계정 + 게이트 통과 판정', await q(`
  SELECT up.id, up.name, up.role, up.clinic_id, up.active,
         au.email,
         (up.clinic_id = '${JONGNO}') AS pass_same_clinic,
         (up.clinic_id IS NULL AND up.role IN ('admin','manager','director')) AS pass_hq,
         EXISTS(SELECT 1 FROM staff s WHERE s.user_id=up.id AND s.clinic_id='${JONGNO}') AS pass_staff
  FROM user_profiles up
  LEFT JOIN auth.users au ON au.id=up.id
  WHERE up.name LIKE '%김주연%' OR up.role IN ('admin','manager','director')
  ORDER BY up.role, up.name;`));

console.log('\n✅ READ-ONLY DIAG3 완료 (write 0건)');
