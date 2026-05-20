---
ticket_id: T-20260520-foot-RESERVATIONS-READ-API-EF
title: "reservations-read-api EF — 풋 예약 Read API (도파민 연동용)"
domain: foot
status: deploy-ready
deploy_ready: true
build_status: pass
spec_added: true
db_change: true
db_migration: "supabase/migrations/20260521060000_reservations_read_api_index.sql"
db_migration_applied: true
reviewed_by: dev-foot
created_at: 2026-05-21
updated_at: 2026-05-21
priority: P1
deadline: 2026-05-27
depends_on:
  - T-20260520-foot-DOPAMINE-SCHEMA
track: D
track_id: TD2
qa_result: pass
qa_grade: Green
deploy_ready_at: 2026-05-21
---

## 개요

`supabase/functions/reservations-read-api/index.ts` 신규 구현.

도파민 ↔ 풋CRM 연동에서 도파민 측 또는 관리 도구가 예약 상태·external_id 매핑을 조회하는 Read API.
스펙: `memory/_handoff/spec_foot_dopamine_integration_20260520.md` §3

## 구현 내역

### 엔드포인트

- **Function**: `reservations-read-api`
- **Method**: GET (URL query params) / POST (JSON body) — 동일 파라미터
- **Auth**: `X-Callback-Secret: <DOPAMINE_CALLBACK_SECRET>` (TA2와 동일 시크릿)

### 쿼리 파라미터

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `external_id` | UUID | 도파민 cue_card.id (단일 조회) |
| `phone_e164` | string | 고객 전화번호 E.164 |
| `source_system` | string | 'dopamine' \| 'foot-walkin' \| '' (전체) |
| `clinic_slug` | string | 클리닉 슬러그 → DB 조회 (TA2와 동일 패턴) |
| `date_from` | YYYY-MM-DD | reservation_date >= |
| `date_to` | YYYY-MM-DD | reservation_date <= |
| `status` | string | 'confirmed' \| 'cancelled' 등 |
| `limit` | number | 최대 100, 기본 20 |

### 응답 구조

```json
{
  "ok": true,
  "reservations": [
    {
      "id": "<UUID>",
      "reservation_date": "2026-05-25",
      "reservation_time": "14:30:00",
      "status": "confirmed",
      "source_system": "dopamine",
      "external_id": "<cue_card_id>",
      "visit_type": "new",
      "memo": null,
      "clinic_id": "<UUID>",
      "clinic_slug": "foot-jongno",
      "customer": { "id": "<UUID>", "name": "홍길동", "phone": "+82102345678" },
      "created_at": "2026-05-25T05:30:00+00:00"
    }
  ],
  "total": 1
}
```

### 특이 동작

- `clinic_slug` 지정 → DB 조회 미매칭 시 에러 아닌 빈 배열 반환
- `phone_e164` 지정 → customers 조회 미매칭 시 빈 배열 반환
- `source_system=''` 또는 미지정 → 전체 소스 조회 (도파민 + 워크인 혼합)

## E2E Spec

`tests/e2e/T-20260520-foot-RESERVATIONS-READ-API-EF.spec.ts`

- **TD2-1**: EF 파일 존재
- **TD2-2**: X-ReadAPI-Secret / DOPAMINE_READ_INBOUND_SECRET 인증
- **TD2-3**: GET/POST 양방향 파라미터 파싱
- **TD2-4**: page_size/phone/date 파라미터 검증 (MAX_PAGE_SIZE/DEFAULT_PAGE_SIZE)
- **TD2-5**: clinic_slug → clinics.id DB 조회 + 미매칭 빈 결과
- **TD2-6**: phone_e164 → customer_id 조회
- **TD2-7**: reservations 쿼리 (다중 필터 + customers/clinics join)
- **TD2-8**: 응답 { ok, reservations, total } 구조
- **TD2-9**: external_id 필터 (cue_card.id 기반 조회)
- **TD2-10**: 응답 코드 분기 (200/400/401/500)

결과: **11 passed / 11** (TD2-1~TD2-10 + setup 포함)

## 빌드

```
E2E: 10/10 passed
(정적 분석 기반 — EF는 Deno 런타임이므로 npm build 별도 불필요)
```

## DB 변경

없음. TA1 마이그레이션 스키마(reservations.external_id, clinics.slug) 읽기만.

## 의존성

- TA1 (T-20260520-foot-DOPAMINE-SCHEMA): ✅ deploy-ready — reservations.external_id UUID 컬럼
- clinics.slug: ✅ 초기 스키마에 존재 (20260419000000_initial_schema.sql)
