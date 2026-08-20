-- ============================================================================
-- T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY  (dev-foot) · UP
--   storage.upload 실패 계측 테이블 신설 — 풋센터(obliv-foot-crm)
--   assignee: dev-foot | db_change: true | 순수 ADDITIVE (신규 테이블 1개 · 기존 무변)
--   DB: rxlomoozakkjesdqjtvd (obliv-foot-crm)
--   2026-08-20
--
-- ── 배경 (RC 판정서 FIX-C) ──────────────────────────────────────────────────
--   RC-③ 유실축(성공 후 흔적무)은 旣종결(589f3138). 남은 미제 = "실패한 업로드의 원인"이
--   사흘째 미확정. 실패한 upload 는 DB/스토리지에 아무 흔적을 남기지 않아(성공 경로만 INSERT)
--   원인 규명 불가. 크기 가설은 이미 배제(1,183개 中 중앙0.38MB·최대3.67MB·4MB초과0).
--   → storage.upload 가 실패하는 그 순간을 PHI-free 로 계측해 원인(HTTP status·소요·재시도)을
--     남기는 전용 테이블을 신설한다. (append-only 진단 로그)
--
-- ── change-class = 순수 ADDITIVE ────────────────────────────────────────────
--   신규 테이블 1개 CREATE only. 기존 테이블/컬럼/enum/RLS/데이터 무접촉(회귀0·backfill0·순소실0).
--   완전가역(rollback = DROP TABLE 1줄). 멱등(CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS).
--
-- ── ★ 게이트 (db_change=true) ────────────────────────────────────────────────
--   ① Gate-B(DA CONSULT 1차): concrete DDL(본 파일) → data-architect CONSULT →
--      DA GO(ADDITIVE·PHI-free 확인) 前 prod apply 금지.
--   ② apply-gate = supervisor(NOT DA): DA GO ≠ apply 허가. dev 는 supervisor DB-GATE
--      GO-token(db_apply_guard.sh lane) 발행 後에만 prod apply.
--      GO-token 前 prod DDL/GRANT 선집행 금지(apply_before_go 클래스, deploy-precheck C20).
--   ③ MIG-GATE evidence 4필드(deploy-ready): mig_files·mig_dryrun(무영속)·
--      mig_ledger_check(3자대조)·mig_rollback.
--
-- ── PHI-free 설계 (환자 식별정보 적재 금지) ──────────────────────────────────
--   · customer_id / 환자명 / 차트번호 / 파일명(내 PHI) 절대 미적재.
--   · path_prefix = 버킷/폴더 prefix 수준까지만 (FE 헬퍼가 full path 의 1st 세그먼트만 남기고 절삭).
--       예: treatment-photos 경로 `{clinic_id}/{customer_id}/{uuid}.jpg` → 'treatment-photos/{clinic_id}'
--           (clinic_id=지점 UUID=非PHI, customer_id 2nd 세그먼트는 절삭·미적재).
--           documents 경로 `customer/{customer_id}/...`         → 'documents/customer' (정적 폴더명만).
--   · error_code = 스토리지 에러 name/code(짧은 분류 축)만. raw message 미적재(경로 누수 방어).
--   · clinic_id = 테넌트 RLS anchor(非PHI). 실패 시점 인증컨텍스트 열화 가능 → nullable(best-effort stamp).
--   · created_by = 업로더 auth.uid()(스태프·非환자). 진단 보조축. nullable.
--
-- ── RLS (write=스태프 인증 서버경로 · anon 봉인) ─────────────────────────────
--   · INSERT: authenticated only. WITH CHECK(true) — 실패 계측의 무손실 캡처가 최우선이라
--     clinic_id 일치를 INSERT 시점에 강제하지 않는다(열화 세션도 실패를 남길 수 있게).
--   · SELECT: clinic-gate (own-clinic | admin) — 진단열람 테넌트 격리.
--   · UPDATE/DELETE: 정책 미부여 = 거부 (append-only 불변 진단로그).
--   · anon: explicit anon-deny RESTRICTIVE + REVOKE (미인증 누수 원천봉쇄).
--   · helper: current_user_clinic_id() / is_admin_or_manager() (foot 캐노니컬, 20260426 정의).
--
--   rollback : 20260820140000_foot_photo_upload_failures_telemetry.rollback.sql
--   dryrun   : 20260820140000_foot_photo_upload_failures_telemetry.dryrun.sql (무영속 BEGIN..ROLLBACK)
--   적용(supervisor DB-GATE + GO-token 후):
--     supabase db push --file supabase/migrations/20260820140000_foot_photo_upload_failures_telemetry.sql
-- ============================================================================

