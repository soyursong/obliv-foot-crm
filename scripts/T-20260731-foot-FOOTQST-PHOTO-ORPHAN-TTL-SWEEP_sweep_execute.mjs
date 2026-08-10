/**
 * T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP — ARCHIVE-FIRST SWEEP EXECUTOR (GATED)
 *
 * 발건강 질문지 draft 미제출 사진 orphan(B_orphan_ELIGIBLE)을 **archive-first 2단**으로 정리한다.
 * Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard SOP 봉투 준수.
 *
 * ★삭제 술어 SSOT = ./_healthq_orphan_scan.mjs (dry-run 러너와 100% 동일 로직). 술어 drift = PHI 오삭제.
 * ★정본 근거: DA Decision da_decision_foot_healthq_photo_retention_20260731.md §2·§3.
 *
 * ═══ 안전 불변식 (SOP 봉투) ═══
 *  1. hard-DELETE 금지 → archive(copy) 확정 후에만 원본 remove. 순소실 0.
 *  2. dry-run READ-ONLY 선행 → 대상목록·건수·freeze-set 스냅샷 먼저 산출.
 *  3. freeze-set 재검증 abort 게이트 → 삭제 직전 3-교집합 재평가. (A)제출완료 혼입 판정 시 전체 batch ABORT.
 *  4. 멱등 → 이미 아카이브됨(manifest 존재)·원본 부재 시 skip, 재실행 안전.
 *  5. 판정근거 스냅샷 동봉 → manifest JSON(freeze-set + 분류근거)을 아카이브에 함께 저장.
 *  6. DDL-free → manifest = Storage 아카이브 내 JSON 오브젝트(신규 DB 테이블 0 → DA CONSULT 불요).
 *
 * ═══ 실행 게이트 ═══
 *  기본(플래그 없음)     = PLAN 모드(READ-ONLY). 대상목록·계획만 출력. Storage/DB 무변경.
 *  --execute            = 실제 archive+delete 수행. supervisor 코드리뷰/GO 이후에만.
 *  --confirm-abort-ok   = re-verify 에서 (A)혼입 발견 시 batch abort(기본 동작) 명시 승인(no-op 플래그, 문서화용).
 *
 *  ⚠ dev-foot 은 본 executor 를 --execute 로 직접 돌리지 않는다. gate=supervisor.
 *
 * 실행(PLAN): node scripts/T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_execute.mjs
 * 실행(파괴): node scripts/..._sweep_execute.mjs --execute   (supervisor gated)
 */
import { writeFileSync } from 'node:fs';
import {
  BUCKET, ARCHIVE_PREFIX, loadEnv, makeServiceClient, scanAndClassify,
} from './_healthq_orphan_scan.mjs';

const EXECUTE = process.argv.includes('--execute');
// sweep 실행 타임스탬프(아카이브 prefix 세그먼트). 콜론 제거해 Storage 경로 안전.
const SWEEP_TS = new Date().toISOString().replace(/[:.]/g, '-');

const log = (...a) => console.log(...a);

/** freeze-set 각 오브젝트를 3-교집합 재평가(abort 게이트). eligible object_id 집합으로 재검증. */
function reverify(freezeSet, rescan) {
  const stillEligible = new Set(rescan.eligible.map((e) => e.object_id));
  // 현재 (A)제출완료로 라벨된 오브젝트 경로 집합
  const nowProtected = new Set(
    rescan.objects.filter((o) => o.sweep_class === 'A_submitted_protected').map((o) => o.path)
  );
  const kept = [];
  const dropped = [];
  let abort = false;
  for (const f of freezeSet) {
    if (nowProtected.has(f.path)) {
      // 그 사이 제출 발생 → (A) 혼입 → SOP: 전체 batch ABORT (fail-closed).
      abort = true;
      dropped.push({ ...f, reason: 'became_A_submitted_protected (re-verify abort)' });
    } else if (!stillEligible.has(f.object_id)) {
      // 더 이상 적격 아님(만료상태 변화 등) → 해당 대상만 제외.
      dropped.push({ ...f, reason: 'no_longer_eligible (excluded)' });
    } else {
      kept.push(f);
    }
  }
  return { kept, dropped, abort };
}

