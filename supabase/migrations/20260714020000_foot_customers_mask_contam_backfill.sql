-- ============================================================================
-- foot customers 마스킹오염 백필 (Option D: relink + archive-first)
-- Ticket : T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL
-- DA     : DA-...-BACKFILL  GO(조건부) RE-CONFIRMED (MSG-20260714-012820-amra)
--          + addendum GO 유효 재확인 (MSG-20260714-013056-zbn9): 결정키(reservation_id) 전건 부재 →
--          6건 batch→per-row 전량 격상, 배치 auto-merge 경로 폐쇄(C7). 라이즈드바 채택:
--          INV-3 정확단일수렴(비협상) + tail4 충돌가드(정확 1건) + 약보강행(#1·#5) temporal 무효 강등규율.
-- SOP    : Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard
--          (파괴적 삭제 → destructive branch. mutable-UPDATE SOP 아님.)
-- Scope  : 6 ADOPT phantom (per-row 라이즈드바 통과: tail4+clinic 후보=1 + name-stem 교차확인, probe 실증).
--          02594dfa HOLD = §2-F per-row, 본 마이그 제외.
--          라이즈드바 probe: db-gate/..._raisedbar_result.json (6/6 후보=1, 0 강등). PHI=off-git perrow_confirm.json.
-- Vector : UNAUTH-CHANGE(self_checkin masked write) 잔류물. WS-A 가드(798a2281/20260713120000)는
--          forward-only 차단 → 기존 오염행은 본 백필이 정정.
--
-- ⚠ 집행 게이트 (전부 apply 前 충족 — DA carry-forward C1~C6):
--   (per-row) 6건+02594dfa 사람 confirm   (supervisor) MIG-GATE 4필드 + C6 post-probe
--   본 파일은 apply-prep. GO 재확인 수신(RE-CONFIRMED) 상태이나 per-row/supervisor 게이트 미완.
--
-- 불변식 §2-3-b (per phantom):
--   (1) 전 FK 자식(pg_constraint 기계열거) raw로 비파괴 FK-only UPDATE  + movelog 기록
--   (2) dup master(phantom) 전 FK 자식 0건 재검증 — 잔존 시 ABORT (전체 롤백)
--   (3) archive-first 제거(_bak 스냅샷 후 DELETE)
--   + check_ins denorm(customer_name/customer_phone) 마스킹 잔존을 raw 값으로 refresh
-- 멱등: WHERE old-value 조건. 재실행 시 이미 없는 phantom은 map G0에서 0건 → no-op abort-safe.
-- ============================================================================

BEGIN;

-- 아카이브/무브로그 (rollback SSOT, tracked schema 무접촉 — 별도 _backfill_* 테이블)
CREATE TABLE IF NOT EXISTS _backfill_mask_contam_customers_bak (
  LIKE customers,
  backfill_ticket text NOT NULL DEFAULT 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL',
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS _backfill_mask_contam_fkmoves (
  id bigserial PRIMARY KEY,
  backfill_ticket text NOT NULL DEFAULT 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL',
  child_table text NOT NULL,
  child_col   text NOT NULL,
  child_row   jsonb NOT NULL,        -- to_jsonb(child) 이동 전 스냅샷 (정밀 롤백)
  from_phantom uuid NOT NULL,
  to_raw       uuid NOT NULL,
  moved_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS _backfill_mask_contam_denorm (
  id bigserial PRIMARY KEY,
  checkin_id uuid NOT NULL,
  old_name text, old_phone text,
  new_name text, new_phone text,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

DO $mig$
DECLARE
  v_clinic constant uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';
  -- frozen phantom→raw 매핑 (UUID PK만 — PHI 아님. phone_tail4+clinic 단일수렴, per-row confirm 대상)
  map jsonb := '[
    {"phantom":"0356b229-e8c7-4655-aa6e-651b15370c1f","raw":"c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b","tail":"9089"},
    {"phantom":"512998d0-d51a-42c4-947e-b0cb2cc69da4","raw":"8fa12f4c-abfe-405e-8736-c2ca8e4aef8a","tail":"5453"},
    {"phantom":"67ea1793-05e5-4d4a-b5c1-1ec73486e317","raw":"7ad9e9a4-5e52-418c-acdb-300ee7d30e0b","tail":"0011"},
    {"phantom":"bd307dfe-79f0-4fea-86a6-0957cea492cd","raw":"d916d27b-e1a4-42ea-893e-db9a4fd3a461","tail":"2200"},
    {"phantom":"44a6a076-ca66-458a-bdc5-e0a3a12c2e67","raw":"d2ba1e9a-74d2-4866-a7b8-d2282fccc2eb","tail":"1122"},
    {"phantom":"2dc21d1c-6e9f-4643-a733-dca92252d830","raw":"38e1a858-71fc-4b74-9032-7a95298bb00b","tail":"0101"}
  ]';
  rec jsonb;
  ph uuid; rw uuid; want_tail text;
  fk record;
  moved int; total_moved int := 0;
  remaining int; total_remaining int;
  deleted_ct int := 0;
  denorm_ct int := 0;
  ph_ok int; rw_ok int; tail_ok int;
BEGIN
  -- ── [G0] freeze re-assert: 매핑 phantom 6건이 정확히 존재 + masking-signature + clinic 일치 ──
  FOR rec IN SELECT * FROM jsonb_array_elements(map) LOOP
    ph := (rec->>'phantom')::uuid; rw := (rec->>'raw')::uuid; want_tail := rec->>'tail';

    -- phantom: 존재 + clinic + masking-signature(name '*' OR phone '*' OR phone digit 1~7)
    SELECT count(*) INTO ph_ok FROM customers c
     WHERE c.id = ph AND c.clinic_id = v_clinic
       AND ( c.name ~ '\*' OR c.phone ~ '\*'
             OR length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7 )
       AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4) = want_tail;
    IF ph_ok <> 1 THEN
      RAISE EXCEPTION 'ABORT G0: phantom % freeze-drift (masking-signature/clinic/tail4 미일치, got %)', ph, ph_ok;
    END IF;

    -- raw: 존재 + clinic + NON-masked + tail4 일치 (convergence key 재검증)
    SELECT count(*) INTO rw_ok FROM customers c
     WHERE c.id = rw AND c.clinic_id = v_clinic
       AND c.name !~ '\*'
       AND length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) >= 8
       AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4) = want_tail;
    IF rw_ok <> 1 THEN
      RAISE EXCEPTION 'ABORT G0: raw % 검증실패 (존재/non-masked/tail4 미일치, got %)', rw, rw_ok;
    END IF;
    IF ph = rw THEN RAISE EXCEPTION 'ABORT G0: phantom=raw 동일 %', ph; END IF;

    -- ★ tail4 충돌가드 (DA addendum MSG-20260714-013056-zbn9, C7 라이즈드바):
    --   결정키(reservation_id) 부재로 tail4+clinic 이 1차 결정근거로 승격 → phantom 제외 동 clinic·
    --   non-masked·8+digit·동일 tail4 raw 후보가 정확히 1건(=declared raw)이어야 채택. ≥2 면 INV-3
    --   fail-closed → auto-merge 금지, 전체 ABORT. (probe 시점 6건 전부 후보=1 실증. 집행시점 재검증.)
    SELECT count(*) INTO tail_ok FROM customers c
     WHERE c.clinic_id = v_clinic AND c.id <> ph
       AND c.name !~ '\*'
       AND length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) >= 8
       AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4) = want_tail;
    IF tail_ok <> 1 THEN
      RAISE EXCEPTION 'ABORT G0(tail4 충돌가드): tail4 % non-masked 후보 %건 (정확히 1 기대) → INV-3 fail-closed, per-row HOLD', want_tail, tail_ok;
    END IF;
  END LOOP;

  -- 정확히 6건만 대상 (초과/부족 시 abort)
  SELECT count(*) INTO ph_ok FROM jsonb_array_elements(map);
  IF ph_ok <> 6 THEN RAISE EXCEPTION 'ABORT G0: map 건수 % (6 기대)', ph_ok; END IF;

  -- ── [G1] archive-first: phantom 6건 스냅샷 ──
  FOR rec IN SELECT * FROM jsonb_array_elements(map) LOOP
    ph := (rec->>'phantom')::uuid;
    INSERT INTO _backfill_mask_contam_customers_bak
    SELECT c.*, 'T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL', now()
      FROM customers c WHERE c.id = ph;
  END LOOP;

  -- ── per phantom: §2-3-b (1)relink → (2)0건검증 → (3)archive-first delete ──
  FOR rec IN SELECT * FROM jsonb_array_elements(map) LOOP
    ph := (rec->>'phantom')::uuid; rw := (rec->>'raw')::uuid;

    -- (1) 전 FK 자식 기계열거 → raw로 FK-only UPDATE (movelog 기록 후 이동)
    FOR fk IN
      SELECT cl.relname AS child_table, att.attname AS child_col
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_class rf ON rf.oid = con.confrelid
        JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype = 'f' AND rf.relname = 'customers'
    LOOP
      -- movelog: 이동 전 자식 행 스냅샷
      EXECUTE format(
        'INSERT INTO _backfill_mask_contam_fkmoves(child_table,child_col,child_row,from_phantom,to_raw)
           SELECT %L,%L,to_jsonb(t.*),%L::uuid,%L::uuid FROM %I t WHERE t.%I = %L::uuid',
        fk.child_table, fk.child_col, ph, rw, fk.child_table, fk.child_col, ph);
      -- relink
      EXECUTE format('UPDATE %I SET %I = %L::uuid WHERE %I = %L::uuid',
        fk.child_table, fk.child_col, rw, fk.child_col, ph);
      GET DIAGNOSTICS moved = ROW_COUNT;
      total_moved := total_moved + moved;
    END LOOP;

    -- denorm refresh: raw로 재링크된 check_ins 중 마스킹 잔존을 raw 실값으로 refresh
    INSERT INTO _backfill_mask_contam_denorm(checkin_id,old_name,old_phone,new_name,new_phone)
      SELECT ci.id, ci.customer_name, ci.customer_phone, c.name, c.phone
        FROM check_ins ci JOIN customers c ON c.id = rw
       WHERE ci.customer_id = rw
         AND ( ci.customer_name ~ '\*' OR ci.customer_phone ~ '\*'
               OR length(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7 );
    UPDATE check_ins ci
       SET customer_name  = c.name,
           customer_phone = c.phone
      FROM customers c
     WHERE c.id = rw AND ci.customer_id = rw
       AND ( ci.customer_name ~ '\*' OR ci.customer_phone ~ '\*'
             OR length(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7 );
    GET DIAGNOSTICS moved = ROW_COUNT;
    denorm_ct := denorm_ct + moved;

    -- (2) §2-3-b 불변식: phantom이 전 FK에서 자식 0건 재검증 — 잔존 시 ABORT
    total_remaining := 0;
    FOR fk IN
      SELECT cl.relname AS child_table, att.attname AS child_col
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_class rf ON rf.oid = con.confrelid
        JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype = 'f' AND rf.relname = 'customers'
    LOOP
      EXECUTE format('SELECT count(*) FROM %I WHERE %I = %L::uuid', fk.child_table, fk.child_col, ph)
        INTO remaining;
      total_remaining := total_remaining + remaining;
    END LOOP;
    IF total_remaining > 0 THEN
      RAISE EXCEPTION 'ABORT §2-3-b(2): phantom % 잔존 자식 % 건 → 순소실 방지 전체 롤백', ph, total_remaining;
    END IF;

    -- (3) archive-first delete (스냅샷 G1 완료)
    DELETE FROM customers WHERE id = ph;
    GET DIAGNOSTICS moved = ROW_COUNT;
    deleted_ct := deleted_ct + moved;
  END LOOP;

  -- ── [G-final] frozen 6-set에 masking-signature customer 0건 잔존 ──
  SELECT count(*) INTO total_remaining
    FROM customers c
   WHERE c.id IN (SELECT (e->>'phantom')::uuid FROM jsonb_array_elements(map) e);
  IF total_remaining > 0 THEN
    RAISE EXCEPTION 'ABORT G-final: phantom % 건 미삭제', total_remaining;
  END IF;

  RAISE NOTICE 'BACKFILL_OK moved=% denorm_refreshed=% phantom_deleted=%',
    total_moved, denorm_ct, deleted_ct;
END $mig$;

COMMIT;
