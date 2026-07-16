-- ════════════════════════════════════════════════════════════════════════════
-- T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT
-- fn_checkin_sync_reservation() WHERE 조건 확장 (body-only CREATE OR REPLACE, 완전 가역)
--
-- ── 증상 (박장군 팀장 / 김주연 총괄, 2026-07-16 #foot) ────────────────────────
--   노쇼→예약복원→체크인 동선에서 체크인 생성 후 **예약관리 페이지 상태값이 체크인으로
--   반영되지 않음**. 대시보드에서는 정상(체크인 박스 표시). 예약관리 목록만 미반영.
--     · 예약관리(Reservations.tsx) 유일 소스 = reservations.status
--     · 대시보드(Dashboard.tsx)      = check_ins 테이블 병행 조회
--   → check_ins 행은 생성됐으나 reservations.status 가 checked_in 으로 동기화되지 않아 두 화면 divergence.
--
-- ── RC (런타임 규명, 이재이 010-2115-0170 / resv 9f45105b 실데이터) ───────────
--   reservations.status='confirmed' 인데 연결 check_in(f62bf262, status=done) 이 실재.
--   즉 예약↔체크인 sync 트리거가 발화하지 않았다.
--
--   기존 fn_checkin_sync_reservation()(20260506000010, SELFCHECKIN-MERGE)는
--     UPDATE reservations SET status='checked_in'
--       WHERE id = NEW.reservation_id AND status = 'confirmed';   ← ★ 'confirmed' 정확일치만
--   그런데 BEFORE INSERT 가드 check_reservation_status()(NOSHOW-CANONICAL 20260629150000)는
--   status NOT IN ('no_show','cancelled') 이면 **체크인 생성 자체는 허용** (confirmed·reserved 등).
--
--   ⇒ 두 가드의 허용집합 불일치(gap): BEFORE-가드가 통과시킨 체크인이라도, AFTER-sync 시점의
--     reservations.status 가 정확히 'confirmed' 가 아니면(예: 노쇼↔복원 반복 중 상태 race,
--     'reserved' 등) sync UPDATE 가 0행 매칭 → **check_in 은 생성되고 reservations.status 는
--     조용히 미동기화**. self_checkin_with_reservation_link / batch_checkin 경로는 FE 폴백 UPDATE
--     없이 이 트리거에만 의존(20260602250000 line 295 주석) → 단일 실패점.
--
-- ── Fix ────────────────────────────────────────────────────────────────────
--   sync WHERE 를 BEFORE-가드 허용집합과 정합하도록 확장:
--     status = 'confirmed'  →  status NOT IN ('checked_in','done','cancelled')
--   · 체크인이 생성됐다는 것은 BEFORE-가드상 no_show/cancelled 가 아니었음을 의미 → 그 예약은
--     반드시 checked_in 으로 착지해야 한다(모든 체크인 생성 경로 공통 불변식).
--   · 이미 checked_in/done → no-op(멱등, 회귀0). cancelled → 보존(체크인은 BEFORE-가드가 이미 차단).
--   · checked_in 착지 후엔 예약관리 auto-noshow(status='confirmed' 한정)가 재플립 못 함 → 재발 차단.
--
-- 스코프: 함수 body-only 교체. 컬럼/테이블/enum/트리거 정의 변경 0 (신규 DDL 없음).
--   트리거 바인딩(trg_checkin_sync_reservation AFTER INSERT)·SECURITY DEFINER·OWNER postgres 불변.
-- 가역: 20260716120000_foot_checkin_sync_reservation_broaden.rollback.sql (구 'confirmed' 정확일치 body 복원).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION fn_checkin_sync_reservation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- 셀프접수(anon)·관리자 접수·RPC(self_checkin_with_reservation_link/batch_checkin) 등
  -- 모든 체크인 생성 경로에서, reservation_id 가 연결된 경우 예약을 checked_in 으로 동기화.
  -- ★ BEFORE INSERT 가드(check_reservation_status)가 no_show/cancelled 예약의 체크인 생성을
  --   이미 차단하므로, 여기 도달한 = 체크인 가능 상태. 정확히 'confirmed' 가 아니어도(reserved 등,
  --   또는 노쇼↔복원 race) checked_in 으로 착지시켜 예약관리↔대시보드 divergence 를 제거.
  --   이미 checked_in/done 은 멱등 no-op, cancelled 는 보존.
  IF NEW.reservation_id IS NOT NULL THEN
    UPDATE public.reservations
    SET status = 'checked_in'
    WHERE id = NEW.reservation_id
      AND status NOT IN ('checked_in', 'done', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION fn_checkin_sync_reservation() OWNER TO postgres;

COMMIT;

-- 사후 검증 (수동):
--   SELECT pg_get_functiondef('public.fn_checkin_sync_reservation()'::regprocedure) ILIKE '%NOT IN%';
--   -- 재현: 노쇼→복원(confirmed)→체크인 → reservations.status='checked_in' 착지, 예약관리 목록 반영.
--   -- 회귀: 직접 체크인(confirmed→checked_in) 정상, 이미 checked_in 재체크인 시 no-op(멱등).