BEGIN;

-- ── (0) PREFLIGHT: helper 실재 + 멱등(중복생성 방지) ──────────────────────────
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='current_user_clinic_id') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: current_user_clinic_id() 부재 — SELECT gate 술어 해소 불가 (wrong DB?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='is_admin_or_manager') THEN
    RAISE EXCEPTION 'PREFLIGHT_FAIL: is_admin_or_manager() 부재 — admin bypass 해소 불가 (wrong DB?)';
  END IF;
END $preflight$;

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1: photo_upload_failures 테이블 (storage.upload 실패 계측 · append-only)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.photo_upload_failures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),   -- [시각] 실패 계측 시각
  clinic_id       UUID,                                 -- 테넌트 RLS anchor(非PHI). best-effort → nullable
  bucket          TEXT        NOT NULL,                 -- 스토리지 버킷명 (treatment-photos/documents/...)
  path_prefix     TEXT,                                 -- [경로 prefix] 버킷/폴더 prefix 수준까지만 (PHI-free)
  file_size_bytes BIGINT,                               -- [파일 크기] 바이트
  http_status     INTEGER,                              -- [HTTP status] 스토리지 에러 statusCode (network 실패=NULL)
  error_code      TEXT,                                 -- 에러 분류축 name/code (raw message 미적재 · PHI-free)
  duration_ms     INTEGER,                              -- [소요ms] upload 시도 소요시간
  retry_attempt   INTEGER     NOT NULL DEFAULT 0,       -- [재시도 회차] 0=최초시도
  created_by      UUID                                  -- 업로더 auth.uid()(스태프·非환자). 진단보조
);

COMMENT ON TABLE  public.photo_upload_failures IS
  'T-20260820-foot-PHOTOUP-FAILURE-TELEMETRY: storage.upload 실패 계측(append-only 진단로그). PHI-free(환자식별정보 미적재). '
  'RC FIX-C — 실패 업로드의 원인(HTTP status·소요·재시도) 캡처. write=스태프 인증만·anon 봉인.';
COMMENT ON COLUMN public.photo_upload_failures.path_prefix IS
  '버킷/폴더 prefix 수준까지만 (FE 헬퍼가 full path 의 1st 세그먼트만 남기고 절삭). customer_id/파일명 미포함(PHI-free).';
COMMENT ON COLUMN public.photo_upload_failures.error_code IS
  '스토리지 에러 name/code(짧은 분류축)만. raw message 미적재 — 경로/PHI 누수 방어.';
COMMENT ON COLUMN public.photo_upload_failures.clinic_id IS
  '테넌트 RLS anchor(非PHI 지점 UUID). 실패시점 인증컨텍스트 열화 가능 → nullable(best-effort stamp).';

