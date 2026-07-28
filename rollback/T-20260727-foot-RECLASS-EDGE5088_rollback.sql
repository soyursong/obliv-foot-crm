-- T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — EDGE #5088 담당축 정정 ROLLBACK
-- 강경민 → 김지윤 되돌리기 (UUID 명시, 멱등 AND 조건).
-- 강경민=6ab26d9f-fd10-4042-9fd7-076f277be5d4 / 김지윤=c23d4491-cbdc-423d-af33-17c836941f9c
UPDATE public.check_ins
   SET consultant_id = 'c23d4491-cbdc-423d-af33-17c836941f9c'
 WHERE id = '85ecbec3-0917-4d71-ae06-1993b855714b'
   AND consultant_id = '6ab26d9f-fd10-4042-9fd7-076f277be5d4';
-- 기대 rows-affected = 1.
