---
id: T-20260521-foot-WALKIN-MEMO-GAP
title: "워크인 메모 갭 — check_in_id 3순위 fallback (수기 생성 walk-in customer=NULL 케이스)"
status: deploy-ready
priority: P2
domain: foot
reporter: ops-planner (MQ MSG-20260521-020313-trrb)
assignee: dev-foot
created: 2026-05-21
deadline: 2026-05-27
deploy_ready: true
deploy_ready_at: "2026-05-21T03:10:00+09:00"
deploy_ready_by: dev-foot
db_change: true
db_migration: "supabase/migrations/20260521050000_resv_memo_checkin_id.sql"
db_rollback: "supabase/migrations/20260521050000_resv_memo_checkin_id.down.sql"
build_pass: true
spec_added: true
e2e_spec: "tests/e2e/T-20260521-foot-WALKIN-MEMO-GAP.spec.ts"
regression_risk: low
qa_result: pending
---

## 배경

T-20260520-foot-RESV-MEMO-WALKIN에서 `customer_id` nullable + FK를 추가해 예약 없는 워크인도
메모 작성이 가능하게 했으나, 직원이 전화번호 없이 수기 생성한 walk-in check_in의 경우
`check_ins.customer_id = NULL` → `effectiveKey = null` → 메모 비활성 상태가 남아 있었음.

## 수용 기준 (AC)

- **AC-1**: 예약 없어도 2번차트에서 메모 작성 가능 (customer 기반 fallback)
- **AC-2**: 기존 예약 연결 메모와 공존 — 회귀 없음
- **AC-3**: 메모 히스토리 타임라인 정상 표시
- **AC-4**: 1번차트 체크인 컨텍스트에서 `check_in_id` fallback 활성 — 콘솔 에러 없음

## 구현

### FE — ReservationMemoTimeline.tsx

- `checkInId?: string | null` prop 추가
- effectiveKey 3순위 fallback: `reservation_id → customer_id → check_in_id`
- SELECT query에 `check_in_id` 컬럼 추가
- INSERT/filter 로직에 `check_in_id` fallback 반영

### FE — CheckInDetailSheet.tsx

- `<ReservationMemoTimeline>` 호출에 `checkInId={checkIn?.id}` prop 전달

### DB — reservation_memo_history

- `check_in_id uuid REFERENCES check_ins(id) ON DELETE CASCADE` 컬럼 추가
- `idx_rmh_check_in_id` 인덱스 생성
- `chk_rmh_id_present` CHECK 제약 갱신: `reservation_id OR customer_id OR check_in_id`

## 연관 티켓

- T-20260520-foot-RESV-MEMO-WALKIN (선행): customer_id 기반 fallback
- T-20260521-foot-WALKIN-MEMO-GAP (본 티켓): check_in_id 3순위 fallback

## 리스크

| # | 항목 | 해당 | 비고 |
|---|------|------|------|
| 1 | DB 스키마 변경 | O | nullable 컬럼 추가 — 기존 행 영향 없음 |
| 2 | 외부 서비스 의존 | X | — |
| 3 | 비즈니스 로직 변경 | X | 기존 로직 확장만 |
| 4 | 대량 데이터 변경 | X | — |
| 5 | 신규 npm 패키지 | X | — |
