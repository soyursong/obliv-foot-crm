-- ============================================================
-- ROLLBACK: T-20260610-foot-SMS-DISPLAYNAME-SPLIT (옵션B)
-- 문자 발송용 지점 표시명 컬럼 + 전용 RPC 제거.
--
-- 안전성: sms_display_name 은 nullable·fallback 설계라 제거해도
--   세 치환 경로(수동SMS·템플릿미리보기·자동발송EF)는 clinics.name 으로
--   복귀(현행 동작). 데이터 손실 영향은 sms_display_name 설정값에 한함.
-- ============================================================

DROP FUNCTION IF EXISTS public.admin_set_sms_display_name(UUID, TEXT);

ALTER TABLE public.clinic_messaging_capability
  DROP COLUMN IF EXISTS sms_display_name;
