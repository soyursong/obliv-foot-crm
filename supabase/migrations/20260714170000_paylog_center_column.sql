-- ══════════════════════════════════════════════════════════════════
-- T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER — payment_reconciliation_log center 컬럼 (ADDITIVE)
-- ══════════════════════════════════════════════════════════════════
-- 배경: 도수(재활의학, B1) 레드페이 대사 인프라. 511-60-00988 사업자를 풋/도수가 공유(단일 merchant
--   사업자) → 5분 폴러가 도수 band(1777274-276, 14종)도 수집. payment_reconciliation_log 는 foot DB
--   단일 물리테이블 → 멀티센터 recon 격리를 위한 스코핑 필드가 필요. DA CONSULT-REPLY 확정:
--     · MSG-20260714-161027-6fi9 (축분리: 폴러+center 컬럼 = dev-foot 공유인프라 lane, center 값='body')
--     · MSG-20260714-161525-ipsv (정밀 계약, 정본=da_decision_body_redpay_center_column_20260714.md)
--
-- ── DA center 컬럼 정밀 계약 (정본) ────────────────────────────────────────
--   · 소유/물리위치: payment_reconciliation_log = obliv-foot-crm 소유 단일 물리테이블(foot Supabase DB).
--       center DDL = dev-foot lane. body DB 에 별도 테이블 없음 — body 탭은 center='body' cross-CRM read only.
--   · 타입/제약: center text + CHECK(center IN ('foot','body')). pg enum 회피(ALTER TYPE 파괴 위험 제거,
--       확장 시 CHECK 만 ADD).
--   · 값 표준(canonical brand 토큰): {'foot','body'}. ⛔ dohsu/dosu(display alias) ⛔ body_rehab(축오염) 금지.
--       재활 relabel = 표시라벨 축(center VALUE 무영향, 재활도 center='body').
--   · DEFAULT/backfill/NOT NULL: DEFAULT 'foot' (ADD COLUMN DEFAULT 가 기존행 자동 충전) → NOT NULL 승격.
--       PG11+ fast-default → 기존행 rewrite 없이 즉시 'foot' 충전 + NOT NULL 강제(안전).
--   · 회귀 0 조건: center 미참조 뷰(v_redpay_reconciliation_daily 등) 무영향, backfill 후 기존행 전량 'foot'
--       → 기존 풋 recon 회귀 0 (AC4).
--
-- ── ADDITIVE 계약 ─────────────────────────────────────────────────────
--   신규: payment_reconciliation_log.center 컬럼(NOT NULL DEFAULT 'foot' + CHECK) + 조회 인덱스.
--   무접촉: 기존 컬럼·제약·트리거·RLS·원장. 뷰/함수(center 미참조)는 자동 무영향.
--   Rollback: 20260714170000_paylog_center_column.rollback.sql (DROP CONSTRAINT + DROP COLUMN. 데이터손실=center값만).
--
-- risk: GO_WARN(DA) — ADDITIVE. 대표 게이트 면제(autonomy §3.1, ADDITIVE + DA CONSULT GO) → supervisor DDL-diff.
-- MIG-GATE: db_change=true. mig_files/mig_dryrun/mig_ledger_check/mig_rollback 4필드 deploy-ready 전 기입.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. center 컬럼 ADD (NOT NULL DEFAULT 'foot' — 기존행 자동 'foot' 충전, PG11+ fast-default) ──
ALTER TABLE public.payment_reconciliation_log
  ADD COLUMN IF NOT EXISTS center text NOT NULL DEFAULT 'foot';

COMMENT ON COLUMN public.payment_reconciliation_log.center IS
  'T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER: 멀티센터 recon 스코핑 필드(canonical brand 토큰). '
  'foot=풋센터 / body=도수(재활의학). ⛔dohsu/dosu/body_rehab 금지(값표준=DA da_decision_body_redpay_center_column). '
  'foot=17-set merchant / body=도수 14-band(1777274-276). 폴러 수집 merchant→center 명시 매핑(EF 파생). '
  'body 탭(obliv-body-crm)이 center=body 로 cross-CRM read only.';

-- ── 2. CHECK 제약 — center IN ('foot','body') (pg enum 회피, 확장 시 CHECK 만 ADD) ──
--   멱등: 이미 있으면 DROP 후 재생성(정의 일치 보장).
ALTER TABLE public.payment_reconciliation_log
  DROP CONSTRAINT IF EXISTS payment_reconciliation_log_center_check;
ALTER TABLE public.payment_reconciliation_log
  ADD CONSTRAINT payment_reconciliation_log_center_check
    CHECK (center IN ('foot', 'body'));

-- ── 3. backfill 명시(방어적 no-op) — DEFAULT 로 기존행은 이미 'foot'. 혹시 NULL 잔존 시 정정. ──
--   center 는 NOT NULL 이므로 NULL 존재 불가하나, 재실행/부분적용 시나리오 방어.
UPDATE public.payment_reconciliation_log
   SET center = 'foot'
 WHERE center IS NULL;

-- ── 4. 조회 인덱스 — center 스코핑 조회(body 탭 cross-CRM read, foot recon 격리) 최적화 ──
CREATE INDEX IF NOT EXISTS recon_log_clinic_center_created_idx
  ON public.payment_reconciliation_log (clinic_id, center, created_at DESC);

COMMENT ON INDEX public.recon_log_clinic_center_created_idx IS
  'T-20260714-foot-REDPAY-DOHSU-CLOSING-POLLER: center 스코핑 조회(멀티센터 recon 격리) 인덱스.';

-- ── 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시) ──
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260714170000', 'paylog_center_column')
ON CONFLICT (version) DO NOTHING;

-- ── 적용 검증 쿼리 (참고) ──────────────────────────────────────────────────
-- SELECT column_name, is_nullable, column_default FROM information_schema.columns
--   WHERE table_name='payment_reconciliation_log' AND column_name='center';
-- SELECT center, count(*) FROM public.payment_reconciliation_log GROUP BY 1;  -- 기존행 전량 'foot' 기대
-- SELECT conname FROM pg_constraint WHERE conname='payment_reconciliation_log_center_check';
