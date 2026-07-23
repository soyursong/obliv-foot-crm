-- DRY-RUN (No-Persistence Protocol): T-20260724-foot-DUMMY-NORMALIZE-HOLD-GUARD-APPLY
--   회귀행렬 6종(DA CONSULT-REPLY MSG-20260724-071451-fbr2 판정3) 무영속 검증.
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체를 **단일 DO 블록(=단일 statement, 단일 서브트랜잭션)** 으로 실행한다. 블록 내에서 가드 객체
--   (테이블/함수/트리거)를 EXECUTE 로 생성하고, 테스트 행 INSERT + 6종 UPDATE 를 돌린 뒤, 블록 말미에
--   RAISE EXCEPTION 으로 강제 unwind → 생성 객체·테스트 데이터 **어떤 것도 영속되지 않음**.
--   단일 statement 이므로 Management API /database/query 의 autocommit-between-statements 가 원천적으로
--   불가능(= up.sql 내장 txn-control COMMIT 이 sentinel 이전에 확정되는 hazard 미해당). up.sql 에도 BEGIN/COMMIT 없음.
--
-- ── 회귀행렬 (기대) ───────────────────────────────────────────────────────────
--   1) ROW1(active hold) phone→DUMMY UPDATE          → BLOCK (의도된 fail-closed)
--   2) 비-hold 행 phone→DUMMY UPDATE                  → PASS  (회귀 0)
--   3) active-hold 행 self_checkin-style(phone 미전이) → PASS  (DUMMY 미기록)
--   4) active-hold 행 정상 스태프 편집(phone→실번호)   → PASS  (DUMMY 전이 아님)
--   5) 레지스트리 空(hold released) 후 phone→DUMMY      → PASS  (트리거 no-op)
--   6) phone-normalize HARDEN 경로, 비-hold 행         → PASS  (회귀 0)
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT count(*) FROM pg_trigger WHERE tgname='trg_data_correction_hold_guard';         -- 기대 0(미영속)
--   SELECT to_regclass('public.data_correction_hold_registry');                            -- 기대 NULL(미영속)
--   SELECT count(*) FROM public.customers WHERE name IN ('DRYRUN-HOLDGUARD-HELD','DRYRUN-HOLDGUARD-FREE'); -- 기대 0(INSERT 미영속)
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환된다. 'ALL PASS' = 6종 통과.

DO $dryrun$
DECLARE
  v_clinic   uuid;
  v_id_held  uuid;
  v_id_free  uuid;
  v_dummy    text;
  v_result   text := '';
  v_ok       boolean;
  v_all_pass boolean := true;
  -- 충돌 회피용 랜덤 E164 픽스처(prod idx_customers_clinic_phone 유니크 회피). 실행 시점 랜덤.
  v_p0 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
  v_p1 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
  v_p3 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
  v_p4 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
