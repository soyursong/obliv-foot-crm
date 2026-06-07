-- ============================================================================
-- T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE  ·  AC2 병합 제안서 (MERGE PROPOSAL)
-- ----------------------------------------------------------------------------
-- TARGET DB : foot prod  rxlomoozakkjesdqjtvd  ·  table: public.customers (+ 27 ref FK)
-- clinic    : 74967aea (종로 풋)
--
-- *** GATE — DO NOT EXECUTE ***
--   순서(불변): AC1 dry-run(완료, READ-ONLY) → AC2 병합 제안서(본 파일)
--               → AC3 문지은 대표원장 케이스별 GO/보류 확인(responder 경유)
--               → AC4 supervisor 단독 DB 게이트 GO → AC5 실행·검증.
--   대표원장 확인 + supervisor 게이트 GO 전까지 customers/FK UPDATE·DELETE·병합 절대 금지.
--   dev-foot 자동 실행 금지. 본 파일은 설계 산출물(초안)일 뿐 실행 대상 아님.
--   supabase/migrations/ 에 두지 않음(자동 적용 방지). 표준 마이그 게이트로만 적용.
--
-- 근거: scripts/T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE_ac1.mjs (READ-ONLY) →
--       scripts/out/T-20260607-CUSTOMER-MASTER-DUP-TRIAGE_ac1.{md,json}
--       (out/ gitignore → 본 패키지 dry_run_report.md 에 인벤토리 사본 동봉)
--
-- 케이스 요약:
--   ① 김규리  dup_pair  KEEP 7fa5dff1(실 phone,자산19) ← MERGE ← ERR 7cef3be8(test phone,자산4)  [clear GO 후보]
--   ② 김민경  MISLINK   check_in 10f10231(name=김민경,phone test9999)이 test고객 김구번 3da2d8ef 에 오연결
--                       → 신원 혼입. 자동 병합/재연결 금지. SQL 없음(HOLD). 대표원장 신원확인 필수.
--   ③ 김승현  dup_pair  KEEP fcdcd44f(실 phone,자산1) ← MERGE ← ERR 53661ce0(test phone,자산2)  [clear GO 후보]
--
-- 병합 정의(dup_pair): ERR 고객을 참조하는 모든 FK 행을 KEEP 으로 재귀속한 뒤 ERR customers 행 DELETE.
--   · 자식 UNIQUE(customer_id 포함) 제약 = 없음(AC1 확인) → 재귀속 충돌 없음.
--   · customers (clinic_id,phone) UNIQUE / chart_number UNIQUE: ERR 행 DELETE 가정이므로 신규 충돌 없음.
--   · 모든 mutation 은 백업 + 이동대장(ledger) 기록 → rollback.sql 로 완전 역연산 가능.
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 0 — BACKUP (역연산 자료 확보). 어떤 mutation 보다 먼저 실행.
--   (a) DELETE 대상 ERR customers 행 원본 보존(rollback 시 재INSERT).
--   (b) 재귀속(이동) 대상 자식행의 (테이블·행id·원 customer_id) 이동대장 기록.
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._merge_bk_T20260607_cmaster_customers
  (LIKE public.customers INCLUDING ALL);

INSERT INTO public._merge_bk_T20260607_cmaster_customers
SELECT * FROM public.customers
 WHERE id IN (
   '7cef3be8-211f-4685-8c80-5141240328cf',  -- 김규리 ERR
   '53661ce0-5d3a-4da6-8459-121c36860d45'   -- 김승현 ERR
 )
ON CONFLICT (id) DO NOTHING;
-- 기대: 2 rows 백업.

CREATE TABLE IF NOT EXISTS public._merge_bk_T20260607_cmaster_moves (
  ref_table       text        NOT NULL,
  ref_column      text        NOT NULL,
  row_id          uuid        NOT NULL,
  old_customer_id uuid        NOT NULL,   -- = ERR
  new_customer_id uuid        NOT NULL,   -- = KEEP
  moved_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_table, ref_column, row_id)
);

-- ───────────────────────────────────────────────────────────────────────────
-- STEP 1 — 재귀속 + DELETE (dup_pair 2건). 단일 트랜잭션.
--   information_schema 에서 customers.id 를 참조하는 FK 컬럼을 실행시점 기준으로
--   전수 열거 → 드리프트(드라이런 이후 신규행) 까지 빠짐없이 이동.
--   self-ref(unified_customer_id / designated_therapist_id) 는 FK 미설정 가능 → 수동 보강.
-- ───────────────────────────────────────────────────────────────────────────
BEGIN;

DO $$
DECLARE
  -- (KEEP, ERR) 쌍
  v_pairs   text[][] := ARRAY[
    ARRAY['7fa5dff1-85c0-4f60-88a1-103fca36fdd5','7cef3be8-211f-4685-8c80-5141240328cf'],  -- 김규리
    ARRAY['fcdcd44f-51f0-4dd0-87f9-9e6b2fd90f5b','53661ce0-5d3a-4da6-8459-121c36860d45']   -- 김승현
  ];
  v_keep    uuid;
  v_err     uuid;
  i         int;
  c         record;
  v_moved   bigint;
