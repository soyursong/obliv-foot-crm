-- ============================================================
-- T-20260728-foot-FORMSUB-DURABILITY-IMPROVE (트랙 A) — 발행문서 soft-delete + audit + hard-DELETE 전면차단
-- ============================================================
-- DA CONSULT-REPLY(정본): GO(조정 3건) — DA-20260802-foot-FORMSUB-DURABILITY-SOFTDELETE-AUDIT (MSG-20260802-093002-ovbb)
--   ⚠ 이 판정이 정본. 선행 MSG-20260802-092240-q6rk(4컬럼 미러) 는 DA 자기정정으로 SUPERSEDED.
--   상세: agents/docs/da_consult_reply_foot_formsub_durability_softdelete_audit_20260802.md §ADDENDUM
--   change-class = ADDITIVE, medical_charts 미러. 대표게이트 면제(autonomy §3.1), supervisor DDL-diff only.
--
-- reporter: agent-data-architect (DA decision §5, 부모 T-20260728-foot-DOCWRITE-DASH-UNISSUED-DATEFILTER-REOPEN)
-- 근거:
--   · form_submissions(629행) = 법적 의미 있는 발행문서(소견서/진단서). 의료법 제22조(진료기록 수정·삭제 시
--     원본보존·수행자·일시 기록) / 제40조(10년 보존). 현재 soft-delete·audit 전무 → 삭제 forensics·복구 공백.
--   · medical_charts(진료차트)는 이미 full soft-delete + medical_charts_audit_log 보유. 본 마이그는 그 선례를 미러.
--
-- 미러 원본:
--   · supabase/migrations/20260612150000_medical_charts_body_audit.sql (audit_log 테이블 + BEFORE UPDATE 트리거)
--   · supabase/migrations/20260621003000_medical_charts_soft_delete_sameday_unique.sql (soft-delete 컬럼 + 삭제전이 라벨 + RESTRICTIVE 가시성)
--
-- ── DA CONSULT-REPLY(정본 093002) 판정 반영 — ★조정 3건 ──
--   [Q1] ★조정③(필수): free-standing mutable BOOL is_deleted = REJECT. 정본 술어 = 단일 authority atom `deleted_at IS NULL`.
--        · soft-delete 3컬럼: deleted_at / deleted_by / delete_reason (mutable bool 제거).
--        · mutable is_deleted 는 deleted_at 과 독립 divergence 가능(is_deleted=true AND deleted_at IS NULL) = A9 cancel-terminal
--          동형 잠복불변식 위반 클래스를 PHI 테이블에 신규주조 → 금지.
--        · parity(FE .eq('is_deleted',false) 16곳 belt 유지)용으로 유일 허용형 = GENERATED 컬럼
--          (is_deleted BOOLEAN GENERATED ALWAYS AS (deleted_at IS NOT NULL) STORED) — drift 구조불가. dev재량 채택.
--        · RESTRICTIVE/partial-index 술어는 전부 `deleted_at IS NULL` 로 통일(is_deleted 술어 사용 금지).
--   [Q2] GO form_submissions_audit_log 신규(clinic_id UUID = form_submissions.clinic_id 타입정합, Q5 CONFIRM). append-only.
--        · ★조정①(필수): audit_log SELECT = current_user_role() IN(director,admin) — is_approved_user 아님
--          (old/new_data=full-row PHI, base 삭제행 director/admin 제한과 정합. 승인전체 개방 시 삭제 소견서 본문 우회노출 갭).
--        · ★조정②(권장·비블로커): audit_log FK = ON DELETE RESTRICT (NOT CASCADE) — forensics 테이블에 CASCADE=부모
--          물리삭제 시 audit 무언 동반소멸=유실. hard-DELETE 가드가 CASCADE 를 moot 화하나 RESTRICT 가 forensics-correct backstop.
--   [Q2-imm] draft·voided 불변확대 = 미확대 GO(둘 다 mutable 유지). forensics 는 audit 트리거가 전 UPDATE 포착으로 달성
--        (immutability ≠ auditability). draft 확대=편집 lifecycle 회귀 / voided 확대=soft-delete UPDATE 경로 충돌. published 만 불변.
--   [Q3/Q4] ★핵심: (iii) hard-DELETE 전status 전면차단 = GO(강화). published UPDATE-block 무조건 유지(옵션 a 컬럼-부분집합 완화 REJECT).
--        근거: published=의무기록 §40 10년보존→삭제대상 아님, §22 정정=신규발행. 삭제흔적 forensics 갭은 non-published 에만 존재→그것만 닫음.
--        정당 purge = service_role 의 의도적 트리거 disable. published void 실필요 = 별도 SECDEF RPC 후속 트랙(RLS/shared-guard 완화 금지).
--   [Q4-b] form_submissions_update RLS `status <> 'published'` 술어 변경 없음(published 이중방어 유지, void 미포함으로 완화 불요).
--   [Q5] GO RESTRICTIVE director/admin: (deleted_at IS NULL OR current_user_role()=ANY(director,admin)). 소견서/진단서=medical_charts 동급 PHI tier.
--
-- ── ★pre-apply 확인(DA 요구) — service_role hard-DELETE 의존 grep ──
--   grep 결과: form_submissions .delete() = scripts/T-20260617-*_seed.mjs / T-20260629-*_verify.mjs 2건뿐 = 종료티켓 1회성
--   test seed/cleanup(비활성). 활성/반복 service_role 배치 의존 = 0건 → soft-delete 전환·트리거 disable 불요, 적용 안전.
--   (해당 스크립트 재실행 시엔 DA 규정대로 ALTER TABLE ... DISABLE TRIGGER 감싸야 함 — 그러나 종료티켓 inert, 본 마이그 범위 밖.)
--
-- foot 스키마 정합 (medical_charts 와 다른 점):
--   · form_submissions.clinic_id 는 UUID(medical_charts 는 TEXT) → audit.clinic_id 도 UUID(의도적 상이, 타입정합, Q5 CONFIRM).
--
-- ── 트리거 공존/순서 (DA 안전확인) ──
--   기존 immutable 트리거 trg_form_submissions_published_immutable (BEFORE UPDATE OR DELETE) 와 공존.
--   트리거명 알파벳 순: trg_form_submissions_body_audit < trg_form_submissions_published_immutable → audit 先 평가.
--   차단 RAISE(published UPDATE / 전status DELETE) 시 same-txn audit INSERT 동반 롤백 = phantom 감사행 0. 안전.
--
-- ⚠️ ADDITIVE ONLY (DROP/타입변경 0). 기존 629행 = deleted_at NULL default(전량 활성). is_deleted 는 GENERATED(deleted_at IS NOT NULL)
--   → STORED 계산으로 629행 경미 rewrite(소테이블 무해). 무손실.
-- 롤백: 20260802150000_foot_form_submissions_softdelete_audit.rollback.sql
-- dry-run: 20260802150000_foot_form_submissions_softdelete_audit.dryrun.mjs (canonical no-persistence runner)
-- ============================================================

