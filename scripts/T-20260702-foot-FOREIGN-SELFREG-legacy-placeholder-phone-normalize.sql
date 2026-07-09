-- ============================================================
-- T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC  [STAGE2 (d) — 별도 CORRECTIVE, 크리티컬패스 분리]
--   legacy "000..." placeholder phone 4행 → canonical person-distinct 토큰(DUMMY-<uuid>) 정규화.
-- SSOT: planner NEW-TASK MSG-20260709-175622-rk4d
--       + DA-20260709-foot-FOREIGN-SELFREG-PHONE-DUMMY-STAGE2 (ii)
-- 준수: Cross-CRM Data-Correction 백필 SOP v1.0 (agents/docs/data_correction_backfill_sop.md)
-- 작성: dev-foot / 2026-07-09
-- 롤백: T-20260702-foot-FOREIGN-SELFREG-legacy-placeholder-phone-normalize.rollback.sql (before-image 복원)
-- 게이트: supervisor. STAGE2 스키마(20260709120000 트리거) 적용 後 실행(트리거가 phone_dummy=true 자동 파생).
-- ⚠ DDL 0 (순수 데이터 UPDATE) → schema_migrations 원장 무접점(SOP §4). data-correction 아티팩트로 버전관리.
--
-- ── SOP 준수 요약 ─────────────────────────────────────────────────────────────
--   §0 분류: phone 은 mutable 필드이나, 대상 4값은 실 join key 아닌 bogus placeholder(전화 아님).
--            원장/차트/encounter 무접점 → mutable PII 정정(파괴적 아님). DA 판정 지지.
--   §1  단일 count UPDATE 금지 → PK 프리즈 + 값-지문 교집합.
--   §2  버그경로 지문 = "무전화 접수 시 스태프가 손입력한 애드혹 placeholder 리터럴"
--        (정확히 '0' / '000' / '000-0001-1111' / '000-0111-0000'). 실번호(010-…)·정규 로컬(0103557…)은 대상 아님.
--   §3-1 freeze: WHERE id IN (frozen 4 PK) AND phone IN (4 exact 리터럴). confirm↔실행 drift 0.
--   §3-2 스냅샷: 아래 before-image 표 + 실행 전 DO NOTICE 로그(감사 trail). 롤백 스크립트가 복원.
--   §3-3 멱등: WHERE phone IN(4리터럴) → flip 후 DUMMY-<uuid> 는 자연 제외 → 재실행 no-op.
--   §3-4 abort 임계: 정확히 4행. GET DIAGNOSTICS ≠ 4 (0 또는 >4) → RAISE EXCEPTION 중단.
--
-- ── before-image 스냅샷 (frozen 4-row PK셋, prod rxlomoozakkjesdqjtvd 2026-07-09 introspection) ──
--   id                                    | phone(before)  | clinic_id
--   d330baa7-45b0-44b8-9711-c76c8628f450  | '0'            | 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   ce00c1af-14ff-4542-9142-9ac9e329c6ee  | '000'          | 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   06e744e0-b881-4dc0-b8ed-cec78fc73212  | '000-0001-1111'| 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   5a64b5c5-6fbf-4929-ae95-14d525147e11  | '000-0111-0000'| 74967aea-a60b-4da3-a0e7-9c997a930bc8
--   (이 값들은 전화가 아닌 bogus placeholder → PHI 아님. git 기록 SOP §4 위반 아님.)
-- ============================================================

BEGIN;

