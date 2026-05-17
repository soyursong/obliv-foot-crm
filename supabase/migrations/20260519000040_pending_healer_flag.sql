-- T-20260516-foot-HEALER-RESV-BTN v2 — customers.pending_healer_flag 추가
-- 이전 마이그레이션(20260517000050) 이력 불일치로 재적용
-- IF NOT EXISTS 보장으로 중복 실행 안전

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pending_healer_flag boolean DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_description
    JOIN pg_class ON pg_description.objoid = pg_class.oid
    JOIN pg_attribute ON pg_attribute.attrelid = pg_class.oid AND pg_attribute.attnum = pg_description.objsubid
    WHERE pg_class.relname = 'customers'
      AND pg_attribute.attname = 'pending_healer_flag'
  ) THEN
    COMMENT ON COLUMN public.customers.pending_healer_flag IS '힐러 대기 플래그 — 다음 예약 없을 때 치료사가 설정. 예약 생성 시 healer_flag=true 자동 적용 후 false 리셋 (1회성)';
  END IF;
END $$;
