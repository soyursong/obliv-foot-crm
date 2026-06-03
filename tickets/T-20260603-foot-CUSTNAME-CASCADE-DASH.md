---
id: T-20260603-foot-CUSTNAME-CASCADE-DASH
ticket_id: T-20260603-foot-CUSTNAME-CASCADE-DASH
title: 고객명 변경 시 대시보드 예약/체크인 카드 비정규화 컬럼 카스케이드
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
deploy_commit: PENDING
deployed_at: null
bundle_hash: null
e2e_spec: tests/e2e/T-20260603-foot-CUSTNAME-CASCADE-DASH.spec.ts
db_migration: none
regression_risk: low
reporter: planner (MSG-20260603-203123-31z2)
created_at: 2026-06-03
deadline: 2026-06-06
---

# T-20260603-foot-CUSTNAME-CASCADE-DASH

## 증상
고객명 변경 시 차트(`customers.name`)는 반영되나 대시보드 예약/체크인 카드는 구명 유지.

## 원인
대시보드가 비정규화 컬럼(`reservations.customer_name` / `check_ins.customer_name`)을 표시.
`Customers.tsx` `EditCustomerDialog.save()` 가 `customers` 만 update, 카스케이드 미처리.

## 구현 (앱레벨 병렬 update 선택)
- `src/pages/Customers.tsx` `save()`:
  - `nameChanged = newName !== (customer.name ?? '').trim()` 변경 감지.
  - `customers` update 성공 후, 변경 시에만 `reservations`/`check_ins` 의 `customer_name`
    을 `customer_id` 기준 `Promise.all` 병렬 update.
- Postgres 트리거 대신 앱레벨 선택 이유: 변경 발생 지점이 단일(EditCustomerDialog)이고,
  부분 실패를 사용자에게 즉시 토스트로 알려야(AC-2) 해서 앱 제어가 명확. 트리거는 silent.

## AC 충족
- AC-1: 이름 변경 시 customers + reservations + check_ins 모두 신규명 → 대시보드 카드 신규명 표시.
- AC-2: 부분 실패 격리 — customers update 성공 후 카스케이드만 실패하면 "고객 정보는
  저장되었습니다"(성공) + 별도 error 토스트, `onUpdated()` 호출(저장 성공 유지).
- AC-3: 무회귀 — 이름 미변경 시 카스케이드 미발생(불필요 write 없음). 기존 저장 동선 유지.
- AC-4: backfill dry-run 26건(resv 14 / check_ins 12) 산출 → planner 보고.
  ⚠️ divergent 집합이 phone-dedup 오연결(RES-NAME-MISMATCH-WARN 영역)과 혼재 →
  일괄 백필 금지. supervisor+planner 게이트 SQL(`scripts/...-backfill.sql`)로 보류.

## 정합성 메모 (RES-NAME-MISMATCH-WARN 연계)
go-forward 카스케이드는 customer_id 기준이라 오연결 행에도 이름을 덮어쓸 수 있으나,
신규 개명은 차트의 올바른 customer_id 에서만 발생 → 정상. 과거 오연결분은 customer_id
정정(datafix)이 맞는 해법이며 customer_name 백필로 은폐하지 않음.

## 산출
- 코드: `src/pages/Customers.tsx`
- spec: `tests/e2e/T-20260603-foot-CUSTNAME-CASCADE-DASH.spec.ts`
- backfill(게이트): `scripts/T-20260603-foot-CUSTNAME-CASCADE-DASH-backfill.sql`
