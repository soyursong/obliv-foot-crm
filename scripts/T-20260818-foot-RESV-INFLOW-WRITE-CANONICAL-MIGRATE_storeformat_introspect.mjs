/**
 * T-20260818-foot-RESV-INFLOW-WRITE-CANONICAL-MIGRATE
 *   — store-format prod introspection (prep item #1, planner FOLLOWUP-6 reply MSG-20260819-162925-bguj)
 *
 * 목적(F3-b mirror-not-invent): (y) keep-widen 신규 유입경로 값을 저장할 때
 *   customers.visit_route + reservations.visit_route CHECK allowlist 를 widen 해야 한다.
 *   신규 값 store-format(한글 라벨 vs canonical 코드) = 반드시 기존 값 format 을 미러(byte-parity).
 *   → prod 실측으로 기존 CHECK allowlist 값의 정확한 바이트를 확정한다(발명 금지 근거).
 *
 * READ-ONLY. prod write 0 · DDL 0. pg_constraint 정의문만 SELECT.
 * usage: node scripts/T-20260818-...storeformat_introspect.mjs
 */
import { query } from './lib/foot_migration_ledger.mjs';

const one = async (sql) => {
  const body = await query(sql);
  const rows = Array.isArray(body) ? body : (body?.[0] !== undefined ? body : []);
  return Array.isArray(rows) ? rows : [];
};

console.log('════════════════════════════════════════════════════════════');
console.log('[STORE-FORMAT INTROSPECT] foot prod ref rxlomoozakkjesdqjtvd — visit_route CHECK allowlist');
console.log('  READ-ONLY (pg_constraint 정의문 SELECT only · no write · no DDL)');
console.log('════════════════════════════════════════════════════════════');

// ── 1. 두 테이블 visit_route CHECK 제약 정의문 실측 ──
const constraints = await one(`
  SELECT c.conrelid::regclass::text AS tbl, c.conname,
         pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
   WHERE c.conname IN ('customers_visit_route_check','reservations_visit_route_check')
   ORDER BY tbl;
`);

console.log('\n── A. CHECK 제약 정의문 (prod 실측) ──');
for (const r of constraints) {
  console.log(`\n  [${r.tbl}] ${r.conname}`);
  console.log(`    ${r.def}`);
}

// ── 2. 정의문에서 allowlist 값 추출 (byte 확인) ──
const extractVals = (def) => {
  if (!def) return [];
  // 두 형태 지원: IN ('a','b')  또는  = ANY (ARRAY['a'::text, 'b'::text])
  const inM = def.match(/ IN \(([^)]*)\)/);
  const anyM = def.match(/ANY \(ARRAY\[([^\]]*)\]/);
  const seg = inM ? inM[1] : (anyM ? anyM[1] : '');
  return [...seg.matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
};

console.log('\n── B. allowlist 값 (byte-parity 미러 소스) ──');
const perTable = {};
for (const r of constraints) {
  const vals = extractVals(r.def);
  perTable[r.tbl] = vals;
  console.log(`  [${r.tbl}] (${vals.length}값) = ${vals.map((v) => JSON.stringify(v)).join(', ')}`);
}

// ── 3. 두 테이블 divergence 확인 (동시 widen 대상 정합) ──
const tables = Object.keys(perTable);
if (tables.length === 2) {
  const [a, b] = tables;
  const sa = JSON.stringify(perTable[a]);
  const sb = JSON.stringify(perTable[b]);
  console.log('\n── C. 2-table 정합 (동시 widen 대상) ──');
  console.log(`  customers==reservations allowlist? ${sa === sb ? 'YES (동형·정합)' : 'NO (⚠ divergence)'}`);
  if (sa !== sb) {
    console.log(`    customers    : ${sa}`);
    console.log(`    reservations : ${sb}`);
  }
}

// ── 4. store-format 판정 (한글 라벨 vs canonical 코드) ──
const sample = perTable[tables[0]] || [];
const hasHangul = sample.some((v) => /[가-힣]/.test(v));
const hasDotCode = sample.some((v) => /^[a-z]+\.[a-z_]+$/.test(v));
console.log('\n── D. store-format 판정 (F3-b mirror-not-invent) ──');
console.log(`  한글 라벨 존재?      ${hasHangul}`);
console.log(`  canonical 코드(x.y)? ${hasDotCode}`);
console.log(`  ⇒ store-format = ${hasHangul && !hasDotCode ? '한글 라벨 (신규값도 한글 라벨로 미러)' : hasDotCode ? 'canonical 코드' : '혼합/미확정'}`);

// ── 5. 실제 저장된 distinct 값 분포 (읽기 · 정의문 밖 실데이터 존부) ──
try {
  const dist = await one(`
    SELECT visit_route, count(*)::int AS n
      FROM public.customers
     WHERE visit_route IS NOT NULL
     GROUP BY visit_route ORDER BY n DESC;
  `);
  console.log('\n── E. customers.visit_route 실 저장 distinct (읽기) ──');
  for (const r of dist) console.log(`  ${JSON.stringify(r.visit_route)} : ${r.n}`);
} catch (e) {
  console.log('\n── E. 실 저장 distinct 조회 skip:', e.message);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('[DONE] READ-ONLY introspection 완료 · prod write 0 · DDL 0');
console.log('════════════════════════════════════════════════════════════');
