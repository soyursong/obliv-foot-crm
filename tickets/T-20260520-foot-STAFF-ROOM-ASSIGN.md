---
ticket_id: T-20260520-foot-STAFF-ROOM-ASSIGN
title: room_assignments UPDATE RLS — staff/part_lead 추가
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-21T00:25:00+09:00"
db_change: true
db_change_note: |
  room_assignments UPDATE 정책에 is_floor_staff() 추가
  마이그레이션: 20260521000040_room_assignments_staff_update_rls.sql
migration_file: supabase/migrations/20260521000040_room_assignments_staff_update_rls.sql
rollback_file: supabase/migrations/20260521000040_room_assignments_staff_update_rls.down.sql
commit: 583d9a9
build_ok: true
e2e_spec: none
e2e_spec_exempt_reason: db_only
risk_verdict: GO_WARN
risk_reason: "DB RLS UPDATE 정책 추가 — staff/part_lead 역할 room_assignments 수정 권한"
created_at: 2026-05-20
deadline: 2026-05-28
implemented_by: dev-foot
parent_ticket: T-20260520-foot-STAFF-PERM-AUDIT
---

# T-20260520-foot-STAFF-ROOM-ASSIGN — room_assignments UPDATE RLS staff/part_lead 추가

## 배경

STAFF-PERM-AUDIT 후속 P2 티켓.
현재 room_assignments = staff SELECT only.
치료실/레이저실 공간 배정 변경 불가 — 현장 불편.

## 착수 조건

- P1 CUSTOMER-UPDATE + PKG-ACCESS 완료 후

## 수정 내용 (예정)

- room_assignments UPDATE RLS에 `is_floor_staff()` 추가
- FE: 대시보드 공간 배정 변경 버튼 staff/part_lead에게 노출

## AC (예정)

- AC-1: staff 계정 room_assignments UPDATE 가능
- AC-2: part_lead 계정 동일
- AC-3: 기존 admin/manager 동작 회귀 없음
- AC-4: 마이그레이션 + 롤백 SQL 쌍
