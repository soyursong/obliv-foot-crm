-- ============================================================================
-- ROLLBACK — T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP merge-before-archive
-- soft-archive·re-point 가역 복원. hard-DELETE 없었으므로 데이터 순소실 0.
-- ============================================================================
BEGIN;

-- 3'. loser soft-archive 복원 (active=true·라벨 제거·auto_assign 복원)
UPDATE public.staff
   SET active = true,
       auto_assign_enabled = true,
       name = replace(name, ' [중복정리 2026-08-10]', ''),
       updated_at = now()
 WHERE id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',   -- 강다연 loser
              '9a429fb7-699b-4647-94da-c2ec1e61b3c9');   -- 이진석 loser

-- 1'. staff_attendance re-point 원복 (survivor → loser)
UPDATE public.staff_attendance
   SET staff_id = '4bcf55a2-4472-48ac-86a1-fca4b576ac21'
 WHERE staff_id = '0ff81a68-9696-4a3a-b7ce-38973e37ee36'
   -- ⚠ survivor 원래 소유 attendance 와 구분 불가 위험 →
   --    실 rollback 은 _before_image / mig 실행로그의 re-point 대상 PK 로 한정 UPDATE 할 것.
   --    (여기 WHERE 는 개념 표기 — apply 시 re-pointed attendance PK 를 로그로 freeze 후 그 PK 만 원복)
   AND false;  -- ★가드: PK-freeze 없이 blanket 원복 금지. 실 롤백은 로그 PK 기반.

-- 이진석 동일 (PK-freeze 기반 원복)
UPDATE public.staff_attendance
   SET staff_id = '9a429fb7-699b-4647-94da-c2ec1e61b3c9'
 WHERE staff_id = '884b4571-fbfb-4aa7-871c-f555dc296956'
   AND false;  -- ★가드: 상동

COMMIT;

-- NOTE: staff_attendance re-point 원복은 survivor 가 원래 갖던 attendance 와
--   re-pointed attendance 를 구분해야 하므로, apply 단계에서 re-point 대상 PK 를
--   실행로그(before_image 확장)에 기록 → rollback 시 그 PK 집합만 loser 로 되돌린다.
--   soft-archive 복원(§3')만으로도 근무캘린더 2중표시는 재현되나 데이터 무결.
