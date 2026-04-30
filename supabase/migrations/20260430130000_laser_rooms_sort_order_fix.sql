-- T-20260430-foot-LASER-ROOM-REORDER
-- 레이저실 sort_order를 치료실 sort_order보다 큰 값으로 보정
-- 현상: 일부 레이저실 룸이 치료실 룸보다 낮은 sort_order를 가져
--       sort_order 기반 정렬 시 레이저실이 치료실 위에 표시됨
--
-- 해결: 레이저실 sort_order를 100 이상으로, 치료실은 1~99 범위로 정규화
-- 리스크: 0/5 — UI 표시 순서만 변경, 스키마 변경 없음

-- 치료실: sort_order 10, 20, 30, ... (name 순)
WITH ranked_treatment AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY clinic_id ORDER BY name) AS rn
  FROM rooms
  WHERE room_type = 'treatment' AND active = true
)
UPDATE rooms r
SET sort_order = rt.rn * 10
FROM ranked_treatment rt
WHERE r.id = rt.id;

-- 레이저실: sort_order 110, 120, 130, ... (name 순) — 치료실(max ~90)보다 확실히 큰 값
WITH ranked_laser AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY clinic_id ORDER BY name) AS rn
  FROM rooms
  WHERE room_type = 'laser' AND active = true
)
UPDATE rooms r
SET sort_order = 100 + (rl.rn * 10)
FROM ranked_laser rl
WHERE r.id = rl.id;

-- 상담실: sort_order 210, 220, ... (name 순)
WITH ranked_consultation AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY clinic_id ORDER BY name) AS rn
  FROM rooms
  WHERE room_type = 'consultation' AND active = true
)
UPDATE rooms r
SET sort_order = 200 + (rc.rn * 10)
FROM ranked_consultation rc
WHERE r.id = rc.id;

-- 원장실: sort_order 310, 320, ...
WITH ranked_examination AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY clinic_id ORDER BY name) AS rn
  FROM rooms
  WHERE room_type = 'examination' AND active = true
)
UPDATE rooms r
SET sort_order = 300 + (re.rn * 10)
FROM ranked_examination re
WHERE r.id = re.id;
