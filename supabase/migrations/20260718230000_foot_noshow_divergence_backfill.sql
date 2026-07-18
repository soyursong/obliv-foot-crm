-- T-20260716-foot-NOSHOW-CHECKIN-STATUS-DIVERGENCE-BACKFILL
-- reservations.status ↔ check_ins divergence 잔존행 데이터 정정 백필 (DATA only, no DDL)
--
-- 배경 (parent = T-20260716-foot-NOSHOW-RESTORE-CHECKIN-NOREFLECT, deployed):
--   트리거 fn_checkin_sync_reservation() 의 sync WHERE 과협소 버그로 일부 예약이
--   check_in 은 실재하는데 reservations.status 가 'confirmed' 에 머무른 divergence(desync).
--   parent 가 트리거 WHERE 를 allowlist(status IN ('reserved','confirmed'))로 확장해 신규 누수는 차단.
--   → 이미 어긋난 잔존행은 자동 정정 안 됨 → 본 백필로 1회 정정.
--
-- 성격: contamination(오염 write) 아님 = non-delivery(트리거가 냈어야 할 값 미도달).
--   ∴ 정정 = 트리거의 올바른 산출값(checked_in) 복제. Cross-CRM Data-Correction Backfill SOP 준거.
--
-- 확정 대상셋 (census commit 335adc91, READ-ONLY 전수, scope FROZEN):
--   지문: reservations.status='confirmed' ∧ 연결 check_in 실재 ∧ check_in.status NOT IN(cancelled,no_show)
--   total_diverged = 2행 (스캔모수=비cancelled check_in 200 조인, 지문 밖 divergence 0):
--     1) resv 26f3e3d5 | 2026-05-10 10:00 | check_in=treatment_waiting
--     2) resv 9f45105b | 2026-07-16 10:00 | check_in=done
--
-- 정정 방향 (DA CONSULT-REPLY CONDITIONAL GO, MSG-cqcm): 전 대상행 → status='checked_in' (단일 target).
--   근거: reservations.status 도메인에 'done' 부재(실측 0/575) — terminal='checked_in'.
--   시술완료(done)는 check_ins.status 에만 존재 → check_in.status(done/treatment_waiting)는 무접촉·보존.
--
-- ── C3 apply-time 3종 (DA SOP §3, 실행 계약 임베드) ─────────────────────────
--   (a) §3-1 freeze 재검증: 2 PK 각각 아직 status='confirmed' ∧ 연결 active check_in 실재 확인.
--       drift(스태프 수동정정/취소 등)면 해당 PK 자동 skip(idempotent no-op) — 오정정 0.
--   (b) §3-3 멱등 WHERE: UPDATE ... WHERE id = pk AND status='confirmed' (old-value 임베드 → 재실행 no-op).
--   (c) §2 override 확인: per-row 스냅샷(updated_at, check_in created_at/status)을 NOTICE 로 감사 emit.
--       (census 시점 override(check_in 이후 의도적 confirmed 되돌림) 흔적 없음 = 2행 freeze 확정.)
--
-- 안전: UPDATE only(ADD/DROP 없음). 비파괴·멱등. 대상 외 0행 접촉. check_ins 무접촉.
--   updated_at bump = 정답(자기치유 — Bronze updated_at-watermark 증분이 2행 자동 재수집 → Silver/Gold 수렴).
-- 롤백: 20260718230000_foot_noshow_divergence_backfill.rollback.sql

BEGIN;

DO $backfill$
DECLARE
  v_target uuid[] := ARRAY[
    '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a',  -- 2026-05-10 10:00, check_in=treatment_waiting
    '9f45105b-eff7-4056-a61d-e1308b837c0f'   -- 2026-07-16 10:00, check_in=done
  ]::uuid[];
  v_pk uuid;
  v_updated int := 0;
  v_skipped int := 0;
  r RECORD;
BEGIN
  FOREACH v_pk IN ARRAY v_target LOOP
    -- C3(a)+(c): freeze 재검증 스냅샷 (reservations 현재값 + 연결 active check_in)
    SELECT res.id,
           res.status      AS resv_status,
           res.updated_at  AS resv_updated_at,
           ci.id           AS checkin_id,
           ci.status       AS checkin_status,
           ci.created_at   AS checkin_created_at
      INTO r
      FROM public.reservations res
      LEFT JOIN LATERAL (
        SELECT c.id, c.status, c.created_at
          FROM public.check_ins c
         WHERE c.reservation_id = res.id
           AND c.status NOT IN ('cancelled','no_show')   -- active check_in 만
         ORDER BY c.created_at DESC
         LIMIT 1
      ) ci ON true
     WHERE res.id = v_pk;

    IF NOT FOUND THEN
      RAISE NOTICE 'BACKFILL-SKIP pk=% : reservation 부재 (drift) — no-op', v_pk;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- C3(a): 상태 drift 방어 — 이미 confirmed 아니면 정정 불필요/불가 → skip
    IF r.resv_status IS DISTINCT FROM 'confirmed' THEN
      RAISE NOTICE 'BACKFILL-SKIP pk=% : status 가 이미 %(스태프 수동/기정정) — 멱등 no-op', v_pk, r.resv_status;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- C3(a): freeze 술어(active check_in 실재) 재검증 — 깨졌으면 abort this pk
    IF r.checkin_id IS NULL THEN
      RAISE NOTICE 'BACKFILL-SKIP pk=% : active check_in 부재 (freeze 술어 붕괴) — abort this pk', v_pk;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- C3(c): override 감사 스냅샷
    RAISE NOTICE 'BACKFILL-SNAPSHOT pk=% : resv.updated_at=% | check_in(%%)=% created_at=%',
      v_pk, r.resv_updated_at, r.checkin_id, r.checkin_status, r.checkin_created_at;

    -- C3(b): 멱등 UPDATE (old-value 임베드) — 트리거가 냈어야 할 값 복제
    UPDATE public.reservations
       SET status = 'checked_in'
     WHERE id = v_pk
       AND status = 'confirmed';

    RAISE NOTICE 'BACKFILL-OK   pk=% : confirmed→checked_in (check_in=% 보존)', v_pk, r.checkin_status;
    v_updated := v_updated + 1;
  END LOOP;

  RAISE NOTICE 'BACKFILL-SUMMARY: updated=% skipped=% (target=2)', v_updated, v_skipped;
END;
$backfill$;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260718230000', 'foot_noshow_divergence_backfill')
ON CONFLICT (version) DO NOTHING;

COMMIT;
