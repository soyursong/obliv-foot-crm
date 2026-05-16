-- T-20260516-foot-HEALER-RESV-BTN v2
-- customers 테이블에 힐러 대기 플래그 추가
-- 다음 예약 없을 때 [힐러예약 후 차감] 클릭 → pending_healer_flag = true 저장
-- 예약 생성 시 pending_healer_flag = true → 신규 예약 healer_flag = true 자동 설정 후 1회 소모(false 리셋)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS pending_healer_flag boolean DEFAULT false;

COMMENT ON COLUMN public.customers.pending_healer_flag IS '힐러 대기 플래그 — 다음 예약 없을 때 치료사가 설정. 예약 생성 시 healer_flag=true 자동 적용 후 false 리셋 (1회성)';
