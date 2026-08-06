-- T-20260629-foot-GRADE-ENUM-INSERT-VALIDATE — AC-4: legacy 'manual' 등급 스냅샷 정규화 backfill
--
-- 권위: DA-20260806-foot-GRADE-ENUM-2-2-2-FINALIZE (MSG-20260806-193530-najs)
--   AC-4: 비급여건 현 금액영향 0이나 급여 go-live 전 backfill 정규화 완료(환수 리스크 선제차단).
--   AC-3(#5 rate 미기록 backfill) = live census(2026-08-06) 결과 copayment_rate_at_charge NULL 행 0건 → NO-OP.
--
-- 대상: service_charges 의 legacy 'manual' 등급 행(DocumentPrintPanel.handleAddService 비급여 수기추가 산물).
--   census(2026-08-06): 20건, 전건 fingerprint 일치 = is_insurance_covered=false AND copayment_rate_at_charge=1.000.
--   'manual' = 등급 아님(DA sentinel). 비급여 수기 line 이라 유효 자격등급 미상 → 정직값 'unverified' 로 정규화.
--
-- ── 안전 (Data-Correction Backfill SOP 준수) ─────────────────────────────────
--   · 버그경로 지문 교집합: grade='manual' AND is_insurance_covered=false AND copayment_rate_at_charge=1.0
--     (단일 count 기준 blanket UPDATE 금지 — DocumentPrintPanel 지문에 정확히 매칭되는 행만).
--   · 대상셋 freeze: _backfill_sc_manual_grade_20260806 에 대상 id·판정근거 스냅샷 동봉(감사·롤백 앵커).
--   · 금액영향 0: copayment_rate_at_charge·copayment_amount·base_amount 무변경(등급 라벨만 정규화).
--   · 폴백/롤백: rollback 이 freeze 스냅샷 기준 id 별로 'manual' 원복.
--   · 원장 무접점: 의사(진료대시보드/진료관리) 화면 무접촉 — service_charges = billing 명세 grain.
--
-- change-class = 데이터 정정(mutable 필드 UPDATE, 스키마 무변경). ADDITIVE(신규 아카이브 테이블 + 라벨 UPDATE).
-- 게이트: gate.da_consult=resolved(AC-4 명시 in-scope) · supervisor DDL-diff.
--
-- Rollback: 20260806194200_foot_service_charges_manual_grade_backfill.rollback.sql
-- Dry-run : 20260806194200_foot_service_charges_manual_grade_backfill.dryrun.mjs
-- author: dev-foot / 2026-08-06

-- ============================================================
-- 1) 대상셋 freeze + 판정근거 스냅샷 (멱등: 이미 있으면 재생성 안 함)
-- ============================================================
CREATE TABLE IF NOT EXISTS _backfill_sc_manual_grade_20260806 (
  id                       UUID PRIMARY KEY,
  old_grade                TEXT NOT NULL,
  is_insurance_covered     BOOLEAN,
  copayment_rate_at_charge NUMERIC,
  copayment_amount         INTEGER,
  base_amount              INTEGER,
  calculated_at            TIMESTAMPTZ,
  frozen_at                TIMESTAMPTZ DEFAULT now()
);

INSERT INTO _backfill_sc_manual_grade_20260806
  (id, old_grade, is_insurance_covered, copayment_rate_at_charge, copayment_amount, base_amount, calculated_at)
SELECT id, customer_grade_at_charge, is_insurance_covered, copayment_rate_at_charge,
       copayment_amount, base_amount, calculated_at
FROM service_charges
WHERE customer_grade_at_charge = 'manual'
  AND is_insurance_covered = false
  AND copayment_rate_at_charge = 1.0
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2) 정규화 UPDATE — freeze 셋 기준 id 별 'manual' → 'unverified' (금액 컬럼 무변경)
-- ============================================================
UPDATE service_charges sc
SET customer_grade_at_charge = 'unverified'
FROM _backfill_sc_manual_grade_20260806 f
WHERE sc.id = f.id
  AND sc.customer_grade_at_charge = 'manual';   -- 재실행 안전(이미 정규화된 행 제외)
