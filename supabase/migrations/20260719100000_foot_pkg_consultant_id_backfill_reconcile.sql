-- ════════════════════════════════════════════════════════════════════════════
-- T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE  (P2, foot) — [PHASE 1 : 백필 RECONCILE]
-- packages.consultant_id 백필을 authoritative DA 결정문에 재수렴.
--
-- 배경/사유(정직한 divergence 수렴):
--   Phase 1 최초 백필(20260718241000_..._backfill.sql)은 DA 핸드오프 REPLY(sy5d)의
--   "heuristic(pkg_attr) 스냅샷 백필"에 정렬해 119건을 채웠다. 그러나 그 직후 발행된
--   **formal 결정문**(memory/1_Projects/201_.../da_decision_foot_pkg_consultant_id_attr_capture_20260718.md,
--   decision_id DA-20260718-foot-PKG-CONSULTANT-ID-ATTR, canonical CONSULT nyym 회신)의
--   **Q4**는 정반대를 규정한다:
--     · heuristic-launder 반려 — 오늘의 추측을 '사실 컬럼'에 각인 금지(populated⟺사실 불변식 파괴).
--     · 백필 GO 대상 = 결정적 링크(check_ins.package_id=packages.id AND ci.consultant_id NOT NULL)만 fact.
--     · 나머지 전부 NULL 유지(by-design) → read-time COALESCE(consultant_id, heuristic) 폴백(Q3=영구).
--   결정문이 SSOT·later·canonical CONSULT 회신 → sy5d 핸드오프 REPLY를 supersede. 본 마이그가 정합 수렴.
--
-- dry-run(무영속) 산출 — 20260719100000_..._reconcile.dryrun.mjs PASS:
--   ① total=141 / (사전)filled=119 / null=22
--   ② 결정적링크 fact 대상 = 1건 (pkg 9155d158)
--      ★ 현재 컬럼=김민경(heuristic 오귀속) → det=김주연(check_ins.package_id 실결속=사실)으로 정정.
--        (heuristic 이 실제로 2,960,000원 패키지를 오귀속했음을 결정적 링크가 증명 — 정밀화 이득)
--   ③ 최종 NULL-유지 = 140건 (heuristic-launder 118건 revert + 기존 잔차 22건) — 강제귀속 금지, read-time 폴백.
--   [freeze] revert-set=118건(113,234,000원), det-fix=1건. 판정근거 스냅샷 동봉(reconcile.freeze.json).
--
-- ★ 종단상태: consultant_id = { 결정적 사실 1건 } ∪ { NULL 140건 }. populated⟺사실 불변식 회복.
--
-- 회귀 영향 = 0 (현재 live):
--   live foot_stats_consultant 는 아직 heuristic CTE 직접참조(Phase 2 RPC cutover 미배포).
--   컬럼을 읽는 prod read 경로 없음 → 컬럼 값 변경이 실장별 통계에 무영향(현재).
--   Phase 2 는 결정문 Q3 에 따라 COALESCE(consultant_id, heuristic) 로 설계돼야 하며(직접참조 아님),
--   그 경우 140 NULL 행은 read-time heuristic = 오늘과 동일, 1 fact 행만 오귀속(김민경)→사실(김주연) 정정.
--
-- 성격: data-only 정정(DDL 무변경). packages 컬럼/트리거/FK 불변. 원장(package_payments) 무접점.
--   멱등: 종단상태 재수렴 조건부 UPDATE (재실행 no-op). 대상셋 freeze 재검증 abort.
-- 롤백: 20260719100000_..._reconcile.rollback.sql (= 최초 heuristic 백필 재적용 = 직전상태 복원).
-- 표준: cross_crm_data_correction_backfill_sop / Migration Dry-Run No-Persistence Protocol.
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm). author: dev-foot / 2026-07-19
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $reconcile$
DECLARE
  v_clinic     uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브의원 서울오리진점 (foot active)
  v_det_target int;
  v_reverted   int;
  v_det_fixed  int;
  v_filled_post int;
  v_null_post   int;
BEGIN
  -- freeze 재검증: 결정적링크 대상 수(dry-run 확정=1). drift 시 abort(대상셋 변동 = 데이터 변화).
  SELECT COUNT(DISTINCT p.id) INTO v_det_target
    FROM packages p JOIN check_ins ci ON ci.package_id = p.id
   WHERE p.clinic_id = v_clinic AND ci.consultant_id IS NOT NULL;
  IF v_det_target <> 1 THEN
    RAISE EXCEPTION '[PKG-CONSULTANT-RECONCILE] ABORT: 결정적링크 대상수 drift (expected 1, got %) — dry-run freeze 재검증 실패', v_det_target;
  END IF;

  -- (1) heuristic-launder revert → NULL : 현재 filled 이나 결정적 링크가 없는 행(=heuristic 추측분).
  UPDATE packages p
     SET consultant_id = NULL
   WHERE p.clinic_id = v_clinic
     AND p.consultant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM check_ins ci
        WHERE ci.package_id = p.id AND ci.consultant_id IS NOT NULL
     );
  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  -- (2) 결정적 링크분 fact 확정 : check_ins.package_id 실결속의 consultant_id 로 UPDATE(멱등).
  WITH det AS (
    SELECT DISTINCT p.id AS package_id, ci.consultant_id AS det_consultant
    FROM packages p JOIN check_ins ci ON ci.package_id = p.id
    WHERE p.clinic_id = v_clinic AND ci.consultant_id IS NOT NULL
  )
  UPDATE packages p
     SET consultant_id = d.det_consultant
    FROM det d
   WHERE p.id = d.package_id
     AND p.clinic_id = v_clinic
     AND p.consultant_id IS DISTINCT FROM d.det_consultant;
  GET DIAGNOSTICS v_det_fixed = ROW_COUNT;

  -- 종단상태 검증
  SELECT COUNT(*) INTO v_filled_post FROM packages WHERE clinic_id = v_clinic AND consultant_id IS NOT NULL;
  SELECT COUNT(*) INTO v_null_post   FROM packages WHERE clinic_id = v_clinic AND consultant_id IS NULL;

  RAISE NOTICE '[PKG-CONSULTANT-RECONCILE] reverted→NULL=% | det-fixed=% | filled_post=% | null_post=%',
    v_reverted, v_det_fixed, v_filled_post, v_null_post;

  -- 정합 가드: 종단 filled 는 오직 결정적 링크분(=1)이어야 함.
  IF v_filled_post <> v_det_target THEN
    RAISE EXCEPTION '[PKG-CONSULTANT-RECONCILE] ABORT: filled_post(%) != 결정적링크(%) — 비결정 잔재/누락(정합붕괴)', v_filled_post, v_det_target;
  END IF;

  -- 정합 가드: filled 행 전부가 결정적 링크값과 일치해야 함(populated⟺사실 불변식).
  IF EXISTS (
    SELECT 1 FROM packages p
    WHERE p.clinic_id = v_clinic AND p.consultant_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.package_id = p.id AND ci.consultant_id = p.consultant_id
      )
  ) THEN
    RAISE EXCEPTION '[PKG-CONSULTANT-RECONCILE] ABORT: filled 행 중 결정적링크와 불일치 존재 — semantic 불변식 위반';
  END IF;
END;
$reconcile$;

NOTIFY pgrst, 'reload schema';

COMMIT;
