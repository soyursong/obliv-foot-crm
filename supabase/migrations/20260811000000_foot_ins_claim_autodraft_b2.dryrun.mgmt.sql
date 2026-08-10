-- T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2) — DRY-RUN (Management-API 실행용, No-Persistence)
-- 목적: supervisor 가 foot pooler DB 비번 없이 foot-supabase-pat (Management API /database/query) 로
--   단일 query 내 BEGIN;…;ROLLBACK; 무영속 dryrun 을 돌려 C23 grant-seal 을 실측한다.
--   (dryrun.mjs 는 pooler+SUPABASE_DB_PASSWORD 요구 → 비번 provision 시 그쪽 사용. 본 파일은 mgmt 경로 대체.)
--
-- 검증(단일 트랜잭션):
--   1) 마이그 verbatim 적용 (아래 BEGIN 블록 내부)
--   2) 신규 SECDEF 함수 3종에 anon/authenticated EXECUTE 잔차 = 0 (C23) + rollup.service_role=true 확인
--   3) 의도적 sentinel RAISE EXCEPTION → 트랜잭션 ABORT → 영속 0 (No-Persistence)
-- 결과: 에러 메시지 본문 "DRYRUN_C23_REPORT C23 PASS ..." 가 판정. (에러 = No-Persistence sentinel, 정상)
-- 사후: POST-PROBE 쿼리를 별도 호출로 실행 → pg_proc 존재수 0 이어야 무영속 정상.
--
-- 실행(개념): POST {mgmt}/v1/projects/rxlomoozakkjesdqjtvd/database/query  body={"query": <본 파일 전체>}
-- ============================================================
BEGIN;
-- T-20260810-foot-INS-CLAIM-AUTODRAFT (B-2) — up (청구 명세 자동 생성)
--
-- 근본원인: insurance_claims=0건. claim draft 가 InsuranceCopaymentPanel(수동 저장)에서만 생성되는데,
--   현장은 수납확정 자동경로(→ service_charges)만 탄다 → 급여를 계산·적재하면서도 청구 명세가 0건.
--   service_charges 를 쓰는 경로는 다수(PaymentMiniWindow · DocumentPrintPanel · footBilling ·
--   autoBindContext · record_insurance_consult_payment RPC · InsuranceCopaymentPanel)라 개별 배선은
--   반드시 누락된다(0건이 그 증거). → service_charges 를 단일 트리거로 잡아 claim draft 를 파생한다.
--
-- 설계:
--   1) fn_build_insurance_claim_draft(check_in_id) — 멱등 빌더.
--      ★ 멱등키 = check_in_id + claim_status='draft' (기존 수동패널 패턴 재사용 · 신규 grain 발명 없음).
--      ★ 금액 = service_charges VERBATIM 재사용, 재산출 절대 없음 (revenue_insurance_split_spec §2-2 SSOT).
--        base/copayment/covered 를 service_charges 컬럼에서 그대로 합산·복사. calc_copayment 재호출 없음.
--      ★ append-only 재저장으로 인한 중복 service_charges 는 (service_id) 별 latest(calculated_at) 로 dedup.
--   2) trg_service_charges_autodraft — service_charges AFTER INSERT(급여행만) → 빌더 호출.
--      = 수납확정/모든 service_charges 쓰기 경로에서 claim draft "동시 생성". 단일 생성자 = 수동/자동 이중생성 방지.
--   3) fn_rollup_insurance_claim_drafts(clinic, from, to) — 기적재분(트리거 이전 service_charges) 백필 배치.
--      마일스톤(8월 진료분 → 9월 초 청구 사이클)용. 멱등 → 반복 실행 안전.
--
-- hira_code NULL(B-1 미시드분) 처리: claim_item 을 DROP 하지 않는다 — hira_code=NULL 인 채로 남긴다(missing_code 표식).
--   silent drop 금지: 항목은 명세에 존재하되 제출 게이트에서 차단된다. B-1 시드 후 재빌드 시 코드가 채워진다.
-- draft = 전송 아님: edi_submissions 는 본 마이그 범위 밖. claim_status 는 'draft' 에서만 자동 생성/갱신된다
--   (submitted/accepted 등 이후 상태는 자동경로가 절대 덮지 않음).
--
-- change_class = ADDITIVE (function 3 + trigger 1 신설 · 기존 컬럼/테이블/enum 0 · 기존행 mutation 0 ·
--   backfill 은 별도 RPC 로 GO-token 후 명시 실행). 신규 컬럼/테이블/enum 0 → §S2.4 DA CONSULT(스키마 게이트) 대상 아님.
--   적용 게이트 = supervisor DB-GATE GO-token (apply_before_go — GO-token 前 prod 선집행 금지).
-- Rollback: 20260811000000_foot_ins_claim_autodraft_b2.rollback.sql
-- Dry-run:  20260811000000_foot_ins_claim_autodraft_b2.dryrun.mjs (No-Persistence Protocol)
-- Created: 2026-08-10 (dev-foot)

