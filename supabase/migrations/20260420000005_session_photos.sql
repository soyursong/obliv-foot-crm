-- #37 treatment_memo 구조
-- 원칙: 다회차(패키지) = package_sessions에 회차별 row, 단건/체험 = check_ins.treatment_memo JSONB
-- photos는 Storage 경로 배열 (photos 버킷)
-- 과거 회차 펼쳐보기 UI: 패키지 탭에서 package_sessions 목록 렌더

ALTER TABLE package_sessions
  ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS service_type TEXT;
  -- service_type 예: 'preconditioning' | 'laser_heated' | 'laser_unheated_combo' | 'laser_HC' | 'laser_AF' | 'laser_IV'

-- check_ins.treatment_memo JSONB 컨벤션 (단건/체험용, 앱 레이어에서 강제):
-- {
--   "memo": "텍스트",
--   "photos": ["photos/cust_xxx/ci_yyy/before_..."],
--   "duration_min": 18,
--   "staff_id": "uuid",
--   "staff_name": "김치료사",
--   "service_type": "laser_heated"
-- }
