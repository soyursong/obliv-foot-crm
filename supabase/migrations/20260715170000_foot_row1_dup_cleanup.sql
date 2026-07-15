-- ============================================================================
-- foot row1(0356b229) self-checkin 중복행 정정 — mutation (HYBRID SOP)
-- Ticket : T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
-- 특성화 : T-20260714-foot-ROW1-MASTER-DEFECT-CHARACTERIZE (READ-ONLY done)
--          = 가설A 중복행(self-checkin duplicate) · confidence HIGH · keep=RAW.
-- SOP    : HYBRID
--   (1) Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard
--       — 파괴적 relink + archive-first 2단(archive→verify→remove), hard-DELETE 금지,
--         순소실0, FK RESTRICT 무결성 가드, DESTRUCTIVE→검증→ADDITIVE 분리, freeze셋 재검증 abort.
--   (2) Cross-CRM Data-Correction Backfill SOP 규율
--       — ROW1→RAW rrn_enc(및 vault/version/reenc) mutable 이관. 단일 count UPDATE 금지·
--         지문 교집합·대상셋 freeze·판정근거 스냅샷·폴백.
--   ⚠ 부모 마스킹 마이그(옵션D) 재사용 금지(DA 지시). name 비마스킹 = 마스킹-오염 서명 불일치.
--
-- ⛔⛔ DRAFT / DO-NOT-APPLY ⛔⛔  (본 티켓 status=approved(1차 DA GO) — 2·3차 게이트 前 적용금지)
--   착수 게이트(순차·fail-closed):
--     [1차] data-architect CONSULT-REPLY GO  ← 획득(CONDITIONAL GO, MSG-20260715-082910-6xuo).
--     [2차] supervisor DB-GATE (DDL-diff + dry-run no-persistence + ledger 3자 + 롤백)
--     [3차] 대표 게이트 (파괴적 + 실환자 PII + RRN 실데이터 이동, autonomy §3.1)
--           + per-row 사람 confirm (DA C4/C7 바 — HIGH이나 결정키 부재)
--   위 3게이트 전량 통과 前 prod 적용 절대 금지. per-row GUC 훅 미설정 시 fail-closed ABORT.
--
-- ── keep=RAW 이관 방향 ──
--   ROW1(0356b229) = self-checkin 중복행(삭제 대상, has_rrn=TRUE)
--   RAW (c51dd5e0) = 정본 master(보존 대상, has_rrn=FALSE, 실 phone 보유)
--   RRN은 중복행 ROW1에만 존재 → 먼저 RAW로 이관 → 4 하드자식 relink → archive-first ROW1 제거.
--   merge가 ROW1 마스킹 phone을 RAW 실 phone으로 복원(현장 APPROVED_BLANKET 자연 충족).
--
-- ── RRN 이관 안전성 (evidence, DA 확인 + prod 실측 2026-07-15) ──
--   rrn_decrypt 는 pgp_sym_decrypt(rrn_enc, v_key) — v_key = CRM 단위 대칭키
--   (version=2 → Vault 'foot_rrn_key_v2' / v1 → GUC app.rrn_key). customer_uuid 는
--   행 조회·clinic 게이트·audit 용도일 뿐 암호문에 bind 되지 않음(UUID-unbound, DA 확증).
--   ★ prod 실측(2026-07-15): ROW1.rrn_encryption_version=2, rrn_re_encrypted_at=NOT NULL,
--     rrn_vault_id=NULL. (DA C1 가정 v1/NULL 과 divergence — 아래 C1 참조.)
--   ∴ 4컬럼 faithful 동반 이관 시 RAW.id 하에서 version=2 → Vault 신키로 그대로 복호 가능.
--     ROW1↔RAW 동일 clinic(74967aea) + 동일 CRM 단일키 → 재암호화 불요.
--
-- ── DA 바인딩 조건 매핑 ──
--   C1(faithful 4컬럼·재태깅 금지) : G2 UPDATE 4컬럼 직접 복사 + G-final version 동일성 assert.
--                                     ★ 실측 version=2 이므로 v1 하드코딩 금지 — 실값 캡처·보존.
--   C2(opaque BYTEA·복호 금지)      : G2 = rrn_enc BYTEA 직접 UPDATE. rrn_decrypt/encrypt 미호출. 복호 0회.
--   C3(resident_id 평문 차단)       : G0-C3 = ROW1·RAW resident_id 실측(둘 다 NULL). non-NULL 시 ABORT.
--                                     resident_id 미복사 → RAW.resident_id NULL 불변.
--   C4(freeze + fail-closed)        : G0 = PK VALUES 고정. per-row 훅 정확일치. G-final 다중 재검증.
--   C5(기계 FK 열거)                : G3/G4 = pg_constraint(contype=f,confrelid=customers) 기계열거.
--                                     confdeltype NOTICE + archived==moved assert. (prod 실측 32 FK)
--   C6(denorm refresh 스코프 바운드): relink된 check_ins customer_name/phone 로 한정.
--   C7(dry-run 무영속)              : *.dryrun.sql 미러 + scripts/…_dryrun_run.mjs (buildHarness 3요소).
--
-- 멱등: 이미 이관/삭제된 상태 재실행 시 G* 재검증으로 no-op abort-safe.
-- ============================================================================

