-- DRYRUN (no-persistence): T-20260806-foot-TESTTID-479470-PERSEAT-REGISTER-ENABLE (AC-3)
--   목적: up.sql(ADD COLUMN reconcile_excluded + 뷰 2종 CREATE OR REPLACE + 470 단일행 seed)을
--         prod 무영속 검증 + VG1~VG5 assert.
--   Migration Dry-Run No-Persistence Protocol 준수: 전 구간 단일 txn BEGIN..ROLLBACK, COMMIT 문 0
--     → sentinel-bypass hazard 없음(영속 0). 성공 경로도 마지막 ROLLBACK 으로 무영속 보장.
--   실행: psql "$SUPABASE_DB_URL" -f 이 파일 (prod). 'DRYRUN OK ...' NOTICE 확인 후 ROLLBACK.

BEGIN;

-- ── 1) 전제 + VG 사전상태 (up 前): 의존객체 실재 + reconcile_excluded 컬럼 ABSENT + 470 ABSENT ──
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF to_regclass('public.redpay_terminal_registry') IS NULL THEN v_missing := v_missing || ' redpay_terminal_registry'; END IF;
  IF to_regclass('public.redpay_raw_transactions') IS NULL THEN v_missing := v_missing || ' redpay_raw_transactions'; END IF;
  IF to_regclass('public.payments') IS NULL THEN v_missing := v_missing || ' payments'; END IF;
  IF to_regclass('public.v_redpay_reconciliation_daily') IS NULL THEN v_missing := v_missing || ' v_redpay_reconciliation_daily'; END IF;
  IF to_regclass('public.v_redpay_installverify_pairs') IS NULL THEN v_missing := v_missing || ' v_redpay_installverify_pairs'; END IF;
  IF v_missing <> '' THEN RAISE EXCEPTION 'DRYRUN FAIL — 전제 미충족:%', v_missing; END IF;

  -- VG3 사전상태: 컬럼 신규(ADDITIVE) — 아직 부재여야.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='redpay_terminal_registry' AND column_name='reconcile_excluded') THEN
    RAISE NOTICE 'DRYRUN NOTE — reconcile_excluded 이미 존재(재적용/부분적용 상태). ADD COLUMN IF NOT EXISTS 멱등.';
  END IF;
  -- VG4 사전상태: 470 아직 부재여야(신규 seed).
  IF EXISTS (SELECT 1 FROM public.redpay_terminal_registry WHERE domain='foot' AND merchant_id='1047479470') THEN
    RAISE NOTICE 'DRYRUN NOTE — 470(merchant_id=1047479470) 이미 존재. ON CONFLICT DO UPDATE 멱등.';
  END IF;
  RAISE NOTICE 'DRYRUN OK — 전제 충족(의존객체 실재)';
END $$;

-- ── archive-first before-image (VG4·READ-ONLY): 470 seed 이전상태 스냅샷 ──
\echo '── archive-first: 470 before-image (기대 0행) ──'
SELECT merchant_id, tid, active, terminal_label FROM public.redpay_terminal_registry
 WHERE domain='foot' AND merchant_id='1047479470';

-- ── 2) up.sql 본체 실행 (ADD COLUMN + 뷰 2종 + 470 seed) ──
ALTER TABLE public.redpay_terminal_registry
  ADD COLUMN IF NOT EXISTS reconcile_excluded boolean DEFAULT false;

