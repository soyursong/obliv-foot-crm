-- DRY-RUN (No-Persistence Protocol) — T-20260726-foot-CRM-ASSIGN-V1 상담 자동배정 ADDITIVE 스키마
--
-- ── 무영속 보장(sentinel-bypass 불가, migration_dryrun_no_persistence_standard §1) ──────────────
--   전체를 단일 DO 블록(= 단일 statement, 단일 서브트랜잭션)으로 실행. 블록 내에서 ADD COLUMN / CREATE TABLE /
--   CHECK 제약을 EXECUTE 로 적용·검증한 뒤 블록 말미 RAISE EXCEPTION 으로 강제 unwind → 생성물 어떤 것도 영속 안 됨.
--   단일 statement 이므로 Management API autocommit-between-statements 불가. up.sql 에 BEGIN/COMMIT/txn 제어문 있으나
--   본 dryrun 은 up.sql 을 전송하지 않고 아래 자립 블록만 실행(txn-strip 무관). RLS 정책 생성은 무영속 재현이
--   불필요하므로 dry-run 범위에서 제외(스키마 DDL 문법·형상만 검증).
--
-- ── 검증(기대) ────────────────────────────────────────────────────────────────
--   (1) staff.auto_assign_enabled bool NOT NULL DEFAULT true                          → PASS
--   (2) staff.slack_user_id text NULLABLE                                             → PASS
--   (3) assignment_ranking_weights: PK=clinic_id, 3 weight NUMERIC DEFAULT 1          → PASS
--   (4) assignment_daily_target_config: CHECK top=bottom*2 (2:1) 존재·강제            → PASS
--   (5) assignment_leadsource_policy: PK(clinic_id,lead_source), CHECK 2종            → PASS
--   (6) assignment_pointer_state: PK(clinic_id,lead_source), cursor_rank DEFAULT 0    → PASS
--
-- ── POST-PROBE (무영속 재확인, 별도 read-only 세션) ───────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='staff' AND column_name IN ('auto_assign_enabled','slack_user_id');  -- 기대 0행
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('assignment_ranking_weights','assignment_daily_target_config',
--                         'assignment_leadsource_policy','assignment_pointer_state');       -- 기대 0행
--   ⚠ 결과는 블록 말미 RAISE EXCEPTION 메시지('DRYRUN RESULT: ...')로 반환. 'ALL PASS' = 6종 통과.

DO $dryrun$
DECLARE
  v_result   text := '';
  v_all_pass boolean := true;
  v_cnt      int;
  v_ratio_rejected boolean := false;
