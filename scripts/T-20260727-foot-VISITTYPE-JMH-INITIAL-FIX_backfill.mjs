/**
 * T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX — 정명희(#4270) 초진/재진 분류 정정 (backfill SOP)
 * ─────────────────────────────────────────────────────────────────────────────
 * 총괄(김주연) 확정: 정명희(#4270) visit_type 'returning' → 'new' (초진).
 *   check_in 1c2117de(2026-07-10, done) 이전 방문 없음 → 초진 맞음.
 *
 * 대상 2행 (freeze — 정명희만, 이영수·황보경서 무접점):
 *   check_ins    id = 1c2117de-b091-4227-b8a5-a167c1d865b7
 *   reservations id = eb7e5047-9cb5-4bac-80bc-f313d9db67aa
 *
 * Data-Correction Guard (cross_crm_data_correction_backfill_sop):
 *   #1 archive-first: 정정 전 원행 스냅샷 JSON 저장(rollback/..._snapshot.json).
 *   #2 dry-run 재확인: UPDATE 전 현재값 = 'returning' 확인. 아니면 abort.
 *   #3 WHERE = UUID 명시 + AND visit_type='returning' (멱등·count기준 금지).
 *   #4 rows-affected = 정확히 2 (행별 1). 0/≠2 이면 즉시 ROLLBACK.
 *   #5 POSTCHECK: 대상 2행 visit_type='new' 확정 + 통계 카운트 정합.
 *   #6 rollback SQL 동봉(new→returning, UUID 명시).
 *
 * 실행: node scripts/..._backfill.mjs           (DRY-RUN only)
 *       node scripts/..._backfill.mjs --apply   (APPLY)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
const CI = '1c2117de-b091-4227-b8a5-a167c1d865b7'; // check_ins
const RESV = 'eb7e5047-9cb5-4bac-80bc-f313d9db67aa'; // reservations
const APPLY = process.argv.includes('--apply');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log(`=== 정명희(#4270) visit_type returning→new ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);

// #2 현재 대상행 재확인 (판정근거 스냅샷)
const ciBefore = await q(`SELECT id, customer_id, visit_type, status, checked_in_at FROM public.check_ins WHERE id=${lit(CI)};`);
const rvBefore = await q(`SELECT id, customer_id, visit_type, status FROM public.reservations WHERE id=${lit(RESV)};`);
console.log('── check_ins BEFORE ──'); console.table(ciBefore);
console.log('── reservations BEFORE ──'); console.table(rvBefore);

if (ciBefore.length !== 1) { console.error(`⛔ check_ins 대상행 ${ciBefore.length}건 — abort`); process.exit(1); }
if (rvBefore.length !== 1) { console.error(`⛔ reservations 대상행 ${rvBefore.length}건 — abort`); process.exit(1); }
if (ciBefore[0].visit_type !== 'returning') {
  console.error(`⛔ Guard#2: check_ins visit_type(${ciBefore[0].visit_type}) ≠ 'returning' — abort (이미 정정됐거나 상이)`);
  process.exit(1);
}
if (rvBefore[0].visit_type !== 'returning') {
  console.error(`⛔ Guard#2: reservations visit_type(${rvBefore[0].visit_type}) ≠ 'returning' — abort (이미 정정됐거나 상이)`);
  process.exit(1);
}

// 통계 정합 — 정정 대상 고객(#4270)의 정정 전 카운트 스냅샷
const custId = ciBefore[0].customer_id;
const statBefore = await q(`SELECT visit_type, COUNT(*)::int AS n FROM public.check_ins WHERE customer_id=${lit(custId)} GROUP BY visit_type ORDER BY visit_type;`);
console.log(`── 고객 ${custId} check_ins visit_type 분포 BEFORE ──`); console.table(statBefore);

if (!APPLY) {
  console.log('\n[DRY-RUN] 예정 UPDATE (2행):');
  console.log(`   UPDATE public.check_ins    SET visit_type='new' WHERE id=${lit(CI)}   AND visit_type='returning';`);
  console.log(`   UPDATE public.reservations SET visit_type='new' WHERE id=${lit(RESV)} AND visit_type='returning';`);
  console.log('   기대 rows-affected 합계=2 (행별 1). --apply 로 실행.');
  process.exit(0);
}

// #1 archive-first
const snapPath = join(root, 'rollback', 'T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX_snapshot.json');
writeFileSync(snapPath, JSON.stringify({
  ticket: 'T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX', patient: '정명희 #4270',
  archived_kst: new Date().toISOString(),
  check_ins_before: ciBefore[0], reservations_before: rvBefore[0],
  from: 'returning', to: 'new',
  rollback_sql: [
    `UPDATE public.check_ins    SET visit_type='returning' WHERE id='${CI}'   AND visit_type='new';`,
    `UPDATE public.reservations SET visit_type='returning' WHERE id='${RESV}' AND visit_type='new';`,
  ],
}, null, 2));
console.log(`   #1 archive → ${snapPath}`);

// #3/#4 guarded UPDATE (행별 1)
const upCi = await q(`UPDATE public.check_ins    SET visit_type='new' WHERE id=${lit(CI)}   AND visit_type='returning' RETURNING id, visit_type;`);
const upRv = await q(`UPDATE public.reservations SET visit_type='new' WHERE id=${lit(RESV)} AND visit_type='returning' RETURNING id, visit_type;`);
const affected = upCi.length + upRv.length;
console.log(`   #4 rows-affected: check_ins=${upCi.length} reservations=${upRv.length} 합계=${affected} (기대 2)`);
if (upCi.length !== 1 || upRv.length !== 1) {
  console.error('⛔ rows-affected ≠ (1,1) → ROLLBACK');
  await q(`UPDATE public.check_ins    SET visit_type='returning' WHERE id=${lit(CI)}   AND visit_type='new';`);
  await q(`UPDATE public.reservations SET visit_type='returning' WHERE id=${lit(RESV)} AND visit_type='new';`);
  process.exit(1);
}

// #5 POSTCHECK
const ciAfter = await q(`SELECT id, visit_type FROM public.check_ins WHERE id=${lit(CI)};`);
const rvAfter = await q(`SELECT id, visit_type FROM public.reservations WHERE id=${lit(RESV)};`);
console.log('── check_ins AFTER ──'); console.table(ciAfter);
console.log('── reservations AFTER ──'); console.table(rvAfter);
if (ciAfter[0].visit_type !== 'new' || rvAfter[0].visit_type !== 'new') {
  console.error('⛔ POSTCHECK 실패 → ROLLBACK');
  await q(`UPDATE public.check_ins    SET visit_type='returning' WHERE id=${lit(CI)}   AND visit_type='new';`);
  await q(`UPDATE public.reservations SET visit_type='returning' WHERE id=${lit(RESV)} AND visit_type='new';`);
  process.exit(1);
}
const statAfter = await q(`SELECT visit_type, COUNT(*)::int AS n FROM public.check_ins WHERE customer_id=${lit(custId)} GROUP BY visit_type ORDER BY visit_type;`);
console.log(`── 고객 ${custId} check_ins visit_type 분포 AFTER ──`); console.table(statAfter);
console.log('\n✅ APPLY 완료 — 정명희 #4270 visit_type returning→new, rows-affected=2, POSTCHECK 확정.');
