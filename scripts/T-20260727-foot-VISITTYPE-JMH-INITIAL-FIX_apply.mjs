/**
 * T-20260727-foot-VISITTYPE-JMH-INITIAL-FIX — APPLY
 * ─────────────────────────────────────────────────────────────────────────────
 * 정명희(F-4270, customer_id=299b6535-e1f1-420a-bbc2-8f552a4e7487) 배정 정정.
 * visit_type "returning" -> "new", freeze 2행(UUID 명시):
 *   · check_ins    1c2117de-b091-4227-b8a5-a167c1d865b7
 *   · reservations eb7e5047-9cb5-4bac-80bc-f313d9db67aa
 *
 * Data-Correction Guard:
 *  #1 dry-run 선행 완료(별도 스크립트) — 여기서도 UPDATE에 AND visit_type='returning' 재확인.
 *  #2 WHERE = UUID 명시 (count/조건 일괄 금지).
 *  #3 rows-affected = 정확히 2행(테이블당 1). 0/≠2 이면 즉시 ROLLBACK·보고.
 *  #4 롤백 SQL: *_rollback.sql (new->returning, UUID 2개).
 *  #5 사후 배정 통계 초진/재진 카운트 정합 확인.
 * ※ 이영수(#4550)·황보경서(#4582) 무접점.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const TOK = (process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '').trim();
const REF = 'rxlomoozakkjesdqjtvd';
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}

const CUST = '299b6535-e1f1-420a-bbc2-8f552a4e7487';
const CHECKIN_ID = '1c2117de-b091-4227-b8a5-a167c1d865b7';
const RESV_ID = 'eb7e5047-9cb5-4bac-80bc-f313d9db67aa';

async function rollback(reason) {
  console.error(`\n⛔ ${reason} → 즉시 ROLLBACK 실행`);
  const r1 = await q(`UPDATE public.check_ins SET visit_type='returning' WHERE id='${CHECKIN_ID}' AND visit_type='new' RETURNING id;`);
  const r2 = await q(`UPDATE public.reservations SET visit_type='returning' WHERE id='${RESV_ID}' AND visit_type='new' RETURNING id;`);
  console.error(`   롤백: check_ins ${r1.length}행 / reservations ${r2.length}행 되돌림`);
  process.exit(1);
}

console.log('=== T-20260727 VISITTYPE-JMH-INITIAL-FIX APPLY ===\n');

// #1 재확인 + #2/#3: 테이블당 UUID 명시 UPDATE, AND visit_type='returning', RETURNING 으로 정확 카운트
const upCi = await q(`UPDATE public.check_ins SET visit_type='new' WHERE id='${CHECKIN_ID}' AND visit_type='returning' RETURNING id, visit_type;`);
console.log(`check_ins  UPDATE rows-affected = ${upCi.length} (기대 1)`);
const upRv = await q(`UPDATE public.reservations SET visit_type='new' WHERE id='${RESV_ID}' AND visit_type='returning' RETURNING id, visit_type;`);
console.log(`reservations UPDATE rows-affected = ${upRv.length} (기대 1)`);

const total = upCi.length + upRv.length;
console.log(`\n★ Guard #3: 총 rows-affected = ${total} (기대 정확히 2)`);
if (upCi.length !== 1 || upRv.length !== 1 || total !== 2) {
  await rollback(`rows-affected 불일치 (check_ins=${upCi.length}, reservations=${upRv.length}, total=${total})`);
}
console.log('   ✅ 정확히 2행 (테이블당 1행) — 정상');

// POSTCHECK: 대상행 재조회 = 'new'
const ci = await q(`SELECT id, visit_type FROM public.check_ins WHERE id='${CHECKIN_ID}';`);
const rv = await q(`SELECT id, visit_type FROM public.reservations WHERE id='${RESV_ID}';`);
console.log('\n── POSTCHECK 대상행 (기대 new) ──');
console.table([{ tbl: 'check_ins', visit_type: ci[0]?.visit_type }, { tbl: 'reservations', visit_type: rv[0]?.visit_type }]);
if (ci[0]?.visit_type !== 'new' || rv[0]?.visit_type !== 'new') {
  await rollback('POSTCHECK 실패 — 대상행이 new 가 아님');
}
console.log('   ✅ 두 행 모두 new 확정');

// #5: 배정 통계 정합 (정명희 visit_type 분포)
console.log('\n★ Guard #5: 정명희(F-4270) visit_type 분포 [AFTER]');
const dist = await q(`
  SELECT 'check_ins' tbl, visit_type, count(*)::int AS n FROM public.check_ins WHERE customer_id='${CUST}' GROUP BY visit_type
  UNION ALL
  SELECT 'reservations', visit_type, count(*)::int FROM public.reservations WHERE customer_id='${CUST}' GROUP BY visit_type
  ORDER BY 1,2;`);
console.table(dist);
console.log('   (BEFORE: check_ins new=1/returning=2, reservations new=1/returning=2)');
console.log('   (기대 AFTER: check_ins new=2/returning=1, reservations new=2/returning=1 — 정정 1행씩 이동)');

console.log('\n✅ APPLY 완료 — affected=2, POSTCHECK new 확정.');