BEGIN
  -- (1)(2) staff 컬럼
  EXECUTE 'ALTER TABLE public.staff ADD COLUMN auto_assign_enabled boolean NOT NULL DEFAULT true';
  EXECUTE 'ALTER TABLE public.staff ADD COLUMN slack_user_id text';
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff'
     AND column_name='auto_assign_enabled' AND is_nullable='NO'
     AND data_type='boolean' AND column_default LIKE '%true%';
  IF v_cnt=1 THEN v_result:=v_result||'(1) staff.auto_assign_enabled bool NOT NULL DEFAULT true: PASS'||E'\n';
  ELSE v_result:=v_result||'(1) staff.auto_assign_enabled: FAIL'||E'\n'; v_all_pass:=false; END IF;
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='staff'
     AND column_name='slack_user_id' AND is_nullable='YES' AND data_type='text';
  IF v_cnt=1 THEN v_result:=v_result||'(2) staff.slack_user_id text NULLABLE: PASS'||E'\n';
  ELSE v_result:=v_result||'(2) staff.slack_user_id: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- (3) assignment_ranking_weights
  EXECUTE 'CREATE TABLE public.assignment_ranking_weights ('
       || ' clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,'
       || ' weight_revenue_month numeric NOT NULL DEFAULT 1 CHECK (weight_revenue_month >= 0),'
       || ' weight_revenue_week numeric NOT NULL DEFAULT 1 CHECK (weight_revenue_week >= 0),'
       || ' weight_avg_ticket numeric NOT NULL DEFAULT 1 CHECK (weight_avg_ticket >= 0),'
       || ' updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid)';
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assignment_ranking_weights'
     AND column_name IN ('weight_revenue_month','weight_revenue_week','weight_avg_ticket')
     AND data_type='numeric' AND column_default='1';
  IF v_cnt=3 THEN v_result:=v_result||'(3) assignment_ranking_weights 3 weight NUMERIC DEFAULT 1: PASS'||E'\n';
  ELSE v_result:=v_result||'(3) assignment_ranking_weights: FAIL (cnt='||v_cnt||')'||E'\n'; v_all_pass:=false; END IF;

  -- (4) assignment_daily_target_config + 2:1 CHECK 강제 검증
  EXECUTE 'CREATE TABLE public.assignment_daily_target_config ('
       || ' clinic_id uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,'
       || ' top_rank_target integer NOT NULL CHECK (top_rank_target > 0),'
       || ' bottom_rank_target integer NOT NULL CHECK (bottom_rank_target > 0),'
       || ' updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,'
       || ' CONSTRAINT assignment_daily_target_ratio_2to1 CHECK (top_rank_target = bottom_rank_target * 2))';
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conname='assignment_daily_target_ratio_2to1' AND contype='c';
  -- 2:1 위반(top=3,bottom=1)은 거부돼야 함 → 무영속 서브트랜잭션에서 시도.
  BEGIN
    EXECUTE 'INSERT INTO public.assignment_daily_target_config(clinic_id,top_rank_target,bottom_rank_target) '
         || 'VALUES (gen_random_uuid(),3,1)';
  EXCEPTION WHEN check_violation THEN v_ratio_rejected := true;
  END;
  IF v_cnt=1 AND v_ratio_rejected THEN
    v_result:=v_result||'(4) daily_target CHECK 2:1 (top=bottom*2) 강제: PASS'||E'\n';
  ELSE v_result:=v_result||'(4) daily_target 2:1 CHECK: FAIL (constraint='||v_cnt||' rejected='||v_ratio_rejected||')'||E'\n'; v_all_pass:=false; END IF;

  -- (5) assignment_leadsource_policy
  EXECUTE 'CREATE TABLE public.assignment_leadsource_policy ('
       || ' clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,'
       || ' lead_source text NOT NULL CHECK (lead_source IN (''TM'',''INBOUND'',''WALK_IN'')),'
       || ' strategy text NOT NULL CHECK (strategy IN (''daily_target'',''ranking_pointer'')),'
       || ' updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,'
       || ' PRIMARY KEY (clinic_id, lead_source))';
  SELECT count(*) INTO v_cnt FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
   WHERE t.relname='assignment_leadsource_policy' AND c.contype='c';
  IF v_cnt=2 THEN v_result:=v_result||'(5) leadsource_policy PK + 2 CHECK: PASS'||E'\n';
  ELSE v_result:=v_result||'(5) leadsource_policy CHECK: FAIL (cnt='||v_cnt||')'||E'\n'; v_all_pass:=false; END IF;

  -- (6) assignment_pointer_state
  EXECUTE 'CREATE TABLE public.assignment_pointer_state ('
       || ' clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,'
       || ' lead_source text NOT NULL CHECK (lead_source IN (''TM'',''INBOUND'',''WALK_IN'')),'
       || ' cursor_rank integer NOT NULL DEFAULT 0 CHECK (cursor_rank >= 0),'
       || ' reset_date date, updated_at timestamptz NOT NULL DEFAULT now(),'
       || ' PRIMARY KEY (clinic_id, lead_source))';
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='assignment_pointer_state'
     AND column_name='cursor_rank' AND column_default='0';
  IF v_cnt=1 THEN v_result:=v_result||'(6) pointer_state cursor_rank DEFAULT 0: PASS'||E'\n';
  ELSE v_result:=v_result||'(6) pointer_state: FAIL'||E'\n'; v_all_pass:=false; END IF;

  -- 강제 unwind (무영속)
  RAISE EXCEPTION 'DRYRUN RESULT: %  %',
    CASE WHEN v_all_pass THEN 'ALL PASS' ELSE 'HAS FAIL' END, E'\n' || v_result;
END;
$dryrun$;
