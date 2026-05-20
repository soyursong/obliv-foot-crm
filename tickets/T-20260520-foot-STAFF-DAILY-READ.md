---
ticket_id: T-20260520-foot-STAFF-DAILY-READ
title: daily_closings SELECT RLS — staff/part_lead 읽기 허용
domain: foot
priority: P2
status: approved
deploy_ready: false
db_change: true
db_change_note: |
  daily_closings SELECT 정책에 is_approved_user() 추가 (읽기전용)
  예정 마이그레이션: 20260528000030_daily_closings_staff_read_rls.sql
  CRUD는 admin/manager 유지
build_ok: false
e2e_spec: none
created_at: 2026-05-20
deadline: 2026-05-28
implemented_by: dev-foot
parent_ticket: T-20260520-foot-STAFF-PERM-AUDIT
---

# T-20260520-foot-STAFF-DAILY-READ — daily_closings SELECT RLS staff/part_lead 추가

## 배경

STAFF-PERM-AUDIT 후속 P2 티켓.
현재 daily_closings = staff 완전 차단 (is_consultant_or_above OR is_coordinator_or_above).
일일 매출 현황 열람 불가 — 현장 불편.

## 착수 조건

- P1 CUSTOMER-UPDATE + PKG-ACCESS 완료 후

## 수정 내용 (예정)

- daily_closings SELECT에 `is_approved_user()` 정책 추가
- WRITE(INSERT/UPDATE/DELETE)는 기존 admin/manager 유지
- FE: 일마감 페이지 RoleGuard는 admin/manager만 유지 (WRITE 보호)
  → 별도 READ-only 뷰 또는 대시보드 위젯에서 열람 가능

## AC (예정)

- AC-1: staff 계정 daily_closings SELECT 가능
- AC-2: part_lead 계정 동일
- AC-3: daily_closings INSERT/UPDATE/DELETE는 admin/manager만 유지 (회귀 없음)
- AC-4: 마이그레이션 + 롤백 SQL 쌍
- AC-5: 일마감 페이지 RoleGuard 변경 없음 (WRITE 보호)
