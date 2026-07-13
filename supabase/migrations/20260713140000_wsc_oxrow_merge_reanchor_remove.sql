-- T-20260713-foot-UNAUTH-CHANGE-INVESTIGATE-ROLLBACK (WS-C): 마스킹 오염 중복 customers merge/re-anchor + remove
--
-- 배경 (DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2 / dev-foot WS-C freeze 실측):
--   키오스크 WRITE-path 오염(WS-A 前)으로 마스킹 표시값이 신규 customers 로 INSERT 되어
--   raw 마스터의 '마스킹 중복행(dup master)'이 2건 생성됨(실환자0·전부 test/DUMMY):
--     · dup 512998d0(성명 마스킹/전화 tail …5453)  ← raw 8fa12f4c(성명 raw/전화 tail …5453, 39초前)
--     · dup 0356b229(성명 raw/전화 tail …9089)      ← raw c51dd5e0(성명 raw/전화 tail …9089)
--   (성명/전화 평문은 off-git — redacted 스냅샷 _artifacts/…_judgment_snapshot.redacted.json 참조)
--   각 dup 에 자식이 매달림(freeze 실측 — DA Q2 자식모델 check_ins/status_transitions 를 초과):
--     check_ins·health_q_tokens·health_q_results·customer_consult_memos·package_payments·packages (총 8행).
--   CASCADE(health_q*,consult_memos) + NO ACTION(check_ins,packages,package_payments) 혼재 →
--   자식 re-anchor 없이 dup 를 지우면 (a) NO ACTION 차단 또는 (b) CASCADE 순소실 → full merge 가 유일한 순소실0 경로.
--
-- 이 마이그(DML only · DDL 0):
--   Step A (re-anchor) — customers.id 를 참조하는 '모든' FK 컬럼을 dup→raw 로 재앵커(결정적 FK 재부모).
--                        status_transitions 는 check_in_id 로 동반(재앵커 불요). backfill-SOP §0-1 class A.
--   Step B (remove)    — 재앵커 후 dup 잔존 자식(전 FK) 0 을 assert(guard) → dup master DELETE. orphan-SOP §1 순소실0.
--   ⚠ archive(순소실0) 는 apply 러너가 실행 前 off-git _backup 네임스페이스로 선적재(DA §4 "archive tracked CREATE 금지").
--      본 마이그는 archive CREATE 를 포함하지 않는다(DML only). 롤백=.rollback.sql(_backup 에서 복원).
--   freeze셋 재검증 abort: 재앵커 후 dup 자식이 0 이 아니면 RAISE → 트랜잭션 전체 롤백(파괴 미실행).
--   원장: DDL0(UPDATE/DELETE) 이나 감사추적 위해 apply 러너가 net-new version 20260713140000 로 정직등재.
--   abort 불변식: 147(fn_selfcheckin_today_reservations) 무접촉 · 키오스크 anon raw-PHI-0(§15-5-1) 무관(customers/자식만).
--
-- ── DA CONSULT-REPLY(2lha, 2026-07-13) child-model divergence RESOLVED — G1~G3 guardrail 반영 ──
--   전 6 FK full re-anchor = faithful execution(scope 확장 아님·설계변경 아님). 명시 2종(check_ins/status_transitions)은
--   당시 가시분 illustrative 였고 net-loss-0 은 grain-agnostic → financial/clinical 자식 재앵커도 이미 순소실0 에 포함.
--   G1 (financial 원장 무접점): package_payments 재앵커 = customer_id FK-only UPDATE·금액/결제 컬럼 무접촉.
--       → re-anchor 전후 SUM(amount)/SUM(vat_amount) 불변 assert 동봉(변동 시 WSC_ABORT_G1·전체 롤백).
--   G2 (clinical PHI): health_q*/consult_memos 재앵커 = FK-only(customer_id) UPDATE 1컬럼만·내용/동의링크 무변경.
--       평문 PHI 는 off-git(redacted 스냅샷만 커밋). ↓ 재앵커 루프가 FK 컬럼 1개만 SET(내용/동의 컬럼 미접촉).
--   G3 (최중요·CASCADE 순서 불변식): CASCADE(health_q*,consult_memos)+NO ACTION(check_ins,packages,package_payments)
--       혼재 → 삭제 순서 뒤집으면 CASCADE 자식이 archive 前 소실. 순서 고정 =
--       (1) 전 6 FK 자식 raw master 로 re-anchor UPDATE 완료 → (2) dup master 가 6 FK '전반' 자식 0건 재검증
--       (잔존 시 abort) → (3) archive-first remove(master empty → CASCADE 무해화). ↓ 본 DO 블록이 이 순서를 강제.
--   판정근거 스냅샷 자식건수 = 기계열거된 전 6 FK 카운트(information_schema 동적 열거·2종 부분집합 금지).
-- author: dev-foot / 2026-07-13 · DA: DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2 + CONSULT-REPLY 2lha