BEGIN
  -- ── 가드 객체 생성 (up.sql 정의와 동일, 무영속) ──
  EXECUTE $ddl$
    CREATE TABLE public.data_correction_hold_registry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id uuid NOT NULL,
      target_table text NOT NULL,
      target_pk text NOT NULL,
      guard_scope text NOT NULL DEFAULT 'phone_dummy_normalize',
      hold_ticket text NOT NULL,
      reason text NOT NULL,
      created_by text NOT NULL DEFAULT current_user,
      created_at timestamptz NOT NULL DEFAULT now(),
      released_at timestamptz,
      released_by text,
      release_reason text
    )$ddl$;
  EXECUTE $ddl$
    CREATE UNIQUE INDEX uq_hold_active ON public.data_correction_hold_registry
      (clinic_id, target_table, target_pk, guard_scope) WHERE released_at IS NULL$ddl$;
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.fn_data_correction_hold_guard()
    RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
    DECLARE v_hold_ticket text;
    BEGIN
      IF NEW.phone IS NULL OR NEW.phone NOT LIKE 'DUMMY-%'
         OR (OLD.phone IS NOT NULL AND OLD.phone LIKE 'DUMMY-%') THEN
        RETURN NEW;
      END IF;
      SELECT h.hold_ticket INTO v_hold_ticket
        FROM public.data_correction_hold_registry h
       WHERE h.target_table = TG_TABLE_NAME AND h.target_pk = OLD.id::text
         AND h.clinic_id = OLD.clinic_id
         AND h.guard_scope IN ('phone_dummy_normalize','all') AND h.released_at IS NULL
       LIMIT 1;
      IF v_hold_ticket IS NOT NULL THEN
        RAISE EXCEPTION 'data-correction hold active: % target_pk=% hold_ticket=%',
          TG_TABLE_NAME, OLD.id::text, v_hold_ticket USING ERRCODE='raise_exception';
      END IF;
      RETURN NEW;
    END $fn$$ddl$;
  EXECUTE $ddl$
    CREATE TRIGGER trg_data_correction_hold_guard BEFORE UPDATE OF phone ON public.customers
      FOR EACH ROW EXECUTE FUNCTION public.fn_data_correction_hold_guard()$ddl$;

  -- ── 테스트 픽스처 ──
  SELECT id INTO v_clinic FROM public.clinics LIMIT 1;
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic, 'DRYRUN-HOLDGUARD-HELD', v_p0, 'new') RETURNING id INTO v_id_held;
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic, 'DRYRUN-HOLDGUARD-FREE', v_p1, 'new') RETURNING id INTO v_id_free;
  -- ROW1 대역: v_id_held 를 active hold 로 등록(guard_scope 기본).
  INSERT INTO public.data_correction_hold_registry (clinic_id, target_table, target_pk, hold_ticket, reason)
    VALUES (v_clinic, 'customers', v_id_held::text, 'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION', 'forensics');

  -- ── case 1: active-hold 행 phone→DUMMY → BLOCK 기대 ──
  v_dummy := 'DUMMY-'||gen_random_uuid();
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = v_dummy WHERE id = v_id_held;
    v_ok := false;  -- 도달하면 = 차단 실패
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%data-correction hold active%' THEN v_ok := true; END IF;
  END;
  v_result := v_result || format('case1(held→DUMMY expect BLOCK)=%s ', CASE WHEN v_ok THEN 'BLOCK✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 2: 비-hold 행 phone→DUMMY → PASS 기대 ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE id = v_id_free;
    v_ok := true;  -- 통과 = 정상
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case2(free→DUMMY expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 3: active-hold 행 self_checkin-style(phone 미전이, 실번호 유지) → PASS 기대 ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = v_p3 WHERE id = v_id_held;  -- DUMMY 아님 → 전이 매치 안 함
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case3(held self_checkin real-phone expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 4: active-hold 행 정상 스태프 편집(phone→실번호) → PASS 기대 ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = v_p4 WHERE id = v_id_held;
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case4(held staff real-phone expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 5: hold released → 레지스트리 active 空 → phone→DUMMY → PASS(트리거 no-op) 기대 ──
  UPDATE public.data_correction_hold_registry
     SET released_at = now(), released_by = 'dryrun', release_reason = 'case5 release test'
   WHERE target_pk = v_id_held::text AND released_at IS NULL;
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE id = v_id_held;
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case5(released→DUMMY expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 6: phone-normalize HARDEN 경로(비-hold 행 → DUMMY sentinel) → PASS 기대 ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE id = v_id_free;  -- 이미 비-hold
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case6(HARDEN non-hold expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── 강제 unwind(무영속) — 결과를 EXCEPTION 메시지로 반환 ──
  RAISE EXCEPTION 'DRYRUN RESULT: %verdict=%',
    v_result, CASE WHEN v_all_pass THEN 'ALL PASS (6/6 회귀행렬 통과)' ELSE 'FAIL (회귀 검출)' END;
END $dryrun$;
