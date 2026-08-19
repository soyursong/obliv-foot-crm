-- ROLLBACK (data lane): T-20260819-foot-PKGSESSION-REVISIT-NOPAY-FORWARDSOURCE
--   328 folded APPLY (부모 T-20260724 316 backfill + interval-delta 12 = 328) 되돌림.
--   정본: da_decision_foot_pkgsession_backfill_316_applyset_reapprove_20260819.md ADDENDUM #1.
--
-- ⚠ 이 rollback 은 **apply 직전 live 재캡처된 full 328 pre-image** 로만 유효하다(DA ADDENDUM #1 §Q1 조건③:
--   'apply 직전 live 재캡처 = 328 전건' · delta-note 12행 merge 로 대체 금지).
--   pre-image 소스 = db-gate/T-20260819-foot-PKGSESSION-FORWARDSOURCE_gb-preimage-full328.json
--   (scripts/..._apply_instant_census_328.mjs 가 생성). 전건 prev_psid=NULL ∧ prev_flag=false 확증 하에서만.
--
-- 생성: node scripts/T-20260819-foot-PKGSESSION-FORWARDSOURCE_gen_rollback_328.mjs
--       (pre-image JSON → 아래 VALUES 블록 주입). 손으로 편집 금지(divergence 방지).
--
-- 되돌림 방식: pre-image 의 (cis_id, prev_psid, prev_flag) 를 정확복원.
--   전건 prev_flag=false·prev_psid=NULL 이므로 결과는 (package_session_id=NULL, is_package_session=false).
--   pre-true clobber 위험 0(전건 false). cis_id 정합으로 apply 대상 행만 touch(over-restore 방지).
BEGIN;

CREATE TEMP TABLE _bf_preimage_328 (
  cis_id      uuid PRIMARY KEY,
  prev_psid   uuid,
  prev_flag   boolean NOT NULL
) ON COMMIT DROP;

-- << INJECT PRE-IMAGE VALUES HERE >> (gen_rollback_328.mjs 가 채움 · 328행)
-- INSERT INTO _bf_preimage_328 (cis_id, prev_psid, prev_flag) VALUES
--   ('<cis_id>', NULL, false),
--   ... (328행) ;

-- 사전 assert: 주입 행수 == 328 (full pre-image 만 허용)
DO $guard$
DECLARE v_n INTEGER;
BEGIN
  SELECT count(*) INTO v_n FROM _bf_preimage_328;
  IF v_n <> 328 THEN
    RAISE EXCEPTION 'ROLLBACK-ABORT: pre-image 행수 % != 328 (full-328 pre-image 만 허용 — delta-merge 금지)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM _bf_preimage_328 WHERE prev_flag = true OR prev_psid IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK-ABORT: pre-image 에 prev_flag=true 또는 prev_psid NOT NULL 존재 — clobber 위험(전건 false/NULL 계약 위반)';
  END IF;
END $guard$;

-- 정확복원 (cis_id 매칭 대상 행만).
UPDATE public.check_in_services t
   SET package_session_id = pi.prev_psid,   -- 전건 NULL
       is_package_session = pi.prev_flag    -- 전건 false
  FROM _bf_preimage_328 pi
 WHERE t.id = pi.cis_id;

-- 사후 assert: 복원 후 대상 328행 전건 (FK-null ∧ flag-false)
DO $verify$
DECLARE v_bad INTEGER;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.check_in_services t JOIN _bf_preimage_328 pi ON pi.cis_id = t.id
  WHERE t.package_session_id IS NOT NULL OR t.is_package_session <> false;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ROLLBACK-INCOMPLETE: 복원 후 % 행이 FK/flag 잔존 — 재확인', v_bad;
  END IF;
  RAISE NOTICE 'ROLLBACK-OK: 328행 pre-image 정확복원 (FK→NULL·flag→false)';
END $verify$;

COMMIT;
