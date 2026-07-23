-- DRY-RUN (No-Persistence Protocol): ROW1 HOLD-SEED · T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION
--   planner NEW-TASK MSG-20260724-073838-7z2g §2:
--     "seed INSERT 후 post-probe로 registry_rows≥1 재현 + 정상 corrective 경로 회귀 0 확인. 무영속 unwind 실증."
--
-- ── 전제: hold-guard 가 이미 prod LIVE (deployed@07:33, commit 08c8e377/f392e9df) ─────────────
--   본 dry-run 은 가드 객체를 **재생성하지 않는다**(이미 존재 → CREATE 시 충돌). 대신 LIVE 트리거/레지스트리에
--   대해 seed INSERT 메커니즘을 실증한다. supervisor NOTIFY(MSG-20260724-073403-in6a): 가드는 구조만 live·
--   registry_rows=0 → ROW1 fail-closed 보호 미발효. 본 dry-run 은 seed 로 registry_rows≥1 이 되면 보호가
--   실효함을 **무영속(합성 fixture)** 으로 재현한다. 실 ROW1 seed 영속은 supervisor DB-GATE.
--
-- ── PHI 위생 ──
--   실 ROW1 UUID 미사용. clinic 74967aea(ROW1 clinic, git-safe PK8)의 합성 fixture 2행(HELD/FREE)으로
--   메커니즘만 검증. 평문 PHI 미출력.
--
-- ── 무영속 보장(sentinel-bypass 불가) ────────────────────────────────────────
--   전체가 **단일 DO 블록(=단일 statement)**. seed INSERT·fixture·회귀 UPDATE 후 블록 말미 RAISE EXCEPTION
--   으로 강제 unwind → seed row·fixture customers **어떤 것도 영속되지 않음**. BEGIN/COMMIT 없음(txn-control
--   내장 hazard 미해당). 별도 read-only POST-PROBE(러너)로 사후 부재 실증.
--
-- ── 회귀행렬 (기대) ───────────────────────────────────────────────────────────
--   probe) seed INSERT 후 active registry_rows ≥ 1                          → PASS (보호 발효 전제 재현)
--   1) HELD(active hold) 행 phone→DUMMY UPDATE                              → BLOCK (의도된 fail-closed = ROW1 보호)
--   2) FREE(비-hold) 행 phone→DUMMY UPDATE                                  → PASS  (정상 corrective 회귀 0)
--   3) HELD 행 정상 스태프 편집(phone→실번호)                                → PASS  (DUMMY 전이 아님 → 무영향)
--
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('SEED-DRYRUN RESULT: ...')로 반환된다.

DO $dryrun$
DECLARE
  v_clinic    uuid;
  v_id_held   uuid;
  v_id_free   uuid;
  v_reg_active int;
  v_reg_held   int;
  v_result    text := '';
  v_ok        boolean;
  v_all_pass  boolean := true;
  -- 충돌 회피용 랜덤 E164 픽스처(prod idx_customers_clinic_phone 유니크 회피)
  v_p0 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
  v_p1 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
  v_p3 text := '+8210' || lpad((floor(random()*90000000)+9000000)::bigint::text, 8, '0');
BEGIN
  -- ROW1 clinic(74967aea) 우선 선택, 부재 시 임의 clinic 폴백(메커니즘만 검증하므로 무해).
  SELECT id INTO v_clinic FROM public.clinics WHERE left(id::text,8)='74967aea' LIMIT 1;
  IF v_clinic IS NULL THEN SELECT id INTO v_clinic FROM public.clinics LIMIT 1; END IF;

  -- ── 합성 fixture 2행 (ROW1/RAW 대역) ──
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic, 'DRYRUN-ROW1SEED-HELD', v_p0, 'new') RETURNING id INTO v_id_held;
  INSERT INTO public.customers (clinic_id, name, phone, visit_type)
    VALUES (v_clinic, 'DRYRUN-ROW1SEED-FREE', v_p1, 'new') RETURNING id INTO v_id_free;

  -- ── SEED INSERT (ROW1 대역 fixture 를 active hold 로 등록 · seed.sql §B 와 동일 shape) ──
  INSERT INTO public.data_correction_hold_registry
    (clinic_id, target_table, target_pk, guard_scope, hold_ticket, reason, created_by)
  VALUES
    (v_clinic, 'customers', v_id_held::text, 'phone_dummy_normalize',
     'T-20260715-foot-ROW1-DUP-CLEANUP-MUTATION', 'cleanup', current_user)
  ON CONFLICT (clinic_id, target_table, target_pk, guard_scope) WHERE released_at IS NULL
  DO NOTHING;

  -- ── POST-PROBE: registry_rows ≥ 1 재현 (보호 발효 전제) ──
  SELECT count(*) INTO v_reg_active
    FROM public.data_correction_hold_registry WHERE released_at IS NULL;
  SELECT count(*) INTO v_reg_held
    FROM public.data_correction_hold_registry
   WHERE target_pk = v_id_held::text AND guard_scope='phone_dummy_normalize' AND released_at IS NULL;
  v_ok := (v_reg_active >= 1 AND v_reg_held = 1);
  v_result := v_result || format('probe(registry_active=%s, held_hold=%s, expect≥1/=1)=%s ',
                v_reg_active, v_reg_held, CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 1: HELD(active hold) 행 phone→DUMMY → BLOCK 기대 (LIVE 트리거) ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE id = v_id_held;
    v_ok := false;  -- 도달하면 = 차단 실패
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%hold active%' THEN v_ok := true; END IF;
  END;
  v_result := v_result || format('case1(HELD→DUMMY expect BLOCK)=%s ', CASE WHEN v_ok THEN 'BLOCK✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 2: FREE(비-hold) 행 phone→DUMMY → PASS 기대 (정상 corrective 회귀 0) ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = 'DUMMY-'||gen_random_uuid() WHERE id = v_id_free;
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case2(FREE→DUMMY expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── case 3: HELD 행 정상 스태프 편집(phone→실번호) → PASS 기대 (전이 아님) ──
  v_ok := false;
  BEGIN
    UPDATE public.customers SET phone = v_p3 WHERE id = v_id_held;
    v_ok := true;
  EXCEPTION WHEN raise_exception THEN v_ok := false;
  END;
  v_result := v_result || format('case3(HELD staff real-phone expect PASS)=%s ', CASE WHEN v_ok THEN 'PASS✓' ELSE 'FAIL✗' END);
  v_all_pass := v_all_pass AND v_ok;

  -- ── 강제 unwind(무영속) — 결과를 EXCEPTION 메시지로 반환 ──
  RAISE EXCEPTION 'SEED-DRYRUN RESULT: %verdict=%',
    v_result, CASE WHEN v_all_pass THEN 'ALL PASS (registry_rows≥1 재현 + 회귀 0)' ELSE 'FAIL (회귀 검출)' END;
END $dryrun$;