BEGIN;

-- ── 단계 1. form_submissions soft-delete 컬럼 (ADDITIVE, Q1 정본 — deleted_at 단일 authority) ──
--   ★조정③: mutable is_deleted BOOL 미도입. authority = deleted_at(3컬럼). is_deleted 는 GENERATED(파생, drift 구조불가).
--   deleted_at/by/reason 은 nullable default NULL → rewrite 없이 즉시 반영. is_deleted GENERATED STORED 는 629행 경미 rewrite.
--   ⚠ 순서: deleted_at 을 먼저 ADD 한 뒤 그것을 참조하는 is_deleted GENERATED 를 뒤에 ADD(동일 ALTER 내 좌→우 평가).
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ NULL,   -- 삭제 일시(의료법 §22 일시) = soft-delete 단일 authority atom
  ADD COLUMN IF NOT EXISTS deleted_by    UUID        NULL,   -- 삭제 수행자 auth.uid()(§22 수행자). 진실원천=audit_log.changed_by
  ADD COLUMN IF NOT EXISTS delete_reason TEXT        NULL,   -- 삭제 사유(보존)
  -- parity(FE .eq('is_deleted',false) belt) 전용 파생 플래그. GENERATED = deleted_at 과 divergence 구조불가(mutable bool 금지).
  ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN     GENERATED ALWAYS AS (deleted_at IS NOT NULL) STORED;

