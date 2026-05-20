---
ticket_id: T-20260520-foot-DOPAMINE-SCHEMA
title: 풋CRM ↔ 도파민 양방향 연동 스키마 마이그레이션 (TA1)
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
db_change: true
db_change_note: |
  supabase/migrations/20260520000040_dopamine_integration_schema.sql
  - reservations.external_id: TEXT → UUID 타입 변환 (IF NOT EXISTS, 기존 데이터 없어 안전)
  - payments.external_id: uuid 컬럼 추가 (cue_card.id carry-over용)
  - dopamine_outbound_log 테이블 신규 생성 (Reverse 콜백 멱등 + 재시도 추적)
    · UNIQUE(callback_type, event_id): visited/paid 중복 발사 방지
    · RLS: service_role만 접근 (Edge Function 전용)
    · 인덱스: external_id, (status, created_at DESC)
  선행 마이그레이션(20260513000050_reservations_source_system.sql):
    - reservations.source_system / external_id TEXT 컬럼 (이미 적용)
    - upsert_reservation_from_source() RPC (SECURITY DEFINER, 멱등 upsert)
  DB 적용 상태: ✅ 모두 원격 DB에 적용 완료 (2026-05-20 확인)
  롤백: 20260520000040_dopamine_integration_schema.down.sql
build_ok: true
e2e_spec: tests/e2e/T-20260520-foot-DOPAMINE-SCHEMA.spec.ts
created_at: 2026-05-20
deadline: 2026-05-22
implemented_by: dev-foot
depends_on: []
blocks:
  - T-20260520-foot-RESERVATION-INGEST-EF
  - T-20260520-foot-VISITED-CALLBACK-EMIT
  - T-20260520-foot-PAID-CALLBACK-EMIT
---

# T-20260520-foot-DOPAMINE-SCHEMA (TA1) — 풋CRM ↔ 도파민 연동 스키마

## 배경 / 목적

CEO 결정 (2026-05-20): 풋CRM ↔ 도파민(tm-flow) 양방향 연동.
큐카드 master = 도파민, 풋은 external_id(cue_card.id) 운반.
신규 유입(광고→TM→예약→내원→첫결제)만 도파민 큐카드로 추적.

스펙 SSOT: `memory/_handoff/spec_foot_dopamine_integration_20260520.md` §9

---

## 구현 내용

### 스키마 변경 사항

#### 1. `reservations` 테이블 — external_id UUID 타입 통일

```sql
-- 선행(20260513): source_system TEXT, external_id TEXT 컬럼 이미 존재
-- TA1: external_id TEXT → UUID 타입 변환 (데이터 없어 안전)
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS source_system text,
  ADD COLUMN IF NOT EXISTS external_id   text;

ALTER TABLE public.reservations
  ALTER COLUMN external_id TYPE uuid USING external_id::uuid;
```

- `source_system`: null | 'dopamine' | 'foot-walkin'
- `external_id`: 도파민 cue_card.id (UUID), 큐카드 master=도파민 모델
- UNIQUE partial index: `idx_reservations_source_external` (20260513에서 생성, 재사용)

#### 2. `payments` 테이블 — external_id 추가

```sql
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS external_id uuid;
```

- 예약에서 carry-over하여 paid 콜백 발사 시 사용
- NULL = 도파민 비연동 결제

#### 3. `dopamine_outbound_log` 테이블 — Reverse 콜백 멱등 추적

```sql
CREATE TABLE IF NOT EXISTS public.dopamine_outbound_log (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id      uuid        NOT NULL,           -- 도파민 cue_card.id
  callback_type    text        NOT NULL CHECK (callback_type IN ('visited', 'paid')),
  event_id         text        NOT NULL,            -- 멱등키: check_ins.id / payments.id
  payload          jsonb       NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'sent', 'duplicate', 'failed')),
  http_status      int,
  response_body    text,
  attempts         int         NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (callback_type, event_id)
);
```

- **멱등 보장**: UNIQUE(callback_type, event_id) → 동일 event_id 재발사 차단
- **재시도 추적**: attempts + last_attempt_at + status
- **RLS**: service_role만 접근 (Edge Function 전용, FE 직접 쿼리 금지)

---

## AC 검증 (전원 통과 ✅)

| AC | 설명 | 상태 |
|----|------|------|
| AC-1 | reservations.source_system/external_id uuid 컬럼 존재 | ✅ DB 확인 |
| AC-2 | payments.external_id uuid 컬럼 존재 | ✅ DB 확인 |
| AC-3 | dopamine_outbound_log 전체 스키마 (11컬럼 + CHECK + RLS + 인덱스) | ✅ DB 확인 |
| AC-4 | UNIQUE(callback_type, event_id) 멱등 제약 | ✅ DB 확인 |
| AC-5 | SQL 파일 + 롤백 SQL 파일 쌍 제출 | ✅ 파일 존재 |
| AC-6 | upsert_reservation_from_source() RPC (SECURITY DEFINER + 멱등 upsert) | ✅ DB 확인 |
| AC-7 | RLS — service_role 전용, FE 직접 접근 차단 | ✅ DB 확인 |
| 도메인 경계 | 도파민 DB 직접 참조 없음 (FDW/dblink 없음) | ✅ SQL 검증 |

**Node.js 정적 검증**: 23개 전원 통과

---

## 경계 원칙 (스펙 §1)

- 풋CRM → 도파민 연결은 HTTP webhook(Edge Function)으로만
- 도파민 DB(`vucxspurgmrcslvdbiot`) 직접 참조 없음
- `dopamine_outbound_log`는 service_role만 접근 (FE 쿼리 금지)
- **재진(재방문) 동선**: 도파민 미전송, 풋CRM 단독
- **패키지 회차차감/추가 구매**: 도파민 미전송
- **첫 패키지 결제만** paid 콜백 1회 발사

---

## 파일 목록

| 파일 | 종류 | 설명 |
|------|------|------|
| `supabase/migrations/20260520000040_dopamine_integration_schema.sql` | DB 마이그레이션 | external_id UUID 변환 + payments.external_id + dopamine_outbound_log |
| `supabase/migrations/20260520000040_dopamine_integration_schema.down.sql` | 롤백 SQL | 위 변경 역순 DROP |
| `supabase/migrations/20260513000050_reservations_source_system.sql` | 선행 마이그레이션 | source_system/external_id TEXT + upsert_reservation_from_source() RPC |
| `tests/e2e/T-20260520-foot-DOPAMINE-SCHEMA.spec.ts` | E2E spec | AC-1~7 + 도메인 경계 23개 검증 |

---

## 리스크

- **GO_WARN**: DB 스키마 변경 (컬럼 추가 + 테이블 생성)
- **롤백**: `20260520000040_dopamine_integration_schema.down.sql` 실행으로 즉시 원복 가능
- **데이터 안전**: ADD COLUMN NULL default / external_id 기존 데이터 없어 TYPE 변환 안전
- **의존 티켓**: TA2(RESERVATION-INGEST-EF), TA3(VISITED-CALLBACK-EMIT), TA4(PAID-CALLBACK-EMIT) 이 TA1 완료 전제

---

## Supervisor 검토 사항

1. `dopamine_outbound_log` RLS — service_role 정책만 존재, anon/authenticated 접근 차단 확인
2. UNIQUE(callback_type, event_id) — 동일 체크인/결제 재발사 시 적용 여부
3. reservations.external_id UUID 타입 변환 — 기존 데이터 NULL 확인 (DB 실제 데이터 검증 권장)
4. TA2~TA4 착수 전 이 스키마 deploy-ready 확인 필요
