-- ════════════════════════════════════════════════════════════════════════════
-- T-20260717-foot-PKG-CONSULTANT-ID-ATTR-CAPTURE  (P2, foot) — [PHASE 1 : 백필]
-- 기존 packages.consultant_id 백필 = 부모 RPC heuristic(pkg_attr 시간정렬) 스냅샷.
--
-- 선행: 20260718240000_foot_pkg_consultant_id_capture.sql (컬럼+트리거) 적용 완료.
-- DA CONSULT-REPLY §3 (AC-C):
--   · 근거소스 = 부모 배포본 pkg_attr CTE(동일고객 ticketed 상담 中 created_at 최근접,
--     DISTINCT ON(package_id)). 현행 stats 출력의 진실 → 컬럼 초기값을 여기에 정렬 → cutover 회귀 0.
--   · NULL 잔차(ticketed 상담이력 전무 고객의 패키지) = NULL 유지(강제귀속 금지, BINDING-3 계승) — 계측.
--   · dry-run 무영속 필수(20260718241000_..._backfill.dryrun.mjs = txn-strip 아닌 inline SELECT 재현 + pre/post-probe).
--   · 대상셋 freeze + 재검증. cross_crm_data_correction_backfill_sop 준수.
--
-- 성격: 전량 NULL → fill (overwrite 아님). 파괴성 낮음. 원장(package_payments) 무접점.
--   멱등: WHERE p.consultant_id IS NULL (트리거로 이미 채워진 신규분 무접촉·재실행 no-op).
--   강제귀속 금지: pa.consultant_id IS NOT NULL 인 행만 UPDATE (heuristic NULL → 컬럼 NULL 유지).
-- 롤백: 20260718241000_foot_pkg_consultant_id_backfill.rollback.sql (= 백필분 → NULL 복원).
--   ※ 트리거 신규분(백필 이후 생성)과 구분 위해 롤백은 "백필 실행 시각 이전 created_at" 조건 사용.
-- author: dev-foot / 2026-07-18
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $backfill$
DECLARE
  v_clinic   uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';  -- 오블리브의원 서울오리진점 (foot active)
  v_null_pre  int;
  v_updated   int;
  v_null_post int;
  v_resid     int;
BEGIN
  -- freeze 스냅샷: 백필 前 NULL 행 수(트리거 배포 직후이므로 사실상 전량 NULL 예상).
  SELECT COUNT(*) INTO v_null_pre
    FROM packages WHERE clinic_id = v_clinic AND consultant_id IS NULL;

  -- heuristic 스냅샷 UPDATE (pkg_attr 동형). fill-from-NULL, 강제귀속 금지.
  WITH ticketed_all AS (
    SELECT DISTINCT ci.id AS check_in_id, ci.consultant_id, ci.customer_id, ci.checked_in_at
    FROM check_ins ci
    JOIN status_transitions st ON st.check_in_id = ci.id
    WHERE ci.clinic_id = v_clinic
      AND ci.consultant_id IS NOT NULL
      AND st.to_status = 'consultation'
  ),
  pkg_attr AS (
    SELECT DISTINCT ON (p.id) p.id AS package_id, ta.consultant_id
    FROM packages p
    JOIN ticketed_all ta ON ta.customer_id = p.customer_id
    WHERE p.clinic_id = v_clinic
    ORDER BY
      p.id,
      (ta.checked_in_at <= p.created_at) DESC,
      ABS(EXTRACT(EPOCH FROM (p.created_at - ta.checked_in_at))) ASC,
      ta.check_in_id
  )
  UPDATE packages p
     SET consultant_id = pa.consultant_id
    FROM pkg_attr pa
   WHERE p.id = pa.package_id
     AND p.clinic_id = v_clinic
     AND p.consultant_id IS NULL          -- 멱등: 이미 채워진 행 무접촉
     AND pa.consultant_id IS NOT NULL;    -- 강제귀속 금지: heuristic NULL → 컬럼 NULL 유지
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*) INTO v_null_post
    FROM packages WHERE clinic_id = v_clinic AND consultant_id IS NULL;

  -- NULL 잔차(귀속불가) = 고객이 전기간 ticketed 상담이력 전무 → NULL 유지(계측).
  SELECT COUNT(*) INTO v_resid
    FROM packages p
   WHERE p.clinic_id = v_clinic
     AND p.consultant_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM check_ins ci
       JOIN status_transitions st ON st.check_in_id = ci.id
       WHERE ci.clinic_id = v_clinic
         AND ci.customer_id = p.customer_id
         AND ci.consultant_id IS NOT NULL
         AND st.to_status = 'consultation'
     );

  RAISE NOTICE '[PKG-CONSULTANT-BACKFILL] clinic=% | NULL_pre=% | updated=% | NULL_post=% | 잔차(귀속불가)=%',
    v_clinic, v_null_pre, v_updated, v_null_post, v_resid;

  -- 정합 가드: NULL_post 는 오직 "귀속불가 잔차"여야 함(heuristic 이 값을 줬는데 NULL 남으면 버그).
  IF v_null_post <> v_resid THEN
    RAISE EXCEPTION '[PKG-CONSULTANT-BACKFILL] ABORT: NULL_post(%) != 귀속불가잔차(%) — heuristic 값 존재분이 미반영(정합붕괴)', v_null_post, v_resid;
  END IF;
END;
$backfill$;

NOTIFY pgrst, 'reload schema';

COMMIT;