COMMENT ON COLUMN form_submissions.deleted_at    IS 'soft-delete 단일 authority(NULL=활성). hard-DELETE 금지(전status 트리거 차단). 목록 기본 숨김, director/admin 만 조회. 의료법 §22. T-20260728-foot-FORMSUB-DURABILITY-IMPROVE';
COMMENT ON COLUMN form_submissions.deleted_by    IS '삭제 수행자 auth.uid()(의료법 §22 수행자). 법적 진실원천=form_submissions_audit_log.changed_by';
COMMENT ON COLUMN form_submissions.delete_reason IS '삭제 사유(보존)';
COMMENT ON COLUMN form_submissions.is_deleted    IS 'GENERATED(deleted_at IS NOT NULL) — FE parity belt 전용 파생컬럼. write 불가(soft-delete 는 deleted_at 설정으로만). authority=deleted_at. T-20260728-foot-FORMSUB-DURABILITY-IMPROVE';

-- partial index (Q1 partial-index): 활성행 목록 조회 최적화. ★술어 통일 = deleted_at IS NULL(is_deleted 술어 미사용).
--   629행 소테이블 → 트랜잭션 내 CREATE INDEX(비-CONCURRENTLY) 락 무해.
CREATE INDEX IF NOT EXISTS idx_form_submissions_active
  ON form_submissions (clinic_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ── 단계 2. form_submissions_audit_log (수정/삭제 전·후 전체 행 스냅샷, append-only, Q2 GO) ──
--   medical_charts_audit_log 미러. clinic_id 만 UUID(타입정합).
CREATE TABLE IF NOT EXISTS form_submissions_audit_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ★조정②: ON DELETE RESTRICT (NOT CASCADE) — forensics 테이블 무언 동반소멸 방지. hard-DELETE 가드가 부모삭제를 막아
  --   RESTRICT 발동경로 자체가 moot 이나, forensics-correct backstop(가드 우회/미래 회귀 대비).
  form_submission_id  UUID        NOT NULL REFERENCES form_submissions(id) ON DELETE RESTRICT,
  clinic_id           UUID,                                   -- foot form_submissions.clinic_id = UUID
  old_data            JSONB       NOT NULL,                   -- 수정/삭제 전 원본 전체 행(의료법 §22)
  new_data            JSONB,                                  -- 수정본 전체 행
  changed_by          UUID,                                   -- 수행자 auth.uid()(누가)
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- 언제
  operation           TEXT        NOT NULL DEFAULT 'UPDATE' CHECK (operation IN ('UPDATE', 'DELETE'))
);

CREATE INDEX IF NOT EXISTS idx_fsal_submission_id
  ON form_submissions_audit_log (form_submission_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsal_clinic_date
  ON form_submissions_audit_log (clinic_id, changed_at DESC);

COMMENT ON TABLE form_submissions_audit_log IS
  '발행문서(소견서/진단서 등) 수정·삭제 이력 Audit Trail(append-only). 수정/삭제 전 원본+수정본 보존. 의료법 제22조 (T-20260728-foot-FORMSUB-DURABILITY-IMPROVE)';

ALTER TABLE form_submissions_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: ★director/admin 만 (Q2 DA ruling — is_approved_user 아님).
--   근거: old_data/new_data = full-row PHI(소견서/진단서 본문). 승인전체 개방 시 삭제 소견서 본문 우회노출 갭.
--   Q5 삭제행 가시성(director/admin)과 정합. medical_charts 선례의 느슨한 is_approved_user 는 잠복갭(별도 하드닝 후보).
DROP POLICY IF EXISTS "fsal_select_approved" ON form_submissions_audit_log;
DROP POLICY IF EXISTS "fsal_select_director_admin" ON form_submissions_audit_log;
CREATE POLICY "fsal_select_director_admin" ON form_submissions_audit_log
  FOR SELECT TO authenticated
  USING (current_user_role() = ANY (ARRAY['director'::text, 'admin'::text]));

-- INSERT: 트리거(SECURITY DEFINER) 경유 적재. 직접 INSERT 도 승인 사용자만(WITH CHECK 는 PHI 미노출).
DROP POLICY IF EXISTS "fsal_insert_approved" ON form_submissions_audit_log;
CREATE POLICY "fsal_insert_approved" ON form_submissions_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_approved_user());

