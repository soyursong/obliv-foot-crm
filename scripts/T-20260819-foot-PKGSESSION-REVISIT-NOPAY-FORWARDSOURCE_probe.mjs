/**
 * T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE — Phase1 read-only 진단 (prod write 0)
 * 재진 no-payment 레이저소비축이 is_package_session/package_session_id 를 미세팅하는 forward-source 인지 pin.
 * CTE = 부모 backfill.sql "matched" 문자동일(자동 widen 0). mutation 0 (SELECT only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
const envLocal = readFileSync('/Users/domas/GitHub/obliv-foot-crm/.env.local','utf8');
const g=(k)=>(envLocal.match(new RegExp(`^${k}=(.*)$`,'m'))||[])[1]?.trim();
const PAT=g('SUPABASE_ACCESS_TOKEN');
const REF=g('SUPABASE_PROJECT_REF')||((g('VITE_SUPABASE_URL')||'').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)||[])[1];
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${PAT}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

// 부모 backfill.sql "matched" CTE — 문자동일 (per-row CASE 불변, 자동 widen 금지)
const CTE=`WITH ps AS (SELECT p.id AS session_id,p.check_in_id,p.session_type,p.created_at AS ps_created,row_number() OVER (PARTITION BY p.check_in_id,p.session_type ORDER BY p.session_number ASC,p.created_at ASC) AS rn FROM public.package_sessions p WHERE p.status='used' AND p.check_in_id IS NOT NULL),cis_typed AS (SELECT c.id AS cis_id,c.check_in_id,c.created_at,c.price,c.is_package_session,c.package_session_id,CASE WHEN s.service_code='SZ035-30' OR s.name LIKE '%비가열%' THEN 'unheated_laser' WHEN s.service_code='SZ035-35' OR (s.name LIKE '%가열%' AND s.name NOT LIKE '%비가열%') THEN 'heated_laser' WHEN s.service_code='BC1300MB08' OR s.name LIKE '%포돌로게%' THEN 'podologue' WHEN (COALESCE(s.category_label,'')||' '||COALESCE(s.category,'')) LIKE '%수액%' OR s.name LIKE '%수액%' THEN 'iv' ELSE NULL END AS session_type FROM public.check_in_services c JOIN public.services s ON s.id=c.service_id WHERE c.package_session_id IS NULL AND s.name NOT LIKE '%체험%'),cis AS (SELECT cis_id,check_in_id,session_type,created_at,price,is_package_session,row_number() OVER (PARTITION BY check_in_id,session_type ORDER BY created_at ASC,cis_id ASC) AS rn FROM cis_typed WHERE session_type IS NOT NULL),matched AS (SELECT cis.cis_id,ps.session_id,cis.session_type,cis.created_at,cis.price,cis.is_package_session,ps.check_in_id,ps.ps_created FROM cis JOIN ps ON ps.check_in_id=cis.check_in_id AND ps.session_type=cis.session_type AND ps.rn=cis.rn)`;

const FIX_TS = '2026-07-23 19:12:00+09'; // source-closure caller fix (KST)

(async () => {
  // 메인: 316 target set + 축분해 (재진/신규 · 선수금payment 유무 · post-fix)
  const rows = await q(`${CTE}
    SELECT m.cis_id, m.session_id AS target_psid, m.session_type, m.price,
           m.is_package_session AS cis_flag,
           (m.created_at AT TIME ZONE 'Asia/Seoul')::text AS cis_created_kst,
           (m.ps_created AT TIME ZONE 'Asia/Seoul')::text AS ps_created_kst,
           (m.created_at > TIMESTAMPTZ '${FIX_TS}') AS cis_postfix,
           (m.ps_created > TIMESTAMPTZ '${FIX_TS}') AS ps_postfix,
           ci.visit_type,
           ci.customer_id,
           -- 선수금 payment 유무(=settle deduct 경로 지문): tax_type='선수금' & not-void
           (SELECT count(*) FROM public.payments pay
              WHERE pay.check_in_id = m.check_in_id AND pay.tax_type='선수금'
                AND pay.deleted_at IS NULL AND pay.cancelled_at IS NULL) AS prepaid_pay_cnt,
           (SELECT count(*) FROM public.payments pay
              WHERE pay.check_in_id = m.check_in_id
                AND pay.deleted_at IS NULL AND pay.cancelled_at IS NULL) AS any_pay_cnt
    FROM matched m JOIN public.check_ins ci ON ci.id = m.check_in_id
    ORDER BY m.ps_created;`);

  const N = rows.length;
  const postfix = rows.filter(r=>r.cis_postfix);
  const settleAxis = rows.filter(r=>Number(r.prepaid_pay_cnt)>0);   // 선수금차감 clobber 축(G-C-1)
  const nopayAxis  = rows.filter(r=>Number(r.prepaid_pay_cnt)===0); // 재진 no-payment 축
  const nopayNoAnyPay = rows.filter(r=>Number(r.any_pay_cnt)===0);  // 어떤 결제도 없음(순수 no-payment)

  const byVisit = (rs)=>rs.reduce((a,r)=>{const k=r.visit_type||'(null)';a[k]=(a[k]||0)+1;return a;},{});
  const dates = (rs)=>rs.map(r=>r.ps_created_kst).filter(Boolean).sort();

  const summary = {
    ticket:'T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE',
    phase:'Phase1 read-only prod pin (mutation 0)',
    prod_ref:REF, fix_boundary_kst:FIX_TS,
    captured_at_note:'Date.now 미사용 — 실행시각은 파일 mtime 참조',
    target_set_count:N,
    // 1) post-fix 비중 (밑빠진독 신호)
    postfix_cis_count:postfix.length,
    postfix_cis_pct:(100*postfix.length/N).toFixed(1),
    // 2) 축분해 (선수금payment 유무 = mechanism proxy)
    axis_settle_prepaid_cnt:settleAxis.length,       // G-C-1 선수금차감 축
    axis_nopay_cnt:nopayAxis.length,                 // 재진 no-payment 축
    axis_nopay_no_any_payment_cnt:nopayNoAnyPay.length,
    // 3) 재진 no-payment 축 상세
    nopay_by_visit_type:byVisit(nopayAxis),
    nopay_by_session_type:nopayAxis.reduce((a,r)=>{a[r.session_type]=(a[r.session_type]||0)+1;return a;},{}),
    nopay_postfix_cnt:nopayAxis.filter(r=>r.cis_postfix).length,
    nopay_ps_created_min:dates(nopayAxis)[0],
    nopay_ps_created_max:dates(nopayAxis)[dates(nopayAxis).length-1],
    // 4) settle 축 상세(대조)
    settle_by_visit_type:byVisit(settleAxis),
    settle_postfix_cnt:settleAxis.filter(r=>r.cis_postfix).length,
    settle_ps_created_max:dates(settleAxis)[dates(settleAxis).length-1],
    // 5) 전체 visit_type 분포
    all_by_visit_type:byVisit(rows),
    // ⊥ 확증: settle + nopay == N (상호배타)
    orthogonal_check:(settleAxis.length+nopayAxis.length===N),
    rows,
  };
  writeFileSync('/Users/domas/GitHub/obliv-foot-crm/db-gate/T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE_evidence.json', JSON.stringify(summary,null,2));
  const {rows:_,...head}=summary;
  console.log(JSON.stringify(head,null,2));
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
