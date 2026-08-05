import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const TOK=(process.env.SUPABASE_ACCESS_TOKEN||env.SUPABASE_ACCESS_TOKEN||'').trim();
const REF='rxlomoozakkjesdqjtvd';
async function q(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${TOK}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});const t=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}: ${t}`);return JSON.parse(t);}
const j=x=>JSON.stringify(x,null,2);

console.log('════ AC-4 v2 재발 census: 오펀 재결제 패턴 (F-4717 signature) ════\n');

// F-4717 signature: package status=refunded & net_pp=0(원장① 전액환불) &
//   같은 customer 에 payments(원장②) 행 존재(package_id NULL, payment, active, 환불 직후, amount=환불총액 근사)
console.log('── (A) status=refunded & package_payments net=0 인 패키지 중, 같은 고객이 환불시각 이후\n        payments(원장②)에 package_id=NULL payment 를 가진 케이스 (오펀 재결제 의심) ──');
const orphan = await q(`
WITH pkg_net AS (
  SELECT p.id AS package_id, p.customer_id, p.clinic_id, p.status, p.total_amount, p.package_name,
         COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                           WHEN pp.payment_type='refund'  THEN -pp.amount ELSE 0 END),0) AS net_pp,
         MAX(CASE WHEN pp.payment_type='refund' THEN pp.created_at END) AS last_refund_at,
         SUM(CASE WHEN pp.payment_type='refund' THEN pp.amount ELSE 0 END) AS sum_refund
  FROM packages p JOIN package_payments pp ON pp.package_id=p.id
  WHERE p.status='refunded'
  GROUP BY p.id
  HAVING COALESCE(SUM(CASE WHEN pp.payment_type='payment' THEN pp.amount
                           WHEN pp.payment_type='refund'  THEN -pp.amount ELSE 0 END),0) <= 0
)
SELECT k.package_id, k.package_name, k.status, k.net_pp, k.sum_refund, k.total_amount,
       c.chart_number, c.name AS cust_name, k.last_refund_at,
       (SELECT count(*) FROM payments py
         WHERE py.customer_id=k.customer_id AND py.package_id IS NULL
           AND py.payment_type='payment' AND COALESCE(py.status,'active')<>'cancelled'
           AND py.deleted_at IS NULL AND py.is_simulation=false
           AND py.created_at >= k.last_refund_at - interval '10 min'
           AND py.amount >= 100000) AS orphan_repay_candidates,
       (SELECT COALESCE(SUM(py.amount),0) FROM payments py
         WHERE py.customer_id=k.customer_id AND py.package_id IS NULL
           AND py.payment_type='payment' AND COALESCE(py.status,'active')<>'cancelled'
           AND py.deleted_at IS NULL AND py.is_simulation=false
           AND py.created_at >= k.last_refund_at - interval '10 min'
           AND py.amount >= 100000) AS orphan_repay_sum
FROM pkg_net k JOIN customers c ON c.id=k.customer_id
ORDER BY k.last_refund_at DESC`);
console.log(j(orphan));

console.log('\n── (B) 규모 요약 (오펀 재결제 후보 1건+ 인 refunded 패키지) ──');
const withOrphan = orphan.filter(r=>Number(r.orphan_repay_candidates)>0);
console.log(`  전체 refunded&net<=0 패키지: ${orphan.length}건`);
console.log(`  그 중 오펀 재결제 후보 1건+ (F-4717형 의심): ${withOrphan.length}건`);
console.log(`  영향 고객: ${new Set(withOrphan.map(r=>r.chart_number)).size}명`);
console.log(`  오펀 재결제 합계(의심): ${withOrphan.reduce((s,r)=>s+Number(r.orphan_repay_sum||0),0).toLocaleString()}원`);
console.log('  차트:', withOrphan.map(r=>`${r.chart_number}(${r.cust_name}) net_pp=${r.net_pp} orphan=${r.orphan_repay_sum}`).join(' | '));

console.log('\n── (C) 광의 census: payments.package_id NULL 비율 (원장 분열 규모) ──');
const split = await q(`
SELECT
  count(*) FILTER (WHERE package_id IS NULL) AS pkgid_null,
  count(*) FILTER (WHERE package_id IS NOT NULL) AS pkgid_set,
  count(*) AS total
FROM payments WHERE payment_type='payment' AND is_simulation=false AND deleted_at IS NULL`);
console.log(j(split));
console.log('  ▸ payments 원장②는 대부분 package_id NULL 설계(수납=check_in 기반) → 패키지 결제도 여기 착지 시 원장① 미반영.');

console.log('\n════ census 완료 (READ-ONLY) ════');