-- §3-2 실행 전 스냅샷 로그(감사 trail) + §3-4 abort 임계 사전 확인
DO $$
DECLARE
  v_cnt INT;
  r RECORD;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM public.customers
   WHERE id IN (
           'd330baa7-45b0-44b8-9711-c76c8628f450',
           'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
           '06e744e0-b881-4dc0-b8ed-cec78fc73212',
           '5a64b5c5-6fbf-4929-ae95-14d525147e11'
         )
     AND phone IN ('0', '000', '000-0001-1111', '000-0111-0000');

  RAISE NOTICE '[CORRECTIVE d] freeze 교집합(PK ∩ 값-지문) 매칭 = % 행 (기대=4)', v_cnt;
  FOR r IN
    SELECT id, phone FROM public.customers
     WHERE id IN (
             'd330baa7-45b0-44b8-9711-c76c8628f450',
             'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
             '06e744e0-b881-4dc0-b8ed-cec78fc73212',
             '5a64b5c5-6fbf-4929-ae95-14d525147e11'
           )
     ORDER BY phone
  LOOP
    RAISE NOTICE '  before-image: id=% phone=%', r.id, r.phone;
  END LOOP;

  IF v_cnt <> 4 THEN
    RAISE EXCEPTION '[CORRECTIVE d] abort(SOP §3-4): freeze 매칭 % 행 ≠ 4. status quo 가 스냅샷과 불일치 → 중단·재검토.', v_cnt;
  END IF;
END $$;

-- §3-1 freeze(PK IN) + 값-지문(phone IN) 교집합 + §3-3 멱등 WHERE 로 정규화.
--   phone → 'DUMMY-'||gen_random_uuid(). 트리거(trg_customers_set_phone_dummy)가 phone_dummy=true 자동 파생.
UPDATE public.customers
   SET phone = 'DUMMY-' || gen_random_uuid()
 WHERE id IN (
         'd330baa7-45b0-44b8-9711-c76c8628f450',
         'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
         '06e744e0-b881-4dc0-b8ed-cec78fc73212',
         '5a64b5c5-6fbf-4929-ae95-14d525147e11'
       )
   AND phone IN ('0', '000', '000-0001-1111', '000-0111-0000');

-- §3-4 사후 검증: 정확히 4행 flip + 재실행 0 + phone_dummy 파생 정합
DO $$
DECLARE
  v_flipped INT;
  v_residual INT;
  v_dummy_ok INT;
BEGIN
  -- flip 후 4 PK 는 전부 DUMMY-% 여야 함
  SELECT count(*) INTO v_flipped
    FROM public.customers
   WHERE id IN (
           'd330baa7-45b0-44b8-9711-c76c8628f450',
           'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
           '06e744e0-b881-4dc0-b8ed-cec78fc73212',
           '5a64b5c5-6fbf-4929-ae95-14d525147e11'
         )
     AND phone LIKE 'DUMMY-%';
  IF v_flipped <> 4 THEN
    RAISE EXCEPTION '[CORRECTIVE d] 검증 실패: DUMMY-%% flip = % 행 ≠ 4', v_flipped;
  END IF;

  -- 멱등: legacy 리터럴 잔존 0(재실행 no-op)
  SELECT count(*) INTO v_residual
    FROM public.customers
   WHERE phone IN ('0', '000', '000-0001-1111', '000-0111-0000');
  IF v_residual <> 0 THEN
    RAISE EXCEPTION '[CORRECTIVE d] 검증 실패: legacy 리터럴 잔존 % 행', v_residual;
  END IF;

  -- 트리거 파생 정합: 4 PK 는 phone_dummy=true (is_dummy_phone(DUMMY-%)=true)
  SELECT count(*) INTO v_dummy_ok
    FROM public.customers
   WHERE id IN (
           'd330baa7-45b0-44b8-9711-c76c8628f450',
           'ce00c1af-14ff-4542-9142-9ac9e329c6ee',
           '06e744e0-b881-4dc0-b8ed-cec78fc73212',
           '5a64b5c5-6fbf-4929-ae95-14d525147e11'
         )
     AND phone_dummy = true;
  IF v_dummy_ok <> 4 THEN
    RAISE EXCEPTION '[CORRECTIVE d] 검증 실패: phone_dummy=true 파생 = % 행 ≠ 4 (트리거 미적용?)', v_dummy_ok;
  END IF;

  RAISE NOTICE '[CORRECTIVE d]: legacy placeholder 4행 → DUMMY-<uuid> 정규화 완료. phone_dummy=true 파생 정합. 취약 status quo 해소.';
END $$;

COMMIT;
