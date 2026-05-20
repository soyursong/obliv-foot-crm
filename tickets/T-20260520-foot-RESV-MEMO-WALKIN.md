---
id: T-20260520-foot-RESV-MEMO-WALKIN
domain: foot
priority: P2
status: deploy-ready
qa_result: pending
deploy_commit: d947bda
deployed_at:
hotfix: false
created: 2026-05-20 20:00
deadline: 2026-05-27
assignee: dev-foot
reporter: planner
risk_verdict: GO_WARN
risk_reason: "DB 변경(reservation_id nullable + customer_id 추가) + 비즈로직 변경. DB 마이그레이션 supervisor 이관 필수."
db_change: true
db_migration: supabase/migrations/20260520130000_resv_memo_walkin.sql
db_rollback: supabase/migrations/20260520130000_resv_memo_walkin.down.sql
e2e_spec: tests/e2e/T-20260520-foot-RESV-MEMO-WALKIN.spec.ts
depends_on:
  - T-20260515-foot-RESV-MEMO-APPEND (deployed)
  - T-20260516-foot-C2Z1-MEMO-SYNC (deployed)
  - T-20260516-foot-RESV-MEMO-C1-SYNC (deployed)
  - T-20260516-foot-RESV-MEMO-REVISIT (deployed)
cross_crm:
  - foot: obliv-foot-crm (본 티켓)
deploy_ready_at: 2026-05-20
---

# T-20260520-foot-RESV-MEMO-WALKIN — 워크인 고객 예약메모 customer_id fallback

## 요약

예약 없는 고객(워크인 등)도 예약메모 작성/열람 가능하도록 `customer_id` fallback 구현.

## 배경

RESV-MEMO-C2-ROUTE(deployed) 구현에서 `ReservationMemoTimeline`이 `reservations[0]?.id` 기준 동작 → 예약 없는 고객(워크인 등)은 "연결된 예약 없음" fallback → 메모 작성 불가.

## 수용 기준 (AC) 및 이행

### AC-1: 2번차트 1구역 예약메모 — reservation_id 없어도 메모 작성 가능 ✅
- `CustomerChartPage.tsx`: `reservationId={reservations[0]?.id}` + `customerId={customerId}` 동시 전달
- 예약 없으면 `customer_id` 기준으로 fetch/insert

### AC-2: 1번차트(CheckInDetailSheet) 동일 fallback 적용 ✅
- `CheckInDetailSheet.tsx` 두 곳 모두 `customerId` prop 추가
  - 1번차트(customerMode): `customerId={customerMode?.customerId}`
  - 2번차트(checkIn): `customerId={checkIn?.customer_id ?? resolvedCustomerId ?? undefined}`

### AC-3: customer_id 기준 fallback (A안) ✅
- `reservation_memo_history.reservation_id` NOT NULL → nullable
- `reservation_memo_history.customer_id uuid FK → customers` 추가
- `idx_rmh_customer_id` 인덱스 추가
- `chk_rmh_id_present` CHECK (reservation_id IS NOT NULL OR customer_id IS NOT NULL)

### AC-4: 예약 있는 고객 기존 동작 회귀 없음 ✅
- `effectiveKey = reservationId ? 'resv:...' : customerId ? 'cust:...' : null`
- `reservationId` 있으면 기존 `reservation_id` 기준 동작 그대로

### AC-5: 빌드 성공 + E2E 회귀 없음 ✅
- `npm run build` → ✅ 3.14s
- E2E spec: `tests/e2e/T-20260520-foot-RESV-MEMO-WALKIN.spec.ts` (AC-1/2/4/5 4케이스)

## DB 마이그레이션

```sql
-- supervisor가 실행해야 할 마이그레이션
-- 파일: supabase/migrations/20260520130000_resv_memo_walkin.sql
ALTER TABLE reservation_memo_history ALTER COLUMN reservation_id DROP NOT NULL;
ALTER TABLE reservation_memo_history ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_rmh_customer_id ON reservation_memo_history(customer_id);
ALTER TABLE reservation_memo_history ADD CONSTRAINT chk_rmh_id_present CHECK (reservation_id IS NOT NULL OR customer_id IS NOT NULL);
```

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/components/ReservationMemoTimeline.tsx` | reservationId optional + customerId prop 추가, fetch/insert 이중 경로 |
| `src/pages/CustomerChartPage.tsx` | 예약메모 조건부 렌더 → 항상 렌더 (customerId 전달) |
| `src/components/CheckInDetailSheet.tsx` | 두 곳 모두 customerId fallback 적용 |
| `supabase/migrations/20260520130000_resv_memo_walkin.sql` | DB 마이그레이션 (supervisor 이관) |
| `supabase/migrations/20260520130000_resv_memo_walkin.down.sql` | 롤백 SQL |
| `tests/e2e/T-20260520-foot-RESV-MEMO-WALKIN.spec.ts` | E2E 4케이스 |

## 리스크

| # | 항목 | 판정 |
|---|------|------|
| 1 | DB 스키마 변경 | **Y** — reservation_id nullable + customer_id 추가 (supervisor 마이그 필요) |
| 2 | 외부 서비스 의존 | N |
| 3 | 비즈니스 로직 변경 | **Y** — fetch/insert 경로 이중화 |
| 4 | 대량 데이터 변경 | N |
| 5 | 신규 npm 패키지 | N |

**판정: GO_WARN (2/5)**

## 롤백 SQL

```sql
-- supabase/migrations/20260520130000_resv_memo_walkin.down.sql
ALTER TABLE reservation_memo_history DROP CONSTRAINT IF EXISTS chk_rmh_id_present;
DROP INDEX IF EXISTS idx_rmh_customer_id;
ALTER TABLE reservation_memo_history DROP COLUMN IF EXISTS customer_id;
-- 주의: customer_id 기반 데이터 존재 시 아래 실패
ALTER TABLE reservation_memo_history ALTER COLUMN reservation_id SET NOT NULL;
```
