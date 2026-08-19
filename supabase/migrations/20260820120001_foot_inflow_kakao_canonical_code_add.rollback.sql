-- ROLLBACK: T-20260819-foot-INFLOW-KAKAO-CANONICAL-CODE-ADD (되돌림)
-- system_codes 의 inbound.kakao 1행만 DELETE = 신규 canonical 코드 제거.
--   · 기존 11코드(inbound.walkin ... internal.staff) 무접촉.
--   · ⚠ forward-only 원칙상 통상 롤백 불필요(신규 코드는 하류 무참조 — 미선택이면 아무 데이터도 안 쌓임).
--   · 롤백 전 이미 inbound.kakao 로 write 된 신규 예약/고객 행이 있으면 그 값은 잔존한다(FK 없음).
--       코드 목록에서만 사라짐 → 향후 라벨 미매핑 시 legacy 사슬(source_ref)로 graceful fall-through.
--       필요 시 별도 데이터 정정(SOP)으로 처리 — 본 롤백은 코드 시드만 원복.
--
-- 적용: supabase db push --file supabase/migrations/20260820120001_foot_inflow_kakao_canonical_code_add.rollback.sql

BEGIN;

DELETE FROM public.system_codes
 WHERE code_type = 'inflow_channel'
   AND code = 'inbound.kakao';

-- 방어 확인: 기존 11코드 존치
DO $chk$
DECLARE v_rest integer;
BEGIN
  SELECT count(*) INTO v_rest FROM public.system_codes
    WHERE code_type = 'inflow_channel' AND code <> 'inbound.kakao';
  IF v_rest <> 11 THEN
    RAISE EXCEPTION 'ROLLBACK 가드 실패: 기존 inflow_channel 코드가 11개가 아님(실제=%)', v_rest;
  END IF;
END $chk$;

NOTIFY pgrst, 'reload schema';

COMMIT;
