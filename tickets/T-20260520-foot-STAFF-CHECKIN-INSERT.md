---
ticket_id: T-20260520-foot-STAFF-CHECKIN-INSERT
title: check_ins INSERT RLS — staff/part_lead 추가
domain: foot
priority: P2
status: approved
deploy_ready: false
db_change: true
db_change_note: |
  check_ins INSERT 정책에 is_floor_staff() 추가
  예정 마이그레이션: 20260528000020_check_ins_staff_insert_rls.sql
  (UPDATE는 T-20260520-foot-CHECKIN-RLS-STAFF에서 이미 완료)
build_ok: false
e2e_spec: none
created_at: 2026-05-20
deadline: 2026-05-28
implemented_by: dev-foot
parent_ticket: T-20260520-foot-STAFF-PERM-AUDIT
---

# T-20260520-foot-STAFF-CHECKIN-INSERT — check_ins INSERT RLS staff/part_lead 추가

## 배경

STAFF-PERM-AUDIT 후속 P2 티켓.
현재 check_ins INSERT = consultant/coordinator만 허용.
staff는 체크인 직접 등록 불가.

참고: check_ins UPDATE는 T-20260520-foot-CHECKIN-RLS-STAFF에서 이미 완료됨.

## 착수 조건

- P1 CUSTOMER-UPDATE + PKG-ACCESS 완료 후

## 수정 내용 (예정)

- check_ins INSERT RLS에 `is_floor_staff()` 추가
- FE: NewCheckInDialog staff/part_lead에서 INSERT 허용 확인

## AC (예정)

- AC-1: staff 계정 check_ins INSERT 가능
- AC-2: part_lead 계정 동일
- AC-3: 기존 INSERT 정책 회귀 없음
- AC-4: 마이그레이션 + 롤백 SQL 쌍
