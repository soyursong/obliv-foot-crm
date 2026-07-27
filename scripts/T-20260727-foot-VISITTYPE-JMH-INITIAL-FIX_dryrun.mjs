/**
 * T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX — DRY-RUN (READ-ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 * 배정 화면 초진/재진 데이터 정정 — 정명희(#4270) only.
 * visit_type "returning" → "new", 대상 2행(freeze, UUID 명시):
 *   · check_ins     id = 1c2117de-b091-4227-b8a5-a167c1d865b7
 *   · reservations  id = eb7e5047-9cb5-4bac-80bc-f313d9db67aa
 *
 * Data-Correction Guard #1: UPDATE 전 두 행 SELECT로 현재값 = "returning" 재확인.
 *   → 이미 new 거나 다르면 착수 중단·보고 (이 스크립트는 abort 신호만 출력).
 * ※ 이영수(#4550)·황보경서(#4582) 무접점 — 본 스크립트 대상 아님.
 * 삭제/변경 없음. 순수 조회.
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

const CHECKIN_ID = '1c2117de-b091-4227-b8a5-a167c1d865b7';
const RESV_ID    = 'eb7e5047-9cb5-4bac-80bc-f313d9db67aa';

console.log('=== T-20260727 VISITTYPE-JMH-INITIAL-FIX DRY-RUN (READ-ONLY) ===\n');

// check_ins 대상행
const ci = await q(`
  SELECT id, customer_id, visit_type, status, created_at
  FROM public.check_ins
  WHERE id = '${CHECKIN_ID}';`);
console.log('── check_ins 대상행 ──');
console.table(ci);

// reservations 대상행
const rv = await q(`
  SELECT id, customer_id, visit_type, status, created_at
  FROM public.reservations
  WHERE id = '${RESV_ID}';`);
console.log('── reservations 대상행 ──');
console.table(rv);

// 고객 교차확인 (freeze 검증: 두 행이 같은 고객이고 #4270 인지)
const custIds = [...new Set([...ci, ...rv].map((r) => r.customer_id).filter(Boolean))];
if (custIds.length) {
  const cust = await q(`
    SELECT id, chart_number, chart_no, name
    FROM public.customers
    WHERE id IN (${custIds.map((c) => `'${c}'`).join(',')});`).catch(async () => {
      // 컬럼명 불확실 → 최소 컬럼만
      return q(`SELECT id FROM public.customers WHERE id IN (${custIds.map((c) => `'${c}'`).join(',')});`);
    });
  console.log('── 대상 고객 (교차확인) ──');
  console.table(cust);
}

// ★ Guard #1 판정
const rows = [
  { tbl: 'check_ins', row: ci[0] },
  { tbl: 'reservations', row: rv[0] },
];
let allReturning = true;
let allFound = true;
console.log('\n★ Guard #1 판정 (착수 가부):');
for (const { tbl, row } of rows) {
  if (!row) { allFound = false; console.log(`   ✗ ${tbl}: 대상행 없음 (0행) — ABORT`); continue; }
  const ok = row.visit_type === 'returning';
  if (!ok) allReturning = false;
  console.log(`   ${ok ? '✅' : '⚠'} ${tbl}: visit_type='${row.visit_type}' ${ok ? '(returning 확인)' : '(returning 아님 — ABORT)'}`);
}
const sameCust = custIds.length === 1;
console.log(`   ${sameCust ? '✅' : '⚠'} freeze: 두 행 동일 고객 ${sameCust ? `(customer_id=${custIds[0]})` : `(customer_id ${custIds.length}종 — 확인필요)`}`);

const GO = allFound && allReturning;
console.log(`\n   >>> ${GO ? '✅ GO — 두 행 모두 returning, UPDATE 진행 가능' : '⛔ ABORT — 조건 불충족, 착수 중단·보고'}`);
