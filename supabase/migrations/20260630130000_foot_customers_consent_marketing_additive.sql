-- ============================================================
-- Migration: foot_CUSTOMERS-CONSENT-MARKETING — customers.consent_marketing ADDITIVE 1컬럼
-- Ticket: T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL (P0 hotfix)
-- ============================================================
--
-- ── 배경 (현장 RED) ───────────────────────────────────────────
--   도파민 캘린더 → 풋(종로)/문제성발톱/신규 고객 예약 확정 시 500.
--   reservation-ingest-from-dopamine EF 의 신규 customer INSERT 가
--     "Could not find the 'consent_marketing' column of 'customers' in the schema cache"
--   로 실패. dev-foot 판별 결과 = 실제 컬럼 부재(cache-stale 아님).
--   (information_schema.columns: customers 에 consent_sensitive/consent_agreed_at/
--    consent_version 만 존재, consent_marketing 부재 확인.)
--
-- ── §6-1 cross-CRM 데이터계약 정합 (신규 설계 아님) ───────────
--   도파민 push EF(foot-reservation-push)는 §6-1 계약대로
--   customer.consent_marketing 을 boolean(=false, cue_cards에 없어 기본 false)으로 운반.
--   foot ingest EF 는 이를 boolean | undefined 로 읽어 INSERT 페이로드에 조건부 적재.
--   → 수신측 컬럼 부재가 계약-결함. 본 마이그는 그 결함을 보정(conformance).
--   ※ derm CRM 의 consent_marketing(JSONB)은 도메인별 발산 표현 — foot 계약 아님.
--     foot 계약축 = 도파민 push 가 운반하는 boolean false. 동축인 sibling
--     consent_sensitive(boolean DEFAULT false)와 동일 형상으로 정렬한다.
--
-- ── 컬럼 스펙 (data-architect §6-1 CONSULT 그라운딩) ──────────
--   consent_marketing  BOOLEAN  nullable  DEFAULT FALSE
--     - type=boolean    : 도파민 push 운반형 + foot EF read 형(boolean | undefined) 정합
--     - nullable=YES    : 미운반(undefined) 행 허용 — EF는 값 있을 때만 적재(조건부)
--     - default=FALSE   : 동의 미수집 기본값. sibling consent_sensitive 와 동일 정책
--                         (미동의 행 허위 TRUE 기록 방지)
--
-- ── 비파괴 정책 (ADDITIVE only — blast 0) ─────────────────────
--   - ADD COLUMN IF NOT EXISTS (멱등) — 재적용/race 안전, cache-stale 케이스도 무해
--   - DROP/타입변경/데이터유실 0
--   - 백필 금지 — 기존 row 는 DEFAULT FALSE 로 채워짐(소급 동의 기록 아님)
--   - CHECK constraint 추가 없음 (Lovable CHECK 갱신 불요)
--   - supervisor DDL-diff 게이트 binding
--
-- ── 적용 후 PostgREST schema cache reload ────────────────────
--   ADD COLUMN 후 PostgREST 스키마 캐시가 즉시 인지하도록 NOTIFY 동봉.
--
-- 롤백: 20260630130000_foot_customers_consent_marketing_additive.rollback.sql
-- 적용: node scripts/apply_20260630130000_foot_customers_consent_marketing_additive.mjs
-- 대상 DB: foot Supabase rxlomoozakkjesdqjtvd
-- ============================================================

BEGIN;

-- ─── customers ADDITIVE 1컬럼 추가 ───────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS consent_marketing BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.customers.consent_marketing IS
  'T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL: 마케팅 정보수신 동의 (cross-CRM §6-1 계약). '
  'boolean nullable DEFAULT FALSE — 도파민 push EF 운반(boolean false) 수신축. '
  'sibling consent_sensitive(개보법 §23 민감정보 동의)와 별개 동의항목 — 오버로드 금지. '
  '기존 row 는 FALSE 유지(미동의 허위기록 방지). derm JSONB 표현 복붙 금지.';

COMMIT;

-- ─── PostgREST schema cache reload (트랜잭션 밖) ──────────────────────────────
--   신규 컬럼을 PostgREST(REST/EF supabase-js)가 즉시 인지하도록 강제 reload.
NOTIFY pgrst, 'reload schema';