-- (뷰 2종 CREATE OR REPLACE — up.sql §2/§3 verbatim, 컴파일 검증용. 본문은 up.sql 참조 — 여기선 컴파일만 확인)
-- installverify_pairs (reconcile_excluded 술어 포함)
CREATE OR REPLACE VIEW public.v_redpay_installverify_pairs
WITH (security_invoker = true) AS
WITH foot_raw AS (
  SELECT r.id, r.clinic_id,
    COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) AS tid,
    r.approval_no, r.external_status, r.amount, r.approved_at, r.cancelled_at, r.external_trxid
  FROM public.redpay_raw_transactions r
  WHERE (COALESCE((r.raw_payload -> 'merchant'::text) ->> 'id'::text, (r.raw_payload -> 'data'::text) ->> 'merchant_id'::text) IN (
           SELECT redpay_terminal_registry.merchant_id FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain='foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false)))
    AND (COALESCE(r.tid, (r.raw_payload -> 'data'::text) ->> 'tid'::text) IN (
           SELECT redpay_terminal_registry.tid FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain='foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.tid IS NOT NULL
           UNION
           SELECT unnest(redpay_terminal_registry.superseded_tids) FROM public.redpay_terminal_registry
            WHERE redpay_terminal_registry.domain='foot'::text AND redpay_terminal_registry.active
              AND NOT COALESCE(redpay_terminal_registry.reconcile_excluded, false) AND redpay_terminal_registry.superseded_tids IS NOT NULL))
),
tid_counts AS (SELECT clinic_id, tid, count(*) AS n FROM foot_raw WHERE tid IS NOT NULL GROUP BY clinic_id, tid),
pairs AS (
  SELECT a.clinic_id, a.tid, a.approval_no, a.id AS approval_row_id, c.id AS cancel_row_id,
    a.external_trxid AS approval_trxid, c.external_trxid AS cancel_trxid,
    a.amount AS approval_amount, c.amount AS cancel_amount, a.approved_at AS approval_at,
    COALESCE(c.cancelled_at, c.approved_at) AS cancel_at,
    EXTRACT(EPOCH FROM (COALESCE(c.cancelled_at, c.approved_at) - a.approved_at)) AS gap_sec
  FROM foot_raw a JOIN foot_raw c ON c.clinic_id=a.clinic_id AND c.tid=a.tid AND c.approval_no=a.approval_no
  WHERE a.tid IS NOT NULL AND a.approval_no IS NOT NULL
    AND a.external_status='Y' AND a.amount>0
    AND c.external_status=ANY(ARRAY['N'::text,'X'::text,'M'::text]) AND c.amount<0
    AND (a.amount+c.amount)=0 AND a.approved_at IS NOT NULL AND COALESCE(c.cancelled_at,c.approved_at) IS NOT NULL
)
SELECT p.clinic_id, p.tid, p.approval_no, p.approval_row_id, p.cancel_row_id, p.approval_trxid, p.cancel_trxid,
  p.approval_amount, p.cancel_amount, p.approval_at, p.cancel_at, p.gap_sec, tc.n AS tid_txn_count,
  (p.approval_at AT TIME ZONE 'Asia/Seoul'::text)::date AS close_date,
  jsonb_build_object('classified','설치검증_추정','cond1_net0_same_tid_amount_approval',true,
    'cond2_cancel_gap_sec',round(p.gap_sec)::int,'cond2_threshold_sec',120,'cond3_tid_txn_count',tc.n,
    'cond4_amount',p.approval_amount,'approval_trxid',p.approval_trxid,'cancel_trxid',p.cancel_trxid,
    'approval_at',p.approval_at,'cancel_at',p.cancel_at,'approval_no',p.approval_no,'tid',p.tid) AS install_verify_evidence
FROM pairs p JOIN tid_counts tc ON tc.clinic_id=p.clinic_id AND tc.tid=p.tid
WHERE tc.n=2 AND p.gap_sec>=0 AND p.gap_sec<=120 AND p.approval_amount IN (100,500,1000,1004);

-- reconciliation_daily — up.sql §3 를 직접 소싱해 컴파일(재기재 생략, up.sql 이 SSOT). 여기선 seed·VG assert 집중.
-- (supervisor MIG-GATE 는 up.sql 전문을 이 BEGIN..ROLLBACK 로 실행 — 본 파일은 컬럼/seed/VG assert 검증 목적.)

-- 470 단일행 seed (up.sql §4 verbatim — FIX: 무조건 단일행 VALUES, clinic_id best-effort NULL)
INSERT INTO public.redpay_terminal_registry
  (clinic_id, domain, merchant_id, tid, terminal_label, active, reconcile_excluded, source, verified_at)
VALUES (
  (SELECT id FROM public.clinics WHERE business_no='511-60-00988' ORDER BY id LIMIT 1),  -- best-effort, 미발견 시 NULL
  'foot', '1047479470', '1047479470', '풋(시험검증)', true, true,
  '시험용 검증단말(reconcile_excluded=true). DRYRUN.', now()
)
ON CONFLICT (merchant_id) DO UPDATE SET
  active=EXCLUDED.active, reconcile_excluded=EXCLUDED.reconcile_excluded, tid=EXCLUDED.tid,
  terminal_label=EXCLUDED.terminal_label, source=EXCLUDED.source, verified_at=EXCLUDED.verified_at, updated_at=now();

-- ── 3) VG assert (up 後·txn 내) ──
DO $$
DECLARE
  v_470_active boolean; v_470_excl boolean; v_470_cnt int;
  v_gate_has_470 int;        -- #1 게이트 소비 집합(tid∪superseded, active) 에 470 포함?  기대 1
  v_recon_has_470 int;       -- #3~#6 정산 소비 집합(active AND NOT reconcile_excluded) 에 470 포함? 기대 0
  v_merno_ok int;            -- #2 MERNO 게이트(merchant_id OR tid, active) 470 통과?  기대 1
  v_regress int;             -- VG3: 기존 단말(470 제외) reconcile_excluded=true 로 오염된 것? 기대 0
