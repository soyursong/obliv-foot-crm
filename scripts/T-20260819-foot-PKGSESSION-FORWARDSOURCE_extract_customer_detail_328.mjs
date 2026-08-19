/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
 * ── 328 backfill 대상 고객별 상세목록 (총괄 328 재확인용 · READ-ONLY) ──
 * planner NEW-TASK MSG-20260820-082219-1p1k (fold#2(a) 328-scoped 총괄 재확인).
 * write0 / DDL0 / mutation0. Management API service_role SELECT only.
 * matched CTE = 부모 backfill.sql core block byte-identical 재사용(divergence 0).
 * 선수금 有/無 = Phase1 술어(payments.tax_type='선수금' per check_in, not-void).
 */
import { readFileSync, writeFileSync } from 'node:fs';
const REPO='/Users/domas/GitHub/obliv-foot-crm';
const env=readFileSync(`${REPO}/.env.local`,'utf8');
const g=(k)=>(env.match(new RegExp(`^${k}=(.*)$`,'m'))||[])[1]?.trim();
const PAT=g('SUPABASE_ACCESS_TOKEN');const REF=g('SUPABASE_PROJECT_REF')||((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)||[])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// frozen316 cis_id set (delta 판별용)
const frozen=JSON.parse(readFileSync('/tmp/pkg328/remeasure316.json','utf8'));
const FROZEN=new Set(frozen.snapshot.rows.map(r=>r.cis_id));

const CTE=`WITH ps AS (SELECT p.id AS session_id,p.check_in_id,p.session_type,row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number ASC,p.created_at ASC) AS rn FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL),
cis_typed AS (SELECT c.id AS cis_id,c.check_in_id,c.created_at,CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser' WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser' WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue' WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv' ELSE NULL END AS session_type FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'),
cis AS (SELECT cis_id,check_in_id,session_type,row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at ASC,cis_id ASC) AS rn FROM cis_typed WHERE session_type IS NOT NULL),
matched AS (SELECT cis.cis_id,ps.session_id,cis.session_type,cis.check_in_id FROM cis JOIN ps ON ps.check_in_id=cis.check_in_id AND ps.session_type=cis.session_type AND ps.rn=cis.rn)`;

const TYPE_KO={unheated_laser:'비가열레이저',heated_laser:'가열레이저',podologue:'포돌로게',iv:'수액'};

const rows=await q(`${CTE}
  SELECT m.cis_id, m.session_type,
         t.price,
         (ci.created_at AT TIME ZONE 'Asia/Seoul')::date::text AS visit_date,
         COALESCE(NULLIF(TRIM(cust.name),''), NULLIF(TRIM(ci.customer_name),''), '(무명)') AS customer_name,
         RIGHT(regexp_replace(COALESCE(cust.phone, ci.customer_phone,''),'[^0-9]','','g'),4) AS phone4,
         s.name AS service_name,
         (SELECT count(*) FROM public.payments pay WHERE pay.check_in_id=m.check_in_id AND pay.tax_type='선수금' AND pay.deleted_at IS NULL AND pay.cancelled_at IS NULL) AS prepaid_cnt
  FROM matched m
  JOIN public.check_in_services t ON t.id=m.cis_id
  JOIN public.check_ins ci ON ci.id=m.check_in_id
  LEFT JOIN public.customers cust ON cust.id=ci.customer_id
  JOIN public.services s ON s.id=t.service_id
  ORDER BY (ci.created_at AT TIME ZONE 'Asia/Seoul')::date DESC, customer_name ASC;`);

if(rows.length!==328) throw new Error(`row count ${rows.length} != 328`);
const enriched=rows.map(r=>({
  cis_id:r.cis_id,
  name:r.customer_name,
  phone4:r.phone4||'----',
  visit_date:r.visit_date,
  type_ko:TYPE_KO[r.session_type]||r.session_type,
  service_name:r.service_name,
  price:Number(r.price||0),
  prepaid: Number(r.prepaid_cnt)>0,
  set: FROZEN.has(r.cis_id)?'freeze316':'delta12',
}));
const total=enriched.reduce((a,r)=>a+r.price,0);
const prepaidYes=enriched.filter(r=>r.prepaid).length;
const prepaidNo=328-prepaidYes;
const deltaN=enriched.filter(r=>r.set==='delta12').length;
// 날짜별 집계
const byDate={};
for(const r of enriched){byDate[r.visit_date]=byDate[r.visit_date]||{cnt:0,sum:0};byDate[r.visit_date].cnt++;byDate[r.visit_date].sum+=r.price;}
const dates=Object.keys(byDate).sort().reverse();

console.log(`총 ${enriched.length}건 | 합계 ₩${total.toLocaleString()} | 날짜수 ${dates.length}`);
console.log(`선수금 有=${prepaidYes} 無=${prepaidNo} | delta12=${deltaN}`);
console.log(`77.45M match: ${total===77450000} | 328 match: ${enriched.length===328}`);

writeFileSync('/tmp/pkg328/customer_detail_328.json',JSON.stringify({
  ticket:'T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE',
  task:'MSG-20260820-082219-1p1k (328 고객별 상세 · READ-ONLY)',
  prod_ref:REF, total:enriched.length, sum:total, date_count:dates.length,
  prepaid_yes:prepaidYes, prepaid_no:prepaidNo, delta12_count:deltaN,
  prepaid_predicate:"payments.tax_type='선수금' per check_in (not-void)",
  by_date:dates.map(d=>({date:d,cnt:byDate[d].cnt,sum:byDate[d].sum})),
  rows:enriched,
},null,2));
console.log('WROTE /tmp/pkg328/customer_detail_328.json');
