-- ============================================================
-- DATAFIX (분리) — reservations.is_healer_intent backfill
-- 원천: 20260614130000_reservation_is_healer_intent.sql 에서 분리됨.
-- ============================================================
-- ★ 본 파일은 데이터변경(UPDATE)이다 — AC-3 경계.
--   T-20260615-foot-PROD-MIGRATION-PARITY-AUDIT 배치에서 적용 금지.
--   별도 datafix 티켓(planner 발번 예정)으로 supervisor/planner 게이트 경유 후에만 실행.
--
-- 전제: is_healer_intent 컬럼이 prod 에 이미 존재(#7 컬럼 ADD 선적용)해야 함.
-- 의미: 아직 소모 안 된 힐러 예약(healer_flag=true)의 의도를 영속 컬럼에 승계.
-- 영향 행수는 적용 전 SELECT count(*) ... WHERE healer_flag=true 로 사전 측정 권고.
-- ============================================================

UPDATE public.reservations
  SET is_healer_intent = true
  WHERE healer_flag = true
    AND is_healer_intent IS DISTINCT FROM true;
