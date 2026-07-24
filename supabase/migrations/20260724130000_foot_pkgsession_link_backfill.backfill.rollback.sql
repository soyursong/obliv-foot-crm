-- ROLLBACK: T-20260724-foot-PKGSESSION-BACKFILL-AND-EFFICACY  (J4, data lane)
-- DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
-- ============================================================
-- ★가역성 주의 — 스냅샷 기반 rollback 필수.
--   backfill 은 UPDATE(append 아님). 순진한 blanket revert(SET is_package_session=false)는
--   backfill 이전부터 true 였던 49행(is_package_session=true & package_session_id IS NULL,
--   pre-FK 마킹)의 정당한 true 를 clobber → 매출 오염. 따라서:
--
--   ▸ APPLY 직전(supervisor): 마킹 대상 pre-image 를 off-txn 캡처해 아래 _bf_preimage 에 주입.
--     캡처 쿼리(= .backfill.sql 의 matched 집합 + 현재값):
--       WITH ...(동일 CTE)...
--       SELECT t.id AS cis_id, t.package_session_id AS prev_psid, t.is_package_session AS prev_flag
--         FROM public.check_in_services t JOIN cis JOIN ps ON (매칭) WHERE t.id = cis.cis_id;
--     → 예상 42행. (id, prev_psid[전건 NULL], prev_flag[true/false 혼재]) VALUES 로 아래에 붙여넣기.
--   ▸ rollback = 캡처된 각 행을 정확히 pre-image 로 복원(순소실 0, pre-true 보존).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _bf_preimage (
  cis_id     UUID NOT NULL,
  prev_psid  UUID,            -- backfill 이전 package_session_id (전건 NULL 예상)
  prev_flag  BOOLEAN NOT NULL -- backfill 이전 is_package_session (true=pre-FK 마킹 보존대상)
) ON COMMIT DROP;

-- >>> SUPERVISOR: apply 직전 캡처한 pre-image VALUES 붙여넣기 <<<
-- INSERT INTO _bf_preimage (cis_id, prev_psid, prev_flag) VALUES
--   ('...'::uuid, NULL, false),
--   ('...'::uuid, NULL, true),   -- pre-FK 마킹행: FK 만 NULL 복원, flag 는 true 유지
--   ... ;

DO $guard$
DECLARE v_cnt INTEGER;
BEGIN
  SELECT count(*) INTO v_cnt FROM _bf_preimage;
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'ROLLBACK-ABORT: _bf_preimage 비어있음(template 미치환) — fail-closed';
  END IF;
  RAISE NOTICE 'ROLLBACK: pre-image % 행 복원 예정', v_cnt;
END $guard$;

-- pre-image 정확 복원 (FK·flag 를 backfill 이전 값으로).
UPDATE public.check_in_services t
   SET package_session_id = pi.prev_psid,
       is_package_session = pi.prev_flag
  FROM _bf_preimage pi
 WHERE t.id = pi.cis_id;

-- 사후: 복원 대상 중 backfill 잔재(우리가 심은 psid) 잔존 0 확인.
DO $post$
DECLARE v_left INTEGER;
BEGIN
  SELECT count(*) INTO v_left
  FROM public.check_in_services t
  JOIN _bf_preimage pi ON pi.cis_id = t.id
  WHERE t.package_session_id IS DISTINCT FROM pi.prev_psid
     OR t.is_package_session IS DISTINCT FROM pi.prev_flag;
  IF v_left <> 0 THEN RAISE EXCEPTION 'ROLLBACK-FAIL: 미복원 % 행', v_left; END IF;
  RAISE NOTICE 'ROLLBACK-OK: pre-image 전량 복원(순소실 0, pre-true 보존)';
END $post$;

COMMIT;
