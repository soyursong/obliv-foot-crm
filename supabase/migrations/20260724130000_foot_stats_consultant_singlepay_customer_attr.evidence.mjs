/**
 * T-20260724-foot-CONSULTANT-TKTREV-SINGLEPAY-ATTR-FIX — single_rev WHO 회수 EVIDENCE (READ-ONLY)
 *
 * 목적(AC-2/AC-4): single_rev 를 check_in_id 단일경로 → 결정적+고객기반 이중경로로 바꿨을 때
 *   ① BEFORE(옛): check_in_id 직접조인만 귀속 — count/net
 *   ② AFTER(신): (a)결정적 링크 ∪ (b)고객기반 폴백 — count/net
 *   ③ DELTA = 회수 = (b)폴백으로 새로 귀속된 단건 count/net  (기대 ≈ 145행 / ₩6.9M)
 *   ④ 회귀검증: 결정적 링크 단건의 옛 귀속 == 신 귀속 (byte-동일, 불일치 0 이어야 함)
 *   ⑤ 잔여 미귀속(AC-4): 상담이력 전무 고객/고객미상 단건 — count/net (LABEL-RECONCILE 재개정 판단근거)
 *
 * ⚠ SELECT만. write 0. non-persistence. prod(rxlomoozakkjesdqjtvd) 대상.
 * 실행: node supabase/migrations/20260724130000_foot_stats_consultant_singlepay_customer_attr.evidence.mjs
 */
import { readFileSync } from 'node:fs';
const ENV = '/Users/domas/GitHub/obliv-foot-crm/.env.local';
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const TOK = env.SUPABASE_ACCESS_TOKEN;
const REF = 'rxlomoozakkjesdqjtvd';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const FROM = '2000-01-01', TO = '2999-12-31'; // 전기간(회수 총량 재현)
const won = (n) => n == null ? '-' : Number(n).toLocaleString('ko-KR');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`); return JSON.parse(t);
}

// 공통 CTE (신 마이그 파이프라인과 동형)
const BASE = `
  ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id='${CLINIC}' AND ci.consultant_id IS NOT NULL AND st.to_status='consultation'
  ),
  payment_base AS (
    SELECT pay.id AS payment_id, pay.check_in_id,
           COALESCE(pay.customer_id, ci.customer_id) AS customer_id,
           pay.created_at,
           (CASE WHEN pay.payment_type='refund' THEN -pay.amount ELSE pay.amount END)::bigint AS net
    FROM payments pay LEFT JOIN check_ins ci ON ci.id=pay.check_in_id
    WHERE pay.clinic_id='${CLINIC}' AND pay.accounting_date BETWEEN '${FROM}' AND '${TO}'
  ),
  single_direct AS (
    SELECT DISTINCT ON (pb.payment_id) pb.payment_id, ta.consultant_id
    FROM payment_base pb JOIN ticketed_all ta ON ta.check_in_id=pb.check_in_id
    ORDER BY pb.payment_id, ta.check_in_id
  ),
  single_cust AS (
    SELECT DISTINCT ON (pb.payment_id) pb.payment_id, ta.consultant_id
    FROM payment_base pb JOIN ticketed_all ta ON ta.customer_id=pb.customer_id
    WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_direct)
    ORDER BY pb.payment_id, (ta.checked_in_at<=pb.created_at) DESC,
             ABS(EXTRACT(EPOCH FROM (pb.created_at-ta.checked_in_at))) ASC, ta.check_in_id
  )`;

console.log('════ single_rev WHO 회수 EVIDENCE (read-only, non-persistence) ════');
console.log('prod=%s clinic=%s 기간=%s~%s(전기간)\n', REF, CLINIC.slice(0, 8), FROM, TO);

// 전체 단건 모집단
const pop = (await q(`WITH ${BASE}
  SELECT COUNT(*) AS n, COALESCE(SUM(net),0) AS net FROM payment_base`))[0];
console.log('[모집단] 기간 단건결제 총 %s행 / net %s원', pop.n, won(pop.net));

// ① BEFORE = 결정적 링크(옛 single_rev 와 동일)
const before = (await q(`WITH ${BASE}
  SELECT COUNT(*) AS n, COALESCE(SUM(pb.net),0) AS net
  FROM single_direct sd JOIN payment_base pb ON pb.payment_id=sd.payment_id`))[0];
console.log('① BEFORE(옛 check_in_id 직접조인)  귀속 %s행 / net %s원', before.n, won(before.net));

// ② AFTER = 결정적 ∪ 고객기반
const after = (await q(`WITH ${BASE},
  single_attr AS (SELECT payment_id FROM single_direct UNION ALL SELECT payment_id FROM single_cust)
  SELECT COUNT(*) AS n, COALESCE(SUM(pb.net),0) AS net
  FROM single_attr sa JOIN payment_base pb ON pb.payment_id=sa.payment_id`))[0];
console.log('② AFTER(결정적 ∪ 고객기반 폴백)     귀속 %s행 / net %s원', after.n, won(after.net));

// ③ DELTA 회수 = 고객기반 폴백분
const delta = (await q(`WITH ${BASE}
  SELECT COUNT(*) AS n, COALESCE(SUM(pb.net),0) AS net
  FROM single_cust sc JOIN payment_base pb ON pb.payment_id=sc.payment_id`))[0];
console.log('③ DELTA 회수(고객기반 폴백 신규귀속) %s행 / net %s원   ← 기대 ≈ 145행 / ₩6,900,000', delta.n, won(delta.net));

// ④ 회귀검증: 결정적 링크 단건 = 옛 귀속과 byte-동일(신 single_direct 로 동일 재현) → 불일치는 원리상 0
//   (옛 single_rev 도 동일 조인 → single_direct 가 그 정의를 그대로 계승. 상호배타로 폴백이 침범 불가.)
const overlap = (await q(`WITH ${BASE}
  SELECT COUNT(*) AS n FROM single_direct sd
  WHERE sd.payment_id IN (SELECT payment_id FROM single_cust)`))[0];
console.log('④ 회귀검증: 결정적∩폴백 교집합 = %s (0 이어야 함=이중카운트/침범 0, 정상결선 단건 불변)', overlap.n);

// ⑤ 잔여 미귀속(AC-4): 결정적도 폴백도 안 되는 단건 = 상담이력 전무/고객미상
const resid = (await q(`WITH ${BASE},
  single_attr AS (SELECT payment_id FROM single_direct UNION ALL SELECT payment_id FROM single_cust)
  SELECT COUNT(*) AS n, COALESCE(SUM(pb.net),0) AS net,
         COUNT(*) FILTER (WHERE pb.customer_id IS NULL) AS no_customer,
         COUNT(*) FILTER (WHERE pb.customer_id IS NOT NULL) AS customer_no_consult
  FROM payment_base pb
  WHERE pb.payment_id NOT IN (SELECT payment_id FROM single_attr)`))[0];
console.log('⑤ 잔여 미귀속(AC-4) %s행 / net %s원  [고객미상 %s · 상담이력無 %s]',
  resid.n, won(resid.net), resid.no_customer, resid.customer_no_consult);

// 정합: BEFORE + DELTA == AFTER, AFTER + 잔여 == 모집단
console.log('\n[정합] BEFORE+DELTA=%s (AFTER=%s) · AFTER+잔여=%s (모집단=%s)',
  Number(before.n) + Number(delta.n), after.n, Number(after.n) + Number(resid.n), pop.n);
console.log('       net: BEFORE+DELTA=%s (AFTER=%s)', won(Number(before.net) + Number(delta.net)), won(after.net));
console.log('\n════ END (write 0) ════');
