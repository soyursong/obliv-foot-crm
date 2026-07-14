-- DRY-RUN: T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT (v_redpay_reconciliation_body + body_recon_ro)
-- 목적(격리 실측 = supervisor deploy-precheck 4점 예행):
--   (A) 뷰 생성 무오류 + WHERE center='body' 리터럴 실존
--   (B) center 컬럼이 뷰 표면에 미노출(구조적)
--   (C) center='body' 행 노출 / center='foot' 행 구조적 미도달(하드필터 실측)
--   (D) body_recon_ro grant: 뷰 SELECT=true / base 테이블·foot뷰 SELECT=false (grant 0 실측)
-- Migration Dry-Run No-Persistence Protocol 준수:
--   · up.sql 에 txn-control 문(COMMIT/SAVEPOINT release) 없음 → BEGIN..ROLLBACK 무영속.
--   · center 컬럼이 prod 미배포(POLLER 선결)여도 dry-run 자체완결: center 컬럼을 txn 내에서 임시
--     provision(ADD IF NOT EXISTS) 후 뷰 생성·검증, ROLLBACK 으로 전량 소멸.
--   · 보안 assertion 은 DO 블록에서 실패 시 RAISE EXCEPTION → 배치 abort(runner 가 FAIL 감지).
--   · runner(.mjs)가 독립 콜로 pre/post 실재를 재확인 = sentinel-bypass 차단(뷰/role 미영속 MUST).
-- 실 데이터 무변경. supervisor DB-GATE 증거용. 프로드 rxlomoozakkjesdqjtvd.
-- 실행: node scripts/T-20260714-foot-REDPAY-BODY-RECON-VIEW-GRANT_dryrun.mjs

BEGIN;

-- ── 0. center 컬럼 txn-내 임시 provision (POLLER 선결 대체 — ROLLBACK 으로 소멸) ──
ALTER TABLE public.payment_reconciliation_log
  ADD COLUMN IF NOT EXISTS center text NOT NULL DEFAULT 'foot';
ALTER TABLE public.payment_reconciliation_log
  DROP CONSTRAINT IF EXISTS payment_reconciliation_log_center_check;
ALTER TABLE public.payment_reconciliation_log
  ADD CONSTRAINT payment_reconciliation_log_center_check CHECK (center IN ('foot','body'));

-- ── 1. seed: foot 1 + body 1 (격리 실측용. clinic_id FK = 기존 clinic 사용) ──
INSERT INTO public.payment_reconciliation_log (clinic_id, event_type, external_trxid, external_amount, center)
SELECT c.id, 'auto_matched', 'DRYRUN-FOOT-TRX', 11111, 'foot' FROM public.clinics c ORDER BY c.created_at LIMIT 1;
INSERT INTO public.payment_reconciliation_log (clinic_id, event_type, external_trxid, external_amount, center)
SELECT c.id, 'auto_matched', 'DRYRUN-BODY-TRX', 22222, 'body' FROM public.clinics c ORDER BY c.created_at LIMIT 1;

-- ── 2. up.sql §1~3 발췌 (role + 뷰 + grant) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'body_recon_ro') THEN
    CREATE ROLE body_recon_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END$$;
ALTER ROLE body_recon_ro SET default_transaction_read_only = on;

CREATE OR REPLACE VIEW public.v_redpay_reconciliation_body
WITH (security_barrier = true) AS
SELECT
  l.id AS row_id, l.clinic_id AS clinic_id,
  (COALESCE(r.approved_at, l.created_at) AT TIME ZONE 'Asia/Seoul')::date AS close_date,
  r.approved_at AS approved_at, r.cancelled_at AS cancelled_at,
  l.external_trxid AS external_trxid,
  COALESCE(r.external_status, l.raw_payload->>'external_status') AS external_status,
  r.tid AS tid,
  COALESCE(r.raw_payload->'merchant'->>'id',   l.raw_payload->'merchant'->>'id')   AS merchant_id,
  COALESCE(r.raw_payload->'merchant'->>'name', l.raw_payload->'merchant'->>'name') AS merchant_name,
  l.external_amount::numeric AS van_amount, l.crm_amount::numeric AS crm_amount, p.method AS crm_method,
  l.event_type AS recon_status, l.match_rule AS match_rule, l.mismatch_reason AS mismatch_reason,
  l.created_at AS logged_at
FROM public.payment_reconciliation_log l
LEFT JOIN public.redpay_raw_transactions r ON r.id = l.raw_transaction_id
LEFT JOIN public.payments p ON p.id = l.payment_id
WHERE l.center = 'body';