async function main() {
  const svc = makeServiceClient(loadEnv());
  const now = new Date();
  log('===== ARCHIVE-FIRST SWEEP EXECUTOR =====');
  log(`mode=${EXECUTE ? 'EXECUTE (파괴 실행)' : 'PLAN (READ-ONLY, 무변경)'}  bucket=${BUCKET}  sweep_ts=${SWEEP_TS}`);
  if (!EXECUTE) log('⚠ PLAN 모드 — Storage/DB 를 변경하지 않습니다. 실제 정리는 --execute (supervisor gated).');

  // ── STAGE 0: dry-run 스캔 → freeze-set 고정 ──
  const scan = await scanAndClassify(svc, now);
  log(`\n[0] 전 오브젝트 ${scan.total_objects}건 / 분류:`, JSON.stringify(scan.class_counts));
  const freezeSet = scan.eligible;
  log(`freeze-set(B_orphan_ELIGIBLE) = ${freezeSet.length}건`);

  if (freezeSet.length === 0) {
    log('\n적격 orphan 0건 — 정리할 대상 없음. 종료(no-op, 멱등).');
    return;
  }

  const manifest = {
    ticket: 'T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP',
    sweep_ts: SWEEP_TS,
    mode: EXECUTE ? 'EXECUTE' : 'PLAN',
    bucket: BUCKET,
    predicate: '3-교집합: (1)token expired AND (2)result absent AND (3)photo absent [+ used_at IS NULL]',
    da_ssot: 'da_decision_foot_healthq_photo_retention_20260731.md §3',
    sop: 'Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard',
    class_counts: scan.class_counts,
    freeze_set: freezeSet,
    stages: {},
  };

  if (!EXECUTE) {
    log('\n[PLAN] 아래 대상을 archive→re-verify→delete 할 예정 (현재는 무변경):');
    for (const f of freezeSet) log(`  - ${f.path}  (archive→ ${ARCHIVE_PREFIX}/${SWEEP_TS}/${f.path})`);
    const planPath = new URL('./T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_plan.out.json', import.meta.url);
    writeFileSync(planPath, JSON.stringify(manifest, null, 2));
    log(`\nplan 스냅샷 → ${planPath.pathname}`);
    log('===== END (PLAN, 파괴 실행 없음) =====');
    return;
  }

  // ══════════════ 이하 --execute 경로 (supervisor gated) ══════════════

  // ── STAGE 1: archive (copy, 순소실 0) + manifest 동봉 ──
  log('\n[1] ARCHIVE (copy) — 원본 삭제 전 복원 가능 상태 경유');
  const archived = [];
  for (const f of freezeSet) {
    const dest = `${ARCHIVE_PREFIX}/${SWEEP_TS}/${f.path}`;
    // 멱등: 이미 아카이브 존재하면 skip
    const { data: existing } = await svc.storage.from(BUCKET).list(dest.split('/').slice(0, -1).join('/'), {
      search: dest.split('/').pop(),
    });
    if (existing && existing.length) { log(`  skip(이미 아카이브됨): ${dest}`); archived.push({ ...f, dest, skipped: true }); continue; }
    const { error } = await svc.storage.from(BUCKET).copy(f.path, dest);
    if (error) throw new Error(`archive copy 실패(${f.path}): ${error.message}`);
    log(`  archived: ${f.path} → ${dest}`);
    archived.push({ ...f, dest, skipped: false });
  }
  manifest.stages.archive = { count: archived.length, items: archived };

  // manifest 를 아카이브 prefix 에 동봉(판정근거 스냅샷)
  const manifestPath = `${ARCHIVE_PREFIX}/${SWEEP_TS}/_manifest.json`;
  const { error: mErr } = await svc.storage.from(BUCKET).upload(
    manifestPath, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), { upsert: true }
  );
  if (mErr) throw new Error(`manifest 업로드 실패: ${mErr.message}`);
  log(`  manifest 동봉: ${manifestPath}`);

  // ── STAGE 2: freeze-set 재검증 (ABORT 게이트) ──
  log('\n[2] RE-VERIFY (abort 게이트) — 삭제 직전 3-교집합 재평가');
  const rescan = await scanAndClassify(svc, new Date());
  const rv = reverify(freezeSet, rescan);
  manifest.stages.reverify = { kept: rv.kept.length, dropped: rv.dropped, abort: rv.abort };
  if (rv.abort) {
    log('  ⚠⚠ ABORT — freeze-set 에 (A)제출완료 혼입 발견. 원본 삭제하지 않음(아카이브만 남김). 수동 검토 필요.');
    writeFileSync(new URL('./T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_manifest.out.json', import.meta.url),
      JSON.stringify(manifest, null, 2));
    process.exit(2);
  }
  log(`  재검증 통과: ${rv.kept.length}건 삭제 진행 / ${rv.dropped.length}건 제외`);

  // ── STAGE 3: delete (원본 remove) — 아카이브·재검증 확정분만 ──
  log('\n[3] DELETE (원본 remove) — 아카이브 확정 + 재검증 통과분만');
  const toDelete = rv.kept.map((f) => f.path);
  const { data: rmData, error: rmErr } = await svc.storage.from(BUCKET).remove(toDelete);
  if (rmErr) throw new Error(`원본 remove 실패: ${rmErr.message}`);
  log(`  삭제 완료: ${rmData?.length ?? toDelete.length}건`);
  manifest.stages.delete = { count: toDelete.length, paths: toDelete };

  const outPath = new URL('./T-20260731-foot-FOOTQST-PHOTO-ORPHAN-TTL-SWEEP_sweep_manifest.out.json', import.meta.url);
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  log(`\n최종 manifest → ${outPath.pathname}`);
  log('===== END (EXECUTE 완료·순소실 0·아카이브 복원 가능) =====');
}

main().catch((e) => { console.error('SWEEP ERROR:', e.message); process.exit(1); });
