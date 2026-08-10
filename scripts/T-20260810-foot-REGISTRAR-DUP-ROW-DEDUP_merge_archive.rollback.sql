-- ============================================================================
-- ROLLBACK (FROZEN v2) — T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP merge-before-archive
-- soft-archive·re-point 가역 복원. hard-DELETE 없었으므로 데이터 순소실 0.
-- PK-precise: up.sql freeze set 의 명시 attendance PK 로 한정 원복 (blanket UPDATE 금지).
-- ============================================================================
BEGIN;

-- 3'. loser soft-archive 복원 (active=true·라벨 제거·auto_assign 복원) — 멱등
UPDATE public.staff
   SET active = true,
       auto_assign_enabled = true,
       name = replace(name, ' [중복정리 2026-08-10]', ''),
       updated_at = now()
 WHERE id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',   -- 강다연 loser
              '9a429fb7-699b-4647-94da-c2ec1e61b3c9');   -- 이진석 loser

-- 1'. staff_attendance re-point 원복 — PK-precise (up.sql 이 UPDATE 한 정확히 그 PK만)
-- 강다연: attendance a9761249 → loser 4bcf55a2
UPDATE public.staff_attendance
   SET staff_id = '4bcf55a2-4472-48ac-86a1-fca4b576ac21'
 WHERE id = 'a9761249-fc3b-45b1-9a2a-1e3db3e65a07'
   AND staff_id = '0ff81a68-9696-4a3a-b7ce-38973e37ee36';   -- 가드: up.sql 적용본만 원복

-- 이진석: attendance f35160d7 → loser 9a429fb7
UPDATE public.staff_attendance
   SET staff_id = '9a429fb7-699b-4647-94da-c2ec1e61b3c9'
 WHERE id = 'f35160d7-8c7f-4337-bd79-a1ec3c288366'
   AND staff_id = '884b4571-fbfb-4aa7-871c-f555dc296956';

COMMIT;

-- NOTE: attendance PK 를 up.sql 이 명시(a9761249·f35160d7)하므로 rollback 은 그 2 PK 만
--   loser 로 되돌린다 — survivor 원소유 attendance 와 혼동 위험 0 (구 DRAFT 의 blanket 가드 제거).
--   soft-archive 복원(§3')만으로도 근무캘린더 2중표시는 재현되나 데이터 무결.