BEGIN
  -- VG4: 470 단일행 · active=true · reconcile_excluded=true
  SELECT count(*) INTO v_470_cnt FROM public.redpay_terminal_registry WHERE domain='foot' AND merchant_id='1047479470';
  SELECT active, reconcile_excluded INTO v_470_active, v_470_excl
    FROM public.redpay_terminal_registry WHERE domain='foot' AND merchant_id='1047479470';
  IF v_470_cnt <> 1 THEN RAISE EXCEPTION 'VG4 FAIL — 470 rows=% (기대 1)', v_470_cnt; END IF;
  IF v_470_active IS NOT TRUE THEN RAISE EXCEPTION 'VG4 FAIL — 470 active<>true'; END IF;
  IF v_470_excl IS NOT TRUE THEN RAISE EXCEPTION 'VG4 FAIL — 470 reconcile_excluded<>true'; END IF;

  -- VG2 (#1 게이트): 470 이 게이트 소비 집합(active, tid∪superseded — reconcile_excluded 무접촉) 에 포함.
  SELECT count(*) INTO v_gate_has_470 FROM (
    SELECT tid FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND tid IS NOT NULL
    UNION SELECT unnest(superseded_tids) FROM public.redpay_terminal_registry WHERE domain='foot' AND active AND superseded_tids IS NOT NULL
  ) g WHERE g.tid='1047479470';
  IF v_gate_has_470 < 1 THEN RAISE EXCEPTION 'VG2 FAIL — 470 이 #1 게이트 집합에 미포함(선택불가)'; END IF;

  -- VG2 (#2 MERNO): 470 이 MERNO 게이트(merchant_id OR tid, active — reconcile_excluded 무접촉) 통과.
  SELECT count(*) INTO v_merno_ok FROM public.redpay_terminal_registry r
   WHERE r.domain='foot' AND r.active AND (r.merchant_id='1047479470' OR r.tid='1047479470');
  IF v_merno_ok < 1 THEN RAISE EXCEPTION 'VG2 FAIL — 470 이 #2 MERNO 게이트 미통과(결제거부)'; END IF;

  -- VG1 (정산 배제): 470 이 정산 소비 집합(active AND NOT reconcile_excluded) 에 미포함.
  SELECT count(*) INTO v_recon_has_470 FROM (
    SELECT merchant_id AS k FROM public.redpay_terminal_registry
      WHERE domain='foot' AND active AND NOT COALESCE(reconcile_excluded,false)
    UNION
    SELECT tid FROM public.redpay_terminal_registry
      WHERE domain='foot' AND active AND NOT COALESCE(reconcile_excluded,false) AND tid IS NOT NULL
    UNION
    SELECT unnest(superseded_tids) FROM public.redpay_terminal_registry
      WHERE domain='foot' AND active AND NOT COALESCE(reconcile_excluded,false) AND superseded_tids IS NOT NULL
  ) s WHERE s.k='1047479470';
  IF v_recon_has_470 <> 0 THEN RAISE EXCEPTION 'VG1 FAIL — 470 이 정산 소비 집합에 포함(오경보 재생산)'; END IF;

  -- VG3 (회귀 0): 470 외 어떤 기존 단말도 reconcile_excluded=true 로 오염되지 않음.
  SELECT count(*) INTO v_regress FROM public.redpay_terminal_registry
   WHERE domain='foot' AND merchant_id<>'1047479470' AND COALESCE(reconcile_excluded,false)=true;
  IF v_regress <> 0 THEN RAISE EXCEPTION 'VG3 FAIL — 기존 단말 % 개가 reconcile_excluded 오염', v_regress; END IF;

  RAISE NOTICE 'DRYRUN OK — VG1(정산배제 0)·VG2(게이트+MERNO 통과)·VG3(회귀 0)·VG4(470 단일행 active+excluded) 전부 PASS';
END $$;

-- 뷰 실행 컴파일 확인(0행이어도 성공=컴파일 OK).
\echo '── 뷰 컴파일/실행 확인 (에러 없으면 OK) ──'
SELECT count(*) AS installverify_rows FROM public.v_redpay_installverify_pairs;

ROLLBACK;  -- 무영속 보장(성공/실패 무관).
