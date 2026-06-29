-- T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER
-- 자동배정 기본순번(round-robin) 영속 — staff.assign_sort_order 단일 ADDITIVE 컬럼.
--
-- 설계(dev-foot 판단):
--   Q1 연동방식 = Option B. 기존 월균등(AUTOASSIGN-BALANCE-TOSS) primary 유지,
--     기본순번은 pickLeastLoaded 3순위 tie-break(기존 random 대체). 비파괴 확장.
--   Q2 영속 = 기존 staff 구조 재사용(신규 테이블/enum/제약 없음). 순수 ADDITIVE nullable 컬럼.
--   Q3 매핑 = 상담 7(consultant)·치료 9(therapist) 표시명 → active staff. 서은정/박소예 비활성
--     중복 레코드는 active=true 조건으로 유일 해소.
--
--   autonomy §3.1: ADDITIVE → 대표 게이트 면제. data-architect CONSULT(ADDITIVE 확인) +
--   supervisor DDL-diff 후 적용. 멱등(IF NOT EXISTS / IS NULL 가드) — 재실행 안전.

-- 1) 컬럼 추가 (ADDITIVE · nullable · DEFAULT 없음 · backfill 불요)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS assign_sort_order INTEGER;

COMMENT ON COLUMN staff.assign_sort_order IS
  '자동배정 기본순번(round-robin). (clinic_id,role) 그룹 내 정렬 키(작을수록 우선). NULL=미지정(name 후순위+random). T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER';

-- 2) 초기 순번 seed (현장 확정 목록) — active staff, 동일 역할, 미지정(NULL)만 채움(멱등).
--    상담 파트(consultant): 김수린→송지현→엄경은→정연주→김지윤→이승은→김주연
UPDATE staff AS s
SET assign_sort_order = v.ord
FROM (VALUES
  ('김수린', 1), ('송지현', 2), ('엄경은', 3), ('정연주', 4),
  ('김지윤', 5), ('이승은', 6), ('김주연', 7)
) AS v(nm, ord)
WHERE s.name = v.nm
  AND s.role = 'consultant'
  AND s.active = true
  AND s.assign_sort_order IS NULL;

--    치료 파트(therapist): 김규리→임별→조선미→윤시하→서은정→최민지→강혜인→박소예→김유리
UPDATE staff AS s
SET assign_sort_order = v.ord
FROM (VALUES
  ('김규리', 1), ('임별', 2), ('조선미', 3), ('윤시하', 4), ('서은정', 5),
  ('최민지', 6), ('강혜인', 7), ('박소예', 8), ('김유리', 9)
) AS v(nm, ord)
WHERE s.name = v.nm
  AND s.role = 'therapist'
  AND s.active = true
  AND s.assign_sort_order IS NULL;