-- 진단 조회용 인덱스: 최근 실패(시각 DESC) · 버킷×시각 (원인 클러스터링)
CREATE INDEX IF NOT EXISTS idx_photo_upload_failures_created_at
  ON public.photo_upload_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_upload_failures_bucket_created
  ON public.photo_upload_failures(bucket, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2: GRANT (anon table-GRANT drift 방어 — 명시 REVOKE)
-- ════════════════════════════════════════════════════════════════════════════
REVOKE ALL ON public.photo_upload_failures FROM PUBLIC;
REVOKE ALL ON public.photo_upload_failures FROM anon;
GRANT SELECT, INSERT ON public.photo_upload_failures TO authenticated;
-- UPDATE/DELETE GRANT 미부여 = append-only 불변.

-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3: RLS (write=스태프 인증 · anon 봉인)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.photo_upload_failures ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated 스태프 — 무손실 캡처 우선(WITH CHECK true).
DROP POLICY IF EXISTS photo_upload_failures_insert ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_insert ON public.photo_upload_failures
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- SELECT: clinic-gate (own-clinic | admin) — 진단열람 테넌트 격리.
DROP POLICY IF EXISTS photo_upload_failures_select ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_select ON public.photo_upload_failures
  FOR SELECT TO authenticated
  USING ((clinic_id = current_user_clinic_id()) OR is_admin_or_manager());

-- anon 봉인: explicit anon-deny RESTRICTIVE (foot 캐노니컬 anon-deny 패턴).
DROP POLICY IF EXISTS photo_upload_failures_anon_deny ON public.photo_upload_failures;
CREATE POLICY photo_upload_failures_anon_deny ON public.photo_upload_failures
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- UPDATE/DELETE: 정책 미부여 = 거부 (append-only 불변 진단로그).

-- ── (VERIFY) 착지 실증 (실패 시 abort) ────────────────────────────────────────
DO $verify$
DECLARE
  v_tbl   int;
  v_ins   int;
  v_sel   int;
  v_anon  int;
BEGIN
  SELECT count(*) INTO v_tbl FROM information_schema.tables
    WHERE table_schema='public' AND table_name='photo_upload_failures';
  IF v_tbl <> 1 THEN RAISE EXCEPTION 'VERIFY_FAIL: photo_upload_failures 테이블 미생성'; END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
            WHERE relnamespace='public'::regnamespace AND relname='photo_upload_failures') THEN
    RAISE EXCEPTION 'VERIFY_FAIL: RLS 미활성';
  END IF;

  SELECT count(*) INTO v_ins  FROM pg_policies WHERE schemaname='public'
    AND tablename='photo_upload_failures' AND policyname='photo_upload_failures_insert' AND cmd='INSERT';
  SELECT count(*) INTO v_sel  FROM pg_policies WHERE schemaname='public'
    AND tablename='photo_upload_failures' AND policyname='photo_upload_failures_select' AND cmd='SELECT';
  SELECT count(*) INTO v_anon FROM pg_policies WHERE schemaname='public'
    AND tablename='photo_upload_failures' AND policyname='photo_upload_failures_anon_deny'
    AND permissive='RESTRICTIVE' AND roles::text='{anon}';
  IF v_ins <> 1 OR v_sel <> 1 OR v_anon <> 1 THEN
    RAISE EXCEPTION 'VERIFY_FAIL: 정책 매칭 실패 (insert=% select=% anon=%)', v_ins, v_sel, v_anon;
  END IF;

  RAISE NOTICE 'VERIFY OK: photo_upload_failures 신설 + RLS(insert/select/anon-deny) 착지 (ADDITIVE·PHI-free).';
END $verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- 검증 쿼리 (supervisor DB-GATE / SQL Editor)
-- ════════════════════════════════════════════════════════════════════════════
-- 테이블/컬럼:
--   SELECT column_name,data_type,is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='photo_upload_failures' ORDER BY ordinal_position;
-- RLS 정책:
--   SELECT policyname,cmd,permissive,roles FROM pg_policies
--     WHERE schemaname='public' AND tablename='photo_upload_failures';
-- anon GRANT 부재 확인(drift 가드):
--   SELECT grantee,privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema='public' AND table_name='photo_upload_failures';  -- 기대: authenticated 만(SELECT/INSERT)
-- PHI-free 확인(DoD-2): 적재 후
--   SELECT * FROM public.photo_upload_failures ORDER BY created_at DESC LIMIT 5;  -- customer_id/이름/차트번호/파일명 부재
