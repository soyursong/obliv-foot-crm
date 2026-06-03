-- T-20260603-foot-DASH-NAME-STALE-SYNC: customers.name → check_ins/reservations.customer_name 전파 트리거
--
-- Root Cause:
--   대시보드는 환자명을 check_ins.customer_name / reservations.customer_name
--   (비정규화 스냅샷 컬럼)에서 직접 렌더한다. (Dashboard.tsx L1406/1486/1586/1664/2092/2150~2153)
--   고객관리(Customers.tsx save() L552~573)는 customers.name 만 UPDATE 하고
--   스냅샷에 전파하지 않아, 성함 변경 후 대시보드/일부 차트 패널이 옛 이름(또는
--   셀프체크인 placeholder "초진환자1" 등)을 계속 표시한다.
--
-- Fix (옵션 A — 소비처 일괄 근본 해결):
--   customers.name AFTER UPDATE 트리거 fn_sync_customer_name() 가 customer_id 매칭으로
--   check_ins.customer_name / reservations.customer_name 스냅샷을 자동 전파.
--   기존 selfcheckin_merge 트리거(fn_checkin_sync_reservation)와 동일한 SECURITY DEFINER 패턴.
--   → 향후 모든 성함 변경이 스냅샷에 즉시 반영 (버그 2 영구 해소).
--   → 기존 stale row 는 별도 1회성 backfill 로 정정 (scripts/backfill_customer_name_stale_20260603.mjs, 승인 게이트).
--
-- Risk: 스키마 변경(트리거 신규)만. 데이터 변경 없음(트리거는 향후 UPDATE 시에만 발화).
-- Rollback: 20260603030000_sync_customer_name_trigger.rollback.sql
-- Ticket: T-20260603-foot-DASH-NAME-STALE-SYNC

BEGIN;

-- 성함 동기화 함수 (SECURITY DEFINER: 호출자 RLS 우회, DB 레벨 원자적 처리)
CREATE OR REPLACE FUNCTION fn_sync_customer_name()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 이름이 실제로 바뀐 경우에만, 동일 customer_id 의 스냅샷 컬럼 전파.
  -- 내부 IS DISTINCT FROM 가드로 불필요한 no-op write/트리거 연쇄 방지.
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.check_ins
      SET customer_name = NEW.name
      WHERE customer_id = NEW.id
        AND customer_name IS DISTINCT FROM NEW.name;

    UPDATE public.reservations
      SET customer_name = NEW.name
      WHERE customer_id = NEW.id
        AND customer_name IS DISTINCT FROM NEW.name;
  END IF;
  RETURN NEW;
END;
$$;

-- name 컬럼 UPDATE 시에만 발화 (WHEN 절로 추가 안전장치)
DROP TRIGGER IF EXISTS trg_sync_customer_name ON public.customers;
CREATE TRIGGER trg_sync_customer_name
  AFTER UPDATE OF name ON public.customers
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION fn_sync_customer_name();

-- 함수 소유권: postgres (SECURITY DEFINER 보안 강화)
ALTER FUNCTION fn_sync_customer_name() OWNER TO postgres;

COMMENT ON FUNCTION fn_sync_customer_name() IS
  'customers.name 변경 시 check_ins/reservations.customer_name 비정규화 스냅샷 전파 (T-20260603-foot-DASH-NAME-STALE-SYNC)';

COMMIT;
