/**
 * T-20260821-foot-DOCREQITEM-INGROWN-TOENAIL-ADD — 진단서 섹션 [내성발톱] 옵션 PROD seed apply
 *
 * 2번차트 소견서/진단서 발행요청 옵션 그리드 [진단서] 섹션에 [내성발톱] 옵션 1건 ADDITIVE 추가.
 *   SSOT = form_templates(clinic=풋센터종로, form_key='opinion_doc').field_map.sections[0](진단서).
 *   ★FE OPINION_SECTIONS 는 empty-safe 폴백일 뿐 — prod 는 이 DB seed 를 우선 렌더하므로 본 apply 필수.
 *
 * 성격: db_change=false · ADDITIVE · 무DDL(JSONB 데이터 UPDATE) · 멱등(@> 가드) · DA CONSULT 불요 · GO-token 대상 아님.
 *   phrase = 문지은 대표원장 verbatim(MSG-20260821-221354-5jia, 의료법§22 immutable).
 *
 * ★PROD write 게이트: applyMigration 실적용은 supervisor 게이트 경유(foot_migration_ledger 규약).
 *   dev-foot 는 dry-run(read-only PRE 확인)까지. --apply 는 supervisor QA 후.
 *
 * 사용:
 *   node scripts/T-20260821-...INGROWN-TOENAIL-ADD_apply.mjs            # dry-run (PRE 상태 확인, 기본)
 *   node scripts/T-20260821-...INGROWN-TOENAIL-ADD_apply.mjs --apply    # PROD apply + 원장기록 + POST 검증 (supervisor)
 *
 * author: dev-foot / 2026-08-21
 */
import { query, applyMigration } from './lib/foot_migration_ledger.mjs';

const APPLY = process.argv.includes('--apply');
const VERSION = '20260821170000';
const FILE = '20260821170000_foot_opinion_doc_add_ingrown_toenail.sql';
const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8'; // 오블리브 풋센터 종로

async function dumpState(label) {
  const rows = await query(`
    SELECT
      ft.field_map->'sections'->0->>'title' AS sec0_title,
      jsonb_array_length(ft.field_map->'sections'->0->'options') AS sec0_opt_count,
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(ft.field_map->'sections'->0->'options') o
        WHERE o->>'key' = 'ingrown_toenail'
      ) AS has_ingrown,
      (
        SELECT o->>'phrase' FROM jsonb_array_elements(ft.field_map->'sections'->0->'options') o
        WHERE o->>'key' = 'ingrown_toenail' LIMIT 1
      ) AS ingrown_phrase
    FROM form_templates ft
    WHERE ft.clinic_id = '${CLINIC}' AND ft.form_key = 'opinion_doc' AND ft.active = true
    LIMIT 1;`);
  const r = (rows?.result ?? rows)?.[0] ?? rows?.[0] ?? rows;
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(r, null, 2));
  return r;
}

console.log(`── INGROWN-TOENAIL seed apply (${APPLY ? 'APPLY' : 'DRY-RUN'}) — ${FILE} ──`);
await dumpState('PRE');

if (!APPLY) {
  const plan = await applyMigration({ version: VERSION, file: FILE, dryRun: true });
  console.log(`\n[dry-run] would apply ${plan.file} (${plan.bytes} bytes). PROD write 미실행.`);
  console.log('supervisor QA 후 --apply 로 실적용.');
} else {
  const res = await applyMigration({ version: VERSION, file: FILE, dryRun: false, createdBy: 'dev-foot-T20260821-INGROWN-TOENAIL' });
  console.log(`\n[APPLIED] ${JSON.stringify(res)}`);
  const post = await dumpState('POST');
  if (!post?.has_ingrown) throw new Error('POST 검증 실패: ingrown_toenail 옵션 미반영');
  if (!post?.ingrown_phrase?.includes('[내원일]')) throw new Error('POST 검증 실패: phrase [내원일] 토큰 훼손');
  console.log('\n✅ POST 검증 통과 — 진단서 섹션 내성발톱 옵션 실재 + [내원일] verbatim 보존.');
}
