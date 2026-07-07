-- T-20260707-foot-CHART2-INSURANCE-CERTNO-FIELD — 2번차트 건보조회 칸 보험 증번호(건강보험증 번호) 필드 신설
-- DA 게이트: CONSULT-REPLY GO = MSG-20260707-160129-j591 (data-architect, 2026-07-07)
--   판정: (1) ADDITIVE=GO (회귀 0, IF NOT EXISTS·nullable·backfill 0·멱등·롤백 pair·파괴변경 아님)
--         (2) 저장보호 = 일반 PII tier (birth_date/medical_license_no 동급). 고유식별정보(개보법 시행령 §19 4종) 아님,
--             민감정보(§23) 아님, RRN 파생 아님 → 평문 TEXT NULL 허용. pgsodium/rrn_vault·phi_access_log 불요.
--         (3) insurance_cert_no TEXT NULL = GO. CHECK 제약 신설 금지(포맷 가변 — 외국인·표기변형 유효값 거부 위험). NOT NULL 금지.
--   RLS: §16-1 canonical 술어 상속(is_approved_user() AND clinic_id=current_user_clinic_id()). 신규 RLS surface 0.
--        SELECT role=기존 chart#2 화면 상속. anon 절대 비노출(§16-3, birth_date/race 동형).
--   축: cross_crm_data_contract customers PII 확장(신규 축 아님). schema_registry customers.insurance_cert_no 등재 완료.
--   조건: supervisor DDL-diff PHI DB-GATE 필수(customers=PHI 인접, §16 canonical drift 검증 + 롤백SQL 동봉).
--
-- 배경: 건보 자격조회 API 미연동 상태에서 스태프가 건강보험증 번호를 고객메모 자유텍스트에
--       수기 기록하는 workaround(검색·정합·재사용 불가) → 전용 컬럼으로 대체.
-- 안전: ADDITIVE only · IF NOT EXISTS · nullable · 백필 없음 · 멱등 · 파괴변경 아님
-- 롤백: 20260707160000_customers_insurance_cert_no.rollback.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- customers 신규 컬럼 (nullable, 선택 입력). 건강보험증 번호 = PII.
--   저장 경로: 1차 스태프 수기 입력, 2차(API 연동 시) 자격조회 payload 자동 채움.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS insurance_cert_no TEXT;

COMMENT ON COLUMN public.customers.insurance_cert_no IS
  '건강보험증 번호(보험 증번호) — PII. 2번차트 건보조회 행 수기 입력 + (API 연동 시) 자격조회 자동채움. T-20260707-foot-CHART2-INSURANCE-CERTNO-FIELD';

-- ─────────────────────────────────────────────────────────────────────────────
-- 검증
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='customers' AND column_name='insurance_cert_no') THEN
    RAISE EXCEPTION 'customers.insurance_cert_no 컬럼 추가 실패';
  END IF;
END $$;

COMMIT;
