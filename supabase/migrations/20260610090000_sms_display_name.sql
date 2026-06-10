-- ============================================================
-- T-20260610-foot-SMS-DISPLAYNAME-SPLIT (옵션B)
-- 문자 발송용 지점 표시명을 법정 의료서식(clinics.name)과 분리.
--
-- 배경: clinics.name = 17종 법정 의료서식(진단서·처방전·진료비영수증·
--   납입증명서 등) 전용 불변 컬럼. SMS 템플릿 {지점명} 치환에 그대로 쓰면
--   "[오블리브 오블리브의원 서울 오리진점점]" 처럼 깨짐.
--   → 문자 전용 표시명을 별도 컬럼으로 분리(null이면 clinics.name fallback).
--
-- 설계: nullable + fallback → 기존 행 backfill 불요(미설정 지점은 현행 동작 유지).
-- 거처: clinic_messaging_capability (지점별 메시징 설정 테이블, sender_number와 동거).
--
-- ⚠️ supervisor DB 게이트 제출용 — dev-foot 자가 실행 금지.
-- ============================================================

-- ── AC-0: 문자 발송용 지점 표시명 컬럼 ───────────────────────
ALTER TABLE public.clinic_messaging_capability
  ADD COLUMN IF NOT EXISTS sms_display_name VARCHAR(100) NULL;

COMMENT ON COLUMN public.clinic_messaging_capability.sms_display_name IS
  'T-20260610-foot-SMS-DISPLAYNAME-SPLIT: SMS 템플릿 {지점명} 치환 전용 표시명. '
  'NULL이면 clinics.name 으로 fallback. clinics.name = 법정 의료서식 전용 불변(미변경).';

-- ── AC-4: 문자용 지점명 저장 전용 RPC (additive, 기존 RPC 시그니처 무변경) ──
-- admin 전용. 빈 문자열/공백 → NULL(= clinics.name fallback).
-- 기존 admin_save_messaging_config 를 건드리지 않기 위해 분리한 추가형 함수.
CREATE OR REPLACE FUNCTION public.admin_set_sms_display_name(
  p_clinic_id        UUID,
  p_sms_display_name TEXT DEFAULT NULL  -- NULL/빈값 = clinics.name fallback
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role  TEXT;
  v_clean TEXT;
BEGIN
  -- ── 권한 체크: admin only ─────────────────────────────────
  v_role := public.get_user_role();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_set_sms_display_name: role=% — admin 전용 함수입니다', COALESCE(v_role, 'NULL');
  END IF;

  -- 공백 trim → 빈 문자열은 NULL(fallback)
  v_clean := NULLIF(TRIM(COALESCE(p_sms_display_name, '')), '');

  -- clinic_messaging_capability 행이 없을 수도 있으므로 upsert.
  INSERT INTO public.clinic_messaging_capability (clinic_id, sms_display_name)
  VALUES (p_clinic_id, v_clean)
  ON CONFLICT (clinic_id) DO UPDATE SET
    sms_display_name = v_clean,
    updated_at       = now();

  RAISE LOG 'admin_set_sms_display_name: clinic=% display=%', p_clinic_id, v_clean;

  RETURN jsonb_build_object(
    'success',          TRUE,
    'sms_display_name', v_clean
  );
END;
$$;

COMMENT ON FUNCTION public.admin_set_sms_display_name(UUID, TEXT) IS
  'T-20260610-foot-SMS-DISPLAYNAME-SPLIT: 문자 발송용 지점 표시명 저장. admin 전용. '
  '빈값=NULL=clinics.name fallback.';
