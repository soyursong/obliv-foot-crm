-- Rollback: T-20260726-foot-CRM-ASSIGN-V1 — 상담 자동배정 시스템 ADDITIVE 스키마 되돌림.
--
-- 되돌림 후 엔진 동작: assignmentStrategy 모듈은 신규 테이블/컬럼 부재 시 graceful(빈 config → 기존
--   월균등 least-loaded 경로로 자연 fallback). 즉 롤백해도 자동배정 동선은 무영향(기존 AUTOASSIGN 유지).
--   ★ customers.assigned_consultant_id(매출귀속 드라이버)는 본 마이그가 생성/변경한 적 없으므로 롤백 대상 아님(불변).
--   ★ staff.assign_sort_order(W1)는 별 마이그 소유 — 본 롤백은 손대지 않음.
--
-- 데이터 동반 소멸(설정·포인터 상태)은 의도된 되돌림. 멱등: IF EXISTS 가드.

BEGIN;

DROP TABLE IF EXISTS assignment_pointer_state;
DROP TABLE IF EXISTS assignment_leadsource_policy;
DROP TABLE IF EXISTS assignment_daily_target_config;
DROP TABLE IF EXISTS assignment_ranking_weights;

ALTER TABLE staff DROP COLUMN IF EXISTS slack_user_id;
ALTER TABLE staff DROP COLUMN IF EXISTS auto_assign_enabled;

COMMIT;
