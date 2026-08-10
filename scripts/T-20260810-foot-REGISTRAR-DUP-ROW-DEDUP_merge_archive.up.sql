-- ============================================================================
-- T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP — merge-before-archive (staff dedup)
-- ★ DRAFT · 미실행. supervisor DB-GATE dry-run(무영속) + 물리 GO-token 후에만 apply.
-- ★ GO-token 前 prod 실행 금지 (apply_before_go 클래스).
-- change-class = DESTRUCTIVE-correction (soft-archive·가역) · DDL 0 · DML only.
-- DA canonical = MSG-20260810-225709-8bno · SSOT §3/§6/§7.
--
-- freeze set (INV-8-a 다축 census 4253fbdf + ac2/ac2b 근거):
--   강다연  survivor=0ff81a68-9696-4a3a-b7ce-38973e37ee36 (08-10·auth·live-login·edge14)
--           loser   =4bcf55a2-4472-48ac-86a1-fca4b576ac21 (08-08·auth無·edge1)
--   이진석  survivor=884b4571-fbfb-4aa7-871c-f555dc296956 (08-10·auth·registrar) ★HR confirm 필수
--           loser   =9a429fb7-699b-4647-94da-c2ec1e61b3c9 (08-08·auth無·edge1)
--
-- ⚠ 이진석 pair 는 INV-8-b MODERATE → 사람 confirm 전 실행 금지.
--   confirm 결과가 survivor 를 뒤집으면 uid 교체 후 재-dry-run.
-- ============================================================================
BEGIN;

-- ── 0. before_image 캡처 (POST-VERIFY INV-8-c 근거·uid only) ─────────────────
CREATE TEMP TABLE _before_image AS
  SELECT id, clinic_id, name, role, active, user_id, created_at, updated_at,
         'staff'::text AS src_table, now() AS captured_at
  FROM public.staff
  WHERE id IN ('0ff81a68-9696-4a3a-b7ce-38973e37ee36',
               '4bcf55a2-4472-48ac-86a1-fca4b576ac21',
               '884b4571-fbfb-4aa7-871c-f555dc296956',
               '9a429fb7-699b-4647-94da-c2ec1e61b3c9');

-- ── 1. merge: loser 참조 → survivor 명시 re-point (full-FK 기계열거 근거) ──────
--    census(A3) 실측 loser 참조 = staff_attendance ×1 (각 pair) 뿐. rows-affected 검증.
-- 강다연: staff_attendance loser 4bcf55a2 → survivor 0ff81a68
WITH upd AS (
  UPDATE public.staff_attendance
     SET staff_id = '0ff81a68-9696-4a3a-b7ce-38973e37ee36'
   WHERE staff_id = '4bcf55a2-4472-48ac-86a1-fca4b576ac21'
  RETURNING 1)
SELECT count(*) AS kdy_attendance_repointed FROM upd;

-- 이진석: staff_attendance loser 9a429fb7 → survivor 884b4571  ★HR confirm 후 활성화
WITH upd AS (
  UPDATE public.staff_attendance
     SET staff_id = '884b4571-fbfb-4aa7-871c-f555dc296956'
   WHERE staff_id = '9a429fb7-699b-4647-94da-c2ec1e61b3c9'
  RETURNING 1)
SELECT count(*) AS ljs_attendance_repointed FROM upd;

-- ── 2. zero-child 재검증 (loser 잔여 참조 0 이어야 함 — 35 FK 중 실측 1축) ───────
DO $$
DECLARE remain int;
BEGIN
  SELECT count(*) INTO remain FROM public.staff_attendance
   WHERE staff_id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',
                      '9a429fb7-699b-4647-94da-c2ec1e61b3c9');
  IF remain <> 0 THEN
    RAISE EXCEPTION 'zero-child 위반: loser staff_attendance 잔여 % (abort)', remain;
  END IF;
END $$;

-- ── 3. soft-archive loser (active=false + 라벨) · hard-DELETE 금지 ─────────────
WITH arc AS (
  UPDATE public.staff
     SET active = false,
         auto_assign_enabled = false,
         name = name || ' [중복정리 2026-08-10]',
         updated_at = now()
   WHERE id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',   -- 강다연 loser
                '9a429fb7-699b-4647-94da-c2ec1e61b3c9')    -- 이진석 loser
     AND active = true                                     -- 멱등 가드
  RETURNING id)
SELECT count(*) AS losers_archived FROM arc;

-- ── 4. POST-VERIFY 즉시 확인 (survivor active·loser inactive) ────────────────
DO $$
DECLARE surv_active int; loser_active int;
BEGIN
  SELECT count(*) INTO surv_active FROM public.staff
   WHERE id IN ('0ff81a68-9696-4a3a-b7ce-38973e37ee36',
                '884b4571-fbfb-4aa7-871c-f555dc296956') AND active;
  SELECT count(*) INTO loser_active FROM public.staff
   WHERE id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',
                '9a429fb7-699b-4647-94da-c2ec1e61b3c9') AND active;
  IF surv_active <> 2 THEN RAISE EXCEPTION 'survivor active != 2 (=%)', surv_active; END IF;
  IF loser_active <> 0 THEN RAISE EXCEPTION 'loser 여전히 active (=%)', loser_active; END IF;
END $$;

COMMIT;