-- UPDATE/DELETE 정책 없음 → RLS default deny(append-only 강제, 위변조 불가). service_role 만 정리 가능.

-- ── 단계 3. BEFORE UPDATE 감사 트리거 on form_submissions ──
--   soft-delete 전이(deleted_at NULL→NOT NULL) = operation 'DELETE' 라벨, 그 외 본문 수정 = 'UPDATE'.
--   FE 경로 누락·우회와 무관하게 모든 UPDATE 가 DB 레벨에서 감사됨(medical_charts 설계정신 계승).
--   ※ 기존 immutable 트리거와 공존(별도 트리거명, 본 트리거는 NEW 무변형 RETURN NEW → 저장 페이로드 회귀 0).
CREATE OR REPLACE FUNCTION public.form_submissions_body_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op TEXT;
BEGIN
  -- authority = deleted_at(is_deleted 는 GENERATED, 판정근거로 사용 금지). NULL→NOT NULL 전이 = soft-delete.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_op := 'DELETE';
  ELSE
    v_op := 'UPDATE';
  END IF;

  INSERT INTO form_submissions_audit_log (
    form_submission_id, clinic_id, old_data, new_data, changed_by, operation
  ) VALUES (
    OLD.id, OLD.clinic_id,
    row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb,
    auth.uid(), v_op
  );
  RETURN NEW;  -- NEW 무변형 → 저장 페이로드 회귀 0
END;
$$;

COMMENT ON FUNCTION public.form_submissions_body_audit() IS
  'form_submissions BEFORE UPDATE 본문·삭제 감사(append-only): 수정/삭제 전 원본+수정본 보존. soft-delete 전이(deleted_at NULL→NOT NULL)는 operation=DELETE 라벨. 의료법 제22조 (T-20260728-foot-FORMSUB-DURABILITY-IMPROVE)';

DROP TRIGGER IF EXISTS trg_form_submissions_audit ON public.form_submissions;       -- draft 명 정리(있으면)
DROP TRIGGER IF EXISTS trg_form_submissions_body_audit ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_body_audit
  BEFORE UPDATE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.form_submissions_body_audit();

-- ── 단계 4 (★Q3/Q4 GO). immutable guard 확대: published 불변 유지(옵션 b) + hard-DELETE 전 status 전면차단 ──
--   현행: OLD.status='published' UPDATE/DELETE 만 차단 → draft/printed/signed/voided/completed 물리삭제 시 흔적 무(forensics 갭).
--   변경(강화): (1) published 본문 불변 = 종전 유지(옵션 a 컬럼-부분집합 완화 REJECT — published soft-delete 조차 불허,
--             §40 10년보존 삭제대상 아님). (2) ★물리 DELETE = 전 status 전면차단 → 모든 삭제는 soft-delete(UPDATE deleted_at=now())로만.
--   ⇒ non-published 삭제흔적 forensics 갭 폐쇄. RLS(status<>'published' USING) + 트리거 이중방어 보존(Q4-b).
CREATE OR REPLACE FUNCTION public.form_submissions_published_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- (유지) published 의무기록 불변 — 정정=신규 발행(의료법 §22). UPDATE·DELETE 전면차단. soft-delete flip 불허(§40 10년보존).
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION '발행된 의무기록(소견서·검사결과지)은 수정·삭제할 수 없습니다 — 정정은 신규 발행으로만 가능합니다'
      USING ERRCODE = '42501';
  END IF;

  -- (★신규 강화, Q3/Q4-iii GO) 물리 삭제(hard-DELETE)는 전 status 전면차단.
  --   모든 삭제는 soft-delete(UPDATE deleted_at=now())로만 → 삭제 forensics(누가·언제·왜) audit 보존.
  --   정당 purge = service_role 의 의도적 ALTER TABLE ... DISABLE TRIGGER 경유(DA 명시).
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '서류는 물리적으로 삭제할 수 없습니다 — 삭제는 무효화(soft-delete) 기록으로만 가능합니다'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;  -- non-published UPDATE(본문 수정·soft-delete flip) 통과
END;
$$;

