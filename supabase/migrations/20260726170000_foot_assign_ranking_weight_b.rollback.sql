-- Rollback: T-20260726-foot-CRM-ASSIGN-WEIGHT-B — 기본 가중치 B → 균등(월1:주1:객1) 환원.
--
-- 성격: DATA-ONLY. 본 마이그가 정정한 '잠정 default → B' 를 되돌린다. 가드: 주2 default 지문(월1:주2:객1)
--   만 균등으로 환원 → 관리자 의도 설정값 불변. 멱등(재실행 no-op). 코드 default 는 별도 revert 필요.

BEGIN;

UPDATE assignment_ranking_weights
   SET weight_revenue_week = 1,
       updated_at          = now()
 WHERE weight_revenue_month = 1
   AND weight_revenue_week  = 2
   AND weight_avg_ticket    = 1;

COMMIT;