REVOKE ALL ON public.v_redpay_reconciliation_body FROM PUBLIC;
REVOKE ALL ON public.v_redpay_reconciliation_body FROM anon;
REVOKE ALL ON public.v_redpay_reconciliation_body FROM authenticated;
GRANT USAGE  ON SCHEMA public TO body_recon_ro;
GRANT SELECT ON public.v_redpay_reconciliation_body TO body_recon_ro;

-- ── 3. 보안 assertion (실패 시 RAISE EXCEPTION → batch abort = FAIL) ──
DO $$
DECLARE
  v_def        text;
  v_center_col int;
  v_foot_cnt   int;
  v_body_cnt   int;
  v_view_sel   boolean;
  v_base_sel   boolean;
  v_footview_sel boolean;
BEGIN
  -- (A) 뷰 정의에 center='body' 리터럴 실존
  v_def := pg_get_viewdef('public.v_redpay_reconciliation_body'::regclass);
  IF position('center = ''body''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(A): WHERE center=''body'' 리터럴 미검출 → %', v_def;
  END IF;
  RAISE NOTICE 'A PASS: center=''body'' 하드필터 리터럴 실존';

  -- (B) center 컬럼이 뷰 출력에 미노출
  SELECT count(*) INTO v_center_col FROM information_schema.columns
   WHERE table_schema='public' AND table_name='v_redpay_reconciliation_body' AND column_name='center';
  IF v_center_col <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(B): center 컬럼이 뷰 표면에 노출됨(=%)', v_center_col;
  END IF;
  RAISE NOTICE 'B PASS: center 컬럼 뷰 미노출';

  -- (C) center='body' 노출 / center='foot' 구조적 미도달
  SELECT count(*) INTO v_foot_cnt FROM public.v_redpay_reconciliation_body WHERE external_trxid='DRYRUN-FOOT-TRX';
  SELECT count(*) INTO v_body_cnt FROM public.v_redpay_reconciliation_body WHERE external_trxid='DRYRUN-BODY-TRX';
  IF v_foot_cnt <> 0 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(C): center=foot 행이 뷰로 누출됨(cnt=%) — 하드필터 실패', v_foot_cnt;
  END IF;
  IF v_body_cnt <> 1 THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(C): center=body 행 미노출(cnt=%) — 기대 1', v_body_cnt;
  END IF;
  RAISE NOTICE 'C PASS: body 노출(1) / foot 미도달(0)';

  -- (D) role grant 격리
  v_view_sel     := has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_body','SELECT');
  v_base_sel     := has_table_privilege('body_recon_ro','public.payment_reconciliation_log','SELECT');
  v_footview_sel := has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_daily','SELECT');
  IF NOT v_view_sel THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(D): body_recon_ro 가 body 뷰 SELECT 불가';
  END IF;
  IF v_base_sel THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(D): body_recon_ro 가 base 테이블 SELECT 가능(grant≠0)';
  END IF;
  IF v_footview_sel THEN
    RAISE EXCEPTION 'DRYRUN-FAIL(D): body_recon_ro 가 foot 뷰 SELECT 가능(grant≠0)';
  END IF;
  RAISE NOTICE 'D PASS: role grant 격리(body뷰 O / base·foot뷰 X)';

  RAISE NOTICE 'ALL ASSERT PASS — ROLLBACK 진행(무영속)';
END$$;

-- ── 요약 결과(참고, 마지막 SELECT before ROLLBACK) ──
SELECT
  'DRYRUN-SUMMARY' AS tag,
  (SELECT count(*) FROM public.v_redpay_reconciliation_body WHERE external_trxid='DRYRUN-BODY-TRX') AS body_visible,
  (SELECT count(*) FROM public.v_redpay_reconciliation_body WHERE external_trxid='DRYRUN-FOOT-TRX') AS foot_visible,
  has_table_privilege('body_recon_ro','public.v_redpay_reconciliation_body','SELECT') AS role_view_select,
  has_table_privilege('body_recon_ro','public.payment_reconciliation_log','SELECT')   AS role_base_select;

ROLLBACK;

-- ── POST-PROBE (트랜잭션 밖) — 뷰/role/center컬럼 미영속 재확인(MUST all false) ──
SELECT
  'POST-PERSISTENCE (MUST be false)' AS tag,
  EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='v_redpay_reconciliation_body') AS view_persisted,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname='body_recon_ro') AS role_persisted,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_reconciliation_log' AND column_name='center') AS center_col_persisted;
