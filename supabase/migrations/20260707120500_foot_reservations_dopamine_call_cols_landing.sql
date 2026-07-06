-- T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING (part b)
-- 풋센터CRM prod reservations 에 도파민TM 콜 컬럼 3종 ADDITIVE 착지.
--
-- ── 배경 (DA CONSULT-REPLY 확정) ──────────────────────────────────────────────
--   DA-20260707-RESV-DOPAMINE-LANDING-TOPOLOGY (MSG-081145-8t3v):
--     · topology Q1 = (b) CRM별 물리 분리 확정 (reservations = 5 물리 포크).
--       "공유" = schema 계약 공유 ≠ 단일 물리 테이블. foot prod 컬럼 부재 = AC6 미실행 = 정상.
--     · Q2 착지 주체 = dev-foot 자기 ADDITIVE + supervisor DDL-diff (dopamine cross-project write 금지).
--   부모: T-20260521-ops-CROSSPRODUCT-V1-GATE AC6 (§3 = A ADDITIVE).
--   타입 근거 = dopamine IMPL 20260707120500_reservations_dopamine_call_cols.sql
--     (schema 계약 parity 위해 동일 version·동일 타입으로 자기 CRM prod 에 착지).
--
-- ── 소유권 ────────────────────────────────────────────────────────────────────
--   3컬럼 write 주체 = 도파민TM(발원→콜백이 자기 DB 에 기록) + no_show 는 CRM UI→lifecycle-callback §6-6.
--   풋센터CRM FE = read-only (sibling part a READ, 9bf7538c 旣배포). 이 필드에 역write 금지.
--
-- ── 게이트 ────────────────────────────────────────────────────────────────────
--   autonomy §3.1: ADDITIVE → 대표 게이트 면제. DA CONSULT-REPLY GO + supervisor DDL-diff 후 적용.
--   ADD COLUMN IF NOT EXISTS = 멱등(재실행 안전). 상수 DEFAULT → PG11+ 메타데이터-only (테이블 rewrite/lock 없음).
--   회귀 0 · 롤백 DROP COLUMN 무손실(schema 원복, 축적 콜마킹만 소실 — 롤백 파일 주석 참조).

BEGIN;

-- 1) 예방콜(내원 전 리마인드 콜) 완료 여부 — 도파민TM write, 풋 read-only.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS prevention_call_done boolean DEFAULT false;

-- 2) 취소콜(취소 예약 사후 콜) 완료 여부 — 도파민TM write, 풋 read-only.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS cancellation_call_done boolean DEFAULT false;

-- 3) 노쇼 클릭 처리 시각 — CRM UI→crm-lifecycle-callback §6-6 write, 풋 read-only. nullable(미처리=NULL).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS no_show_clicked_at timestamptz;

COMMENT ON COLUMN public.reservations.prevention_call_done IS
  '도파민TM: 예방콜(내원 전 리마인드 콜) 완료 여부. 소유=도파민TM(write), 풋=read-only. T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING';
COMMENT ON COLUMN public.reservations.cancellation_call_done IS
  '도파민TM: 취소콜(취소 예약 사후 콜) 완료 여부. 소유=도파민TM(write), 풋=read-only. T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING';
COMMENT ON COLUMN public.reservations.no_show_clicked_at IS
  '노쇼 클릭 처리 시각(timestamptz, nullable). CRM UI→crm-lifecycle-callback §6-6 write, 풋 read-only. T-20260707-foot-RESERVATIONS-DOPAMINE-COLS-LANDING';

COMMIT;
