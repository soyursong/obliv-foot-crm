-- T-20260602-foot-VISITTYPE-RETURNING-AUTOSET 트랙1 — DRY-RUN (READ-ONLY)
--
-- supervisor SQL 게이트 선행 필수. 본 스크립트는 SELECT만 수행(변경 없음).
--   (0) 영향 건수: 백필로 'new'→'returning' 전환될 고객 수
--   (1) 변경 대상 customer_id 목록: 롤백 추적용으로 결과를 반드시 별도 보존
--   (2) 검증 샘플: 김민경 F-0177 등 방문이력 다수 고객의 현재 라벨 확인
--
-- ticket: T-20260602-foot-VISITTYPE-RETURNING-AUTOSET / author: dev-foot 2026-06-02

-- (0) 영향 건수
SELECT count(*) AS affected_count
FROM public.customers c
WHERE c.visit_type = 'new'
  AND EXISTS (
    SELECT 1 FROM public.check_ins ci
    WHERE ci.customer_id = c.id AND ci.status = 'done'
  );

-- (1) 변경 대상 customer_id 목록 (롤백 추적 캡처용 — 결과 보존)
SELECT c.id AS customer_id,
       c.chart_number,
       c.name,
       (SELECT count(*) FROM public.check_ins ci
        WHERE ci.customer_id = c.id AND ci.status = 'done') AS done_count
FROM public.customers c
WHERE c.visit_type = 'new'
  AND EXISTS (
    SELECT 1 FROM public.check_ins ci
    WHERE ci.customer_id = c.id AND ci.status = 'done'
  )
ORDER BY done_count DESC, c.chart_number;

-- (2) 진짜 초진 보존 확인: done 0건이면서 visit_type='new' (백필 후에도 'new' 유지되어야 함)
SELECT count(*) AS genuine_new_count
FROM public.customers c
WHERE c.visit_type = 'new'
  AND NOT EXISTS (
    SELECT 1 FROM public.check_ins ci
    WHERE ci.customer_id = c.id AND ci.status = 'done'
  );
