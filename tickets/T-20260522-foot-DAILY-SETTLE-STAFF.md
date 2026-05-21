---
id: T-20260522-foot-DAILY-SETTLE-STAFF
title: 일마감 결제내역 초진재진·내원경로 데이터 소스 2번차트 고객정보 확정
status: deploy-ready
deploy-ready: true
build: pass
db_change: false
spec_added: false
regression_risk: low
created_at: 2026-05-22
updated_at: 2026-05-22
priority: P2
domain: foot
---

## 요약

김주연 총괄 후속 지시(5/22 02:58): CLOSING-PAY-3COL(deployed, 4b46d82) 기반으로
초진·재진 / 내원경로 컬럼 데이터 소스를 **2번차트 고객정보**로 확정.

## 확인 결과

### 1. 초진·재진 (visit_type)
- **변경 전**: `check_ins.visit_type` (단건: `ci?.visit_type`, 패키지: `ciByCustomer?.visit_type`)
- **변경 후**: `customers.visit_type` (2번차트 고객정보) — `cust?.visit_type`
- 이유: customers 테이블에 `visit_type TEXT DEFAULT 'new' CHECK ('new','returning')` 존재.
  check_ins 기반은 패키지 결제에서 같은 날 check_in 없을 경우 null이 될 수 있음.

### 2. 내원경로 (lead_source/referral_source)
- **변경 전**: `customers.lead_source` — **이 컬럼은 customers 테이블에 존재하지 않음** → 항상 null
- **변경 후**: `customers.visit_route` (2번차트 고객정보 방문경로: TM/워크인/인바운드/지인소개)
- DB 근거: `20260508000060_chart2_c2_tickets.sql` — customers.visit_route 컬럼 정의

### 3. 수기 결제 (closing_manual_payments)
- 변경 없음. `closing_manual_payments.lead_source` + `closing_manual_payments.visit_type` 은 올바른 소스.

## 변경 내역

- `src/pages/Closing.tsx`
  - `CustomerBasic` interface: `lead_source` 제거 → `visit_route`, `visit_type` 추가
  - SELECT query: `lead_source` → `visit_route, visit_type`
  - 단건 결제 enrichedRows: `cust?.lead_source` → `cust?.visit_route`, `ci?.visit_type` → `cust?.visit_type`
  - 패키지 결제 enrichedRows: `cust?.lead_source` → `cust?.visit_route`, `ciByCustomer?.visit_type` → `cust?.visit_type`
  - `customerIdToCheckInMap` useMemo 제거 (불필요해짐)
  - enrichedRows deps에서 `customerIdToCheckInMap` 제거

## AC 충족

- [x] visit_type·내원경로 2번차트 고객정보(customers) 기준 표시
- [x] 3소스(단건/패키지/수동) 커버
- [x] 결제담당자 회귀 없음 (assigned_staff_id 유지)
- [x] null fallback (`?? null`) 유지
- [x] 빌드 통과
