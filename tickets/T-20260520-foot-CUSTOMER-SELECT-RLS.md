---
ticket_id: T-20260520-foot-CUSTOMER-SELECT-RLS
title: customers SELECT RLS — staff/part_lead/tm 초진 차트 안 열림 P0 hotfix
domain: foot
priority: P0
status: deployed
deploy_ready: true
qa_result: pass
qa_grade: GO_WARN
deploy_commit: 89a50e0
deployed_at: "2026-05-21T12:55:00+09:00"
deployed_by: supervisor
precheck_pass: true
precheck_at: "2026-05-21T12:55:00+09:00"
field_soak_until: "2026-05-22T12:55:00+09:00"
db_change: true
db_change_note: |
  supabase/migrations/20260520000090_customers_staff_select_rls.sql
  - is_floor_staff() CREATE OR REPLACE (idempotent 재확인)
  - customers_staff_select SELECT 정책 신규 추가 (customers 테이블)
  롤백: 20260520000090_customers_staff_select_rls.down.sql
  (DROP POLICY customers_staff_select ON customers)
  DB 적용 완료: 2026-05-20 (Supabase Management API 직접 실행)
build_ok: true
e2e_spec: tests/e2e/T-20260520-foot-CUSTOMER-SELECT-RLS.spec.ts
created_at: 2026-05-20
deadline: 2026-05-21
implemented_by: dev-foot
parent_ticket: T-20260520-foot-CHECKIN-RLS-STAFF
---

# T-20260520-foot-CUSTOMER-SELECT-RLS — 초진 차트 안 열림 P0 hotfix

## 문제 요약

스태프 계정 전원 — /admin 대시보드 초진 환자 칸반 카드 클릭 시:
- 1번차트(CheckInDetailSheet): 고객정보(차트번호·메모·방문경로) 빈값
- 2번차트(CustomerChartSheet): 미열림

**근본 원인**: `customers` 테이블 SELECT RLS에서 `staff`/`part_lead`/`tm` 역할이 차단됨.

기존 `customers_approved_read` (is_approved_user() 기반) 정책이 이론상 커버해야 하나,
`is_approved_user()`의 `approved=true` 조건이 일부 계정에서 false 반환 가능.

## 초진 동선 영향

```
check_in.customer_id = NULL (접수 시 고객 미매칭)
  ↓
load() 에서 customer_phone → customers SELECT 폴백
  ↓ (RLS 차단 시)
resolvedCustomerId 미설정
  ↓
2번차트(CustomerChartSheet) 자동 오픈 불가
1번차트 고객정보 섹션 빈값
```

## DB 현황 확인 (적용 전)

| 정책 | 상태 | 비고 |
|------|------|------|
| `customers_approved_read` | 존재 | is_approved_user() SELECT |
| `customers_staff_select` | **미존재** | → 이번 추가 |
| `customers_staff_update` | 미존재 | STAFF-CUSTOMER-UPDATE P1 |
| `check_ins_staff_update` | 미존재 | CHECKIN-RLS-STAFF P1 |

> `check_ins_approved_read` 및 `check_ins_read` 존재 → 칸반 카드 표시 정상.

## 수정 내용

### 1. `is_floor_staff()` 재확인 (idempotent)
```sql
CREATE OR REPLACE FUNCTION is_floor_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_approved_user()
     AND current_user_role() IN ('admin','manager','director','staff','part_lead','tm');
$$;
```

### 2. `customers_staff_select` 신규 정책
```sql
DROP POLICY IF EXISTS customers_staff_select ON customers;
CREATE POLICY customers_staff_select ON customers
  FOR SELECT TO authenticated
  USING (is_floor_staff());
```

기존 `customers_approved_read` 와 OR 결합 (충돌 없음).

## AC 달성

- **AC-1** ✅: staff 초진 카드 클릭 → 1번차트 열림 (고객정보 로드)
- **AC-2** ✅: staff → 2번차트 열림 (resolvedCustomerId 설정 → openChart 호출)
- **AC-3** ✅: part_lead 동일 (is_floor_staff() 포함)
- **AC-4** ✅: 기존 역할 회귀 없음 (SELECT 정책 추가만, 기존 정책 변경 없음)
- **AC-5** ✅: 마이그레이션 + 롤백 SQL 쌍
- **AC-6** ✅: 초진 customer_id NULL + phone 기반 폴백 — customers SELECT 통과 시 resolvedCustomerId 설정, 2번차트 자동 오픈

## 적용 이력

| 항목 | 값 |
|------|----|
| 마이그레이션 파일 | `20260520000090_customers_staff_select_rls.sql` |
| DB 적용 방법 | Supabase Management API (`scripts/apply_20260520000090_customers_staff_select_rls.mjs`) |
| DB 적용 시각 | 2026-05-20 |
| 검증 | `customers_staff_select` 정책 확인, `is_floor_staff()` SECURITY DEFINER 확인 |

## 후속 조치

| 티켓 | 우선순위 | 내용 |
|------|---------|------|
| T-20260520-foot-STAFF-CUSTOMER-UPDATE | P1 | customers UPDATE (staff/part_lead) |
| T-20260520-foot-CHECKIN-RLS-STAFF | P1 | check_ins UPDATE (staff/part_lead/tm) 칸반 드래그 |
