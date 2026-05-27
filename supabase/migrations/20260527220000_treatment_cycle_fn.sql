-- ============================================================
-- T-20260527-foot-TREATMENT-CYCLE-ALERT
-- 치료회차 기반 경과체크 + 6배수 진료 알림
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- 작성: dev-foot / 2026-05-27
-- 롤백: 20260527220000_treatment_cycle_fn.rollback.sql
-- risk: CREATE FUNCTION + CREATE INDEX only. 기존 테이블 변경 없음. GO (0/5)
-- ============================================================

BEGIN;

-- ── 인덱스: check_ins 치료완료 행 빠른 집계 (N+1 방지) ──────────────────────

CREATE INDEX IF NOT EXISTS idx_check_ins_done_customer
  ON public.check_ins (clinic_id, customer_id)
  WHERE status = 'done';

COMMENT ON INDEX public.idx_check_ins_done_customer IS
  'T-20260527-foot-TREATMENT-CYCLE-ALERT AC-4: 고객별 완료 치료 회차 집계 쿼리 최적화';

-- ── DB 함수: 고객 목록의 완료 회차 수를 한 번에 집계 ─────────────────────────
-- 단일 JOIN 쿼리 → N+1 완전 차단
-- SECURITY INVOKER: 호출자 권한(RLS) 그대로 적용

CREATE OR REPLACE FUNCTION public.get_treatment_cycle_counts(
  p_clinic_id    UUID,
  p_customer_ids UUID[]
)
RETURNS TABLE (
  customer_id     UUID,
  completed_count INTEGER
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    ci.customer_id::UUID,
    COUNT(*)::INTEGER AS completed_count
  FROM public.check_ins ci
  WHERE ci.clinic_id   = p_clinic_id
    AND ci.customer_id = ANY(p_customer_ids)
    AND ci.status      = 'done'
  GROUP BY ci.customer_id;
$$;

COMMENT ON FUNCTION public.get_treatment_cycle_counts(UUID, UUID[]) IS
  'T-20260527-foot-TREATMENT-CYCLE-ALERT AC-1/AC-4:
   특정 클리닉의 고객 목록별 완료(done) 치료 회차 수를 단일 쿼리로 반환.
   패키지 무관. 6배수(6,12,18...) 판정은 FE에서 수행.';

-- EXECUTE 권한 (authenticated 역할)
GRANT EXECUTE ON FUNCTION public.get_treatment_cycle_counts(UUID, UUID[]) TO authenticated;

COMMIT;
