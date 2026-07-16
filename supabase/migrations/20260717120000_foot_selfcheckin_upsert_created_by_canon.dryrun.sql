-- DRY-RUN (No-Persistence): T-20260716-foot-SELFCHECKIN-RPC-CREATEDBY-CANON
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 top-level txn-control(COMMIT 등) 없음 = sentinel-bypass hazard 부재 → BEGIN..ROLLBACK 무영속.
--     (러너 dryrun_lib.mjs 가 up.sql 의 BEGIN/COMMIT 을 strip 후 plpgsql exception-handler 로 무영속 실행)
--   · txn 내부 assertion(DO $chk$): 3함수 정의에 created_by='self_checkin' INSERT stamp 반영 실검증,
--     실패 시 RAISE 'DRYRUN-FAIL' → abort.
--   · 사후 무영속(post-probe)은 canonical 러너의 별 트랜잭션에서 재확인.
BEGIN;

-- ── payload: up.sql 3함수 전문을 러너가 무영속 실행(여기선 검증 assertion 만 재현). ──
--   (함수 CREATE OR REPLACE 는 up.sql 과 동일 — 러너가 up.sql 전문을 무영속 실행한다.)

-- ── txn 내부 검증: 3 upsert 함수가 존재 + created_by stamp('self_checkin') 반영 (실패 시 abort) ──
DO $chk$
DECLARE
  v_fns  INTEGER;
  v_stamp INTEGER;
  v_upd_leak INTEGER;
BEGIN
  -- (1) 3함수 실존
  SELECT COUNT(*) INTO v_fns
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('fn_selfcheckin_upsert_customer',
                    'fn_selfcheckin_upsert_customer_resolve_v2',
                    'fn_selfcheckin_upsert_customer_resolve_v3');
  IF v_fns < 3 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: upsert 함수 3종 미실존 (got: %)', v_fns;
  END IF;

  -- (2) 3함수 모두 created_by INSERT stamp('self_checkin') 반영
  SELECT COUNT(*) INTO v_stamp
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('fn_selfcheckin_upsert_customer',
                    'fn_selfcheckin_upsert_customer_resolve_v2',
                    'fn_selfcheckin_upsert_customer_resolve_v3')
    AND pg_get_functiondef(oid) LIKE '%''self_checkin''%'
    AND pg_get_functiondef(oid) LIKE '%created_by%';
  IF v_stamp <> 3 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: created_by=''self_checkin'' INSERT stamp 3함수 미반영 (got: %)', v_stamp;
  END IF;

  -- (3) new-write-only 가드: UPDATE SET 절에 created_by 재저장(덮어쓰기) 누출 없음
  --     (UPDATE customers SET ... created_by = ... 패턴이 있으면 부모 Q4 위반 → abort)
  SELECT COUNT(*) INTO v_upd_leak
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('fn_selfcheckin_upsert_customer',
                    'fn_selfcheckin_upsert_customer_resolve_v2',
                    'fn_selfcheckin_upsert_customer_resolve_v3')
    AND pg_get_functiondef(oid) ~* 'set[^;]*created_by\s*=';
  IF v_upd_leak <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: UPDATE SET created_by 누출(new-write-only 위반) (got: %)', v_upd_leak;
  END IF;

  RAISE NOTICE 'DRYRUN-OK: upsert 3함수 created_by=''self_checkin'' INSERT-only stamp 확인 (UPDATE 누출 0)';
END $chk$;

ROLLBACK;
