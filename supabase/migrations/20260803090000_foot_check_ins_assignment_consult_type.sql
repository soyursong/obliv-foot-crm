-- T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN — 배정 상담유형 수동 드롭다운 저장 컬럼 (ADDITIVE)
--
-- 요청(김주연 총괄, U0ATDB587PV): 상담·치료사 배정 → 상담 → 오늘 배정 현황/금일 배분 이력에서
--   담당(배정 실장) 옆에 '상담 성격' 드롭다운(4종: 초진/재진/당일재상담/대리상담, 기본 초진) 추가.
--   배정 초진/재진 카운트를 자동 365-recency 판정 대신 실장 수동 선택으로 확정(전향적).
--
-- ── DA 판정 (da_decision_foot_assign_consulttype_dropdown_20260726.md — CONSULT-REPLY MSG-20260726-165130-l6vd) ──
--   Q1 저장모델 = 단일 신설 enum `assignment_consult_type` 1컬럼 (기존 recency×context 2축 권고 SUPERSEDE).
--     · bare `consult_type`/`visit_type` 금지 — `visit_type`은 자동 365-recency축 점유(cross_crm_data_contract §선택컬럼 L121).
--     · 저장표준 = TEXT + named CHECK (계약 §care_category 선례). system_codes 불채택(foot 인프라 정합).
--   Q3 ADDITIVE-safe = YES. db_change=true, DDL-diff 대상.
--     · default = NULL (NOT '초진'). NOT NULL DEFAULT '초진'은 과거행에 초진 소급 assert = 백필 → 부모 "전향적만, 백필 없음" 위반.
--     · "기본 초진"은 App/UI default (신규 배정 시 드롭다운 초진 pre-select). 과거행 NULL = pre-feature/미분류.
--
-- ── 안전 성질 ──
--   · ADDITIVE — 신규 nullable 컬럼 1 + named CHECK 1. drop/rename/type-narrow 0, 백필 0, 기존 reader 무영향.
--   · 카운터 매핑(초진=배정(초진)·목표 / 재진·대리상담=배정(재진) / 당일재상담=전부 제외)의 파생 view 소비는
--     본 마이그에 미포함 — DA 파생view co-sign(auto-assign NULL 처리) 대기(planner MSG-20260803-071839-ata7 scoped hold).
--     본 마이그는 '수동 assertion 저장(SSOT)' 만 언블록. 카운터는 현행 자동축 유지.
--   · 멱등 — ADD COLUMN IF NOT EXISTS + DO 블록으로 named CHECK 존재 가드.
--
-- Rollback: 20260803090000_foot_check_ins_assignment_consult_type.rollback.sql
-- Dry-run : 20260803090000_foot_check_ins_assignment_consult_type.dryrun.sql
-- cross-CRM 영향: assignment_consult_type 는 foot-로컬 운영/관리 지표 컬럼(cross_crm_data_contract 미등재).
--   매출·원장·인센티브 데이터 경로 미접촉(DA §Q4 운영축 격리). 영향 0.

BEGIN;

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS assignment_consult_type TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_check_ins_assignment_consult_type'
      AND conrelid = 'public.check_ins'::regclass
  ) THEN
    ALTER TABLE public.check_ins
      ADD CONSTRAINT chk_check_ins_assignment_consult_type
      CHECK (
        assignment_consult_type IS NULL
        OR assignment_consult_type IN ('초진', '재진', '당일재상담', '대리상담')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.check_ins.assignment_consult_type IS
  'T-20260726-foot-ASSIGN-CONSULTTYPE-DROPDOWN: 배정 시 실장 수동 선택 상담 성격(초진/재진/당일재상담/대리상담). NULL=미분류(pre-feature/auto-assign 미오버라이드). App default=초진. 운영 카운터축 전용(매출/원장/인센티브 미접촉).';

COMMIT;
