/**
 * T-20260724-foot-PKGSESSION-BACKFILL — SOP §2-F 판정근거 스냅샷 박제 (READ-ONLY)
 * 42 대상셋 cis_id + pre-image(prev_psid, prev_flag) 를 freeze → evidence 파일.
 * ※ rollback 실캡처는 apply 직전 supervisor 재실행(상태 live-mutating: G-C-1 49→50 참조). 본 스냅샷=prep 기준선.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const envLocal = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const CTE=`WITH ps AS (SELECT p.id AS session_id,p.check_in_id,p.session_type,row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number ASC,p.created_at ASC) AS rn FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL),cis_typed AS (SELECT c.id AS cis_id,c.check_in_id,c.created_at,c.price,c.is_package_session,c.package_session_id,CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser' WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser' WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue' WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv' ELSE NULL END AS session_type FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'),cis AS (SELECT cis_id,check_in_id,session_type,created_at,price,is_package_session,row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at ASC,cis_id ASC) AS rn FROM cis_typed WHERE session_type IS NOT NULL),matched AS (SELECT cis.cis_id,ps.session_id,cis.session_type,cis.created_at,cis.price,cis.is_package_session FROM cis JOIN ps ON ps.check_in_id=cis.check_in_id AND ps.session_type=cis.session_type AND ps.rn=cis.rn)`;
(async () => {
  const rows = await q(`${CTE}
    SELECT m.cis_id, m.session_id AS target_psid, m.session_type, m.price,
           c.package_session_id AS prev_psid, c.is_package_session AS prev_flag,
           (c.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS kst_date
    FROM matched m JOIN public.check_in_services c ON c.id=m.cis_id
    ORDER BY m.session_type, m.created_at;`);
  const snap = {
    ticket: 'T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY',
    gate: 'SOP §2-F 판정근거 스냅샷 (READ-ONLY prep baseline)',
    captured_context: 'DA CONSULT-REPLY xk54 GO_WARN sub-gates G-A/G-B/G-C-1/G-C-2',
    prod_ref: REF,
    note: 'rollback 실캡처는 apply 직전 supervisor 재실행(상태 live-mutating: pre-FK 49→50 drift, G-C-1). 본 스냅샷=prep 기준선.',
    target_set_count: rows.length,
    prev_flag_true: rows.filter(r=>r.prev_flag===true).length,
    prev_flag_false: rows.filter(r=>r.prev_flag===false).length,
    prev_flag_null: rows.filter(r=>r.prev_flag===null).length,
    all_prev_psid_null: rows.every(r=>r.prev_psid===null),
    revenue_shift_sum_flipfalse: rows.filter(r=>r.prev_flag!==true).reduce((a,r)=>a+Number(r.price||0),0),
    rows,
  };
  writeFileSync('/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260724-foot-PKGSESSION_gate_judgment_snapshot.json', JSON.stringify(snap,null,2));
  console.log(`스냅샷 박제 완료: ${rows.length}행 | prev_true=${snap.prev_flag_true} false=${snap.prev_flag_false} null=${snap.prev_flag_null} | all_prev_psid_null=${snap.all_prev_psid_null} | revenue_shift=${snap.revenue_shift_sum_flipfalse}`);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
