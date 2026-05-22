---
ticket_id: T-20260522-foot-STAFF-REEXPAND
title: staff 권한 재확대 — 5/21 롤백 4건 재적용
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-22T14:00:00+09:00"
db_change: true
db_change_note: |
  1. customers_staff_update (UPDATE) 재생성 — 20260522090010_customers_staff_update_rls_reapply.sql
  2. room_assignments_staff_update (UPDATE) 재생성 — 20260522090020_room_assignments_staff_update_rls_reapply.sql
  3. daily_closings_staff_read (SELECT) 재생성 — 20260522090030_daily_closings_staff_select_rls_reapply.sql
  DB 적용 완료 (supabase db query --linked 직접 실행)
migration_file: |
  supabase/migrations/20260522090010_customers_staff_update_rls_reapply.sql
  supabase/migrations/20260522090020_room_assignments_staff_update_rls_reapply.sql
  supabase/migrations/20260522090030_daily_closings_staff_select_rls_reapply.sql
rollback_file: |
  supabase/migrations/20260522090010_customers_staff_update_rls_reapply.down.sql
  supabase/migrations/20260522090020_room_assignments_staff_update_rls_reapply.down.sql
  supabase/migrations/20260522090030_daily_closings_staff_select_rls_reapply.down.sql
build_ok: true
e2e_spec: tests/e2e/T-20260522-foot-STAFF-REEXPAND.spec.ts
risk_verdict: GO
risk_reason: "원본(40f13ed/583d9a9/efd06a7/ca12d96) 동일 범위 재적용. DROP IF EXISTS + CREATE 패턴. 잠금(stats/sales/accounts) 변경 없음."
created_at: 2026-05-22
deadline: 2026-05-22
implemented_by: dev-foot
ordered_by: 김주연 총괄 ("직원 리뷰 결과 확인하고 권한 풀어줘")
parent_ticket: MSG-20260522-133535-k5ra
rollback_of_rollback:
  - T-20260521-foot-STAFF-PKG-ROLLBACK (packages FE)
  - T-20260521-foot-STAFF-ROOM-ASSIGN-ROLLBACK (room_assignments RLS)
  - T-20260521-foot-STAFF-DAILY-READ-ROLLBACK (daily_closings RLS)
  - customers_staff_update (직접 rollback, commit 없음)
---

# T-20260522-foot-STAFF-REEXPAND — staff 권한 재확대

## 배경

김주연 총괄 명시적 지시: "직원 리뷰 결과 확인하고 권한 풀어줘"

5/21 B안 전체 롤백 4건을 RBAC-MENU-EXPAND 동일 범위로 재적용.

## 변경 내용

### DB — RLS 정책 3건 재생성

| 테이블 | 정책명 | CMD | 상태 |
|--------|--------|-----|------|
| customers | customers_staff_update | UPDATE | ✅ 재생성 (적용 완료) |
| room_assignments | room_assignments_staff_update | UPDATE | ✅ 재생성 (적용 완료) |
| daily_closings | daily_closings_staff_read | SELECT | ✅ 재생성 (적용 완료) |

### FE — packages RoleGuard 재확대

- **변경 전**: `['admin', 'manager', 'consultant', 'coordinator', 'therapist']`
- **변경 후**: `['admin', 'manager', 'consultant', 'coordinator', 'therapist', 'staff', 'part_lead']`
- staff/part_lead → READ-only (Packages.tsx `canWritePackage` 기준, 로직 변경 없음)

### 잠금 유지 (변경 없음)

| 경로 | 허용 역할 |
|------|----------|
| stats | admin, manager, part_lead |
| sales | admin, manager |
| accounts | admin |

## AC 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-1 | packages 페이지 — staff/part_lead 접근 허용 | ✅ RoleGuard 재확대 |
| AC-2 | packages 페이지 — staff/part_lead READ-only | ✅ canWritePackage 로직 그대로 |
| AC-3 | packages 페이지 — consultant/coordinator WRITE 유지 | ✅ 회귀 없음 |
| AC-4 | stats/sales/accounts 잠금 유지 | ✅ 변경 없음 |
| AC-5 | customers UPDATE — staff_update 정책 재생성 | ✅ DB 적용 확인 |
| AC-6 | room_assignments UPDATE — staff_update 정책 재생성 | ✅ DB 적용 확인 |
| AC-7 | daily_closings SELECT — staff_read 정책 재생성 | ✅ DB 적용 확인 |
| AC-8 | admin/manager 기존 권한 회귀 없음 | ✅ 기존 정책 유지 |

## DB 적용 검증

```json
{
  "customers_staff_update": "UPDATE ✅",
  "room_assignments_staff_update": "UPDATE ✅",
  "daily_closings_staff_read": "SELECT ✅"
}
```

(supabase db query --linked 실행 후 pg_policies 직접 확인)

## 비고

- is_floor_staff() 함수: 이미 존재, CREATE OR REPLACE로 idempotent 적용
- PAY-PRINT-BUGS 4건: 이 RLS 재적용으로 동시 해소 가능 — 배포 후 supervisor 확인 필요
- 빌드: ✅ (3.27s, 오류 없음)
