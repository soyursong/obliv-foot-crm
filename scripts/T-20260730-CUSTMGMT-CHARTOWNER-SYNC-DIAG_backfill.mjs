/**
 * T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG — Part 1 데이터 정정 백필 러너.
 * 결정 B: 퇴사(active=false) 김수린 담당 7건 customers.assigned_staff_id → NULL(미지정).
 *
 * data_correction_backfill_sop 준수:
 *   1) 대상셋 freeze 재검증 — UPDATE 직전 재조회해 '여전히 7건·전원 김수린·전원 inactive·id 목록 일치' 확인. 불일치면 abort.
 *   2) 지문(fingerprint) = assigned_staff_id = {김수린 id} AND staff.active=false 교집합 (단순 count-N 기준 아님).
 *   3) 판정근거 스냅샷 — 7행(customer_id/chart_no/name/이전 assigned_staff_id) 동봉.
 *   4) 롤백 SQL — 7행을 김수린 id 로 원복.
 *   5) 원장 무접점 — assigned_consultant_id / payments / 매출·인센티브 무접촉 (assigned_staff_id 만 write).
 *   6) dry-run(영향 행수=7) → 실적용은 --apply.
 *
 * 인증컨텍스트: Supabase Management API (database/query) = postgres, RLS 미적용 (진단·정정 컨텍스트 명시).
 * usage: node scripts/T-20260730-...backfill.mjs            (dry-run only, no persist)
 *        node scripts/T-20260730-...backfill.mjs --apply    (freeze re-verify → real UPDATE)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync('.env.local', 'utf8');
const tok = (env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m) || [])[1]?.trim();
const REF = 'rxlomoozakkjesdqjtvd';
if (!tok) { console.error('no SUPABASE_ACCESS_TOKEN'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

const KIMSURIN_ID = '5b3a3a5f-9d14-4099-897b-95c6ae86b763';
// 진단 D4 시점 freeze 대상셋 (7건). UPDATE 직전 재조회 결과와 이 목록이 정확히 일치해야 진행.
const FROZEN_IDS = [
  '054948a2-fc42-483b-bc98-2ad1a5727395', // F-0155 양종필
  '65351f78-ffee-4a4a-a25d-503c716b8b1e', // F-0896 김수연
  '8ef1f602-5c89-4c50-b616-6a10695647af', // F-3904 서호영
  '0e27bce7-8311-4c80-9a26-edbba0b4d9e1', // F-4067 윤민희
  '362663c7-bb77-4e33-9f17-05b94b3fd866', // F-4328 박세진
  'c074025b-cd27-443c-93a9-151d6d4214d4', // F-4468 풋 서류 테스트 입니다
  'ca8975d4-b79c-4704-b142-3742692ce787', // F-4470 김설아
].sort();

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
}
const idArray = (ids) => `ARRAY[${ids.map((x) => `'${x}'`).join(',')}]::uuid[]`;
// 지문(fingerprint) WHERE — 김수린 id ∩ inactive staff. 실 UPDATE 도 동일 조건에 freeze id 목록을 AND.
const FINGERPRINT = `assigned_staff_id = '${KIMSURIN_ID}'
    AND assigned_staff_id IN (SELECT id FROM staff WHERE active = false)`;

const evidence = { ticket: 'T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG', mode: APPLY ? 'APPLY' : 'DRY-RUN' };

// ── STEP 1: freeze 대상셋 재검증 (fingerprint 교집합 현재 스냅샷) ──
const cur = await q(`
  SELECT c.id AS customer_id, c.chart_number, c.name AS customer_name,
         c.assigned_staff_id, s.active AS staff_active, c.assigned_consultant_id
  FROM customers c JOIN staff s ON s.id = c.assigned_staff_id
  WHERE c.${FINGERPRINT}
  ORDER BY c.id;
`);
evidence.freeze_snapshot = cur;
const curIds = cur.map((r) => r.customer_id).sort();

const problems = [];
if (cur.length !== 7) problems.push(`대상 건수 ${cur.length} ≠ 7`);
if (!cur.every((r) => r.assigned_staff_id === KIMSURIN_ID)) problems.push('김수린 외 staff 혼입');
if (!cur.every((r) => r.staff_active === false)) problems.push('active=true staff 혼입');
if (JSON.stringify(curIds) !== JSON.stringify(FROZEN_IDS)) problems.push('freeze id 목록 불일치(대상 drift)');
if (cur.some((r) => r.assigned_consultant_id !== null)) problems.push('assigned_consultant_id 비어있지 않음(원장 무접점 위반 위험)');

evidence.freeze_verify = { expected: 7, actual: cur.length, problems, passed: problems.length === 0 };

if (problems.length) {
  console.error('[ABORT] freeze 재검증 실패 → planner 복귀:\n  - ' + problems.join('\n  - '));
  writeFileSync(`_artifacts/T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG/backfill_${APPLY ? 'apply' : 'dryrun'}_ABORT.json`, JSON.stringify(evidence, null, 2));
  process.exit(2);
}
console.log('[OK] freeze 재검증 통과 — 7건·전원 김수린·전원 inactive·id 일치·consultant_id 전부 NULL.');

// ── STEP 2: dry-run (BEGIN..ROLLBACK, 무영속, 영향 행수 확인) ──
const dry = await q(`
  BEGIN;
  WITH upd AS (
    UPDATE customers SET assigned_staff_id = NULL
    WHERE ${FINGERPRINT}
      AND id = ANY(${idArray(FROZEN_IDS)})
    RETURNING id
  ) SELECT count(*)::int AS affected FROM upd;
  ROLLBACK;
`);
// database/query 는 마지막 SELECT 결과 반환
const dryAffected = Array.isArray(dry) ? (dry[dry.length - 1]?.affected ?? dry[0]?.affected) : dry?.affected;
evidence.dry_run = { affected: dryAffected, expected: 7, persisted: false };
console.log(`[DRY-RUN] 영향 행수 = ${dryAffected} (기대 7, 무영속 ROLLBACK).`);
if (dryAffected !== 7) {
  console.error('[ABORT] dry-run 영향 행수 ≠ 7 → planner 복귀.');
  writeFileSync(`_artifacts/T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG/backfill_dryrun_ABORT.json`, JSON.stringify(evidence, null, 2));
  process.exit(2);
}

if (!APPLY) {
  writeFileSync(`_artifacts/T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG/backfill_dryrun.json`, JSON.stringify(evidence, null, 2));
  console.log('[DONE] dry-run 완료 (무영속). 실적용은 --apply.');
  process.exit(0);
}

// ── STEP 3: 실적용 UPDATE (fingerprint ∩ freeze id, 정확히 7행) ──
const applied = await q(`
  WITH upd AS (
    UPDATE customers SET assigned_staff_id = NULL
    WHERE ${FINGERPRINT}
      AND id = ANY(${idArray(FROZEN_IDS)})
    RETURNING id
  ) SELECT count(*)::int AS affected FROM upd;
`);
const appliedAffected = Array.isArray(applied) ? applied[0]?.affected : applied?.affected;
evidence.applied = { affected: appliedAffected, persisted: true };
console.log(`[APPLY] UPDATE 완료 — 영향 행수 = ${appliedAffected}.`);

// ── STEP 4: 사후 검증 (7건 NULL, 김수린 assigned 잔존 0, consultant_id 무변경) ──
const post = await q(`
  SELECT
    (SELECT count(*)::int FROM customers WHERE id = ANY(${idArray(FROZEN_IDS)}) AND assigned_staff_id IS NULL) AS now_null,
    (SELECT count(*)::int FROM customers WHERE assigned_staff_id = '${KIMSURIN_ID}') AS kimsurin_remaining,
    (SELECT count(*)::int FROM customers WHERE assigned_consultant_id IS NOT NULL) AS consultant_populated;
`);
evidence.post_verify = post[0];
console.log(`[POST] freeze 7건 NULL=${post[0].now_null} · 김수린 잔존=${post[0].kimsurin_remaining} · consultant_id populated=${post[0].consultant_populated}(무변경 확인).`);

writeFileSync(`_artifacts/T-20260730-foot-CUSTMGMT-CHARTOWNER-SYNC-DIAG/backfill_apply.json`, JSON.stringify(evidence, null, 2));
console.log('[DONE] 백필 적용 완료 + evidence 저장.');
