-- DRY-RUN (No-Persistence): T-20260716-foot-NOSHOW-CHECKIN-STATUS-DIVERGENCE-BACKFILL
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md v1.0):
--   · up.sql 의 txn-control 문(COMMIT) + ledger INSERT 를 **제거** → BEGIN..ROLLBACK 자체로 무영속.
--   · in-txn assertion: (a) 대상 2행 checked_in 수렴 (b) 대상 confirmed 잔존 0
--     (c) scope-freeze 재검증 = 대상 外 지문(confirmed ∧ active check_in) divergence 0.
--   · 데이터 backfill 이라 영속 DDL 객체 없음 → post-probe(assertAbsent) 비대상. 본 파일=in-txn 검증.
BEGIN;

-- ── PRE 스냅샷 ────────────────────────────────────────────────────────
DO $pre$
DECLARE v_confirmed int;
BEGIN
  SELECT count(*) INTO v_confirmed FROM public.reservations
   WHERE id IN ('26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a','9f45105b-eff7-4056-a61d-e1308b837c0f')
     AND status = 'confirmed';
  RAISE NOTICE 'DRYRUN-PRE: target confirmed rows=% (freeze census=2)', v_confirmed;
END;
$pre$;

-- ── up.sql 본문 (COMMIT/ledger 제거) ──────────────────────────────────
DO $backfill$
DECLARE
  v_target uuid[] := ARRAY[
    '26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a',
    '9f45105b-eff7-4056-a61d-e1308b837c0f'
  ]::uuid[];
  v_pk uuid;
  r RECORD;
BEGIN
  FOREACH v_pk IN ARRAY v_target LOOP
    SELECT res.id, res.status AS resv_status, ci.id AS checkin_id
      INTO r
      FROM public.reservations res
      LEFT JOIN LATERAL (
        SELECT c.id FROM public.check_ins c
         WHERE c.reservation_id = res.id
           AND c.status NOT IN ('cancelled','no_show')
         ORDER BY c.created_at DESC LIMIT 1
      ) ci ON true
     WHERE res.id = v_pk;
    IF NOT FOUND OR r.resv_status IS DISTINCT FROM 'confirmed' OR r.checkin_id IS NULL THEN
      CONTINUE;
    END IF;
    UPDATE public.reservations SET status = 'checked_in'
     WHERE id = v_pk AND status = 'confirmed';
  END LOOP;
END;
$backfill$;

-- ── in-txn assertion ─────────────────────────────────────────────────
DO $chk$
DECLARE v_bad int; v_checked int;
BEGIN
  -- (a) 대상 2행이 confirmed 로 남아있지 않아야 (backfill 적용 확인)
  SELECT count(*) INTO v_bad FROM public.reservations
   WHERE id IN ('26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a','9f45105b-eff7-4056-a61d-e1308b837c0f')
     AND status = 'confirmed';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 대상 % 행이 여전히 confirmed (backfill 미적용 or freeze drift)', v_bad;
  END IF;

  -- (b) 대상 2행 checked_in 수렴 확인
  SELECT count(*) INTO v_checked FROM public.reservations
   WHERE id IN ('26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a','9f45105b-eff7-4056-a61d-e1308b837c0f')
     AND status = 'checked_in';
  RAISE NOTICE 'DRYRUN-OK: 대상 % 행 checked_in 수렴', v_checked;

  -- (c) scope-freeze 재검증: 대상 外 지문 divergence 0 (완전성 — 신규 누수 없음)
  SELECT count(*) INTO v_bad
    FROM public.reservations res
    JOIN public.check_ins c
      ON c.reservation_id = res.id
     AND c.status NOT IN ('cancelled','no_show')
   WHERE res.status = 'confirmed'
     AND res.id NOT IN ('26f3e3d5-d1d9-4880-a1da-b6dc56c6da0a','9f45105b-eff7-4056-a61d-e1308b837c0f');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 대상 外 지문 divergence % 행 발견 — scope freeze 위반(재-census 필요)', v_bad;
  END IF;
  RAISE NOTICE 'DRYRUN-OK: scope freeze 유지 (대상 外 divergence 0)';
END;
$chk$;

ROLLBACK;