COMMENT ON FUNCTION public.form_submissions_published_immutable_guard() IS
  'form_submissions 비가역 가드: (1)published UPDATE/DELETE 전면차단(의료법 §22 의무기록 불변, 정정=신규발행) (2)물리 DELETE 전 status 전면차단(모든 삭제는 soft-delete로만, 삭제 forensics 보존). T-20260616-foot-OPINION-DOC-FEATURE C1 + T-20260728-foot-FORMSUB-DURABILITY-IMPROVE(Q3/Q4 GO).';

-- 트리거 정의(BEFORE UPDATE OR DELETE) 자체는 종전과 동일 — 함수만 CREATE OR REPLACE. 멱등 재확인.
DROP TRIGGER IF EXISTS trg_form_submissions_published_immutable ON public.form_submissions;
CREATE TRIGGER trg_form_submissions_published_immutable
  BEFORE UPDATE OR DELETE ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.form_submissions_published_immutable_guard();

-- ── 단계 5. soft-delete 행 가시성 제한 (RESTRICTIVE, ADDITIVE, Q5 GO) ──
--   삭제행(deleted_at IS NOT NULL)은 director/admin 만 SELECT. 소견서/진단서 = medical_charts 동급 PHI tier.
--   ★술어 통일 = deleted_at IS NULL(is_deleted 술어 미사용). RESTRICTIVE 는 기존 permissive(clinic 격리)와 AND
--   → 활성행(deleted_at IS NULL) 노출 종전과 동일(무회귀, 629행 무회귀).
--   FE 큐/발행완료 훅은 별도 .eq('is_deleted', false) belt(=GENERATED, deleted_at IS NULL 과 동치. director/admin 뷰에서도 삭제행 숨김).
DROP POLICY IF EXISTS "fs_deleted_rows_director_only" ON form_submissions;
CREATE POLICY "fs_deleted_rows_director_only" ON form_submissions
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    OR current_user_role() = ANY (ARRAY['director'::text, 'admin'::text])
  );

COMMENT ON POLICY "fs_deleted_rows_director_only" ON form_submissions IS
  'soft-delete 발행문서(deleted_at IS NOT NULL)는 director/admin 만 조회. 술어=deleted_at 단일 authority. RESTRICTIVE=기존 clinic 격리와 AND. Q5 GO. T-20260728-foot-FORMSUB-DURABILITY-IMPROVE';

-- ── 검증(마이그레이션 자체 유효성, supervisor DDL-diff self-check) ──
DO $$
DECLARE
  v_guard_def text;
