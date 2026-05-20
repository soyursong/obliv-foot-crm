---
ticket_id: T-20260520-foot-RESERVATION-INGEST-EF
title: "reservation-ingest-from-dopamine EF — reservations INSERT 스키마 불일치 5건 수정"
domain: foot
status: deploy-ready
deploy_ready: true
build_status: pass
spec_added: true
db_change: false
reviewed_by: dev-foot
created_at: 2026-05-20
updated_at: 2026-05-20
priority: P0
qa_fail_phase: phase1 (FIX-REQUEST from supervisor)
---

## 개요

`supabase/functions/reservation-ingest-from-dopamine/index.ts` (`rsvPayload`)가
`reservations` 테이블 스키마와 맞지 않아 운영 시 전건 INSERT FAIL 하던 결함 5건 수정.

## 수정 내역

### 결함 1 — `reservation_date DATE NOT NULL` 미제공
- `scheduledAt` ISO 8601 문자열에서 `substring(0, 10)` 로 date 추출
- `rsvPayload.reservation_date: scheduledDate` 추가

### 결함 2 — `reservation_time TIME NOT NULL` 미제공
- `scheduledAt`에서 `substring(11, 19)` 로 time 추출
- `rsvPayload.reservation_time: scheduledTime` 추가

### 결함 3 — `clinic_id UUID NOT NULL` 조건부 생략
- `FOOT_CLINIC_ID` 조기 필수 검증 (핸들러 진입 직후, try 블록 전)
- 미설정 시 즉시 500 반환
- `rsvPayload` / `insertPayload` 에서 조건부 spread 제거 → 직접 할당

### 결함 4 — `scheduled_at` 컬럼 미존재
- `rsvPayload.scheduled_at` 제거 (reservations 테이블에 컬럼 없음)
- 결함 1/2에서 분리 저장으로 대체

### 결함 5 — `slot_type`, `campaign_id`, `adset_id`, `ad_id` 위치 오류
- `slot_type` → `visit_type` 매핑 (`new_consult` → `'new'`, else `'returning'`)
- `campaign_id`/`adset_id`/`ad_id` → `reservations` 제거, `customers` 컬럼으로 이동
  - 신규 고객 `insertPayload` 에 추가
  - 기존 고객 `update` 에도 선택적 반영

## E2E Spec

`tests/e2e/T-20260520-foot-RESERVATION-INGEST-EF.spec.ts` 갱신

- **TA2-3** 업데이트: `reservation_date`/`reservation_time` 포함 + `scheduled_at` 직접 삽입 없음 검증
- **TA2-8** 업데이트: `reservation_date`/`reservation_time`/`clinic_id` 필수 포함 + `scheduled_at:`/`campaign_id:`/`adset_id:`/`ad_id:` 부재 검증
- **TA2-10** 신규: `FOOT_CLINIC_ID` 조기 검증 + 조건부 spread 금지

결과: **11 passed / 11**

## 빌드

```
✓ built in 3.14s  (npm run build)
tsc -b --force — 에러 없음
```

## DB 변경

없음. 기존 스키마 컬럼만 사용.
