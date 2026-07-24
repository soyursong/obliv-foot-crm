/**
 * T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL — STEP 03
 * 수정1 APPLY: 엄상욱 상담담당자 강경민 → 엄경은 (check_ins.consultant_id UPDATE)
 *
 * data_correction_backfill_sop 준수:
 *   - 대상 id freeze: check_ins.id = 976e2667-7d75-4c09-95e2-b6faa7d3a14d (엄상욱 유일 check_in, 오늘 2026-07-24)
 *   - from-value 이중 guard: consultant_id = 6ab26d9f(강경민) 인 행만 대상
 *   - before 스냅샷 기록, rows-affected=1 이중가드(≠1이면 미적용/중단)
 *   - to-value: b311593d(엄경은)
 *
 * 실행: DRY 확인용 --apply 플래그 없으면 SELECT만.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const sb = createClient('https://rxlomoozakkjesdqjtvd.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const APPLY = process.argv.includes('--apply');
const TARGET_CHECKIN = '976e2667-7d75-4c09-95e2-b6faa7d3a14d';
const OLD = '6ab26d9f-fd10-4042-9fd7-076f277be5d4'; // 강경민
const NEW = 'b311593d-9e46-4ac8-9424-6b0fa1689a06'; // 엄경은
const CUSTOMER = 'fd9417a3-ccaf-4323-a595-04204f6ee32a'; // 엄상욱 F-5057

// ── 1) before 스냅샷 (전체 행) ──────────────────────────────────
const { data: before, error: e0 } = await sb.from('check_ins').select('*').eq('id', TARGET_CHECKIN);
if (e0) { console.error('before SELECT FAIL:', e0); process.exit(1); }
if (before.length !== 1) { console.error(`ABORT: 대상 행 ${before.length}건 (freeze 위반)`); process.exit(1); }
const row = before[0];

// 대상 정합성 재검증(freeze)
if (row.customer_id !== CUSTOMER || row.customer_name !== '엄상욱') {
  console.error('ABORT: 대상 customer 불일치', { customer_id: row.customer_id, name: row.customer_name }); process.exit(1);
}
if (row.consultant_id !== OLD) {
  console.error(`ABORT: 현재 consultant_id=${row.consultant_id} ≠ 강경민(${OLD}). 이미 변경됐거나 대상 오인.`); process.exit(1);
}
console.log('BEFORE OK — 엄상욱 check_in', TARGET_CHECKIN, 'consultant_id=', row.consultant_id, '(강경민)');

if (!APPLY) { console.log('\n[DRY-RUN] --apply 없음 → UPDATE 미실행. before 검증만 통과.'); process.exit(0); }

// ── 2) 단일행 guarded UPDATE ────────────────────────────────────
const { data: upd, error: e1 } = await sb.from('check_ins')
  .update({ consultant_id: NEW })
  .eq('id', TARGET_CHECKIN)
  .eq('consultant_id', OLD)   // from-value guard
  .select();
if (e1) { console.error('UPDATE FAIL:', e1); process.exit(1); }

// ── 3) rows-affected=1 이중가드 ─────────────────────────────────
if (!upd || upd.length !== 1) {
  console.error(`ABORT/ROLLBACK-NEEDED: rows-affected=${upd?.length ?? 0} ≠ 1.`);
  process.exit(2);
}

// ── 4) after 재조회 검증 ────────────────────────────────────────
const { data: after } = await sb.from('check_ins').select('id, customer_name, consultant_id').eq('id', TARGET_CHECKIN);
console.log('AFTER —', JSON.stringify(after[0]));
if (after[0].consultant_id !== NEW) { console.error('ABORT: after consultant_id 불일치'); process.exit(2); }

// ── 5) evidence: before full snapshot + rollback SQL ────────────
const evidence = {
  ticket: 'T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL',
  op: '수정1 UPDATE check_ins.consultant_id 강경민→엄경은',
  target_check_in_id: TARGET_CHECKIN,
  customer: { id: CUSTOMER, name: '엄상욱', chart: 'F-5057' },
  before_consultant_id: OLD, before_consultant_name: '강경민',
  after_consultant_id: NEW, after_consultant_name: '엄경은',
  rows_affected: upd.length,
  rollback_sql: `UPDATE public.check_ins SET consultant_id = '${OLD}' WHERE id = '${TARGET_CHECKIN}' AND consultant_id = '${NEW}';`,
  before_full_row: row,
};
writeFileSync('scripts/_evidence/T-20260724-foot-EOMSANGWOOK-OWNER-PARKMINSEOK-DEL_eomsangwook_UPDATE.json', JSON.stringify(evidence, null, 2));
console.log('\n[APPLIED OK] rows-affected=1. evidence written. rollback SQL:\n' + evidence.rollback_sql);
