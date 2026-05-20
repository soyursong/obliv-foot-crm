---
ticket_id: T-20260520-foot-RESERVATION-INGEST-EF
title: "reservation-ingest-from-dopamine EF v2 — clinic_slug→clinics.id DB 조회 + 스키마 불일치 5건 수정"
domain: foot
status: deploy-ready
deploy_ready: true
build_status: pass
spec_added: true
db_change: false
reviewed_by: dev-foot
created_at: 2026-05-20
updated_at: 2026-05-21
priority: P0
qa_fail_phase: phase1 → v2 FIX-REQUEST 반영 완료
---

## 개요

`supabase/functions/reservation-ingest-from-dopamine/index.ts`
- **v1** (phase1): reservations INSERT 스키마 불일치 5건 수정
- **v2** (FIX-REQUEST 2026-05-21): clinic_slug → clinics.id DB 조회 로직 강화 (FOOT_CLINIC_ID env var 의존 제거)

## v2 수정 내역 (FIX-REQUEST 반영)

### clinic_slug → clinics.id DB 조회 (결함 3 재강화)
- 기존: `FOOT_CLINIC_ID` env var 조기 필수 검증 (DB 조회 없음)
- v2: payload의 `clinic_slug` → `clinics` 테이블 `slug` 컬럼 DB 조회 → `clinicId` 동적 획득
- `clinic_slug` 필수 필드 승격 (없으면 400 MISSING_FIELD)
- slug DB 미매칭 시 422 `CLINIC_NOT_FOUND` 반환
- `FOOT_CLINIC_ID` env var 의존 제거 → 단일 지점(DB) 관리

## v1 수정 내역 (phase1 QA fail 해소)

### 결함 1 — `reservation_date DATE NOT NULL` 미제공
- `scheduledAt` ISO 8601 문자열에서 `substring(0, 10)` 로 date 추출
- `rsvPayload.reservation_date: scheduledDate` 추가

### 결함 2 — `reservation_time TIME NOT NULL` 미제공
- `scheduledAt`에서 `substring(11, 19)` 로 time 추출
- `rsvPayload.reservation_time: scheduledTime` 추가

### 결함 3 — `clinic_id UUID NOT NULL` 조건부 생략
- v2에서 DB 조회 방식으로 완전 해소

### 결함 4 — `scheduled_at` 컬럼 미존재
- `rsvPayload.scheduled_at` 제거 (reservations 테이블에 컬럼 없음)
- 결함 1/2에서 분리 저장으로 대체

### 결함 5 — `slot_type`, `campaign_id`, `adset_id`, `ad_id` 위치 오류
- `slot_type` → `visit_type` 매핑 (`new_consult` → `'new'`, else `'returning'`)
- `campaign_id`/`adset_id`/`ad_id` → `reservations` 제거, `customers` 컬럼으로 이동

## E2E Spec

`tests/e2e/T-20260520-foot-RESERVATION-INGEST-EF.spec.ts` v2 갱신

- **TA2-9** 갱신: clinic_slug 필수 + DB 조회 로직 검증
- **TA2-10** 교체: FOOT_CLINIC_ID → clinic_slug→clinics.id DB 조회 + env var 의존 제거 검증
- **TA2-11** 신규: clinic_slug DB 미매칭 → 422 CLINIC_NOT_FOUND 검증

결과: **11 passed / 11**

## 빌드

```
✓ built in ~3s  (npm run build)
E2E: 11/11 passed
```

## DB 변경

없음. 기존 스키마 컬럼만 사용.
clinics.slug 컬럼은 초기 스키마(20260419000000)에 존재.
reservations.external_id UUID 타입은 TA1 마이그레이션(20260520000040)에서 완료.
