-- T-20260715-foot-SELFCHECKIN-LEGACYCREATE-SOURCECLOSE-HEAL — Phase B (per-row heal 後)
-- ⚠⚠ 게이트: Phase A(20260716090000 deprecate) 배포 + 소스닫힘 증거(anon/auth/service EXECUTE=false,
--    신규 unlinked+당일confirmed 유입 0) 확보 後에만 apply. + freeze 재검증(phaseB_freeze_reverify.mjs) PASS 後.
--    + supervisor 검증 게이트 + DEVCHANGE-OWNER-CONFIRM. Phase A 미배포 상태 apply 금지.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- INV-1 divergent 1건 정합 정정 (data_correction_backfill_sop §2-F per-row heal)
-- ══════════════════════════════════════════════════════════════════════════════
-- INV-1 계약: active check_in 이 예약에 링크되면 reservations.status ∉ {reserved,confirmed}(= checked_in).
-- divergent(probeA 2026-07-16, prod): reservation 26f3e3d5… 가 'confirmed' stuck 인데
--   링크된 check_in f9840007…(active 'treatment_waiting') 존재 → INV-1 위반 1건.
-- RC(참고): sync 트리거 trg_checkin_sync_reservation 는 AFTER INSERT 발화 → reservation_id 가 INSERT 시점이
--   아니라 사후 UPDATE 로 링크되면 미발화 → 예약 'confirmed' 잔존(구 데이터 2026-05-11). 라이브 경로는
--   self_checkin_with_reservation_link + 트리거로 원자 커버(재발 없음). Phase A 로 레거시 미링크 소스 봉합.
--
-- 안전 4종 (§3):
--   1) 대상셋 freeze = 명시 PK VALUES 박제(1행). 시간윈도우/조건 재-SELECT 아님.
--   2) 판정근거: reservation_id + 링크 check_in id + old status(주석 박제) + 아래 상관 서브쿼리(active 링크 존재).
--   3) 멱등 UPDATE ... WHERE id IN(freeze) AND status='confirmed'(old value 가드) → 재실행 무해(0행).
--   4) EXISTS 가드 = 판정 재확인(active 링크 check_in 실재 시에만 전이) → drift 시 0행 abort-equivalent.
-- 자동배치·단일 count-UPDATE 아님(1행 명시). 원장 무접점. 가역(rollback SQL 동봉).

BEGIN;

UPDATE public.reservations r
   SET status = 'checked_in', updated_at = now()
 WHERE r.id = '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a'::uuid   -- freeze PK (명시)
   AND r.status = 'confirmed'                                 -- old value 가드(멱등)
   AND EXISTS (                                               -- 판정 재확인: active 링크 check_in 실재
     SELECT 1 FROM public.check_ins ci
      WHERE ci.id = 'f9840007-ed46-46c8-adba-1d92fddea4f8'::uuid
        AND ci.reservation_id = r.id
        AND ci.status NOT IN ('cancelled','completed','done','no_show','abandoned')
   );

-- 영향 행수 검증: 정확히 1행이어야 함(0=drift/이미정정, >1=freeze 위반 → 롤백).
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.reservations
   WHERE id = '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a'::uuid AND status = 'checked_in';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'HEAL guard: expected reservation checked_in=1, got %', v_n;
  END IF;
END $$;

COMMIT;
