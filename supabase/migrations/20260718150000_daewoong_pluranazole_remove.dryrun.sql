-- DRY-RUN (No-Persistence): T-20260718-foot-DRUG-DAEWOONG-PLURANAZOLE-REMOVE
-- Migration Dry-Run No-Persistence Protocol 준수 (migration_dryrun_no_persistence_standard.md):
--   · up.sql 의 txn-control(COMMIT) 제거 → BEGIN..ROLLBACK 자체로 무영속(prod 미변경).
--   · in-txn assertion: (a) 동명 freeze census=1 (b) 참조 5종 = 0 (c) DELETE 건수=1 (d) 잔존 0.
--   · DML-only(영속 DDL 객체 없음) → post-probe(assertAbsent) 비대상. 본 파일 = in-txn 검증만.
--   ⚠ dry-run 은 삭제를 실제 수행하나 ROLLBACK 으로 되돌림 → prod 무영향. 실 DELETE COUNT 확정 = supervisor DML 게이트.
BEGIN;

-- ── PRE 스냅샷 ────────────────────────────────────────────────────────
DO $pre$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
  RAISE NOTICE 'DRYRUN-PRE: 대웅푸루나졸 동명 census=% (freeze=1)', v_cnt;
END;
$pre$;

-- ── up.sql 본문 (COMMIT 제거) ─────────────────────────────────────────
DO $body$
DECLARE
  v_target_id  uuid;
  v_name_cnt   int;
  v_ref_total  int := 0;
  v_c          int;
  v_deleted    int;
BEGIN
  SELECT count(*) INTO v_name_cnt FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
  IF v_name_cnt <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 대웅푸루나졸 동명 % 건(freeze=1) — 드리프트', v_name_cnt;
  END IF;

  SELECT id INTO v_target_id FROM public.prescription_codes
   WHERE code_source='custom' AND claim_code='LEGACY-12d7730e32e8' AND name_ko LIKE '대웅푸루나졸%';
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 대상 미식별';
  END IF;

  -- 참조 5종 합산
  SELECT count(*) INTO v_c FROM public.prescription_contraindications WHERE prescription_code_id = v_target_id;
  v_ref_total := v_ref_total + v_c;
  IF to_regclass('public.prescription_code_folders') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescription_code_folders WHERE prescription_code_id=$1' INTO v_c USING v_target_id;
    v_ref_total := v_ref_total + v_c;
  END IF;
  IF to_regclass('public.prescription_code_allowlist') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.prescription_code_allowlist WHERE prescription_code_id=$1' INTO v_c USING v_target_id;
    v_ref_total := v_ref_total + v_c;
  END IF;
  IF to_regclass('public.prescription_sets') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM public.prescription_sets s
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(s.items,'[]'::jsonb)) e
                      WHERE e->>'prescription_code_id' = $1::text) $q$ INTO v_c USING v_target_id;
    v_ref_total := v_ref_total + v_c;
  END IF;
  IF to_regclass('public.medical_charts') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM public.medical_charts m
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(m.prescription_items,'[]'::jsonb)) e
                      WHERE e->>'prescription_code_id' = $1::text) $q$ INTO v_c USING v_target_id;
    v_ref_total := v_ref_total + v_c;
  END IF;

  IF v_ref_total <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 참조 % 건 존재 — hard-DELETE 금지', v_ref_total;
  END IF;
  RAISE NOTICE 'DRYRUN-OK: 참조 5종 합산 0 (금기/폴더/화이트/묶음/처방이력)';

  DELETE FROM public.prescription_codes WHERE id = v_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 삭제 % 건(기대=1)', v_deleted;
  END IF;
  RAISE NOTICE 'DRYRUN-OK: DELETE 건수=% (기대 1)', v_deleted;
END;
$body$;

-- ── in-txn 사후 assertion ────────────────────────────────────────────
DO $chk$
DECLARE v_left int;
BEGIN
  SELECT count(*) INTO v_left FROM public.prescription_codes WHERE name_ko LIKE '대웅푸루나졸%';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL: 대웅푸루나졸 % 건 잔존(기대 0)', v_left;
  END IF;
  RAISE NOTICE 'DRYRUN-OK: 대웅푸루나졸 잔존 0 (무영속 검증 통과)';
END;
$chk$;

ROLLBACK;
