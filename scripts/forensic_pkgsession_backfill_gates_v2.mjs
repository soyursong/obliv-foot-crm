/**
 * T-20260724-foot-PKGSESSION-BACKFILL — forensic v2 (READ-ONLY)
 *   (1) gap 39 decomposition을 backfill 4-type 스코프로 한정(doc 쿼리는 trial/reborn 등 비대상 spill → 132)
 *   (2) G-C-1 postfix(신규) unmarked matchable 3행 상세 드릴 — 소스닫힘 판정
 */
import { readFileSync } from 'node:fs';
const envLocal = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local', 'utf8');
const g = (k) => (envLocal.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
const PAT = g('SUPABASE_ACCESS_TOKEN');
const REF = g('SUPABASE_PROJECT_REF') || ((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const FIX = '2026-07-23 19:12:07+09';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const hr=(s)=>console.log(`\n${'='.repeat(72)}\n${s}\n${'='.repeat(72)}`);

const FOURTYPE = `('heated_laser','unheated_laser','iv','podologue')`;

(async () => {
  // (1) 4-type 한정 decomposition (진짜 gap 39)
  hr('G-A v2 — gap 39 (backfill 4-type 스코프 한정) 버킷');
  const ga = await q(`
    WITH ps AS (
      SELECT p.id AS session_id, p.check_in_id, p.session_type,
             row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number,p.created_at) AS rn
      FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL
        AND p.session_type IN ${FOURTYPE}
    ),
    cis_map AS (
      SELECT c.id AS cis_id, c.check_in_id, c.created_at, c.package_session_id,(s.name LIKE '%체험%') AS is_trial,
             CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
                  WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
                  WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
                  WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
                  ELSE NULL END AS session_type
      FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
    ),
    cis_avail AS (
      SELECT cis_id,check_in_id,session_type,row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at,cis_id) AS rn
      FROM cis_map WHERE package_session_id IS NULL AND session_type IS NOT NULL AND is_trial=false
    ),
    matched AS (SELECT ps.session_id FROM cis_avail a JOIN ps ON ps.check_in_id=a.check_in_id AND ps.session_type=a.session_type AND ps.rn=a.rn),
    unmatched AS (SELECT * FROM ps WHERE session_id NOT IN (SELECT session_id FROM matched))
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id) THEN 'A2_check_in에CIS없음'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type IS NULL) THEN 'B1_LEAKY:CASE→NULL존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.is_trial) THEN 'B3_trial존재'
        WHEN EXISTS (SELECT 1 FROM cis_map m WHERE m.check_in_id=u.check_in_id AND m.session_type=u.session_type AND m.package_session_id IS NOT NULL) THEN 'C_rn비대칭'
        ELSE 'X_기타' END AS bucket, u.session_type, count(*) AS n
    FROM unmatched u GROUP BY 1,2 ORDER BY 1,2;`);
  console.table(ga);
  const tot={}; for(const r of ga){const k=r.bucket.split(':')[0].split('(')[0]; tot[k]=(tot[k]||0)+Number(r.n);}
  const gap=ga.reduce((a,r)=>a+Number(r.n),0);
  console.log('4-type gap 합계 =',gap,'| 버킷:',JSON.stringify(tot),'| B1+X =',(tot['B1_LEAKY']||0)+(tot['X_기타']||0));

  // (2) G-C-1 postfix 3행 상세 드릴
  hr('G-C-1 drill — postfix(fix 이후 created) unmarked matchable 상세');
  const drill = await q(`
    WITH ps AS (
      SELECT p.id AS session_id, p.check_in_id, p.session_type, p.status, p.created_at AS ps_created, p.session_date,
             row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number ASC,p.created_at ASC) AS rn
      FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL
    ),
    cis_typed AS (
      SELECT c.id AS cis_id,c.check_in_id,c.created_at,c.price,c.is_package_session,c.service_name,s.service_code,s.name AS svc,
             CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser'
                  WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser'
                  WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue'
                  WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv'
                  ELSE NULL END AS session_type
      FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id
      WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'
    ),
    cis AS (SELECT *, row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at ASC,cis_id ASC) AS rn FROM cis_typed WHERE session_type IS NOT NULL),
    matched AS (SELECT cis.cis_id,cis.check_in_id,cis.session_type,cis.created_at,cis.price,cis.is_package_session,cis.svc,cis.service_code,ps.session_id,ps.ps_created,ps.session_date
                FROM cis JOIN ps ON ps.check_in_id=cis.check_in_id AND ps.session_type=cis.session_type AND ps.rn=cis.rn)
    SELECT (created_at AT TIME ZONE 'Asia/Seoul')::text AS cis_created_kst,
           (ps_created AT TIME ZONE 'Asia/Seoul')::text AS ps_created_kst,
           session_date::text AS ps_session_date, session_type, service_code, svc, price, is_package_session, check_in_id, cis_id
    FROM matched WHERE created_at >= '${FIX}'::timestamptz
    ORDER BY created_at;`);
  console.table(drill.map(r=>({cis_created_kst:r.cis_created_kst,ps_created_kst:r.ps_created_kst,ps_sess_date:r.ps_session_date,type:r.session_type,svc:r.svc,price:r.price,flag:r.is_package_session})));

  // 이 postfix 3행의 package_session 이 fix 이후 RPC 로 만들어졌나? (ps.created_at vs FIX)
  hr('G-C-1 drill — postfix CIS 의 짝 package_session 생성시각 (RPC 경로 여부 힌트)');
  for (const r of drill) {
    console.log(`cis ${r.cis_id.slice(0,8)} | CIS created ${r.cis_created_kst} | 짝 ps created ${r.ps_created_kst} (session_date ${r.ps_session_date}) | ps_after_fix=${new Date(r.ps_created_kst+'+09:00') >= new Date('2026-07-23T19:12:07+09:00')}`);
  }
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
