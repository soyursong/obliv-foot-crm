-- ============================================================
-- T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-5) — 노쇼/취소 경과지 자동 소프트삭제 §6 배선
--   ★FIX (2026-08-23, MSG-20260823-005741-mvl3 재-DDL-diff): DA C1/C2/C4/C6 위반 봉합.
--     C1/C2 = 삭제술어 reservation_id 등가 ONLY 재설계(날짜배치 sweep·visit_date/session_ordinal 제거).
--     C4    = SECDEF EXECUTE grant-seal(REVOKE PUBLIC + GRANT authenticated) 추가(anon 미도달).
--     C6    = 소프트삭제 건별 audit_log 1행 append 추가.
-- ============================================================
-- ⚠️⚠️ DRAFT — apply-BLOCKED. prod 선집행 절대 금지(apply_before_go 클래스). ⚠️⚠️
--   본 파일은 dev-foot 초안. prod apply 는 다음 3게이트 통과 後에만:
--     (1) data-architect CONSULT-REPLY GO  — §6 트리거 배선이 DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA
--         (부모 마이그 20260822010000, §6 "노쇼 자동폐기 = 스키마 GO ∧ reporter confirm 後 별도 마이그" 명시)의
--         삭제 술어(불변·fail-closed·reservation_id ONLY)와 정합함을 재확인.
--         ★삭제술어/mechanism 변경(배치 sweep → reservation_id[] 등가)이므로 planner 가 DA 재-CONSULT 필요 여부 판단.
--     (2) reporter(문지은 대표원장) confirm — 자동폐기 실배선 동의(파괴성 액션 = 명시 confirm 필요).
--     (3) supervisor DDL-diff + 롤백 SQL 확인 + 물리 GO-token 발행.
--   'ADDITIVE' ≠ apply-gate 면제. GO-token 前 prod 선집행 금지.
--
-- change-class = ADDITIVE (신규 함수 1 · DROP/타입변경/소급변형 0). 부모 스키마(slips/images soft-delete 컬럼)는 이미 prod-applied.
-- 멱등: CREATE OR REPLACE. 롤백: 20260823010000_foot_progress_result_noshow_softdelete.rollback.sql
--
-- ── 설계(DA 술어 그대로 · AC-5 · C1~C6 정합) ──────────────────────────────
--   트리거 방식 = SECURITY DEFINER RPC(자동 cron 아님). '일과 마감' 시 FE(원장 세션)가 호출.
--   ★candidate 선별(어떤 예약이 노쇼 대상인가 = 날짜·도래회차%interval)은 FE(트리거 계기)로 이관.
--     FE 가 DUE-CYCLE-CONFIGURABLE 설정값으로 '당일 도래회차 미체크인' 예약을 골라 p_reservation_ids 로 전달.
--     → RPC 는 어떤 날짜/회차 술어도 갖지 않는다(C2 date-conjunct 금지 · C3 hardcode 6 금지 — RPC 에 interval 로직 부재).
--   삭제 술어(불변·fail-closed·reservation_id 등가 ONLY. 이름·날짜·회차 술어 금지) = 부모 Q2-4 4-conjunct verbatim:
--     #1 slips.reservation_id = ANY(p_reservation_ids)   (reservation_id 등가 — 유일 selector)
--     #2 slip.state <> 'confirmed'                        (확정 건 삭제 금지)
--     #3 NOT EXISTS(체크인 예약)                          (미체크인 = 취소/노쇼/미방문)
--     #4 image.deleted_at IS NULL                         (활성 이미지만)
--   동작: 이미지 soft-delete(deleted_at=now, delete_reason) + slip.state → pending_extract revert(≠delete, slip durable).
--   감사(C6): 소프트삭제 건별 progress_analysis_slips_audit_log 1행 append(actor=auth.uid()·ts·old/new·reservation_id).
--   하드삭제 금지(부모 BEFORE DELETE 가드) · 체크인/확정(slip confirmed) 건 삭제 금지(술어로 차단).
--   7일 휴지통 = 조회필터(display window) — 자동 하드퍼지 없음(부모 §Q2-3, CEO/legal 별건).
--   권한: is_admin_or_manager(admin/manager/director) in-body 게이트 + SECDEF EXECUTE grant-seal(C4, anon 미도달).
--     clinic 경계는 부모 pas_clinic_gate 설계(is_admin_or_manager 는 clinic bypass)와 정합 — 별도 clinic conjunct 불요.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.foot_progress_noshow_softdelete(
  p_reservation_ids uuid[]
)
RETURNS TABLE (reservation_id uuid, slip_id uuid, image_id uuid, chart_no text, session_ordinal integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  -- 권한 게이트: admin/manager/director 만(부모 RLS tier 정합). SECDEF 우회 방지.
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION '권한 없음: 경과지 자동 소프트삭제는 관리자/원장만 실행할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 빈 입력 = no-op(candidate 0건). NULL/빈배열 방어.
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH target_slips AS (
    -- 삭제 대상 slip = reservation_id 등가 ONLY(C1/C2). 날짜·회차 술어 없음.
    SELECT s.id AS slip_id, s.reservation_id, s.chart_no, s.session_ordinal, s.clinic_id
    FROM public.progress_analysis_slips s
    WHERE s.reservation_id = ANY(p_reservation_ids)      -- #1 reservation_id 등가(유일 selector)
      AND s.state <> 'confirmed'                         -- #2 확정 건 삭제 금지
      AND NOT EXISTS (                                   -- #3 체크인 예약 삭제 금지(미체크인=취소/노쇼/미방문)
        SELECT 1 FROM public.reservations r
        WHERE r.id = s.reservation_id AND r.status = 'checked_in'
      )
  ),
  softdel AS (
    UPDATE public.progress_result_images i
    SET deleted_at = now(),
        deleted_by = v_actor,
        delete_reason = '노쇼/취소 자동 소프트삭제(도래 회차 미체크인 · AC-5)'
    FROM target_slips t
    WHERE i.slip_id = t.slip_id
      AND i.deleted_at IS NULL                           -- #4 활성 이미지만
    RETURNING i.id AS image_id, i.slip_id
  ),
  revert AS (
    -- 이미지 soft-delete 된 슬립만 pending_extract 로 revert(≠delete, durable).
    UPDATE public.progress_analysis_slips s
    SET state = 'pending_extract'
    WHERE s.id IN (SELECT DISTINCT slip_id FROM softdel)
      AND s.state = 'awaiting_upload'
    RETURNING s.id
  ),
  audit AS (
    -- C6: 소프트삭제 건별 감사 1행 append(actor·ts·old/new·reservation_id). image soft-delete 는 부모 트리거 미포착 → 명시 기록.
    INSERT INTO public.progress_analysis_slips_audit_log (slip_id, clinic_id, operation, old_data, new_data, actor)
    SELECT t.slip_id, t.clinic_id, 'UPDATE',
           jsonb_build_object(
             'event', 'noshow_softdelete',
             'reservation_id', t.reservation_id,
             'image_id', d.image_id,
             'image_deleted', false
           ),
           jsonb_build_object(
             'event', 'noshow_softdelete',
             'reservation_id', t.reservation_id,
             'image_id', d.image_id,
             'image_deleted', true,
             'delete_reason', '노쇼/취소 자동 소프트삭제(도래 회차 미체크인 · AC-5)',
             'deleted_by', v_actor
           ),
           v_actor
    FROM softdel d
    JOIN target_slips t ON t.slip_id = d.slip_id
    RETURNING 1
  )
  SELECT t.reservation_id, t.slip_id, d.image_id, t.chart_no, t.session_ordinal
  FROM softdel d
  JOIN target_slips t ON t.slip_id = d.slip_id;
END;
$$;

COMMENT ON FUNCTION public.foot_progress_noshow_softdelete(uuid[]) IS
  'AC-5 노쇼/취소 경과지 자동 소프트삭제(일과 마감 FE 호출). 삭제술어=fail-closed reservation_id 등가 ONLY(날짜·회차·이름 술어 금지, candidate 선별은 FE 이관). 이미지 soft-delete + slip pending_extract revert + audit 1행 append. 하드삭제·체크인·확정건 금지. SECDEF+is_admin_or_manager 게이트+EXECUTE grant-seal(anon 미도달). DA-20260822-foot-PROGANALYSIS-SLIP-SCHEMA §6.';

-- C4: SECDEF EXECUTE grant-seal — 기본 PUBLIC EXECUTE 제거 → authenticated 만(anon 미도달·방어심층 §15-5-10/C23).
REVOKE ALL ON FUNCTION public.foot_progress_noshow_softdelete(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.foot_progress_noshow_softdelete(uuid[]) TO authenticated;

-- 검증(마이그 자체 유효성 self-check).
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'foot_progress_noshow_softdelete'
      AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'AC-5 §6 위반: foot_progress_noshow_softdelete 함수 생성 실패';
  END IF;

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
    WHERE proname='foot_progress_noshow_softdelete' AND pronamespace='public'::regnamespace;

  -- C1: reservation_id 등가 술어 실재
  IF v_def NOT ILIKE '%reservation_id = ANY(p_reservation_ids)%' THEN
    RAISE EXCEPTION 'C1 위반: 삭제술어 reservation_id 등가 conjunct 부재'; END IF;
  -- C2: date-conjunct 부재(visit_date/p_interval 는 삭제술어·시그니처 어디에도 없어야 함. session_ordinal 은 RETURN 컬럼으로만 허용)
  IF v_def ILIKE '%visit_date%' THEN
    RAISE EXCEPTION 'C2 위반: 삭제술어/시그니처에 visit_date(date 추측 술어) 잔존'; END IF;
  IF v_def ILIKE '%p_interval%' OR v_def ILIKE '%p_visit_date%' THEN
    RAISE EXCEPTION 'C2/C3 위반: 날짜/회차 파라미터(p_visit_date·p_interval) 잔존 — candidate 선별은 FE 이관'; END IF;

  -- C4: EXECUTE grant-seal(PUBLIC 미도달)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname='foot_progress_noshow_softdelete' AND p.pronamespace='public'::regnamespace
      AND has_function_privilege('public', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'C4 위반: PUBLIC EXECUTE 권한 잔존(anon 도달 surface)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname='foot_progress_noshow_softdelete' AND p.pronamespace='public'::regnamespace
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'C4 위반: authenticated EXECUTE grant 부재'; END IF;

  -- C6: 감사 append 실재
  IF v_def NOT ILIKE '%INSERT INTO public.progress_analysis_slips_audit_log%' THEN
    RAISE EXCEPTION 'C6 위반: 소프트삭제 감사 append 부재'; END IF;

  RAISE NOTICE 'T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK AC-5 §6: 검증 통과 (C1/C2 reservation_id 등가 ONLY · C4 grant-seal · C6 audit append · slip revert · 하드삭제 금지)';
END $$;

COMMIT;
