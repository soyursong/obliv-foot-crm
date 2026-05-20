-- T-20260520-foot-RESERVATIONS-READ-API-EF (TD2) — AC-5
-- reservations 조회 효율화 인덱스
--
-- reservations-read-api EF가 clinic_id + reservation_date 기준으로 조회하므로
-- 복합 인덱스 생성 (clinic_slug 컬럼 없음 — clinic_id FK 기준)
--
-- 롤백: 20260521060000_reservations_read_api_index.down.sql

BEGIN;

-- Read API 조회 복합 인덱스
-- 조회 패턴: clinic_id = ? AND reservation_date BETWEEN ? AND ?  ORDER BY reservation_date DESC
CREATE INDEX IF NOT EXISTS idx_reservations_clinic_date_desc
  ON public.reservations(clinic_id, reservation_date DESC, reservation_time DESC)
  WHERE clinic_id IS NOT NULL;

COMMENT ON INDEX idx_reservations_clinic_date_desc IS
  'reservations-read-api EF 조회 최적화 — clinic_id + 날짜 내림차순. T-20260520-foot-RESERVATIONS-READ-API-EF AC-5';

COMMIT;
