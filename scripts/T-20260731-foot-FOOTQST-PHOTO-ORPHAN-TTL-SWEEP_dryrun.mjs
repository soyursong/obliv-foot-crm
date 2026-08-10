/**
 * T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP — DRY-RUN (READ-ONLY)
 *
 * 발건강 질문지 draft 미제출 사진 orphan 을 3-교집합 술어로 특정하고 **대상목록·건수만** 산출한다.
 * *** SELECT/LIST 만. Storage move/remove·DB write 없음. 순소실 0. ***
 *
 * ★분류 술어 SSOT = ./_healthq_orphan_scan.mjs (executor 와 동일 로직 공유·drift 방지).
 *   정본 근거: DA Decision da_decision_foot_healthq_photo_retention_20260731.md §3 (CODIFY DONE).
 *
 * 파괴 실행은 본 스크립트 범위 아님 — Archive-First SOP 봉투 + supervisor 코드리뷰/gated 실행에서만.
 *   → scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_execute.mjs (default dry-run, --execute 게이트)
 *
 * 실행: node scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.mjs
 *   (repo 루트 .env 또는 .env.local 에 VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요. macstudio 에서 실행.)
 *   결과 JSON → scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.out.json
 */
import { writeFileSync } from 'node:fs';
import { BUCKET, loadEnv, makeServiceClient, scanAndClassify } from './_healthq_orphan_scan.mjs';

async function main() {
  const svc = makeServiceClient(loadEnv());
  const now = new Date();
  console.log('===== DRY-RUN (READ-ONLY): health_q_photos orphan TTL sweep 대상 산정 =====');
  console.log(`bucket=${BUCKET} now=${now.toISOString()}`);

  const scan = await scanAndClassify(svc, now);
  console.log(`\n[1] Storage 오브젝트(파일) 총 ${scan.total_objects}건`);
  if (scan.total_objects === 0) { console.log('대상 없음 — 종료'); return; }

  const summary = {
    ticket: 'T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP',
    mode: 'DRY-RUN (READ-ONLY, no mutation)',
    generated_at: scan.generated_at,
    bucket: BUCKET,
    predicate: '3-교집합: (1)token expired AND (2)result absent AND (3)photo absent [+ used_at IS NULL]',
    da_ssot: 'da_decision_foot_healthq_photo_retention_20260731.md §3',
    total_objects: scan.total_objects,
    class_counts: scan.class_counts,
    sweep_eligible_count: scan.eligible.length,
    protected_note: 'A_submitted_protected / RESIDUE_* / UNCLASSIFIED_* 은 절대 삭제 대상 아님',
    freeze_set: scan.eligible,
  };
  console.log('\n===== 분류 요약 =====');
  console.log(JSON.stringify(summary.class_counts, null, 2));
  console.log(`\nsweep 적격(B_orphan_ELIGIBLE): ${scan.eligible.length}건`);
  console.log('보호(sweep 배제):',
    ['A_submitted_protected', 'RESIDUE_used_but_result_absent', 'UNCLASSIFIED_no_token_row', 'B_draft_not_yet_expired']
      .map((k) => `${k}=${scan.class_counts[k] ?? 0}`).join(' / '));

  const outPath = new URL('./T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_dryrun.out.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nfreeze-set 스냅샷 저장 → ${outPath.pathname}`);
  console.log('===== END DRY-RUN (파괴 실행 없음) =====');
}

main().catch((e) => { console.error('DRY-RUN ERROR:', e.message); process.exit(1); });
