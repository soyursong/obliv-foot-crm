/**
 * T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — EDGE #5088 담당축 정정 (backfill SOP)
 * ─────────────────────────────────────────────────────────────────────────────
 * 박성주 #5088 배정 check_in 85ecbec3(취소, 동일자 중복접수) 담당 상담사 정정:
 *   consultant_id  김지윤 → 강경민  (총괄 confirm 2026-07-28 — 실제 응대=강경민).
 *
 * ★ 커플링 판정(선행 dry-run): payments.check_in_id=85ecbec3 → 0건/₩0, packages(김지윤 앵커)=0,
 *   고객 #5088 전체 payments=0 → **매출귀속 무접점**. 순수 배정기록 정정 = comp 정책 변경 아님(대표 comp 게이트 불요).
 *
 * ※ visit_type 정정(재진→초진)은 별도 DB write 아님 — 이미 stored 'new' + 2A 코드가 표시 교정.
 *   본 스크립트는 담당축(consultant_id) 단일행만 정정.
 *
 * Data-Correction Guard (cross_crm_data_correction_backfill_sop):
 *   #1 archive-first: 정정 전 원행 스냅샷 JSON 저장(rollback/..._snapshot.json).
 *   #2 dry-run 재확인: UPDATE 전 현재값 = 김지윤 확인. 아니면 abort.
 *   #3 WHERE = UUID 명시 + AND consultant_id=김지윤(멱등·오정정 방지).
 *   #4 rows-affected = 정확히 1. 0/≠1 이면 즉시 ROLLBACK.
 *   #5 POSTCHECK: 대상행 consultant_id = 강경민 확정.
 *   #6 rollback SQL 동봉(강경민→김지윤, UUID 명시).
 *
 * 실행: node scripts/..._edge5088_assignee_backfill.mjs           (DRY-RUN only)
 *       node scripts/..._edge5088_assignee_backfill.mjs --apply   (APPLY)
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
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const CI = '85ecbec3-0917-4d71-ae06-1993b855714b';
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

console.log(`=== EDGE #5088 담당축 정정 ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`);

// staff id 조회
const staff = await q(`SELECT id, name FROM public.staff WHERE name IN (${lit('김지윤')}, ${lit('강경민')}) AND clinic_id=${lit(CLINIC)};`);
const kim = staff.find((s) => s.name === '김지윤')?.id;
const kang = staff.find((s) => s.name === '강경민')?.id;
console.log(`   김지윤=${kim}  강경민=${kang}`);
if (!kim || !kang) { console.error('⛔ staff id 미해소 — abort'); process.exit(1); }

// 현재 대상행
const before = await q(`SELECT id, consultant_id, status, visit_type, customer_id FROM public.check_ins WHERE id=${lit(CI)};`);
console.log('── 대상행 BEFORE ──'); console.table(before);
if (before.length !== 1) { console.error(`⛔ 대상행 ${before.length}건 — abort`); process.exit(1); }
if (before[0].consultant_id !== kim) {
  console.error(`⛔ Guard#2: 현재 consultant_id(${before[0].consultant_id}) ≠ 김지윤(${kim}) — abort (이미 정정됐거나 상태 상이)`);
  process.exit(1);
}

if (!APPLY) {
  console.log('\n[DRY-RUN] 예정 UPDATE:');
  console.log(`   UPDATE public.check_ins SET consultant_id=${lit(kang)} WHERE id=${lit(CI)} AND consultant_id=${lit(kim)};`);
  console.log('   기대 rows-affected=1. --apply 로 실행.');
  process.exit(0);
}

// #1 archive-first
const snapPath = join(root, 'rollback', 'T-20260727-foot-RECLASS-EDGE5088_snapshot.json');
writeFileSync(snapPath, JSON.stringify({ ticket: 'T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE', edge: '#5088', archived_kst: new Date().toISOString(), before: before[0], from_staff: '김지윤', to_staff: '강경민' }, null, 2));
console.log(`   #1 archive → ${snapPath}`);

// #3/#4 guarded UPDATE
const up = await q(`UPDATE public.check_ins SET consultant_id=${lit(kang)} WHERE id=${lit(CI)} AND consultant_id=${lit(kim)} RETURNING id, consultant_id;`);
console.log(`   #4 rows-affected = ${up.length} (기대 1)`);
if (up.length !== 1) {
  console.error('⛔ rows-affected ≠ 1 → ROLLBACK');
  await q(`UPDATE public.check_ins SET consultant_id=${lit(kim)} WHERE id=${lit(CI)} AND consultant_id=${lit(kang)};`);
  process.exit(1);
}

// #5 POSTCHECK
const after = await q(`SELECT id, consultant_id, status, visit_type FROM public.check_ins WHERE id=${lit(CI)};`);
console.log('── 대상행 AFTER ──'); console.table(after);
if (after[0].consultant_id !== kang) {
  console.error('⛔ POSTCHECK 실패 → ROLLBACK');
  await q(`UPDATE public.check_ins SET consultant_id=${lit(kim)} WHERE id=${lit(CI)} AND consultant_id=${lit(kang)};`);
  process.exit(1);
}
console.log('\n✅ APPLY 완료 — 85ecbec3 consultant 김지윤→강경민, rows-affected=1, POSTCHECK 확정.');