-- ============================================================
-- 1) fn_build_insurance_claim_draft — 단일 check_in 의 draft claim 을 service_charges 에서 파생(멱등)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_build_insurance_claim_draft(p_check_in_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clinic_id     uuid;
  v_customer_id   uuid;
  v_visit_date    date;
  v_claim_id      uuid;
  v_covered_count int;
  v_total_base    int;
  v_total_copay   int;
  v_total_covered int;
BEGIN
  IF p_check_in_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 동시성: 같은 check_in 재빌드 직렬화 (txn-scoped advisory lock)
  PERFORM pg_advisory_xact_lock(hashtextextended('ins_claim_draft:' || p_check_in_id::text, 0));

  -- 이 방문의 급여 service_charges 를 (service_id) 별 latest 1행으로 집계 (VERBATIM, 재산출 없음)
  SELECT count(*),
         COALESCE(SUM(d.base_amount), 0),
         COALESCE(SUM(d.copayment_amount), 0),
         COALESCE(SUM(d.insurance_covered_amount), 0)
    INTO v_covered_count, v_total_base, v_total_copay, v_total_covered
  FROM (
    SELECT DISTINCT ON (sc.service_id)
           sc.service_id, sc.base_amount, sc.copayment_amount, sc.insurance_covered_amount
    FROM public.service_charges sc
    WHERE sc.check_in_id = p_check_in_id
      AND sc.is_insurance_covered = TRUE
    ORDER BY sc.service_id, sc.calculated_at DESC NULLS LAST
  ) d;

  -- 급여 charge 가 없으면 빈 청구를 만들지 않는다 (기존 draft 도 손대지 않음)
  IF v_covered_count = 0 THEN
    RETURN NULL;
  END IF;

  -- clinic/customer/visit_date 는 check_in 앵커 (charge 폴백)
  SELECT ci.clinic_id, ci.customer_id, COALESCE(ci.checked_in_at::date, CURRENT_DATE)
    INTO v_clinic_id, v_customer_id, v_visit_date
  FROM public.check_ins ci
  WHERE ci.id = p_check_in_id;

  IF v_clinic_id IS NULL OR v_customer_id IS NULL THEN
    SELECT sc.clinic_id, sc.customer_id
      INTO v_clinic_id, v_customer_id
    FROM public.service_charges sc
    WHERE sc.check_in_id = p_check_in_id AND sc.is_insurance_covered = TRUE
    LIMIT 1;
    v_visit_date := COALESCE(v_visit_date, CURRENT_DATE);
  END IF;

  -- ── 멱등 upsert: check_in_id 기준 draft 1건 (신규 grain 없음) ──
  SELECT id INTO v_claim_id
  FROM public.insurance_claims
  WHERE check_in_id = p_check_in_id AND claim_status = 'draft'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_claim_id IS NULL THEN
    INSERT INTO public.insurance_claims
      (clinic_id, customer_id, check_in_id, visit_date, claim_status,
       total_base, total_copayment, total_covered, calculation_engine_version)
    VALUES
      (v_clinic_id, v_customer_id, p_check_in_id, v_visit_date, 'draft',
       v_total_base, v_total_copay, v_total_covered, 'autodraft_from_charges_v1')
    RETURNING id INTO v_claim_id;
  ELSE
    UPDATE public.insurance_claims
    SET total_base                 = v_total_base,
        total_copayment            = v_total_copay,
        total_covered              = v_total_covered,
        visit_date                 = v_visit_date,
        calculation_engine_version = 'autodraft_from_charges_v1'
    WHERE id = v_claim_id;
  END IF;

  -- claim_items 재구성 (draft 이므로 안전하게 전량 교체)
  DELETE FROM public.claim_items WHERE claim_id = v_claim_id;

  INSERT INTO public.claim_items
    (claim_id, service_id, hira_code, hira_score, quantity,
     base_amount, copayment_amount, covered_amount)
  SELECT v_claim_id, d.service_id, s.hira_code, d.hira_score, 1,
         d.base_amount, d.copayment_amount, d.insurance_covered_amount
  FROM (
    SELECT DISTINCT ON (sc.service_id)
           sc.service_id, sc.base_amount, sc.copayment_amount,
           sc.insurance_covered_amount, sc.hira_score
    FROM public.service_charges sc
    WHERE sc.check_in_id = p_check_in_id
      AND sc.is_insurance_covered = TRUE
    ORDER BY sc.service_id, sc.calculated_at DESC NULLS LAST
  ) d
  LEFT JOIN public.services s ON s.id = d.service_id;
  -- ★ s.hira_code 가 NULL 이어도 항목을 남긴다(missing_code 표식) — silent drop 금지.

  RETURN v_claim_id;
END;
$$;

COMMENT ON FUNCTION public.fn_build_insurance_claim_draft(uuid) IS
  '급여 service_charges 에서 check_in 1건의 draft claim 을 멱등 파생(금액 verbatim, 재산출 없음). '
  'hira_code NULL 항목 보존(missing_code). (T-20260810-foot-INS-CLAIM-AUTODRAFT B-2)';

-- ============================================================
-- 2) trg_service_charges_autodraft — service_charges 급여행 INSERT → claim draft 동시 생성
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_service_charges_autodraft()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_insurance_covered = TRUE AND NEW.check_in_id IS NOT NULL THEN
    PERFORM public.fn_build_insurance_claim_draft(NEW.check_in_id);
  END IF;
  RETURN NULL;  -- AFTER 트리거 반환값 무시
