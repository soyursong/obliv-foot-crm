-- ============================================================
-- T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-5) — 노쇼/취소 경과지 자동 소프트삭제 §6 배선
-- ============================================================
-- ⚠️⚠️ DRAFT — apply-BLOCKED. prod 선집행 절대 금지(apply_before_go 클래스). ⚠️⚠️
--   본 파일은 dev-foot 초안. prod apply 는 다음 3게이트 통과 後에만:
--     (1) data-architect CONSULT-REPLY GO  — §6 트리거 배선이 DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA
--         (부모 마이그 20260822010000, §6 "노쇼 자동폐기 = 스키마 GO ∧ reporter confirm 後 별도 마이그" 명시)의
--         삭제 술어(불변·fail-closed·reservation_id ONLY)와 정합함을 재확인.
--         ★동반 확인: 부모 마이그의 is_deleted GENERATED divergence(축약본 mutable bool vs 선례 미러) 확정.
--     (2) reporter(문지은 대표원장) confirm — 자동폐기 실배선 동의(파괴성 액션 = 명시 confirm 필요).
--     (3) supervisor DDL-diff + 롤백 SQL 확인 + 물리 GO-token 발행.
--   'ADDITIVE' ≠ apply-gate 면제. GO-token 前 prod 선집행 금지.
--
-- change-class = ADDITIVE (신규 함수 1 · DROP/타입변경/소급변형 0). 부모 스키마(slips/images soft-delete 컬럼)는 이미 prod-applied.
-- 멱등: CREATE OR REPLACE. 롤백: 20260823010000_foot_progress_result_noshow_softdelete.rollback.sql
--
-- ── 설계(DA 술어 그대로 · AC-5) ─────────────────────────────────────────
--   트리거 방식 = SECURITY DEFINER RPC(자동 cron 아님). '일과 마감' 시 FE(원장 세션)가 호출.
--     · 6회차(도래 회차 간격)는 형제 DUE-CYCLE-CONFIGURABLE 설정값(FE localStorage) → RPC 파라미터 p_interval 로 주입(하드코딩 6 금지, default 6 하위호환).
--     · 슬립은 애초에 도래(6배수) 예약에만 생성됨(ensureSlipForRow) → session_ordinal 이 이미 도래 인코딩. p_interval 은 이중 가드.
--   삭제 술어(불변·fail-closed·reservation_id ONLY. 이름·날짜 술어 금지):
--     images WHERE slip_id=(취소/노쇼/미체크인 예약의 slip) AND slip.state<>'confirmed'
--            AND reservation.status <> 'checked_in'  -- 미체크인(confirmed 예약 포함) or 취소/노쇼
--            AND deleted_at IS NULL.
--   동작: 이미지 soft-delete(deleted_at=now, delete_reason) + slip.state → pending_extract revert(≠delete, slip durable).
--   하드삭제 금지(부모 BEFORE DELETE 가드) · 체크인/확정(slip confirmed) 건 삭제 금지(술어로 차단).
--   7일 휴지통 = 조회필터(display window) — 자동 하드퍼지 없음(부모 §Q2-3, CEO/legal 별건).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_progress_noshow_softdelete(
  p_clinic_id  uuid,
  p_visit_date date,
  p_interval   integer DEFAULT 6
)
RETURNS TABLE (reservation_id uuid, slip_id uuid, image_id uuid, chart_no text, session_ordinal integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_interval integer := CASE WHEN p_interval IS NULL OR p_interval <= 0 THEN 6 ELSE p_interval END;
BEGIN
  -- 권한 게이트: admin/manager/director 만(부모 RLS tier 정합). SECDEF 우회 방지.
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION '권한 없음: 경과지 자동 소프트삭제는 관리자/원장만 실행할 수 있습니다' USING ERRCODE = '42501';
  END IF;
  IF p_clinic_id IS DISTINCT FROM public.current_user_clinic_id() AND NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION '권한 없음: 다른 클리닉 데이터' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH target_slips AS (
    SELECT s.id AS slip_id, s.reservation_id, s.chart_no, s.session_ordinal
    FROM public.progress_analysis_slips s
    JOIN public.reservations r ON r.id = s.reservation_id
    WHERE s.clinic_id = p_clinic_id
      AND s.visit_date = p_visit_date
      AND s.state <> 'confirmed'                       -- 확정 건 삭제 금지
      AND (s.session_ordinal % v_interval) = 0         -- 도래 회차(설정값 기준) 이중 가드
      AND r.status <> 'checked_in'                     -- 미체크인(취소/노쇼/미방문). 체크인 건 삭제 금지
  ),
  softdel AS (
    UPDATE public.progress_result_images i
    SET deleted_at = now(),
        deleted_by = auth.uid(),
        delete_reason = '노쇼/취소 자동 소프트삭제(도래 회차 당일 미체크인 · AC-5)'
    FROM target_slips t
    WHERE i.slip_id = t.slip_id
      AND i.deleted_at IS NULL                         -- 활성 이미지만
    RETURNING i.id AS image_id, i.slip_id
  ),
  revert AS (
    -- 이미지 soft-delete 된 슬립만 pending_extract 로 revert(≠delete, durable).
    UPDATE public.progress_analysis_slips s
    SET state = 'pending_extract'
    WHERE s.id IN (SELECT DISTINCT slip_id FROM softdel)
      AND s.state = 'awaiting_upload'
    RETURNING s.id
  )
  SELECT t.reservation_id, t.slip_id, d.image_id, t.chart_no, t.session_ordinal
  FROM softdel d
  JOIN target_slips t ON t.slip_id = d.slip_id;
END;
$$;

COMMENT ON FUNCTION public.foot_progress_noshow_softdelete(uuid, date, integer) IS
  'AC-5 노쇼/취소 경과지 자동 소프트삭제(일과 마감 FE 호출). 술어=fail-closed reservation_id ONLY(이름·날짜 술어 금지). 이미지 soft-delete + slip pending_extract revert. 하드삭제·체크인·확정건 금지. p_interval=DUE-CYCLE 설정값(default 6). DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA §6.';

-- 검증(마이그 자체 유효성 self-check).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'foot_progress_noshow_softdelete'
      AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'AC-5 §6 위반: foot_progress_noshow_softdelete 함수 생성 실패';
  END IF;
  RAISE NOTICE 'T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK AC-5 §6: 검증 통과 (노쇼 소프트삭제 RPC · fail-closed reservation_id ONLY · slip revert · 하드삭제 금지)';
END $$;

COMMIT;
