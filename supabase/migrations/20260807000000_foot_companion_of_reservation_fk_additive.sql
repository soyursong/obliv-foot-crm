-- T-20260806-dopamine-COMPANION-CHECKIN-FOOT-JONGNO-FIX
-- 동행 예약 승격(promotion) 방문관계 보존용 self-FK. scalp2 canonical(T-20260802) 포팅.
-- DA verdict A / change-class = ADDITIVE (DROP·타입변경·제약제거 0 · nullable · ON DELETE SET NULL · partial index).
--   → autonomy §3.1 대표게이트 면제. 잔여 게이트 = supervisor DDL-diff + MIG-GATE (+ PHI DB-GATE 권고).
-- 멱등(IF NOT EXISTS) · forward-only(기존 행 default NULL · backfill 0).
--
-- 관계: 동행 예약(customer_id 승격 대상)이 어느 본예약(메인 환자)의 동행인지 역참조.
--   populate = foot-local best-effort(같은 clinic/date 비동행 예약 정확 1건 이름매칭). 미해소 시 NULL(무해).
--   dopamine push 계약 무접촉(§9b CLEARED · MSG-20260806-182645-7w20).

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS companion_of_reservation_id uuid
    REFERENCES public.reservations(id) ON DELETE SET NULL;

-- 역참조(동행 목록·집계) 부분 인덱스 — non-null 만(대다수 비동행 NULL 구간 제외, 인덱스 슬림).
CREATE INDEX IF NOT EXISTS idx_reservations_companion_of
  ON public.reservations(companion_of_reservation_id)
  WHERE companion_of_reservation_id IS NOT NULL;

COMMENT ON COLUMN public.reservations.companion_of_reservation_id IS
  'T-20260806 동행 승격: 이 동행 예약이 소속된 본예약(메인 환자) 예약 id. NULL=비동행 또는 앵커 미해소(best-effort). ON DELETE SET NULL.';
