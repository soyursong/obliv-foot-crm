-- Rollback: T-20260629-foot-STAFF-ROTATION-DEFAULT-ORDER
-- staff.assign_sort_order 컬럼 제거(데이터 동반 소멸). autoAssign 은 컬럼 부재 시
-- fetchAssignSortOrder 가 빈 맵 반환 → random tie-break 로 graceful fallback(배정 동선 무영향).
ALTER TABLE staff DROP COLUMN IF EXISTS assign_sort_order;