BEGIN;

DO $$
DECLARE
  r RECORD;
  v_dup        uuid[]  := ARRAY['512998d0-d51a-42c4-947e-b0cb2cc69da4',
                                '0356b229-e8c7-4655-aa6e-651b15370c1f']::uuid[];
  -- dup → raw 결정적 매핑 (per-row confirm ACCEPT · 실환자0)
  v_map        jsonb   := jsonb_build_object(
                            '512998d0-d51a-42c4-947e-b0cb2cc69da4','8fa12f4c-abfe-405e-8736-c2ca8e4aef8a',
                            '0356b229-e8c7-4655-aa6e-651b15370c1f','c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b');
  v_remaining  bigint  := 0;
  v_cnt        bigint;
  v_deleted    bigint;
  -- G1 (financial 원장 무접점): package_payments 금액 총합 재앵커 전후 불변 assert
  v_raw        uuid[]  := ARRAY['8fa12f4c-abfe-405e-8736-c2ca8e4aef8a',
                                'c51dd5e0-5e3f-4f5c-a44f-78001ab9cf6b']::uuid[];
  v_pp_amt_before  bigint;
  v_pp_vat_before  bigint;
  v_pp_cnt_before  bigint;
  v_pp_amt_after   bigint;
  v_pp_vat_after   bigint;
  v_pp_cnt_after   bigint;
BEGIN
  -- ── G1 baseline: dup∪raw 소속 package_payments 금액 총합/행수 스냅샷(재앵커 前) ──
  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(vat_amount),0), COUNT(*)
    INTO v_pp_amt_before, v_pp_vat_before, v_pp_cnt_before
    FROM public.package_payments
   WHERE customer_id = ANY(v_dup) OR customer_id = ANY(v_raw);

  -- ── Step A: customers.id 참조 전 FK 컬럼 dup→raw 재앵커 ──
  FOR r IN
    SELECT tc.table_name AS t, kcu.column_name AS c
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'customers' AND ccu.column_name = 'id'
  LOOP
    -- 각 dup 를 대응 raw 로: SET col = (map->>col) WHERE col = ANY(dup)
    EXECUTE format(
      'UPDATE public.%I SET %I = (($1)->>(%I::text))::uuid WHERE %I = ANY($2)',
      r.t, r.c, r.c, r.c
    ) USING v_map, v_dup;
  END LOOP;

  -- ── freeze/순소실0 guard: 재앵커 후 dup 를 참조하는 자식(전 FK) 잔존 = 0 이어야 ──
  FOR r IN
    SELECT tc.table_name AS t, kcu.column_name AS c
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name = 'customers' AND ccu.column_name = 'id'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY($1)', r.t, r.c)
      USING v_dup INTO v_cnt;
    v_remaining := v_remaining + v_cnt;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'WSC_ABORT: dup 재앵커 후 자식 % 건 잔존(전 FK) — 파괴 미실행, 전체 롤백', v_remaining;
  END IF;

  -- ── G1 assert(financial 원장 무접점): 재앵커는 customer_id FK-only UPDATE 이므로 ──
  --    dup∪raw 소속 package_payments 의 금액 총합·행수는 불변이어야 한다(금액/결제 컬럼 미접촉 확증). ──
  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(vat_amount),0), COUNT(*)
    INTO v_pp_amt_after, v_pp_vat_after, v_pp_cnt_after
    FROM public.package_payments
   WHERE customer_id = ANY(v_dup) OR customer_id = ANY(v_raw);

  IF v_pp_amt_before <> v_pp_amt_after
     OR v_pp_vat_before <> v_pp_vat_after
     OR v_pp_cnt_before <> v_pp_cnt_after THEN
    RAISE EXCEPTION 'WSC_ABORT_G1: package_payments 금액/행수 변동 감지 (amount % → %, vat % → %, cnt % → %) — 원장 접촉 의심, 전체 롤백',
      v_pp_amt_before, v_pp_amt_after, v_pp_vat_before, v_pp_vat_after, v_pp_cnt_before, v_pp_cnt_after;
  END IF;
  RAISE NOTICE 'G1 OK: package_payments SUM(amount)=% SUM(vat)=% cnt=% 불변(재앵커 전후 동일)', v_pp_amt_after, v_pp_vat_after, v_pp_cnt_after;

  -- ── Step B: 빈 dup master 제거 (자식 0 확증됨) ──
  DELETE FROM public.customers WHERE id = ANY(v_dup);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'WSC_ABORT: dup 삭제 % 건 (기대 2) — 롤백', v_deleted;
  END IF;

  RAISE NOTICE 'WS-C merge/re-anchor 완료: dup 자식 전 FK 재앵커 → dup master % 건 삭제', v_deleted;
END $$;

COMMIT;
