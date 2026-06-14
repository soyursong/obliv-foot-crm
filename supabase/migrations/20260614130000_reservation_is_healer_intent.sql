-- T-20260614-foot-HEALER-RESV-CLASSIFY-DEF (Option A 확정 — 김주연 총괄 2026-06-14)
-- reservations 에 '힐러 의도' 영속 컬럼(is_healer_intent) 신설.
--   · 기존 healer_flag(1회성 — 체크인 시 Dashboard HL-blink 후 소모)와 분리.
--   · is_healer_intent 는 캘린더 직접예약·체크인 이후에도 유지되는 분류 SSOT.
--   · '힐러 N건(HL N)' 칩 / resvKind 분류는 (is_healer_intent OR healer_flag) 기준.
-- ADDITIVE: 신규 컬럼 추가 + 기존값 보존 backfill. 파괴적 변경 없음.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservations.is_healer_intent IS
  '힐러 의도(영속) — 예약 팝업 힐러 ON/OFF 토글로 설정. 체크인 후에도 유지되는 힐러 분류 SSOT. healer_flag(1회성 HL-blink 소모)와 분리.';

-- backfill: 현재 healer_flag=true(아직 소모 안 된 힐러 예약)는 의도가 명확 → 영속 컬럼에 승계.
UPDATE public.reservations
  SET is_healer_intent = true
  WHERE healer_flag = true
    AND is_healer_intent IS DISTINCT FROM true;
