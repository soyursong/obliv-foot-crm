---
ticket_id: T-20260520-foot-STAFF-CUSTOMER-UPDATE
title: customers UPDATE RLS — staff/part_lead 추가 + FE 편집 버튼 노출 확장
domain: foot
priority: P1
status: in-progress
deploy_ready: false
db_change: true
db_change_note: |
  supabase/migrations/20260520000070_customers_staff_update_rls.sql
  - customers_staff_update UPDATE 정책 신규 추가 (is_floor_staff() 재사용)
  롤백: 20260520000070_customers_staff_update_rls.down.sql
  (DROP POLICY customers_staff_update ON customers)
build_ok: false
e2e_spec: tests/e2e/T-20260520-foot-STAFF-CUSTOMER-UPDATE.spec.ts
created_at: 2026-05-20
deadline: 2026-05-26
implemented_by: dev-foot
parent_ticket: T-20260520-foot-STAFF-PERM-AUDIT
---

# T-20260520-foot-STAFF-CUSTOMER-UPDATE — customers UPDATE RLS staff/part_lead 추가

## 배경

STAFF-PERM-AUDIT 후속 P1 티켓.
현재 `customers` 테이블 RLS: staff = SELECT only.
데스크 스태프가 고객 전화번호·메모 업데이트 불가 — 현장 업무 방해.

## 수정 내용

### 1. DB — customers_staff_update 정책 추가

```sql
CREATE POLICY customers_staff_update ON customers FOR UPDATE TO authenticated
  USING (is_floor_staff()) WITH CHECK (is_floor_staff());
```

- `is_floor_staff()` 재사용 (20260520000060에서 신규 추가됨)
- 기존 4개 customers 정책 변경 없음 (OR 결합)
- 민감 컬럼 (rrn_enc, rrn_vault_id): SECURITY DEFINER RPC 통해서만 접근 — 이 정책으로 평문 노출 없음

### 2. FE — Customers.tsx 편집 버튼 노출 확장

- `isAdmin = role === 'admin'` → `canEditCustomer` (admin/manager/consultant/coordinator/staff/part_lead)
- `canDeleteCustomer` = admin only (기존 동작 유지)
- `EditCustomerDialog`: passport_number 필드 staff/part_lead 에게는 readonly 처리

## AC

| AC | 설명 | 검증 방법 |
|----|------|-----------|
| AC-1 | staff 계정으로 customers UPDATE RLS 통과 | `customers_staff_update` 정책 is_floor_staff() 조건 |
| AC-2 | FE 편집 버튼 staff/part_lead 계정에 노출 | canEditCustomer role 목록에 staff/part_lead 포함 |
| AC-3 | 삭제 버튼은 admin만 유지 (canDeleteCustomer) | 기존 동작 회귀 없음 |
| AC-4 | passport_number 필드 staff/part_lead readonly | EditCustomerDialog canEditSensitive prop |

## 리스크

- GO_WARN — DB RLS UPDATE 정책 추가
- FE: staff 로그인 시 EditCustomerDialog save() → supabase.from('customers').update() 성공 필요
- 롤백: `.down.sql` 실행으로 즉시 원복 가능

## 파일 목록

| 파일 | 종류 | 설명 |
|------|------|------|
| `supabase/migrations/20260520000070_customers_staff_update_rls.sql` | DB 마이그레이션 | customers_staff_update 정책 |
| `supabase/migrations/20260520000070_customers_staff_update_rls.down.sql` | 롤백 SQL | DROP POLICY |
| `src/pages/Customers.tsx` | FE | canEditCustomer/canDeleteCustomer 분리 |
| `tests/e2e/T-20260520-foot-STAFF-CUSTOMER-UPDATE.spec.ts` | E2E spec | AC-1~4 검증 |
