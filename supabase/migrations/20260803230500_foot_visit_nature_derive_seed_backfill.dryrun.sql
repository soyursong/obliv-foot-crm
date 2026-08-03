-- DRY-RUN (READ-ONLY 미리보기) — T-20260803-foot-VISIT-NATURE-COLUMN-DERIVESEED derive-seed 백필
-- 2026-08-03 23:05 KST
-- supervisor 백필 게이트: 본 SELECT 를 prod(visit_nature 컬럼 DDL 적용 후)에서 실행 → rows-affected 사전 확인.
--   ⚠ READ-ONLY. 어떤 쓰기도 없음(UPDATE/INSERT 0). 값 채워지기 前 실행해야 실 대상 건수 관측.
-- 확인 포인트:
--   ① 대상 건수(파생될 reservations/check_ins) — 백필 rows-affected 예상치
--   ② 파생 분포 = new / revisit 만(fulfillment 0 = over-correction 없음)
--   ③ 미매핑(기타/NULL visit_type) 건수 — 의도적 NULL 존치(보수적)
-- =====================================================

-- ① 파생 대상 + 분포 (reservations)
SELECT 'reservations' AS anchor,
       CASE r.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE '(미매핑·NULL 존치)' END AS mapped_visit_nature,
       count(*) AS rows_affected
FROM public.reservations r
WHERE r.visit_nature IS NULL
GROUP BY 1, 2
UNION ALL
-- ① 파생 대상 + 분포 (check_ins)
SELECT 'check_ins' AS anchor,
       CASE ci.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE '(미매핑·NULL 존치)' END,
       count(*)
FROM public.check_ins ci
WHERE ci.visit_nature IS NULL
GROUP BY 1, 2
ORDER BY anchor, mapped_visit_nature;

-- ② 보수적 가드 자가확인 — fulfillment 로 파생되는 건은 0 이어야 한다(항상 0, 크로스워크에 fulfillment 없음)
SELECT count(*) AS fulfillment_overmap_should_be_zero
FROM (
  SELECT CASE r.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE NULL END AS m
  FROM public.reservations r WHERE r.visit_nature IS NULL
  UNION ALL
  SELECT CASE ci.visit_type WHEN 'new' THEN 'new' WHEN 'returning' THEN 'revisit' ELSE NULL END
  FROM public.check_ins ci WHERE ci.visit_nature IS NULL
) x
WHERE x.m = 'fulfillment';
