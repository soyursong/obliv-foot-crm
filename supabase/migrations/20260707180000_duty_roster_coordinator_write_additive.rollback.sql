-- ROLLBACK — T-20260707-foot-DUTYROSTER-COORDINATOR-WRITE-RLS
-- ADDITIVE 되돌리기: 신규 coordinator 정책 3건 DROP. 기존 admin/manager 정책은 불변이었으므로 복원 불요.
-- 순수 권한 확대의 역연산 = coordinator write 제거(원상 admin/manager-only 복귀). 데이터 유실 없음.

DROP POLICY IF EXISTS "duty_roster_insert_coordinator" ON duty_roster;
DROP POLICY IF EXISTS "duty_roster_update_coordinator" ON duty_roster;
DROP POLICY IF EXISTS "duty_roster_delete_coordinator" ON duty_roster;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260707180000';
