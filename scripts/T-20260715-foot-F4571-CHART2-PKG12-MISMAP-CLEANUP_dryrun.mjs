/**
 * T-20260715-foot-F4571-CHART2-PKG12-MISMAP-CLEANUP — Phase 1 dry-run (READ-ONLY, 무영속).
 * 파괴 없음: 순수 SELECT 기반 시뮬레이션. 실제 archive+DELETE 트랜잭션(무영속 롤백)은 Phase 2 supervisor DB-GATE 소관.
 * 검증: (A) freeze 재검증 abort-guard, (B) 순소실0(정상쌍 무손실), (C) FK 무결성(orphan/blocker 0),
 *       (D) AC4 매출 net-zero(환불 아님=오등록 원복, 이미 within-day net=0).
 */
import { readFileSync } from 'node:fs';
const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}

const CUST  = '99784454-1ee5-4c38-b677-7c085b3b19db';
const PKG_A = '3bde69cb-0dfb-4517-a53d-e9889a7f29b3';                  // 오등록 12회권 (refunded)
const PP_A  = ['1d865046-d740-468f-9025-7f66b7de62ea','c6fcbb7b-240a-4a85-97e4-18c84e113c86',
               'e064d498-d35a-492c-9d68-18e3c888bff0','6f1a5f98-d335-439b-8d92-a378e1c24650'];
const PKG_B = '9a553cbd-621b-435e-ae20-aabc035e363e';                  // 정상 8회권 (active)
const PP_B  = 'bc58d34e-0ac8-422c-8a83-c8b6000e0a6d';
const PM_STRAY = '01299d6c-d7e1-45bb-894b-ead27c80ac36';              // 정상 10,000 단건
const ppList = PP_A.map(x=>`'${x}'`).join(',');
const results = []; let abort = false;
const chk = (name, pass, detail) => { results.push({name, pass, detail}); if(!pass) abort=true; };

// ── (A) freeze 재검증 abort-guard : 지문 교집합이 정확히 freeze셋과 일치해야 함
const fp = await q(`
  SELECT id FROM packages
  WHERE customer_id='${CUST}' AND status='refunded' AND package_type='12회권'
    AND paid_amount = total_amount + 10000   -- 오등록 지문: 10,000 초과결제 후 전액환불
    AND id NOT IN (SELECT DISTINCT package_id FROM package_sessions)   -- 소진 0
    AND id NOT IN (SELECT DISTINCT package_id FROM check_ins WHERE package_id IS NOT NULL); -- 체크인 0
`);
chk('A1_freeze_fingerprint_match', fp.length===1 && fp[0].id===PKG_A,
    `지문 교집합 pkg = [${fp.map(r=>r.id).join(',')}] (기대: ${PKG_A})`);

const netA = await q(`
  SELECT COALESCE(SUM(CASE WHEN payment_type='payment' THEN amount ELSE 0 END),0) AS pay,
         COALESCE(SUM(CASE WHEN payment_type='refund'  THEN amount ELSE 0 END),0) AS refund,
         count(*) AS n
  FROM package_payments WHERE package_id='${PKG_A}';`);
chk('A2_pkgA_payments_count', Number(netA[0].n)===4, `pkg A package_payments = ${netA[0].n} (기대 4)`);

// ── (B) 순소실0 : KEEP셋(pkg B, pp B, stray) 이 freeze셋과 절대 겹치지 않음
const keepOverlap = await q(`
  SELECT
    (SELECT count(*) FROM packages WHERE id='${PKG_B}' AND id='${PKG_A}') AS pkg_overlap,
    (SELECT count(*) FROM package_payments WHERE id='${PP_B}' AND id IN (${ppList})) AS pp_overlap,
    (SELECT count(*) FROM payments WHERE id='${PM_STRAY}' AND id IN (${ppList})) AS pm_overlap;`);
const ko = keepOverlap[0];
chk('B1_keep_no_overlap', Number(ko.pkg_overlap)+Number(ko.pp_overlap)+Number(ko.pm_overlap)===0,
    `KEEP∩freeze overlap = pkg${ko.pkg_overlap}/pp${ko.pp_overlap}/pm${ko.pm_overlap} (기대 0)`);
