-- T-20260724-foot-DISTHIST-ASSIGNEE-BBS-KKM-MOVE — ROLLBACK
-- 역 UPDATE: 강경민(6ab26d9f) → 정연주(c851fbb1) 원복. 명시-PK + 멱등 guard.
-- freeze 원값 스냅샷: FREEZE2.json (customer 백범석/fab31584, status=done, vt=new, checked_in_at 2026-07-24T09:14:28Z)
-- 실행: 기대 rows-affected == 1
UPDATE check_ins
SET consultant_id = 'c851fbb1-31ce-4714-b91c-03e9cb8af566'  -- 정연주 (원값)
WHERE id = '625e534d-22e6-4526-8ea5-c34645691b67'
  AND consultant_id = '6ab26d9f-fd10-4042-9fd7-076f277be5d4';  -- 강경민 (현재값, 멱등 guard)
