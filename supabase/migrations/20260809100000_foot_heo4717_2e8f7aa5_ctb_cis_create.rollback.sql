-- ROLLBACK — T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI
-- 신규 cis id 1행 DELETE (순소실 0 — INSERT 라 소실 원천 없음, rollback 은 신규행 제거).
-- 고정 PK 로 정확 타깃. business-key 보조 술어 동봉(방어).

DELETE FROM public.check_in_services
 WHERE id = '070652f3-3cb0-414a-ad80-98bf4c967e59'::uuid
   AND check_in_id = 'c33dfc76-cda5-48e6-9b34-277281b26626'::uuid
   AND service_id  = 'e17ba3a3-4842-4097-87bc-0778a64d2755'::uuid;