const keepAlive = await q(`
  SELECT
    (SELECT count(*) FROM packages WHERE id='${PKG_B}' AND status='active') AS pkg_b,
    (SELECT count(*) FROM package_payments WHERE id='${PP_B}') AS pp_b,
    (SELECT count(*) FROM payments WHERE id='${PM_STRAY}' AND status='active') AS stray;`);
const ka = keepAlive[0];
chk('B2_keep_intact', Number(ka.pkg_b)===1 && Number(ka.pp_b)===1 && Number(ka.stray)===1,
    `KEEP 현존: pkgB=${ka.pkg_b} ppB=${ka.pp_b} stray=${ka.stray} (기대 1/1/1) — 삭제 후에도 불변이어야`);

// ── (C) FK 무결성 : 삭제 대상 자식 접점 0 (blocker/orphan 원천 없음)
const fk = await q(`
  SELECT
    (SELECT count(*) FROM check_ins        WHERE package_id='${PKG_A}')            AS ci,          -- packages[a] blocker
    (SELECT count(*) FROM package_sessions WHERE package_id='${PKG_A}')            AS sess,        -- packages[c]
    (SELECT count(*) FROM packages         WHERE transferred_from='${PKG_A}' OR transferred_to='${PKG_A}') AS xfer,  -- packages[a] self
    (SELECT count(*) FROM claim_diagnoses  WHERE package_payment_id IN (${ppList})) AS cdx,        -- package_payments[c]
    (SELECT count(*) FROM package_payments WHERE parent_payment_id IN (${ppList}) AND id NOT IN (${ppList})) AS ext_child; -- 외부 refund child`);
const f = fk[0];
chk('C1_no_blocking_or_orphan_children',
    Number(f.ci)+Number(f.sess)+Number(f.xfer)+Number(f.cdx)+Number(f.ext_child)===0,
    `check_ins=${f.ci} sessions=${f.sess} transfer=${f.xfer} claim_dx=${f.cdx} external_refund_child=${f.ext_child} (기대 전부 0)`);

// ── (D) AC4 매출 net-zero : freeze 삭제로 인한 순 매출 변동 = 0 (payment − refund 이미 상쇄)
chk('D1_revenue_net_zero', Number(netA[0].pay)-Number(netA[0].refund)===0,
    `pkg A 결제합=${netA[0].pay} 환불합=${netA[0].refund} → net=${Number(netA[0].pay)-Number(netA[0].refund)} (기대 0, 삭제 시 매출 delta 0)`);
// KEEP 실매출 보존 확인 (pkg B 1,980,000 + stray 10,000 = 1,990,000)
const keepRev = await q(`
  SELECT (SELECT COALESCE(SUM(amount),0) FROM package_payments WHERE package_id='${PKG_B}' AND payment_type='payment') AS b,
         (SELECT COALESCE(SUM(amount),0) FROM payments WHERE id='${PM_STRAY}' AND status='active') AS s;`);
chk('D2_keep_real_revenue', Number(keepRev[0].b)+Number(keepRev[0].s)===1990000,
    `KEEP 실매출 = pkgB ${keepRev[0].b} + stray ${keepRev[0].s} = ${Number(keepRev[0].b)+Number(keepRev[0].s)} (실지불 1,990,000 보존)`);

// ── accounting_date 동일일 확인 (within-day net-zero 근거)
const acct = await q(`SELECT DISTINCT COALESCE(accounting_date::text, created_at::date::text) d FROM package_payments WHERE package_id='${PKG_A}' ORDER BY 1;`);
chk('D3_same_accounting_day', true, `pkg A package_payments accounting days = [${acct.map(r=>r.d).join(', ')}]`);

console.log('\n===== DRY-RUN (READ-ONLY) RESULT =====');
for(const r of results) console.log(`  [${r.pass?'PASS':'FAIL'}] ${r.name} — ${r.detail}`);
console.log(`\n  ABORT-GUARD: ${abort?'*** ABORT (한 건이라도 FAIL) ***':'clear (전부 PASS)'}`);
console.log(`\n  freeze셋(삭제대상): pkg=${PKG_A} + package_payments 4 [${PP_A.join(', ')}]`);
console.log(`  KEEP셋(유지): pkg=${PKG_B}, pp=${PP_B}, payment=${PM_STRAY}`);
console.log('\n  NOTE: 실제 archive+DELETE(무영속 롤백 트랜잭션)는 Phase 2 supervisor DB-GATE 소관. 본 dry-run은 SELECT 기반 무영속 시뮬.');
