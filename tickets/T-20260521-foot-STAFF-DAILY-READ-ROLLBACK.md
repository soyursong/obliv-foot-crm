---
ticket_id: T-20260521-foot-STAFF-DAILY-READ-ROLLBACK
title: daily_closings SELECT RLS — staff/part_lead 권한 롤백 (B안 전체 롤백)
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
deploy_ready_at: "2026-05-21T20:30:00+09:00"
db_change: true
db_change_note: |
  daily_closings_staff_read 정책 DROP
  롤백 대상: T-20260520-foot-STAFF-DAILY-READ (commit efd06a7, deployed 2026-05-21 00:51)
  실행 파일: supabase/migrations/20260521000030_daily_closings_staff_select_rls.down.sql
  SQL: DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;
  주의: is_floor_staff() 함수는 다른 정책에서도 사용 중 — DROP 하지 않음
  ⚠️ 부수 발견: 선행 정책 daily_closings_read (SELECT, true, authenticated) 잔존
     출처: 20260423000000_rls_role_policies.sql — T-20260520 이전부터 존재
     영향: staff는 해당 base 정책을 통해 여전히 daily_closings SELECT 가능
     별도 지시 필요: AC-2 완전 달성 원할 경우 base 정책도 제한 요망 (planner FOLLOWUP 발송됨)
migration_file: supabase/migrations/20260521000030_daily_closings_staff_select_rls.down.sql
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
parent_ticket: T-20260520-foot-STAFF-DAILY-READ
rollback_of: T-20260520-foot-STAFF-DAILY-READ
ordered_by: 김주연 총괄 ("staff 계정 관련 권한은 롤백해" B안 전체 롤백)
---

# T-20260521-foot-STAFF-DAILY-READ-ROLLBACK

## 배경

김주연 총괄 직접 지시: "staff 계정 관련 권한은 롤백해" → B안 전체 롤백 확정.
T-20260520-foot-STAFF-DAILY-READ (deployed 5/21 00:51, commit efd06a7)로 추가된
`daily_closings_staff_read` RLS 정책 제거.

## AC 결과

| AC | 내용 | 결과 |
|----|------|------|
| AC-4 | 실행 전 정책 상태 검증 | ✅ daily_closings_staff_read (SELECT, is_floor_staff()) 존재 확인 — 롤백 필요 |
| AC-1 | rollback SQL 실행 완료 | ✅ `DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;` 성공 |
| AC-2 | staff daily_closings SELECT 거부 확인 | ⚠️ daily_closings_staff_read 제거됨. 단, 선행 정책 `daily_closings_read (SELECT, true, authenticated)`(20260423000000_rls_role_policies.sql)로 인해 staff SELECT 완전 차단 불가. planner FOLLOWUP 발송. |
| AC-3 | admin/manager 회귀 없음 | ✅ daily_closings_admin_all + daily_closings_write 유지 |

## 실행 내역

### 실행 전 정책 목록 (pg_policies)
```
daily_closings_admin_all      | ALL    | {authenticated}  (is_admin_or_manager())
daily_closings_write          | ALL    | {authenticated}  (current_user_is_admin_or_manager())
daily_closings_finance_read   | SELECT | {authenticated}  (is_consultant_or_above() OR is_coordinator_or_above())
daily_closings_read           | SELECT | {authenticated}  (true)                          ← 선행 base 정책 (2026-04-23)
daily_closings_staff_read     | SELECT | {authenticated}  (is_floor_staff())              ← 제거 대상
daily_closings_therapist_read | SELECT | {authenticated}  (is_therapist_or_technician())
```

### 실행 SQL
```sql
DROP POLICY IF EXISTS daily_closings_staff_read ON daily_closings;
```

### 실행 후 정책 목록
```
daily_closings_admin_all      | ALL    | {authenticated}  (is_admin_or_manager())          ← 유지
daily_closings_write          | ALL    | {authenticated}  (current_user_is_admin_or_manager()) ← 유지
daily_closings_finance_read   | SELECT | {authenticated}  (is_consultant_or_above() OR ...)  ← 유지
daily_closings_read           | SELECT | {authenticated}  (true)                              ← 유지 (선행 정책)
daily_closings_therapist_read | SELECT | {authenticated}  (is_therapist_or_technician())      ← 유지
```

## ⚠️ 부수 발견 — planner 확인 필요

`daily_closings_read (SELECT, true, authenticated)` 정책이 2026-04-23 base 마이그레이션
(`20260423000000_rls_role_policies.sql`)에서 이미 정의되어 있음.

- T-20260520-foot-STAFF-DAILY-READ 이전부터 존재
- `USING (true)` = 모든 authenticated 유저 SELECT 허용
- 롤백 후에도 staff는 해당 정책을 통해 daily_closings SELECT 가능
- `daily_closings_staff_read` 는 이 base 정책 위에 추가된 명시적 정책이었음 (실질적 중복)

**AC-2 완전 달성 원할 경우**: base 정책 `daily_closings_read (true)` 제한 또는 DROP 필요.
별도 티켓·승인 필요. planner FOLLOWUP 발송 완료.

## 비고

- `is_floor_staff()` 함수: check_ins/reservations 정책에서도 사용 중 → 함수 DROP 하지 않음
- FE 코드 변경 없음 (DB-only 롤백)
- 코드 commit 없음 (DB-only 롤백, Vercel 재배포 불필요)
