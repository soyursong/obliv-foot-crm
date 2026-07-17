-- ============================================================================
-- FORWARD-DOC MIGRATION (file-set parity 재현 / NOT for re-execution)
-- version : 20260717180000
-- ledger  : foot_checkin_sync_reservation_broaden
-- ticket  : T-20260714-foot-MIGRATION-LEDGER-WHOLESALE-DRIFT-SWEEP (Case C3-a, F-track)
-- 근거    : da_decision_foot_visitroute_gonghom_silver_ledger_reconcile_20260718.md §Item2
--           migration_ledger_reconciliation.md §Case C3-a
--
-- ▸ 본 마이그레이션은 foot 비표준 direct-query runner(Case L-3/C3)로 prod 에 이미 실적용(라이브)
--   되었으나 마이그 파일만 유실되었다(genuine file-less OOB). 본 파일은 repo↔remote 파일셋 정합
--   (db push unblock) 목적의 forward-doc 이며, prod 실재 정의와 content-parity 재현이다.
-- ▸ 수기 재실행 금지. DDL 은 CREATE OR REPLACE(멱등)로 prod 실재 def 와 byte/정의-일치 재현하되,
--   prod 원장(schema_migrations)에 이미 applied 이므로 db push 대상 아님(재실행 없음).
-- ▸ 원장(schema_migrations) 단일행 write 는 supervisor exec lane 전속(§1.5/L-2). dev=repo 파일만.
-- ▸ pre-checkin 전진대상 allowlist 를 reserved·confirmed 로 broaden — 노쇼↔복원 race 로 reserved 상태인
--   예약도 checked_in 착지시켜 예약관리↔대시보드 divergence 제거. 현행 prod 실재 def 재현.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_checkin_sync_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  -- 셀프접수(anon)·관리자 접수·RPC(self_checkin_with_reservation_link/batch_checkin) 등
  -- 모든 체크인 생성 경로에서, reservation_id 가 연결된 경우 예약을 checked_in 으로 동기화.
  -- ★ pre-checkin 전진대상(allowlist)만 명시 전이: reserved·confirmed 둘뿐(INV-1 술어).
  --   노쇼↔복원 race 로 status='reserved' 인 예약도 checked_in 으로 착지시켜 예약관리↔대시보드
  --   divergence 를 제거. 이미 checked_in/done 은 멱등 no-op, cancelled/no_show 는 미포함(보존).
  --   denylist 대신 allowlist 사용 이유(no_show/미래 enum 자동전이 fail-safe): 파일 상단 Fix 주석 참조.
  IF NEW.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET status = 'checked_in'
    WHERE id = NEW.reservation_id
      AND status IN ('reserved', 'confirmed');
  END IF;
  RETURN NEW;
END;
$function$;

