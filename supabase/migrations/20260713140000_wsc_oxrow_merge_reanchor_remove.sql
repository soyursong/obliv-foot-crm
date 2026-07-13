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
-- author: dev-foot / 2026-07-13 · DA: DA-20260713-foot-SELFCHECKIN-WRITE-HARDEN Q2

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
BEGIN
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

  -- ── Step B: 빈 dup master 제거 (자식 0 확증됨) ──
  DELETE FROM public.customers WHERE id = ANY(v_dup);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> 2 THEN
    RAISE EXCEPTION 'WSC_ABORT: dup 삭제 % 건 (기대 2) — 롤백', v_deleted;
  END IF;

  RAISE NOTICE 'WS-C merge/re-anchor 완료: dup 자식 전 FK 재앵커 → dup master % 건 삭제', v_deleted;
END $$;

COMMIT;
