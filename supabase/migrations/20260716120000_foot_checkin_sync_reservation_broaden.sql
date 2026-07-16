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
-- ── RC (런타임 규명, [PHI-redacted] / resv 9f45105b 실데이터) ───────────
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
-- ── Fix (allowlist — DA CONSULT-REPLY 정정 채택, 2026-07-16) ────────────────
--   sync WHERE 를 pre-checkin 전진대상 집합(allowlist)으로 명시 확장:
--     status = 'confirmed'  →  status IN ('reserved', 'confirmed')
--   · reservations.status enum 실측 6값 {confirmed, reserved, checked_in, cancelled, done, no_show}
--     (C10 prod 정본). 이 중 체크인으로 전진해야 할 pre-checkin 상태는 reserved·confirmed **둘뿐**.
--   · allowlist {reserved,confirmed} = INV-1('active check_in 존재 시 status∈{reserved,confirmed} 금지')
--     술어 그 자체 → pre-checkin 전진대상 전량 커버 + no_show/미래 enum 추가값에 fail-safe.
--   · 이미 checked_in/done → no-op(멱등, 회귀0). cancelled/no_show → 미포함(보존, 자동전이 안 됨).
--   · checked_in 착지 후엔 예약관리 auto-noshow(status='confirmed' 한정)가 재플립 못 함 → 재발 차단.
--
--   ※ denylist(`NOT IN ('checked_in','done','cancelled')`)는 DA 반려:
--     (a) no_show 를 제외집합에 안 넣어 fall-through 로 자동전이 대상에 포함,
--     (b) 미래 enum 추가값(값추가=minor)이 묵시적으로 checked_in 자동전이 대상이 됨.
--     allowlist 는 이 둘을 구조적으로 차단(self-defensive, BEFORE-가드 결합 해제). 비용 동일 one-liner.
--   근거 전문: agents/docs/da_replies/DA-20260716-foot-CHECKIN-SYNC-WHERE-EXPAND.md
--   cross-CRM 방증: women 동형 픽스 T-20260715-women-SELFCHECKIN-INV1-PREDICATE-EXPAND(QA Green)가
--     동일 술어 `status IN ('reserved','confirmed')` 로 prod-검증 완료 → 동일 술어 수렴.
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
$$;

ALTER FUNCTION fn_checkin_sync_reservation() OWNER TO postgres;

COMMIT;

-- 사후 검증 (수동):
--   SELECT pg_get_functiondef('public.fn_checkin_sync_reservation()'::regprocedure) ILIKE '%IN (''reserved'', ''confirmed'')%';
--   -- 재현: 노쇼→복원(confirmed)→체크인 → reservations.status='checked_in' 착지, 예약관리 목록 반영.
--   -- 재현2: reserved→체크인(race) → checked_in 착지.
--   -- 회귀: 직접 체크인(confirmed→checked_in) 정상, 이미 checked_in 재체크인 시 no-op(멱등),
--   --       cancelled/no_show 는 자동전이 안 됨(allowlist 미포함).