BEGIN
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_keep := v_pairs[i][1]::uuid;
    v_err  := v_pairs[i][2]::uuid;

    -- customers.id 를 참조하는 FK 컬럼 전수 + self-ref 보강
    FOR c IN
      SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'customers' AND ccu.column_name = 'id'
         AND tc.table_schema = 'public'
      UNION
      SELECT * FROM (VALUES
        ('customers','unified_customer_id'),
        ('customers','designated_therapist_id')
      ) AS s(table_name, column_name)
    LOOP
      -- (a) 이동 대상 기록(idempotent)
      EXECUTE format(
        'INSERT INTO public._merge_bk_T20260607_cmaster_moves
           (ref_table, ref_column, row_id, old_customer_id, new_customer_id)
         SELECT %L, %L, id, %L::uuid, %L::uuid FROM public.%I WHERE %I = %L::uuid
         ON CONFLICT (ref_table, ref_column, row_id) DO NOTHING',
        c.table_name, c.column_name, v_err, v_keep, c.table_name, c.column_name, v_err
      );

      -- (b) 재귀속: ERR → KEEP
      EXECUTE format(
        'UPDATE public.%I SET %I = %L::uuid WHERE %I = %L::uuid',
        c.table_name, c.column_name, v_keep, c.column_name, v_err
      );
      GET DIAGNOSTICS v_moved = ROW_COUNT;
      IF v_moved > 0 THEN
        RAISE NOTICE '  [%] %.% : % rows  ERR(%) → KEEP(%)',
          i, c.table_name, c.column_name, v_moved, left(v_err::text,8), left(v_keep::text,8);
      END IF;
    END LOOP;

    -- (c) 잔여 참조 0 확인 후 ERR customers 행 DELETE
    --     (FK 가 모두 KEEP 으로 옮겨졌으므로 안전. 잔여 시 예외로 중단)
    DELETE FROM public.customers WHERE id = v_err;
    RAISE NOTICE '  [%] ERR customers DELETE: %', i, left(v_err::text,8);
  END LOOP;
END $$;

-- ── 트랜잭션 내 검증 (실패 시 ROLLBACK 으로 전환) ──
-- 1) ERR 2행이 customers 에서 사라졌는지
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.customers
   WHERE id IN ('7cef3be8-211f-4685-8c80-5141240328cf','53661ce0-5d3a-4da6-8459-121c36860d45');
  IF n <> 0 THEN RAISE EXCEPTION 'ERR customers 잔존 % 행 — 병합 미완, ROLLBACK 요망', n; END IF;
END $$;

-- 2) 동명 실명(김규리/김승현) customer master 가 각 1행만 남았는지 (병합 성공 지표)
--    아래는 참고 SELECT (검증용). 결과를 supervisor 로그에 첨부.
--   SELECT name, count(*) FROM public.customers
--    WHERE name IN ('김규리','김승현') AND is_simulation IS NOT TRUE
--    GROUP BY name;  -- 기대: 김규리=1, 김승현=1

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- 케이스 ② 김민경 — MISLINK (신원 혼입) · HOLD · 실행 SQL 없음
-- ----------------------------------------------------------------------------
--   check_in 10f10231-8e63-4002-bbfe-e353fd9a6a0e
--     name=김민경 · phone=+821099999999(test 9999) · status=consult_waiting · visit=new
--     현 customer_id = 3da2d8ef(김구번, test 고객)  ← name 불일치 = 신원 혼입
--   진짜 김민경 = 83ab4fe1 · phone=+821043160981(F-0177)
--   ⚠️ check_in phone(9999) ≠ 진짜 김민경 phone(4316-0981) → 동일인 확증 불가.
--
--   ❌ 어떤 옵션도 자동 진행 금지. 대표원장(문지은) 신원 확인 후에만 1개 선택.
--   옵션 A) check_in.customer_id 를 진짜 김민경(83ab4fe1)로 재연결  ← 동일인 확증 시에만
--           -- (확증 전 실행 금지. 참고용 골격, 주석 유지)
--           -- UPDATE public.check_ins SET customer_id='83ab4fe1-0bbc-4dfc-ab3b-f01378144707'
--           --  WHERE id='10f10231-8e63-4002-bbfe-e353fd9a6a0e'
--           --    AND customer_id='3da2d8ef-97bc-4bc7-a55f-cd9bf8bc4251';  -- 1 row
--   옵션 B) 김구번(test)·본 check_in 이 QA 잔재면 → 테스트 정리(별도 datafix)에서 처리.
--   옵션 C) 김민경 신규 의도였다면 → 신규 customers row 생성 후 연결.
-- ───────────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 실행 후 정리(선택): 백업/이동대장 테이블은 소크 안정 확인 후 DROP.
--   DROP TABLE IF EXISTS public._merge_bk_T20260607_cmaster_moves;
--   DROP TABLE IF EXISTS public._merge_bk_T20260607_cmaster_customers;
--   (rollback 가능성 닫히기 전까지는 보존)
-- ============================================================================
