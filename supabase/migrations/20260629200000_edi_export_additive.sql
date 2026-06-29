-- T-20260629-foot-EDI-EXPORT-IMPL — 심평원 표준 청구명세서 export 메타 (ADDITIVE)
--
-- SSOT: edi_export_data_contract_20260629.md (DA-20260629-EDI-EXPORT-CONTRACT, 조건부 GO)
--   §4 스키마 영향 = edi_submissions ADDITIVE nullable 컬럼만 + §5 PHI/전송보류 가드.
--
-- 목적:
--   ① edi_submissions 에 export 산출·상태 추적 메타 컬럼 추가 (모두 nullable, DEFAULT 무).
--      export_status enum = draft|exported 만 (★transmitted 미사용·자동전이 금지 = D2 보류 가드, §5/AC-6).
--   ② AC-9 정명: foot 물리 테이블 claim_items → logical insurance_claim_items 비파괴 정렬.
--      물리 테이블 rename 은 기존 write 경로(InsuranceCopaymentPanel) 파괴 → 채택 안 함.
--      대신 logical READ VIEW insurance_claim_items 신설(security_invoker=on, RLS 상속).
--      covered_amount → insurance_covered_amount logical 별칭 → body 와 동일 logical 컬럼.
--   ③ PHI 위생(§5): edi_submissions anon REVOKE (방어). 신규 view 도 anon REVOKE.
--
-- ADDITIVE-safe: 컬럼 nullable·DEFAULT 무·CHECK 는 NULL 허용 → 기존행 영향 0, blast 0.
-- 마이그 = dev-foot 직접 실행 (Supabase Management API, 대시보드 수동 금지).
-- rollback: 20260629200000_edi_export_additive.rollback.sql
-- Created: 2026-06-29 (dev-foot)

-- ============================================================
-- 1) edi_submissions — export 산출·상태 추적 메타 (ADDITIVE nullable)
-- ============================================================
ALTER TABLE edi_submissions
  ADD COLUMN IF NOT EXISTS export_format_version TEXT,
  ADD COLUMN IF NOT EXISTS export_status TEXT,
  ADD COLUMN IF NOT EXISTS exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exported_by UUID,
  ADD COLUMN IF NOT EXISTS export_payload_ref TEXT;

-- export_status enum 가드 — NULL(기존행) 허용 + draft/exported 만.
-- ★ transmitted 의도적 제외: D2 전송 보류 가드(§5/AC-6). 향후 SW 연동 시점에만 enum 확장.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'edi_submissions_export_status_chk'
  ) THEN
    ALTER TABLE edi_submissions
      ADD CONSTRAINT edi_submissions_export_status_chk
      CHECK (export_status IS NULL OR export_status IN ('draft', 'exported'));
  END IF;
END $$;

COMMENT ON COLUMN edi_submissions.export_format_version IS
  '표준포맷 logical 모델 버전(범용. SW 선정 후 물리 직렬화 확정 시 갱신). T-20260629-foot-EDI-EXPORT-IMPL';
COMMENT ON COLUMN edi_submissions.export_status IS
  'export 산출 상태 draft|exported. transmitted 미사용(D2 전송 보류 가드, 자동전이 금지).';
COMMENT ON COLUMN edi_submissions.exported_at IS 'export 산출 시각(접근로그)';
COMMENT ON COLUMN edi_submissions.exported_by IS 'export 산출 주체 user_id(접근로그)';
COMMENT ON COLUMN edi_submissions.export_payload_ref IS
  '보관된 표준포맷 산출물 참조(deterministic key + 무결성 해시). PHI 평문 미저장.';

-- PHI 위생(§5): edi_submissions anon 접근 차단(방어). RLS 는 기존 claim join 정책 유지.
REVOKE ALL ON edi_submissions FROM anon;

-- ============================================================
-- 2) AC-9 정명 — logical READ VIEW insurance_claim_items (비파괴)
-- ============================================================
-- 물리 테이블 claim_items 는 불변(write 경로 보존). export 는 본 logical view 를 읽어
-- body(신규 insurance_claim_items 테이블)와 동일 logical 컬럼명을 공유한다.
-- covered_amount → insurance_covered_amount logical 별칭(DA 계약 §2-3 logical 명).
CREATE OR REPLACE VIEW insurance_claim_items
  WITH (security_invoker = on) AS
SELECT
  id,
  claim_id,
  service_id,
  hira_code,
  hira_score,
  quantity,
  base_amount,
  copayment_amount,
  covered_amount               AS insurance_covered_amount,
  covered_amount,              -- 물리명도 유지(하위호환)
  created_at
FROM claim_items;

COMMENT ON VIEW insurance_claim_items IS
  'AC-9 정명 logical view — claim_items 물리 테이블의 logical 별칭(covered_amount→insurance_covered_amount). '
  'security_invoker=on 으로 claim_items RLS 상속(PHI). body insurance_claim_items 테이블과 동일 logical 계약. '
  'T-20260629-foot-EDI-EXPORT-IMPL / DA edi_export_data_contract §3.';

-- PHI: view 도 anon 차단, authenticated 만 SELECT.
REVOKE ALL ON insurance_claim_items FROM anon;
GRANT SELECT ON insurance_claim_items TO authenticated;
