-- T-20260724-foot-ASSIGN-UPSYNC-REVENUE-REATTRIB-GATE — rollback (baseline-freeze 백필)
--
-- 백필-한정 되돌림(경량). 완전 되돌림은 DDL 마이그 롤백(20260814160000 ...snapshot.rollback.sql,
--   컬럼 자체 DROP)이 담당한다. 본 파일 = "백필만" 되돌리되 report-neutral 을 깨지 않는 범위로 한정.
--
-- ★report-neutral 롤백: attributed_staff_id 가 고객 현재 assigned_staff_id 와 여전히 일치하는 행만
--   NULL 로 되돌린다. 이 행들은 read COALESCE(attributed_staff_id, live-join) 이 동일 값을 산출하므로
--   NULL 화해도 리포트 숫자 불변(무손실·무이동).
-- ⚠️ 이미 재배정으로 divergence(attributed ≠ 현재 assigned)한 행은 "과거 귀속 못박음"의 실효 데이터이므로
--    NULL 화 시 소급 재귀속이 재유입된다 → 되돌리지 않는다(SOP §4 정신·Branch A 보존).
--    그런 행까지 완전 제거하려면 DDL 컬럼 DROP 롤백을 사용(archive-first 권고).

UPDATE public.payments p
SET attributed_staff_id = NULL
FROM public.customers c
WHERE p.customer_id = c.id
  AND p.attributed_staff_id IS NOT NULL
  AND p.attributed_staff_id = c.assigned_staff_id;

UPDATE public.package_payments p
SET attributed_staff_id = NULL
FROM public.customers c
WHERE p.customer_id = c.id
  AND p.attributed_staff_id IS NOT NULL
  AND p.attributed_staff_id = c.assigned_staff_id;
