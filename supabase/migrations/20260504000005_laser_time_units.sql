-- T-20260502-foot-LASER-TIME-UNIT
-- 레이저 시간 단위를 clinics 테이블에 JSONB 컬럼으로 추가
-- 어드민이 [12, 15, 20, 30] 등 단위를 자유롭게 설정 가능

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS laser_time_units JSONB DEFAULT '[12, 15, 20, 30]'::jsonb;

-- 기존 클리닉 행 기본값 세팅 (NULL인 경우)
UPDATE clinics
  SET laser_time_units = '[12, 15, 20, 30]'::jsonb
  WHERE laser_time_units IS NULL;
