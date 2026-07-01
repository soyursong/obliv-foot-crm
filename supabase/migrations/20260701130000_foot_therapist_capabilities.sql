-- ============================================================
-- T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN
-- 치료사별 가능 시술(프리컨디셔닝/포돌로게/리본) capability 영속 + 금일 치료유형 기반 배정 후보 제한
-- ============================================================
-- data-architect CONSULT-REPLY GO (ADDITIVE, MSG-20260701-175504-8mjx /
--   da_replies/DA-REPLY-T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN.md):
--   질의A = (ii) 매핑 소형테이블 채택(현장 3 체크박스 UI 불변, 저장 백엔드만 매핑테이블).
--   질의B = SINGLE 확정(무좀PC+NL = preconditioning only). dev '복수' 매칭은 버그 → 배정필터에서 정정.
--   ADDITIVE 순수신설(기존 staff 무변) → 대표게이트 면제(autonomy §3.1), supervisor DDL-diff 게이트만.
--
-- ── 저장 형상(DA 질의A (ii)) ──
--   grain = (치료사 staff_id × capability_code) 1행.
--     체크 → 행 upsert(present) / 언체크 → 행 delete(absent = default false).
--   capability_code = 공유 치료유형 어휘(session_type 정본) gated subset {preconditioning, podologue, ribbon}.
--     ⚠ gated-3 하드 CHECK 를 걸지 않는다(DA 경고) — 신규 gated 치료유형 추가마다 DDL 유발 방지.
--        어휘 검증 = 공유 lookup FK 또는 앱레벨(현재는 앱레벨 GATED_CAPABILITY_CODES + UI 3항목 고정).
--     join key 는 이미 set-containment(⊇)라 session_type 정본 어휘와 직접 조인(번역계층 0).
--
-- ── 배정 필터 규칙(DA 질의B, SINGLE) ── (코드=src/lib/autoAssign.ts filterTherapistPoolByTreatmentCapability)
--   required_caps(환자) = { 환자 금일 치료유형 코드 } ∩ { preconditioning, podologue, ribbon }
--   배정 후보 = { 치료사 : therapist_capabilities(staff_id) ⊇ required_caps(환자) }
--     · 무좀PC+NL → {preconditioning,unheated_laser} ∩ gated = {preconditioning} = SINGLE.
--     · 내성PD→{podologue} · 각질RB→{ribbon} · 피검사/KOH→required_caps=∅(필터 미적용=전체 후보).
--
-- ── cross-CRM 재사용성 ──
--   boolean 3컬럼(현장 원안) 대신 매핑테이블 → derm/scalp/body 도 동일 스키마 재사용 가능(컬럼 폭증 0).
--
-- 롤백: 20260701130000_foot_therapist_capabilities.rollback.sql
-- ============================================================

BEGIN;

-- ── therapist_capabilities (순수 신설, ADDITIVE) ─────────────────────────────
CREATE TABLE IF NOT EXISTS therapist_capabilities (
  staff_id        uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  capability_code text        NOT NULL,  -- 공유 session_type 정본 gated subset. ⚠ 하드 CHECK 금지(앱레벨 검증).
  clinic_id       uuid        REFERENCES clinics(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES auth.users(id),
  -- grain: 치료사 × capability_code 1행 (멱등 upsert/delete 앵커)
  PRIMARY KEY (staff_id, capability_code)
);

COMMENT ON TABLE therapist_capabilities IS
  '치료사별 수행 가능 시술 capability(T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN). '
  'grain=(staff_id)×capability_code, 행 present=수행가능/absent=불가(default false). '
  'capability_code = session_type 정본 gated subset {preconditioning, podologue, ribbon}(하드 CHECK 미설정, 앱레벨 검증). '
  '자동배정 필터 join key = therapist_capabilities ⊇ required_caps(환자 금일 치료유형 ∩ gated). '
  '무좀PC+NL = preconditioning SINGLE(DA GO_WARN 정정). 저장=자동배정 기본순번 설정 화면 3 체크박스.';

-- 배정 필터가 pool(staff_id 집합)으로 조회 → staff_id PK 로 커버. clinic 격리 조회 가속 index.
CREATE INDEX IF NOT EXISTS idx_therapist_capabilities_clinic
  ON therapist_capabilities(clinic_id, capability_code);

ALTER TABLE therapist_capabilities ENABLE ROW LEVEL SECURITY;

-- 승인 사용자 + 지점 격리(is_approved_user / current_user_clinic_id — 既존 헬퍼, chart_treatment_requests 동형).
--   clinic_id NULL 행(레거시/미기입)은 지점격리 조건 미충족으로 read/write 불가 → 앱은 항상 clinic_id 기입.
CREATE POLICY "approved_clinic_therapist_capabilities_all" ON therapist_capabilities
  FOR ALL TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='therapist_capabilities'
  ) THEN RAISE EXCEPTION 'therapist_capabilities 테이블 생성 실패'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='therapist_capabilities' AND c.relrowsecurity=true
  ) THEN RAISE EXCEPTION 'therapist_capabilities RLS 미활성'; END IF;

  -- capability_code 에 하드 CHECK 가 없어야 함(DA 경고 — 신규 gated 추가 시 DDL 유발 방지)
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
     WHERE c.relname='therapist_capabilities' AND con.contype='c'
       AND pg_get_constraintdef(con.oid) ILIKE '%capability_code%'
  ) THEN RAISE EXCEPTION 'capability_code 하드 CHECK 존재 — DA 경고 위반(앱레벨 검증만 허용)'; END IF;

  RAISE NOTICE 'T-20260701-foot-THERAPIST-SKILL-CAPABILITY-ASSIGN: therapist_capabilities(+RLS, no capability CHECK) 검증 통과';
END
$verify$;

COMMIT;
