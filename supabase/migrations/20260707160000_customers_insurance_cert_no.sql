-- T-20260707-foot-CHART2-INSURANCE-CERTNO-FIELD — 2번차트 건보조회 칸 보험 증번호(건강보험증 번호) 필드 신설
-- DA 게이트: CONSULT-REPLY __PENDING__ (신규 PII 컬럼 — data-architect CONSULT 선행 필수, GO 조건 반영 후 본 헤더에 MSG id 기입)
--   축: cross_crm_data_contract customers PII 확장(신규 축 아님). 기존 customers PII 보호정책(RLS·마스킹) 상속.
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
