-- ============================================================
-- T-20260701-foot-CHART2-TREATREQ-SPLIT
-- 2번차트 '치료신청' 5항목 영속 + 치료유형 어휘(session_type CHECK) ADDITIVE 확장
-- ============================================================
-- data-architect CONSULT-REPLY GO (ADDITIVE, DA-REPLY-T-20260701-foot-CHART2-TREATREQ-SPLIT):
--   ADDITIVE 순수신설 + CHECK 허용집합 확장(기존행 무효화 0) → 대표게이트 면제, supervisor DDL-diff만.
--
-- ⚠ DA 전제 정정(dev-foot 그라운딩): DA-REPLY 는 기능명세 §7(스테일) 근거로 현 session_type CHECK =
--   {heated_laser, unheated_laser, iv, preconditioning} 이고 podologue/ribbon 둘 다 부재로 판단했으나,
--   실제 정본 CHECK(20260508000091 + 20260608130000)는 이미
--   {heated_laser, unheated_laser, iv, preconditioning, podologue, trial, reborn} 이다.
--   → 'podologue' 는 이미 존재. 본 티켓의 ADDITIVE 델타는 'ribbon' 단 1개.
--
-- ── 5항목 = 2개 의미 축(DA §7, 하나로 뭉치지 말 것) ──
--   치료유형(treatment) 축 [배정 필터 O]: 내성(PD)=`podologue`(既존) · 각질(RB)=`ribbon`(본 마이그 신규)
--   검사요청(exam)     축 [배정 필터 X]: 피검사=`blood_test` · KOH균검사=`koh_fungal_test`
--                                        → 既존 리스트업 엔티티(check_in_services.blood_test_requested/
--                                          koh_requested + request_*_for_customer RPC)에 write. session_type 아님.
--   무좀PC+NL          축 [배정 필터 X]: `athlete_foot_pc_nl` — dev-foot 그라운딩 결과 처방(PC)+네일락(NL)
--                                        도메인(무좀세트/PrescriptionSets), 치료사 hands-on 시술 아님 →
--                                        非치료(exam=listup only) 축. session_type CHECK 에 넣지 않음(범주 오염 방지).
--
-- [A] 신규 소형 정규화 테이블 chart_treatment_requests — grain=(check_in_id)×request_code 1행.
--     request_axis 로 두 의미 축 분리(배정=axis='treatment'만, 리스트업=axis='exam'만 read).
--     source 로 provenance 구분(초진=manual / 재진=package_derived 체크인 시점 스냅샷, live mirror 아님).
-- [B] package_sessions.session_type CHECK 에 'ribbon' ADDITIVE 추가(배정 join key = 공유 치료유형 어휘 SSOT).
--     'podologue' 는 이미 포함 — 기존 7값 전체 보존 + ribbon.
--
-- 롤백: 20260701120000_foot_chart_treatment_requests.rollback.sql
-- ============================================================

BEGIN;

-- ── [A] chart_treatment_requests ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_treatment_requests (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    uuid        NOT NULL,
  customer_id  uuid        NOT NULL REFERENCES customers(id)  ON DELETE CASCADE,
  check_in_id  uuid        NOT NULL REFERENCES check_ins(id)  ON DELETE CASCADE,
  visit_type   text,       -- customers.visit_type 스냅샷('new'=초진 / 'returning'=재진). 배정 필터는 소비 시 초진 한정.
  request_code text        NOT NULL,
  request_axis text        NOT NULL CHECK (request_axis IN ('treatment', 'exam')),
  source       text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'package_derived')),
  created_by   uuid        REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- grain: 한 내원(check_in) × request_code 1행 (멱등 upsert 앵커)
  CONSTRAINT chart_treatment_requests_grain UNIQUE (check_in_id, request_code)
);

COMMENT ON TABLE chart_treatment_requests IS
  '2번차트 치료신청 영속(T-20260701-foot-CHART2-TREATREQ-SPLIT). grain=(check_in_id)×request_code. '
  'request_axis=treatment(내성 podologue/각질 ribbon → 배정 필터 참여) | exam(무좀 athlete_foot_pc_nl 등 리스트업). '
  '피검사/KOH 는 본 테이블 미저장 — 既존 check_in_services 플래그(중복 저장소 방지, DA AC-4). '
  'source=manual(초진 수동) | package_derived(재진 패키지 파생 체크인 스냅샷, live mirror 아님).';

-- 크로스 환자 리스트업(예: 오늘 특정 치료유형 신청 전 환자) + 축 필터 가속
CREATE INDEX IF NOT EXISTS idx_ctr_clinic_axis_code
  ON chart_treatment_requests(clinic_id, request_axis, request_code);
CREATE INDEX IF NOT EXISTS idx_ctr_checkin
  ON chart_treatment_requests(check_in_id);

ALTER TABLE chart_treatment_requests ENABLE ROW LEVEL SECURITY;

-- 승인 사용자 + 지점 격리(is_approved_user / current_user_clinic_id — 既존 헬퍼, staff_temp_off 동형).
CREATE POLICY "approved_clinic_chart_treatment_requests_all" ON chart_treatment_requests
  FOR ALL TO authenticated
  USING (is_approved_user() AND clinic_id = current_user_clinic_id())
  WITH CHECK (is_approved_user() AND clinic_id = current_user_clinic_id());

-- ── [B] session_type CHECK 에 'ribbon' ADDITIVE 확장 ─────────────────────────
--   기존 허용집합(heated_laser, unheated_laser, iv, preconditioning, podologue, trial, reborn) ⊂ 신집합
--   → 기존 행 위반 0(ADDITIVE). 'podologue' 이미 포함(재추가 아님, 전체 재정의로 보존).
ALTER TABLE package_sessions
  DROP CONSTRAINT IF EXISTS package_sessions_session_type_check;

ALTER TABLE package_sessions
  ADD CONSTRAINT package_sessions_session_type_check
    CHECK (session_type IN (
      'heated_laser', 'unheated_laser', 'iv', 'preconditioning',
      'podologue', 'trial', 'reborn', 'ribbon'
    ));

-- ── 검증 ──
DO $verify$
DECLARE
  v_bad int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='chart_treatment_requests'
  ) THEN RAISE EXCEPTION 'chart_treatment_requests 테이블 생성 실패'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='chart_treatment_requests' AND c.relrowsecurity=true
  ) THEN RAISE EXCEPTION 'chart_treatment_requests RLS 미활성'; END IF;

  -- ADDITIVE 확인: 기존 session_type 행이 새 CHECK 를 전부 통과해야 함(위반 0)
  SELECT count(*) INTO v_bad FROM package_sessions
   WHERE session_type NOT IN (
     'heated_laser','unheated_laser','iv','preconditioning','podologue','trial','reborn','ribbon'
   );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'session_type CHECK 확장이 ADDITIVE 아님 — 기존 위반행 % 건', v_bad;
  END IF;

  RAISE NOTICE 'T-20260701-foot-CHART2-TREATREQ-SPLIT: chart_treatment_requests(+RLS) + session_type ribbon 확장 검증 통과';
END
$verify$;

COMMIT;
