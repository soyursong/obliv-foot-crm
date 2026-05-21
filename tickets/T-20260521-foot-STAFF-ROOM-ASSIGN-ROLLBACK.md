---
ticket_id: T-20260521-foot-STAFF-ROOM-ASSIGN-ROLLBACK
title: room_assignments UPDATE RLS — staff/part_lead 권한 롤백 (B안 전체 롤백)
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-21T20:15:00+09:00"
db_change: true
db_change_note: |
  room_assignments_staff_update 정책 DROP
  롤백 대상: T-20260520-foot-STAFF-ROOM-ASSIGN (commit 583d9a9, deployed 2026-05-21 00:51)
  실행 파일: supabase/migrations/20260521000040_room_assignments_staff_update_rls.down.sql
  SQL: DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;
  주의: is_floor_staff() 함수는 다른 정책에서도 사용 중 — DROP 하지 않음
migration_file: supabase/migrations/20260521000040_room_assignments_staff_update_rls.down.sql
rollback_file: null
commit: null
build_ok: true
e2e_spec: none
e2e_spec_exempt_reason: db_only_rollback
risk_verdict: GO
risk_reason: "정책 DROP만 — 추가 없음. admin/manager 기존 ALL 정책 유지. 회귀 없음."
created_at: 2026-05-21
deadline: 2026-05-21
implemented_by: dev-foot
parent_ticket: T-20260520-foot-STAFF-ROOM-ASSIGN
rollback_of: T-20260520-foot-STAFF-ROOM-ASSIGN
ordered_by: 김주연 총괄 ("staff 계정 관련 권한은 롤백해" B안 전체 롤백)
---

# T-20260521-foot-STAFF-ROOM-ASSIGN-ROLLBACK

## 배경

김주연 총괄 직접 지시: "staff 계정 관련 권한은 롤백해" → B안 전체 롤백 확정.
T-20260520-foot-STAFF-ROOM-ASSIGN (deployed 5/21 00:51, commit 583d9a9)로 추가된
`room_assignments_staff_update` RLS 정책 제거.

## AC 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-4 | 실행 전 정책 상태 검증 | ✅ room_assignments_staff_update 존재 확인 (롤백 필요) |
| AC-1 | rollback SQL 실행 완료 | ✅ `DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;` 성공 |
| AC-2 | staff room_assignments UPDATE 거부 확인 | ✅ 정책 제거됨 — staff UPDATE 차단 (room_assignments_admin_all만 잔존, is_admin_or_manager() 한정) |
| AC-3 | admin/manager 회귀 없음 | ✅ room_assignments_admin_all(ALL, is_admin_or_manager()) 유지 — UPDATE 포함 |

## 실행 내역

### 실행 전 정책 목록 (pg_policies)
```
room_assignments_admin_all     | ALL    | {authenticated}  (is_admin_or_manager())
room_assignments_approved_read | SELECT | {authenticated}
room_assignments_staff_update  | UPDATE | {authenticated}  ← 제거 대상
```

### 실행 SQL
```sql
DROP POLICY IF EXISTS room_assignments_staff_update ON room_assignments;
```

### 실행 후 정책 목록
```
room_assignments_admin_all     | ALL    | {authenticated}  (is_admin_or_manager()) ← 유지
room_assignments_approved_read | SELECT | {authenticated}                           ← 유지
```

## 비고

- `is_floor_staff()` 함수: check_ins/reservations 정책에서도 사용 중 → 함수 DROP 하지 않음
- FE 코드 변경 없음 (UI는 별도 STAFF-PKG-ROLLBACK에서 처리됨)
- 코드 commit 없음 (DB-only 롤백)
