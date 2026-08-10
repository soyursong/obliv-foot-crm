-- ============================================================================
-- T-20260810-foot-REGISTRAR-DUP-ROW-DEDUP — merge-before-archive (staff dedup)
-- ★ FROZEN v2 · 미실행. supervisor DB-GATE dry-run(무영속) + 물리 GO-token 후에만 apply.
-- ★ GO-token 前 prod 실행 금지 (apply_before_go 클래스).
-- change-class = DESTRUCTIVE-correction (soft-archive·가역) · DDL 0 · DML only.
-- DA canonical = MSG-20260810-225709-8bno · SSOT §3/§6/§7.
--
-- freeze set (INV-8-a 다축 census 4253fbdf/c8ca1f6a + freeze_reverify.json 재검증):
--   강다연  survivor=0ff81a68-9696-4a3a-b7ce-38973e37ee36 (08-10·auth·live-login 08-10 03:03·edge14)
--           loser   =4bcf55a2-4472-48ac-86a1-fca4b576ac21 (08-08·user_id NULL·edge1)
--           re-point staff_attendance PK = a9761249-fc3b-45b1-9a2a-1e3db3e65a07
--   이진석  survivor=884b4571-fbfb-4aa7-871c-f555dc296956 (08-10·auth confirmed·registrar) ★HR confirm 필수
--           loser   =9a429fb7-699b-4647-94da-c2ec1e61b3c9 (08-08·user_id NULL·edge1)
--           re-point staff_attendance PK = f35160d7-8c7f-4337-bd79-a1ec3c288366
--
-- full-FK 기계열거(pg_constraint confrelid=public.staff = 35 inbound FK) 실측:
--   loser 실참조 = staff_attendance.staff_id ×2 (각 pair 1) 뿐. 나머지 34 FK = 0.
--   §416(reservations.created_by=auth.users 축·staff FK 아님) 무저촉: loser user_id=NULL.
--
-- before_image (POST-VERIFY INV-8-c 근거·명시 uid): apply 前 러너가 R1(staff 4행)+R2(attendance 2행)을
--   db-gate/..._before_image.json 로 캡처(uid only). soft-archive 는 loser 행을 보존하므로
--   staff 원상태는 in-place 가역, attendance 는 PK-precise rollback 으로 원복.
--
-- ⚠ 이진석 pair = INV-8-b MODERATE(미로그인) → 사람 confirm 前 실행 금지.
--   confirm 이 survivor 를 뒤집으면 이 파일 이진석 블록의 uid/PK 를 교체 후 재-dry-run.
-- ============================================================================
BEGIN;

-- ── 1. merge: loser 참조 → survivor 명시 re-point (PK-precise · rows-affected==1 가드) ──
-- 강다연: attendance a9761249 (staff_id 4bcf55a2 loser) → survivor 0ff81a68
DO $$
DECLARE n int;
BEGIN
  UPDATE public.staff_attendance
     SET staff_id = '0ff81a68-9696-4a3a-b7ce-38973e37ee36'
   WHERE id = 'a9761249-fc3b-45b1-9a2a-1e3db3e65a07'
     AND staff_id = '4bcf55a2-4472-48ac-86a1-fca4b576ac21';   -- 가드: freeze 시점 소유 확인
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'kdy attendance re-point rows=% (기대 1) abort', n; END IF;
END $$;

-- 이진석: attendance f35160d7 (staff_id 9a429fb7 loser) → survivor 884b4571  ★HR confirm 후
DO $$
DECLARE n int;
BEGIN
  UPDATE public.staff_attendance
     SET staff_id = '884b4571-fbfb-4aa7-871c-f555dc296956'
   WHERE id = 'f35160d7-8c7f-4337-bd79-a1ec3c288366'
     AND staff_id = '9a429fb7-699b-4647-94da-c2ec1e61b3c9';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ljs attendance re-point rows=% (기대 1) abort', n; END IF;
END $$;

-- ── 2. zero-child 재검증 (loser 잔여 참조 0 — full-FK 실측 1축 staff_attendance) ─────
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

-- ── 3. soft-archive loser (active=false + 라벨) · hard-DELETE 금지 · 멱등 가드 ─────────
DO $$
DECLARE n int;
BEGIN
  UPDATE public.staff
     SET active = false,
         auto_assign_enabled = false,
         name = name || ' [중복정리 2026-08-10]',
         updated_at = now()
   WHERE id IN ('4bcf55a2-4472-48ac-86a1-fca4b576ac21',   -- 강다연 loser
                '9a429fb7-699b-4647-94da-c2ec1e61b3c9')    -- 이진석 loser
     AND active = true;                                    -- 멱등 가드
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'loser soft-archive rows=% (기대 2) abort', n; END IF;
END $$;

-- ── 4. POST-VERIFY 즉시 확인 (survivor active·loser inactive) — 명시 uid ──────────────
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
