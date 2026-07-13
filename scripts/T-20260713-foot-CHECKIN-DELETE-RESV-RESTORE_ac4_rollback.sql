-- T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE — AC4 rollback
-- 복구(confirmed) 되돌리기: candidate_real 7건을 원상(checked_in)으로.
-- 실행 전 evidence/..._ac4_rollback_applied.json 의 ids 와 대조(실제 변경분만 되돌릴 것).
-- 멱등 가드: status='confirmed' 인 것만 되돌림(사용자가 이후 다른 상태로 바꿨으면 무변경).
update reservations set status = 'checked_in'
where id in (
  '5244c31a-fea6-43fc-9a38-00d6f6297919', -- 김사비 2026-05-17
  '48a2af07-9ac5-40d7-b927-b705b11b2080', -- 박민석 2026-05-21
  '611ba015-a14b-4f64-a13e-820fb20e2f9f', -- 왕지현 2026-05-26
  'f5d37b02-dfbe-407d-b7ea-1606470ff66e', -- 장예지 2026-05-29
  'b0001156-57ef-4eae-977b-7cef0bb9ce1b', -- 김유리 2026-06-02
  'c302de18-ecb4-4b23-8037-5b750cbac466', -- Daniel 2026-06-25
  'a62c3aa3-7a86-4195-b6c0-ffe23df3f9a7'  -- 행행이 2026-07-13
)
and status = 'confirmed';
