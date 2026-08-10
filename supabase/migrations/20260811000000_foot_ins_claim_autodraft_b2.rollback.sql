-- T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2) — rollback
-- 트리거 + function 3종을 제거한다(자동 생성 경로 차단).
-- ★ 데이터 보존: 자동 생성된 draft claim/claim_items 는 삭제하지 않는다(archive-first · 유효 파생 데이터).
--   자동 생성물 식별자 = insurance_claims.calculation_engine_version = 'autodraft_from_charges_v1'.
--   퇴거가 필요하면 별도 Data-Correction Backfill SOP 로 처리(본 rollback 범위 밖).

DROP TRIGGER IF EXISTS trg_service_charges_autodraft ON public.service_charges;
DROP FUNCTION IF EXISTS public.trg_service_charges_autodraft();
DROP FUNCTION IF EXISTS public.fn_rollup_insurance_claim_drafts(uuid, date, date);
DROP FUNCTION IF EXISTS public.fn_build_insurance_claim_draft(uuid);