END;
$$;

DROP TRIGGER IF EXISTS trg_service_charges_autodraft ON public.service_charges;
CREATE TRIGGER trg_service_charges_autodraft
  AFTER INSERT ON public.service_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_service_charges_autodraft();

-- ============================================================
-- 3) fn_rollup_insurance_claim_drafts — 기적재 service_charges 백필 배치(멱등)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_rollup_insurance_claim_drafts(
  p_clinic_id uuid  DEFAULT NULL,
  p_from      date  DEFAULT NULL,
  p_to        date  DEFAULT NULL
)
RETURNS TABLE(check_ins_processed int, claims_built int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r        record;
  v_cid    uuid;
  v_proc   int := 0;
  v_built  int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT sc.check_in_id AS cid
    FROM public.service_charges sc
    JOIN public.check_ins ci ON ci.id = sc.check_in_id
    WHERE sc.is_insurance_covered = TRUE
      AND sc.check_in_id IS NOT NULL
      AND (p_clinic_id IS NULL OR sc.clinic_id = p_clinic_id)
      AND (p_from IS NULL OR ci.checked_in_at::date >= p_from)
      AND (p_to   IS NULL OR ci.checked_in_at::date <= p_to)
  LOOP
    v_proc := v_proc + 1;
    v_cid := public.fn_build_insurance_claim_draft(r.cid);
    IF v_cid IS NOT NULL THEN
      v_built := v_built + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_proc, v_built;
END;
$$;

COMMENT ON FUNCTION public.fn_rollup_insurance_claim_drafts(uuid, date, date) IS
  '기적재 급여 service_charges 를 순회하며 draft claim 을 멱등 백필(트리거 이전 데이터용). '
  '(T-20260810-foot-INS-CLAIM-AUTODRAFT B-2)';

-- ── 권한: PUBLIC 회수, 백필 RPC 는 service_role(ops/GO-token) 에만 ──
--   빌더 fn 은 트리거(definer)에서만 내부호출 → 직접 EXECUTE 권한 불필요.
--
-- ★ C23 grant-seal (intended-caller-tier = backend/service_role-only):
--   prod pg_default_acl(public·functions·grantor=postgres) 에 {authenticated=X, service_role=X} 가 있어
--   current_user=postgres 로 CREATE 된 신규 함수가 authenticated EXECUTE 를 "자동 상속"한다.
--   REVOKE ... FROM PUBLIC 는 named-role(authenticated) 부여를 제거하지 못하므로,
--   SECURITY DEFINER 3함수 전부에 대해 per-fn targeted REVOKE 로 anon·authenticated 잔차를 봉인한다.
--   (blanket ALTER DEFAULT PRIVILEGES 는 사용하지 않는다 — C23 point4.)
REVOKE ALL ON FUNCTION public.fn_build_insurance_claim_draft(uuid)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rollup_insurance_claim_drafts(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_service_charges_autodraft()                    FROM PUBLIC, anon, authenticated;  -- 트리거 fn, non-callable 이나 명시 seal(hygiene)
GRANT EXECUTE ON FUNCTION public.fn_rollup_insurance_claim_drafts(uuid, date, date) TO service_role;

-- ── C23 grant-seal 실측 (마이그 적용 직후, 같은 txn) ──
DO $DR$
DECLARE
  v_anon_build bool := has_function_privilege('anon',          'public.fn_build_insurance_claim_draft(uuid)','EXECUTE');
  v_auth_build bool := has_function_privilege('authenticated', 'public.fn_build_insurance_claim_draft(uuid)','EXECUTE');
  v_anon_roll  bool := has_function_privilege('anon',          'public.fn_rollup_insurance_claim_drafts(uuid, date, date)','EXECUTE');
  v_auth_roll  bool := has_function_privilege('authenticated', 'public.fn_rollup_insurance_claim_drafts(uuid, date, date)','EXECUTE');
  v_anon_trg   bool := has_function_privilege('anon',          'public.trg_service_charges_autodraft()','EXECUTE');
  v_auth_trg   bool := has_function_privilege('authenticated', 'public.trg_service_charges_autodraft()','EXECUTE');
  v_svc_roll   bool := has_function_privilege('service_role',  'public.fn_rollup_insurance_claim_drafts(uuid, date, date)','EXECUTE');
  v_residual   int;
  v_verdict    text;
BEGIN
  v_residual := v_anon_build::int + v_auth_build::int + v_anon_roll::int + v_auth_roll::int + v_anon_trg::int + v_auth_trg::int;
  IF v_residual = 0 AND v_svc_roll THEN v_verdict := 'C23 PASS'; ELSE v_verdict := 'C23 FAIL'; END IF;
  RAISE EXCEPTION 'DRYRUN_C23_REPORT % | residual(anon+auth EXEC)=% | build[anon=% auth=%] rollup[anon=% auth=%] trg[anon=% auth=%] | rollup.service_role=% | (No-Persistence sentinel - txn ABORT expected)',
    v_verdict, v_residual, v_anon_build, v_auth_build, v_anon_roll, v_auth_roll, v_anon_trg, v_auth_trg, v_svc_roll;
END
$DR$;

ROLLBACK;  -- sentinel 예외로 이미 abort — 방어적 명시(비-예외 경로 없음)

-- ============================================================
-- POST-PROBE (별도 mgmt 호출) — 무영속 확인. 아래를 단독 query 로 실행:
--   SELECT count(*) AS should_be_zero FROM pg_proc
--   WHERE proname IN ('fn_build_insurance_claim_draft','fn_rollup_insurance_claim_drafts','trg_service_charges_autodraft');
-- 기대값 0 (prod 미존재 + dryrun rollback). 0 아니면 leak = No-Persistence 위반.
