-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK — T-20260716-foot-EXPPASS-TREATTYPE-CHECK-EXPAND
-- packages.treatment_type CHECK 6토큰 → 5토큰 원복('체험권' 제거).
--
-- ⚠ 순서 필수: 5토큰 CHECK 재적용은 packages.treatment_type='체험권' 값이 존재하면 실패한다.
--    → (선행) 체험권 forward-capture 값을 NULL 로 원복한 뒤 CHECK 를 좁힌다.
--    (백필이 별도 게이트로 이미 실행됐다면 그 백필 롤백을 먼저 수행 후 이 파일 실행.)
--
-- 적용 전 스냅샷(권장):
--   CREATE TABLE IF NOT EXISTS _rollback_snap_pkg_exppass_20260716 AS
--     SELECT id, treatment_type FROM public.packages WHERE treatment_type = '체험권';
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- (선행) 체험권 forward-capture 원복 — 5토큰 CHECK 위반 방지.
UPDATE public.packages
  SET treatment_type = NULL
  WHERE treatment_type = '체험권';

-- (본체) CHECK 5토큰으로 원복 (named constraint 동일명 보존).
ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS chk_packages_treatment_type;

ALTER TABLE public.packages
  ADD CONSTRAINT chk_packages_treatment_type
  CHECK (treatment_type IS NULL OR treatment_type IN ('비가열','가열','포돌로게','수액','Re:Born'));

COMMENT ON COLUMN public.packages.treatment_type IS
  'T-20260708 패키지 시술유형 태깅(수동 선택, 통계 시술유형별 객단가 집계용). CHECK 5토큰(비가열/가열/포돌로게/수액/Re:Born, 저장값=canonical, FE 표시 "리본"). session_type→treatment_type 런타임 파생(차감이벤트 grain)과 별 축 — 병합 금지. NULL=레거시/미태깅 허용.';

-- (원장) 원복
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260716120000';

COMMIT;
