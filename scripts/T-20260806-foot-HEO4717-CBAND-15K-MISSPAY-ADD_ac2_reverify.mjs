/**
 * T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD — AC-2 PRE-APPLY RE-VERIFY (READ-ONLY)
 *
 * ⛔ READ-ONLY. prod WRITE/DELETE/DDL 0. 전부 SELECT.
 * 목적: comp-gate RESOLVED 후, 실 INSERT 직전 target-set freeze 재검증 + 정합 앵커 확정.
 *   (1) F-4717 CTB 15,000 payment 여전히 0건? (idempotency guard — 이미 있으면 no-op ABORT)
 *   (2) 07-28 done 방문 check_in c33dfc76 실재/status 확인 (bind 대상)
 *   (3) payments 컬럼 default (is_simulation/status/accounting_date/payment_type) — INSERT 페이로드 정합
 *   (4) v_daily_revenue 그룹 기준 컬럼(created_at vs accounting_date) — AC-3 delta 검증 대상일 확정
 *   (5) BEFORE 스냅샷: v_daily_revenue[2026-07-28] 현재값 (apply 후 +15,000 정확 대조용)
 *
 * 인증 컨텍스트: Supabase Management API(/database/query, SUPABASE_ACCESS_TOKEN) = service_role 상당, RLS 미적용.
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
if (!TOK) { throw new Error('SUPABASE_ACCESS_TOKEN 필요'); }

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

const CID = '6412fbf7-8a53-4d49-af7a-491e1d731b4c';
const CLINIC = '74967aea'; // prefix — resolve full below
const CI_0728 = 'c33dfc76'; // prefix — resolve full below
const SVC_CTB = 'e17ba3a3-4842-4097-87bc-0778a64d2755';

console.log('════════ AC-2 PRE-APPLY RE-VERIFY (READ-ONLY) ════════\n');

// resolve full ids
const cust = await q(`SELECT id, name, chart_number, clinic_id FROM customers WHERE id='${CID}'`);
console.log('── 고객 ──'); console.log(j(cust));
const CLINIC_FULL = cust[0]?.clinic_id;
console.log(`clinic_id(full)=${CLINIC_FULL}\n`);

// (1) idempotency guard — F-4717 15,000 payment 재확인
const pay15k = await q(`
  SELECT id, check_in_id, amount, method, payment_type, status, is_simulation, created_at, accounting_date
  FROM payments WHERE customer_id='${CID}' AND amount=15000 AND (deleted_at IS NULL)`);
console.log('── (1) F-4717 amount=15,000 payment (freeze guard: 0 이어야 착수) ──');
console.log(`  count=${pay15k.length}`); console.log(j(pay15k));

// (2) bind 대상 check_in — 07-28 done
const ci = await q(`
  SELECT id, clinic_id, customer_id, status, visit_type, created_at,
         (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
  FROM check_ins WHERE customer_id='${CID}' AND id::text LIKE '${CI_0728}%'`);
console.log('\n── (2) bind 대상 check_in c33dfc76 (07-28 done returning) ──'); console.log(j(ci));

// F-4717 전 payments (07-28 timestamp 정합 참고 — 같은 방문 다른 payment created_at 앵커)
const payAll = await q(`
  SELECT id, check_in_id, amount, method, payment_type, created_at,
         (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
  FROM payments WHERE customer_id='${CID}' ORDER BY created_at`);
console.log('\n── F-4717 전 payments (created_at 앵커 참고) ──'); console.log(j(payAll));

// (3) payments 컬럼 default / not-null / enum
const cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='payments'
  ORDER BY ordinal_position`);
console.log('\n── (3) payments 컬럼 스키마(default/nullable) ──'); console.log(j(cols));

// (4) v_daily_revenue 정의 — 그룹 기준 컬럼 확인
const vdef = await q(`SELECT pg_get_viewdef('public.v_daily_revenue'::regclass, true) AS def`);
console.log('\n── (4) v_daily_revenue 정의 ──'); console.log(vdef[0]?.def ?? '(뷰 없음)');

// (5) BEFORE 스냅샷 — v_daily_revenue[2026-07-28]
try {
  const before = await q(`
    SELECT * FROM v_daily_revenue
    WHERE (revenue_date = DATE '2026-07-28' OR "date" = DATE '2026-07-28' OR day = DATE '2026-07-28')
    LIMIT 20`);
  console.log('\n── (5) BEFORE v_daily_revenue[2026-07-28] ──'); console.log(j(before));
} catch (e) {
  console.log('\n── (5) v_daily_revenue 컬럼명 상이 — 정의(4) 참고 후 재쿼리 필요 ──', e.message);
}

console.log('\n════════ RE-VERIFY 종료 (READ-ONLY, 무영속) ════════');
