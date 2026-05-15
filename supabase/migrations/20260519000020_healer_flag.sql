-- T-20260516-foot-HEALER-RESV-BTN
-- reservations 테이블에 힐러예약 플래그 추가
-- 치료사가 [힐러예약] 버튼 클릭 시 다음 예약에 플래그 설정 → 예약 당일 대시보드 자동 HL(노랑) 표시 후 소모

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS healer_flag boolean DEFAULT false;

COMMENT ON COLUMN public.reservations.healer_flag IS '힐러예약 플래그 — 치료사 수동 설정, 예약 당일 대시보드 HL(노랑) 자동 표시 후 false로 리셋 (1회성)';
