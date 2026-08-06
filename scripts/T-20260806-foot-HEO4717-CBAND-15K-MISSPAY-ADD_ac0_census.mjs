/**
 * T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-0 DIAGNOSE-FIRST (READ-ONLY)
 *
 * ⛔ READ-ONLY. prod WRITE/DELETE/DDL 0. 전부 SELECT.
 *
 * 목적: 현은호(F-4717) "케어 토어 밴드 15,000원(카드)" 결제 누락 1건 record 요청의
 *       ★AC-0 census — 정말 누락인지(다른 경로에 이미 존재하지 않는지) + 실 결제됐다는
 *       근거(레드페이 VAN-CARD 승인 실재)를 3자 대조로 확정.
 *
 * ★가드(선행 4717 선례 계승): 순진한 payments INSERT 금지. 본 스크립트는 write target 을
 *   판정하지 않는다 — census 사실만 산출 → planner FOLLOWUP → DA CONSULT(AC-1)에서 write target 확정.
 *
 * ── 인증 컨텍스트 명시 (진단 인증컨텍스트 표준 · 0-row 오독 방지) ──
 *   실행 컨텍스트 = Supabase Management API (/database/query, SUPABASE_ACCESS_TOKEN).
 *   = service_role 상당 full-access (RLS 미적용). 따라서 반환 0-row = "RLS 차단"이 아니라
 *     "실 데이터 부재"로 해석 가능. (anon/publishable 키 아님을 명시.)
 *
 * 3자 대조:
 *   ① payments(원장②, VAN 대사)      — 15,000 카드 payment 실재?
 *   ② package_payments(원장①)         — 15,000 항목 실재?
 *   ③ check_in_services / service_charges — 케어토어밴드/15,000 서비스라인·명세 실재?
 *   ④ redpay_raw_transactions(VAN raw) — 15,000 카드 승인이 단말에 실재하나(=실 결제 근거)? 미매칭?
 *
 * 실행: node scripts/T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD_ac0_census.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV = join(here, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(ENV, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!TOK) { throw new Error('SUPABASE_ACCESS_TOKEN 필요 (management API, no plaintext fallback)'); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const j = (x) => JSON.stringify(x, null, 2);

console.log('════════ AC-0 CENSUS (READ-ONLY · service_role/mgmt-api context) ════════');
console.log('   T-20260806 현은호(F-4717) 케어토어밴드 15,000 카드 누락 여부 3자 대조\n');

// ── 0. 대상 고객 ──
const cust = await q(`
  SELECT id, name, phone, chart_number, clinic_id, created_at
  FROM customers WHERE chart_number ILIKE '%4717%' ORDER BY chart_number LIMIT 20`);
console.log('── 0. 고객 식별 ──'); console.log(j(cust));
if (!cust.length) { console.log('⚠ 미발견 — abort'); process.exit(0); }
const target = cust.find((c) => /(^|\D)4717(\D|$)/.test(String(c.chart_number))) || cust[0];
const CID = target.id;
const CLINIC = target.clinic_id;
console.log(`\n★ customer_id=${CID} clinic_id=${CLINIC} (${target.name} / ${target.chart_number})\n`);

// ── ① payments(원장②) 전건 — 현재 상태 (Phase B 이후) ──
const pay = await q(`
  SELECT id, package_id, check_in_id, amount, method, payment_type, status,
         external_trxid, external_approval_no, external_status, reconciled_at,
         accounting_date, is_simulation, cancelled_at, deleted_at, memo, created_by, created_at
  FROM payments WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log('── ① payments(원장②) 전건 ──'); console.log(j(pay));
const pay15k = pay.filter((p) => Number(p.amount) === 15000);
console.log(`\n  ▸ payments 중 amount=15,000: ${pay15k.length}건`);
console.log(j(pay15k));

// ── ② package_payments(원장①) 전건 ──
const pp = await q(`
  SELECT id, package_id, amount, method, payment_type, fee_kind, external_approval_no,
         accounting_date, is_simulation, memo, created_by, created_at
  FROM package_payments WHERE customer_id = '${CID}' ORDER BY created_at`);
console.log('\n── ② package_payments(원장①) 전건 ──'); console.log(j(pp));
const pp15k = pp.filter((p) => Number(p.amount) === 15000);
console.log(`  ▸ package_payments 중 amount=15,000: ${pp15k.length}건`); console.log(j(pp15k));

// ── ③a check_in_services — 케어토어밴드/밴드/15,000 서비스라인 ──
console.log('\n── ③a check_in_services (이 고객 전 서비스라인) ──');
const cis = await q(`
  SELECT cis.id, cis.check_in_id, cis.service_id, cis.service_name, cis.price,
         cis.original_price, cis.is_package_session, cis.package_session_id,
         cis.voided_at, cis.voided_reason, cis.created_at,
         ci.checked_in_at, ci.created_date, ci.status AS ci_status
  FROM check_in_services cis
  JOIN check_ins ci ON ci.id = cis.check_in_id
  WHERE ci.customer_id = '${CID}' ORDER BY cis.created_at`);
console.log(j(cis));
const cisBand = cis.filter((r) => /밴드|토어|케어|band/i.test(String(r.service_name || '')) || Number(r.price) === 15000 || Number(r.original_price) === 15000);
console.log(`  ▸ check_in_services 중 밴드/토어/케어/15,000 후보: ${cisBand.length}건`); console.log(j(cisBand));

// ── ③b service_charges — 명세(케어토어밴드/15,000) ──
console.log('\n── ③b service_charges (이 고객 명세, 서비스명 join) ──');
const sc = await q(`
  SELECT sc.id, sc.check_in_id, sc.service_id, s.name AS service_name,
         sc.is_insurance_covered, sc.base_amount, sc.insurance_covered_amount,
         sc.copayment_amount, sc.exempt_amount, sc.is_simulation, sc.calculated_at
  FROM service_charges sc
  LEFT JOIN services s ON s.id = sc.service_id
  WHERE sc.customer_id = '${CID}' ORDER BY sc.calculated_at`);
console.log(j(sc));
const scBand = (Array.isArray(sc) ? sc : []).filter((r) => /밴드|토어|케어|band/i.test(String(r.service_name || '')) || [r.base_amount, r.copayment_amount].some((v) => Number(v) === 15000));
console.log(`  ▸ service_charges 중 밴드/토어/케어/15,000 후보: ${scBand.length}건`); console.log(j(scBand));

// ── 케어토어밴드 상품 식별 (services 메뉴에서 명칭·정가) ──
console.log('\n── 참고: services 메뉴 상 "케어토어밴드"류 상품 정의 ──');
const svc = await q(`
  SELECT id, name, price, discount_price, category, category_label, service_type, clinic_id, active
  FROM services
  WHERE (name ILIKE '%토어%' OR name ILIKE '%밴드%' OR name ILIKE '%케어토어%' OR price = 15000 OR discount_price = 15000)
  ORDER BY name LIMIT 50`).catch((e) => ({ error: String(e) }));
console.log(j(svc));

// ── ④ redpay_raw_transactions(VAN raw) — 15,000 카드 승인 실재 여부(실 결제 근거) ──
console.log('\n── ④ redpay_raw_transactions: clinic 내 amount=15,000 승인 (실 결제 근거) ──');
const redpay15k = await q(`
  SELECT id, external_trxid, external_status, amount, approval_no, tid,
         approved_at, cancelled_at, matched_payment_id, created_at
  FROM redpay_raw_transactions
  WHERE clinic_id = '${CLINIC}' AND amount = 15000
  ORDER BY approved_at NULLS LAST, created_at`);
console.log(j(redpay15k));
const redpay15kUnmatched = redpay15k.filter((r) => !r.matched_payment_id && r.external_status !== 'N' && r.external_status !== 'X');
console.log(`  ▸ 15,000 VAN 승인 총 ${redpay15k.length}건 / 그 중 미매칭(matched_payment_id NULL, 승인유효): ${redpay15kUnmatched.length}건`);
console.log('  ▸ 미매칭 15,000 VAN 승인 = "실 결제 완료·payments 미기록"의 강한 근거 후보:');
console.log(j(redpay15kUnmatched));

// ── check_ins 목록 (승인시각 ↔ 방문일 상관용) ──
console.log('\n── 참고: 이 고객 check_ins (방문일 ↔ VAN 승인시각 상관) ──');
const cis2 = await q(`
  SELECT id, created_date, checked_in_at, completed_at, status, visit_type, created_at
  FROM check_ins WHERE customer_id = '${CID}' ORDER BY created_date NULLS LAST, created_at`);
console.log(j(cis2));

// ── 요약 판정 ──
console.log('\n════════ CENSUS 요약 ════════');
console.log(`① payments 15,000 존재: ${pay15k.length}건 ${pay15k.length ? '⚠(이미 record됨 가능 — 이중 INSERT 위험)' : '→ 부재'}`);
console.log(`② package_payments 15,000 존재: ${pp15k.length}건`);
console.log(`③ 서비스라인/명세 밴드·15,000 후보: cis=${cisBand.length} / sc=${scBand.length}건`);
console.log(`④ VAN raw 15,000 승인: 총 ${redpay15k.length} / 미매칭 ${redpay15kUnmatched.length}건`);
console.log('\n판정 해석 규칙:');
console.log(' - ①=0 & ④미매칭≥1 → 실 결제됐으나 payments 미기록 = 진성 누락(레드페이 대조누락 보정 후보).');
console.log(' - ①≥1               → 이미 어딘가 record됨 = 이중 INSERT 위험, 착수 중단·보고.');
console.log(' - ④=0               → VAN 승인 근거 부재 = 결제일자/단말 현장 재확인 필요(responder 경유).');
console.log('\n⛔ write target 판정은 본 census 범위 밖 — DA CONSULT(AC-1)에서 확정.');
console.log('════════ AC-0 census 완료 (READ-ONLY, mutation 0) ════════');