BEGIN;

-- 아카이브/무브로그 (rollback SSOT, tracked schema 무접촉 — 별도 _cleanup_row1_* 테이블)
CREATE TABLE IF NOT EXISTS _cleanup_row1_customers_bak (
  LIKE customers,
  cleanup_ticket text NOT NULL DEFAULT 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION',
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS _cleanup_row1_fkmoves (
  id bigserial PRIMARY KEY,
  cleanup_ticket text NOT NULL DEFAULT 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION',
  child_table text NOT NULL,
  child_col   text NOT NULL,
  confdeltype "char",               -- C5: FK on-delete action (a/r=blocker, n/c=silent-loss 유발자)
  child_row   jsonb NOT NULL,        -- to_jsonb(child) 이동 전 스냅샷 (정밀 롤백)
  from_row1   uuid NOT NULL,
  to_raw      uuid NOT NULL,
  moved_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS _cleanup_row1_rrn_bak (
  id bigserial PRIMARY KEY,
  cleanup_ticket text NOT NULL DEFAULT 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION',
  raw_id uuid NOT NULL,
  old_rrn_enc bytea,                 -- RAW 이관 전 값(NULL 기대) — RRN 이관 롤백용
  old_rrn_vault_id uuid,
  old_rrn_encryption_version smallint,
  old_rrn_re_encrypted_at timestamptz,
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS _cleanup_row1_denorm (
  id bigserial PRIMARY KEY,
  checkin_id uuid NOT NULL,
  old_name text, old_phone text,
  new_name text, new_phone text,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

DO $mig$
DECLARE
  v_clinic constant uuid := '74967aea-a60b-4da3-a0e7-9c997a930bc8';   -- jongno-foot
  v_row1   constant uuid := '0356b229-e8c7-4655-aa6e-651b15370c1f';   -- 중복행(삭제 대상)
  v_raw    constant uuid := 'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b';   -- 정본(보존 대상)
  v_ptail  constant text := '9089';
  fk record;
  moved int; total_moved int := 0; archived_moves int;
  remaining int; total_remaining int;
  denorm_ct int := 0;
  n int; n_ledger int;
  v_confirm text;
  v_row1_hash text; v_raw_hash text;
  v_row1_rrn bytea; v_raw_rrn bytea;
  v_row1_ver smallint; v_raw_ver smallint;
  v_row1_resid text; v_raw_resid text;
BEGIN
  -- ══════════════════════════════════════════════════════════════════════
  -- [PER-ROW CONFIRM 훅] DA C4/C7 바 — HIGH이나 결정키 부재 → 사람 confirm 의무.
  --   대표 게이트 집행자(사람)가 세션 GUC 로 명시 confirm 토큰을 정확일치로 설정해야만 진행.
  --   미설정/불일치 공히 fail-closed ABORT. (auto-merge 금지 = 배치경로 폐쇄)
  --     SET LOCAL app.row1_cleanup_confirm = '0356b229::KEEP-RAW::c51dd5e0';
  -- ══════════════════════════════════════════════════════════════════════
  BEGIN
    v_confirm := current_setting('app.row1_cleanup_confirm');
  EXCEPTION WHEN OTHERS THEN
    v_confirm := NULL;
  END;
  IF v_confirm IS DISTINCT FROM '0356b229::KEEP-RAW::c51dd5e0' THEN
    RAISE EXCEPTION 'ABORT per-row-confirm: app.row1_cleanup_confirm 미설정/불일치 → 사람 confirm 없이 mutation 금지(DA C4/C7 fail-closed)';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G0] freeze re-assert — 단일 count 금지, 지문 교집합(name_hash + ptail + clinic + rrn 상태)
  -- ══════════════════════════════════════════════════════════════════════
  -- ROW1: 존재 + clinic + ptail + rrn 보유(has_rrn=TRUE)
  SELECT count(*) INTO n FROM customers c
   WHERE c.id = v_row1 AND c.clinic_id = v_clinic
     AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4) = v_ptail
     AND c.rrn_enc IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORT G0: ROW1 freeze-drift (clinic/ptail/has_rrn 미일치, got %)', n; END IF;

  -- RAW: 존재 + clinic + ptail + rrn 미보유(has_rrn=FALSE, 이관 타깃)
  SELECT count(*) INTO n FROM customers c
   WHERE c.id = v_raw AND c.clinic_id = v_clinic
     AND right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),4) = v_ptail
     AND c.rrn_enc IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORT G0: RAW freeze-drift (clinic/ptail/rrn_null 미일치, got %)', n; END IF;

  IF v_row1 = v_raw THEN RAISE EXCEPTION 'ABORT G0: ROW1=RAW 동일'; END IF;

  -- 지문: name_hash 완전일치 (특성화 판정 근거 — 평문 미노출, 해시 대조만)
  SELECT md5(lower(regexp_replace(coalesce(name,''),'\s','','g'))) INTO v_row1_hash FROM customers WHERE id = v_row1;
  SELECT md5(lower(regexp_replace(coalesce(name,''),'\s','','g'))) INTO v_raw_hash  FROM customers WHERE id = v_raw;
  IF v_row1_hash IS DISTINCT FROM v_raw_hash THEN
    RAISE EXCEPTION 'ABORT G0: ROW1/RAW name_hash 불일치 → 동일인 지문 붕괴, per-row 재확인 필요';
  END IF;

  -- 중복행 지문: ROW1 self-checkin 서명 = check_ins(reservation_id IS NULL, status=done) ≥1
  SELECT count(*) INTO n FROM check_ins ci
   WHERE ci.customer_id = v_row1 AND ci.reservation_id IS NULL AND ci.status = 'done';
  IF n < 1 THEN
    RAISE EXCEPTION 'ABORT G0: ROW1 self-checkin 서명(check_in reservation_id=NULL/status=done) 부재 → 가설A 지문 붕괴';
  END IF;

  -- ── [G0-C3] resident_id 평문 잔존 차단 (DA C3) ─────────────────────────
  --   ROW1·RAW 공히 resident_id(평문 TEXT) 실측. non-NULL 시 평문 RRN 순환 위험 →
  --   이관 금지·중단(phi_redaction_standard §1 라우팅). prod 실측(07-15): 둘 다 NULL.
  SELECT resident_id INTO v_row1_resid FROM customers WHERE id = v_row1;
  SELECT resident_id INTO v_raw_resid  FROM customers WHERE id = v_raw;
  IF v_row1_resid IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT G0-C3: ROW1.resident_id 평문 non-NULL → 평문 RRN 복사 금지(DA C3), phi_redaction 라우팅 필요';
  END IF;
  IF v_raw_resid IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT G0-C3: RAW.resident_id 평문 non-NULL → 이관 후 잔존 위험, 중단(DA C3)';
  END IF;

  -- ── [G0-ledger] 원장 접점 재검증 = 0 (SOP + C5 fail-closed) ──────────────
  --   특성화: ROW1 blast(payments/medical_charts/packages) = 0. dry-run/apply 시점에 신규
  --   ledger 자식이 유입되면 ROW1 이 실 standalone 로 변모 중 신호 → relink 금지·재판정.
  SELECT
      (SELECT count(*) FROM payments            WHERE customer_id = v_row1)
    + (SELECT count(*) FROM medical_charts      WHERE customer_id = v_row1)
    + (SELECT count(*) FROM package_payments    WHERE customer_id = v_row1)
    + (SELECT count(*) FROM service_charges     WHERE customer_id = v_row1)
    + (SELECT count(*) FROM prescriptions       WHERE customer_id = v_row1)
    + (SELECT count(*) FROM insurance_claims    WHERE customer_id = v_row1)
    + (SELECT count(*) FROM insurance_documents WHERE customer_id = v_row1)
    + (SELECT count(*) FROM insurance_receipts  WHERE customer_id = v_row1)
    + (SELECT count(*) FROM payment_code_claims WHERE customer_id = v_row1)
    + (SELECT count(*) FROM packages            WHERE customer_id = v_row1 OR transferred_to = v_row1)
    INTO n_ledger;
  IF n_ledger <> 0 THEN
    RAISE EXCEPTION 'ABORT G0-ledger: ROW1 원장 접점 %건 유입 — 실환자화 신호. relink 금지 → DA/planner 재판정', n_ledger;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G1] archive-first: ROW1 customers 스냅샷 + RAW rrn 사전상태 스냅샷(롤백 SSOT)
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO _cleanup_row1_customers_bak
  SELECT c.*, 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION', now()
    FROM customers c WHERE c.id = v_row1
   AND NOT EXISTS (SELECT 1 FROM _cleanup_row1_customers_bak b WHERE b.id = v_row1);  -- 멱등

  INSERT INTO _cleanup_row1_rrn_bak(raw_id, old_rrn_enc, old_rrn_vault_id, old_rrn_encryption_version, old_rrn_re_encrypted_at)
  SELECT c.id, c.rrn_enc, c.rrn_vault_id, c.rrn_encryption_version, c.rrn_re_encrypted_at
    FROM customers c WHERE c.id = v_raw
   AND NOT EXISTS (SELECT 1 FROM _cleanup_row1_rrn_bak b WHERE b.raw_id = v_raw);  -- 멱등

  -- ══════════════════════════════════════════════════════════════════════
  -- [G2] RRN mutable 이관 (Data-Correction Backfill 규율) — ROW1 → RAW
  --   C1/C2: 4컬럼(rrn_enc·rrn_vault_id·rrn_encryption_version·rrn_re_encrypted_at)
  --          faithful BYTEA 직접 이관. 복호/재암호화 0회. version 재태깅 금지(실값 보존).
  --   전제: RAW.rrn_enc IS NULL (덮어쓰기 금지).
  -- ══════════════════════════════════════════════════════════════════════
  SELECT rrn_enc, rrn_encryption_version INTO v_row1_rrn, v_row1_ver FROM customers WHERE id = v_row1;
  SELECT rrn_enc INTO v_raw_rrn FROM customers WHERE id = v_raw;
  RAISE NOTICE 'G2 evidence: ROW1 rrn_encryption_version=% (faithful 보존·재태깅 금지)', v_row1_ver;
  IF v_raw_rrn IS NOT NULL THEN
    -- 멱등: 이미 이관됨(RAW.rrn = ROW1.rrn)이면 skip, 다른 값이면 ABORT(덮어쓰기 금지)
    IF v_raw_rrn IS DISTINCT FROM v_row1_rrn THEN
      RAISE EXCEPTION 'ABORT G2: RAW 에 이미 다른 rrn_enc 존재 → 덮어쓰기 금지(순소실 방지)';
    END IF;
    RAISE NOTICE 'G2 idempotent: RRN 이미 이관됨 — skip';
  ELSE
    UPDATE customers r
       SET rrn_enc                = s.rrn_enc,
           rrn_vault_id           = s.rrn_vault_id,
           rrn_encryption_version = s.rrn_encryption_version,
           rrn_re_encrypted_at    = s.rrn_re_encrypted_at
      FROM customers s
     WHERE r.id = v_raw AND s.id = v_row1
       AND r.rrn_enc IS NULL;          -- 조건부(덮어쓰기 금지)
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION 'ABORT G2: RRN 이관 rowcount % (1 기대)', n; END IF;
    -- 이관 검증: RAW.rrn = ROW1.rrn (byte 동일) + version 동일성(faithful)
    SELECT rrn_enc, rrn_encryption_version INTO v_raw_rrn, v_raw_ver FROM customers WHERE id = v_raw;
    IF v_raw_rrn IS DISTINCT FROM v_row1_rrn THEN
      RAISE EXCEPTION 'ABORT G2: RRN 이관 후 RAW.rrn ≠ ROW1.rrn';
    END IF;
    IF v_raw_ver IS DISTINCT FROM v_row1_ver THEN
      RAISE EXCEPTION 'ABORT G2(C1): RAW.rrn_encryption_version(%) ≠ ROW1(%) — 재태깅 감지, 중단', v_raw_ver, v_row1_ver;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G3] FK 자식 relink (FK Integrity Guard) — 기계열거(pg_constraint) 전 FK 자식 ROW1 → RAW
  --   C5: 손열거 금지. confdeltype 동반 스냅샷(a/r=blocker, n/c=silent-loss 유발자 archive-first).
  --   특성화: ROW1 하드자식 4(check_in·consult_memo·health_q_results·health_q_tokens).
  --   customer_id-scoped UNIQUE 충돌=0 (특성화). relink=CASCADE/SET NULL 발화 무력화(삭제 전 0-child).
  -- ══════════════════════════════════════════════════════════════════════
  FOR fk IN
    SELECT cl.relname AS child_table, att.attname AS child_col, con.confdeltype AS del
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_class rf ON rf.oid = con.confrelid
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum,ord) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     WHERE con.contype = 'f' AND rf.relname = 'customers'
  LOOP
    -- movelog: 이동 전 자식 행 스냅샷 (confdeltype 동반 — silent-loss 유발자 명시 archive)
    EXECUTE format(
      'INSERT INTO _cleanup_row1_fkmoves(child_table,child_col,confdeltype,child_row,from_row1,to_raw)
         SELECT %L,%L,%L::"char",to_jsonb(t.*),%L::uuid,%L::uuid FROM %I t WHERE t.%I = %L::uuid',
      fk.child_table, fk.child_col, fk.del, v_row1, v_raw, fk.child_table, fk.child_col, v_row1);
    -- relink
    EXECUTE format('UPDATE %I SET %I = %L::uuid WHERE %I = %L::uuid',
      fk.child_table, fk.child_col, v_raw, fk.child_col, v_row1);
    GET DIAGNOSTICS moved = ROW_COUNT;
    total_moved := total_moved + moved;
  END LOOP;

  -- C5: archived(movelog) 건수 = relink(moved) 건수 (부분집합이면 순소실 위험 → ABORT)
  SELECT count(*) INTO archived_moves FROM _cleanup_row1_fkmoves
   WHERE cleanup_ticket = 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION' AND from_row1 = v_row1;
  IF archived_moves <> total_moved THEN
    RAISE EXCEPTION 'ABORT G3(C5): archived %건 ≠ relinked %건 — 스냅샷 누락(순소실 위험)', archived_moves, total_moved;
  END IF;

  -- denorm refresh (C6, 스코프 바운드): RAW로 재링크된 check_ins 중 마스킹 잔존을 RAW 실값으로 refresh
  --   (ROW1 = 익일 self-checkin 마스킹 4자리 phone → RAW 실 12자리 phone 복원 = APPROVED_BLANKET 이행)
  INSERT INTO _cleanup_row1_denorm(checkin_id,old_name,old_phone,new_name,new_phone)
    SELECT ci.id, ci.customer_name, ci.customer_phone, c.name, c.phone
      FROM check_ins ci JOIN customers c ON c.id = v_raw
     WHERE ci.customer_id = v_raw
       AND ( ci.customer_name ~ '\*' OR ci.customer_phone ~ '\*'
             OR length(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7 );
  UPDATE check_ins ci
     SET customer_name  = c.name,
         customer_phone = c.phone
    FROM customers c
   WHERE c.id = v_raw AND ci.customer_id = v_raw
     AND ( ci.customer_name ~ '\*' OR ci.customer_phone ~ '\*'
           OR length(regexp_replace(coalesce(ci.customer_phone,''),'[^0-9]','','g')) BETWEEN 1 AND 7 );
  GET DIAGNOSTICS denorm_ct = ROW_COUNT;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G4] 순소실 0 검증 — ROW1 전 FK 자식 0건 재검증(잔존 시 ABORT 전체 롤백)
  -- ══════════════════════════════════════════════════════════════════════
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
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = %L::uuid', fk.child_table, fk.child_col, v_row1)
      INTO remaining;
    total_remaining := total_remaining + remaining;
  END LOOP;
  IF total_remaining > 0 THEN
    RAISE EXCEPTION 'ABORT G4: ROW1 잔존 자식 % 건 → 순소실 방지 전체 롤백', total_remaining;
  END IF;

  -- RRN 순소실 0: 삭제 직전 RAW 에 rrn_enc 존재 재확인
  SELECT rrn_enc INTO v_raw_rrn FROM customers WHERE id = v_raw;
  IF v_raw_rrn IS NULL THEN
    RAISE EXCEPTION 'ABORT G4: RAW.rrn_enc NULL — ROW1 삭제 시 RRN 순소실 위험, 중단';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G5] archive-first remove — ROW1 제거 (G1 스냅샷 완료 + G4 0-child/RRN 검증 후에만)
  -- ══════════════════════════════════════════════════════════════════════
  DELETE FROM customers WHERE id = v_row1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORT G5: ROW1 삭제 rowcount % (1 기대)', n; END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- [G-final] freeze-set 재검증 (DA C4) — ROW1 부재 ∧ RAW 존치 ∧ RAW.rrn 보유
  --                                       ∧ RAW.version = ROW1 원값(faithful) ∧ ROW1 자식 0
  -- ══════════════════════════════════════════════════════════════════════
  IF EXISTS (SELECT 1 FROM customers WHERE id = v_row1) THEN
    RAISE EXCEPTION 'ABORT G-final: ROW1 미삭제';
  END IF;
  SELECT count(*) INTO n FROM customers
   WHERE id = v_raw AND rrn_enc IS NOT NULL
     AND rrn_encryption_version IS NOT DISTINCT FROM v_row1_ver;
  IF n <> 1 THEN
    RAISE EXCEPTION 'ABORT G-final: RAW 존치/rrn 보유/version(=%) faithful 검증 실패 (got %)', v_row1_ver, n;
  END IF;
  IF total_remaining <> 0 THEN
    RAISE EXCEPTION 'ABORT G-final: ROW1 자식 잔존 재확인 실패';
  END IF;

  RAISE NOTICE 'ROW1_CLEANUP_OK relinked=% denorm_refreshed=% row1_deleted=1 rrn_transferred=1 rrn_version=%',
    total_moved, denorm_ct, v_row1_ver;
END $mig$;

COMMIT;
