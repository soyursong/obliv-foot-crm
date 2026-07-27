-- DRY-RUN (무영속) — T-20260727-foot-REDPAY-PLANB-NOWAIT orphan 정리 검증
--   20260727090000_foot_drop_orphan_payment_preempts.sql 의 가드+DROP 을 실제 실행하되 ROLLBACK.
--   No-Persistence Protocol: 단일 트랜잭션 강제 unwind → prod 무영속. 가드 통과/차단 여부만 관측.
--   ⚠ prod(supervisor DDL-diff DB) 에서 실행해야 유의미(dev DB 엔 payment_preempts 자체가 부재 →
--     no-op NOTICE 로 정상 종료). prod 실행 시: rows=0/inbound=0 가드 통과 후 DROP → ROLLBACK 으로 원복.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_exists   regclass := to_regclass('public.payment_preempts');
  v_rows     bigint   := 0;
  v_inbound  int      := 0;
BEGIN
  IF v_exists IS NULL THEN
    RAISE NOTICE '[DRY-RUN] payment_preempts 부재 — DROP no-op (fresh/dev 경로).';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.payment_preempts' INTO v_rows;
  RAISE NOTICE '[DRY-RUN] payment_preempts row count = % (기대 0)', v_rows;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '[DRY-RUN ABORT] rows=% <> 0 — orphan 전제 위반', v_rows;
  END IF;

  SELECT count(*) INTO v_inbound
    FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.payment_preempts'::regclass;
  RAISE NOTICE '[DRY-RUN] inbound FK 참조 = % (기대 0)', v_inbound;
  IF v_inbound <> 0 THEN
    RAISE EXCEPTION '[DRY-RUN ABORT] inbound FK=% <> 0 — 참조 소비처 존재', v_inbound;
  END IF;

  DROP TABLE public.payment_preempts;
  RAISE NOTICE '[DRY-RUN] DROP 실행 성공 (무영속 — 아래 ROLLBACK 으로 원복).';

  -- 사후 무영속 확인(post-probe): 이 트랜잭션 내에선 부재, 트랜잭션 밖(ROLLBACK 후)엔 실재 유지.
  IF to_regclass('public.payment_preempts') IS NOT NULL THEN
    RAISE EXCEPTION '[DRY-RUN] 예상: 트랜잭션 내 DROP 후 to_regclass NULL 이어야 함';
  END IF;
  RAISE NOTICE '[DRY-RUN] 트랜잭션 내 to_regclass=NULL 확인. ROLLBACK 시 원복 예정.';
END $$;

ROLLBACK;