BEGIN
  -- Q1(정본): deleted_at authority 컬럼 존재
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='form_submissions' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'form_submissions.deleted_at 컬럼 추가 실패'; END IF;
  -- ★조정③: is_deleted 는 존재하되 반드시 GENERATED(mutable bool 재도입 = 회귀). is_generated='ALWAYS' 강제.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='form_submissions' AND column_name='is_deleted') THEN
    RAISE EXCEPTION 'form_submissions.is_deleted(GENERATED) 컬럼 추가 실패'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='form_submissions' AND column_name='is_deleted'
      AND is_generated <> 'ALWAYS') THEN
    RAISE EXCEPTION '★조정③ 위반: is_deleted 가 GENERATED 아님(mutable bool 금지 — deleted_at 파생만 허용)'; END IF;
  -- 술어 통일: partial index 는 deleted_at IS NULL 술어여야 함(is_deleted 술어 금지)
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='form_submissions'
      AND indexname='idx_form_submissions_active' AND indexdef ILIKE '%deleted_at IS NULL%') THEN
    RAISE EXCEPTION 'Q1 위반: idx_form_submissions_active 술어가 deleted_at IS NULL 아님'; END IF;
  -- ★조정②: audit_log FK = RESTRICT(NOT CASCADE)
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='form_submissions_audit_log'::regclass AND contype='f' AND confdeltype='c') THEN
    RAISE EXCEPTION '★조정② 위반: audit_log FK 가 ON DELETE CASCADE(RESTRICT 이어야 함)'; END IF;

  -- Q2: audit_log 테이블 + SELECT 정책 = director/admin(is_approved_user 아님)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='form_submissions_audit_log') THEN
    RAISE EXCEPTION 'form_submissions_audit_log 테이블 생성 실패'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions_audit_log'
      AND policyname='fsal_select_director_admin' AND qual ILIKE '%is_approved_user%') THEN
    RAISE EXCEPTION 'Q2 위반: audit_log SELECT 가 is_approved_user 사용(director/admin 이어야 함)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions_audit_log'
      AND policyname='fsal_select_director_admin' AND qual ILIKE '%director%') THEN
    RAISE EXCEPTION 'Q2 위반: audit_log SELECT director/admin 술어 누락'; END IF;

  -- append-only: UPDATE/DELETE 정책 부재
  IF EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions_audit_log' AND cmd IN ('UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'form_submissions_audit_log 에 UPDATE/DELETE 정책 존재 — append-only 위반'; END IF;

  -- 단계 3: 감사 트리거(body_audit) 존재
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgname='trg_form_submissions_body_audit' AND tgrelid='form_submissions'::regclass) THEN
    RAISE EXCEPTION 'trg_form_submissions_body_audit 트리거 생성 실패'; END IF;

  -- Q3/Q4: immutable guard 에 물리 DELETE 전면차단(TG_OP='DELETE' RAISE) 반영
  SELECT pg_get_functiondef(oid) INTO v_guard_def FROM pg_proc
    WHERE proname='form_submissions_published_immutable_guard';
  IF v_guard_def IS NULL OR v_guard_def NOT LIKE '%TG_OP = ''DELETE''%' THEN
    RAISE EXCEPTION 'Q3/Q4 위반: immutable guard 에 hard-DELETE 전status 전면차단 누락'; END IF;
  IF v_guard_def NOT LIKE '%published%' THEN
    RAISE EXCEPTION 'Q3/Q4 위반: immutable guard published 불변 차단 소실'; END IF;

  -- Q5: RESTRICTIVE 가시성(★deleted_at 술어 통일 — is_deleted 술어 금지)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions'
      AND policyname='fs_deleted_rows_director_only' AND qual ILIKE '%deleted_at%') THEN
    RAISE EXCEPTION 'Q5 위반: fs_deleted_rows_director_only RESTRICTIVE(deleted_at) 정책 실패'; END IF;

  -- Q4-b: form_submissions_update USING 의 published 이중방어 술어 보존(변경 없음)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='form_submissions'
      AND policyname='form_submissions_update' AND qual LIKE '%published%') THEN
    RAISE EXCEPTION 'Q4-b 위반: form_submissions_update published 이중방어 술어 소실'; END IF;

  RAISE NOTICE 'T-20260728-foot-FORMSUB-DURABILITY-IMPROVE 트랙A(정본 093002): 모든 검증 통과 (Q1 deleted_at authority + is_deleted GENERATED / 술어 deleted_at IS NULL 통일 / Q2 audit director-admin + FK RESTRICT / Q3-Q4 hard-DELETE 전면차단 / Q5 RESTRICTIVE / Q4-b 이중방어 보존)';
END $$;

COMMIT;
