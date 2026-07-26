-- T-20260726-foot-CRM-ASSIGN-V1 — 상담 자동배정 시스템(실행1~4·6) ADDITIVE 스키마
--
-- ── 착수 근거 ──
--   DA CONSULT-REPLY MSG-gxcs = GO_WARN + ADDITIVE=YES → autonomy §3.1(대표승인 불요, supervisor DDL-diff 게이트만).
--   기존 자동배정 엔진(T-20260617 AUTOASSIGN-BALANCE-TOSS, prod LIVE)을 재사용·확장한다.
--     · 조건① Assignment Log = 기존 assignment_actions 재사용(신규 로그 테이블/카운터 컬럼 신설 0).
--       일일 배정건수 = count(*) WHERE created_at::date=today AND to_staff_id AND action_type IN(auto_assign,manual) 파생.
--     · 조건② 매출귀속 RED LINE = INV-1 채택: auto-assign 은 check_ins.consultant_id(방문 포인터)만 write,
--       customers.assigned_consultant_id(매출귀속 유일 드라이버)는 미접촉(본 마이그·엔진 어디서도 write 0).
--     · 조건③ 컬럼명 정본 = customers.assigned_consultant_id / check_ins / staff_attendance.status='present' / payments.
--
-- ── 본 마이그 = 조건④ 신규 ADDITIVE 스키마(신규 테이블/nullable 컬럼, 회귀0, 롤백 pair 필수) ──
--   (1) staff.auto_assign_enabled  bool NOT NULL DEFAULT true   — 실행3 대상필터(직원별 자동배정 ON/OFF)
--   (2) staff.slack_user_id        text nullable                — 실행6 실장별 Slack 매핑(실행5 알림용, 별 dependency)
--   (3) assignment_ranking_weights          — 실행1 랭킹 가중치(월매출·주매출·객단가, 기본 1:1:1)
--   (4) assignment_daily_target_config      — 실행2 Daily Target(1등=꼴등 2배=2:1, DB CHECK+앱 이중 W3)
--   (5) assignment_leadsource_policy        — 실행2 LeadSource별 전략(daily_target | ranking_pointer)
--   (6) assignment_pointer_state            — 실행2 랭킹 포인터 커서(라운드로빈 금지, 순환). cursor_rank≠배정건수.
--   ※ 랭킹(1~N등) 물리 테이블 신설 불요 = payments 재계산(app 온디맨드 임베드 집계). 원장 물리저장 0.
--
-- ── W2 확정(자정 잡 실행주체, dev-foot 판단) ──
--   자정 잡(pg_cron/EF/앱) 없음. 랭킹은 app 온디맨드로 payments 를 재계산(월/주 윈도우는 KST 날짜상대 →
--   자정에 자연 롤오버 = '매일 자정 재계산' 충족). pointer 일일 리셋도 lazy(read 시 reset_date≠today면 cursor←0)로
--   무-잡 처리 → 실행주체 장애 위험 0. (assignment_pointer_state.reset_date 가 리셋 기준.)
--
-- 멱등: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS 후 재생성.
-- 파괴적 변경·RENAME·cross-product 충돌 0. 권한 축소 회귀 0. 기존 staff.assign_sort_order DROP 금지(W1 보존).
-- Rollback: 20260726130000_foot_consult_autoassign_ranking_v1.rollback.sql
-- Dry-run: 20260726130000_foot_consult_autoassign_ranking_v1.dryrun.sql (무영속 sentinel)
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff QA 게이트 선행.

BEGIN;

-- ── (1) staff.auto_assign_enabled — 실행3 대상필터 ────────────────────────────────
-- NOT NULL DEFAULT true → 기존 전 직원 자동 true(회귀0, 기존 배정 동선 무영향). 관리자가 실행6 에서 개별 OFF.
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS auto_assign_enabled BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN staff.auto_assign_enabled IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행3: 자동배정 대상 여부(직원별 ON/OFF). true=대상(기본). 후보 풀 = staff_attendance.status=present AND auto_assign_enabled=true.';

-- ── (2) staff.slack_user_id — 실행6 실장별 Slack 매핑(실행5 알림 dependency) ──────
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS slack_user_id TEXT;
COMMENT ON COLUMN staff.slack_user_id IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행6: 실장별 Slack user id(실행5 배정 알림용, 장쳰봇 명의 발송 매핑). NULL=미매핑.';

-- ── (3) assignment_ranking_weights — 실행1 랭킹 가중치(월매출·주매출·객단가) ──────
-- clinic 당 1행(PK=clinic_id). 기본 1:1:1(column DEFAULT). 행 부재 시 app 이 1:1:1 로 간주.
CREATE TABLE IF NOT EXISTS assignment_ranking_weights (
  clinic_id            UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  weight_revenue_month NUMERIC NOT NULL DEFAULT 1 CHECK (weight_revenue_month >= 0),
  weight_revenue_week  NUMERIC NOT NULL DEFAULT 1 CHECK (weight_revenue_week  >= 0),
  weight_avg_ticket    NUMERIC NOT NULL DEFAULT 1 CHECK (weight_avg_ticket    >= 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID REFERENCES auth.users(id)
);
COMMENT ON TABLE assignment_ranking_weights IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행1: 상담사 랭킹 가중치(월매출/주매출/객단가). clinic 1행. 기본 1:1:1. 랭킹은 payments 온디맨드 재계산(물리 순위 저장 0).';

-- ── (4) assignment_daily_target_config — 실행2 Daily Target(2:1) ──────────────────
-- 1등=꼴등 2배(top=bottom*2) DB CHECK 강제(W3 앱+DB 이중). 중간 등수는 app 이 선형 보간.
CREATE TABLE IF NOT EXISTS assignment_daily_target_config (
  clinic_id          UUID PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  top_rank_target    INTEGER NOT NULL CHECK (top_rank_target    > 0),
  bottom_rank_target INTEGER NOT NULL CHECK (bottom_rank_target > 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID REFERENCES auth.users(id),
  -- 2:1 고정비 — 1등 목표 = 꼴등 목표의 정확히 2배(현장 확정, W3).
  CONSTRAINT assignment_daily_target_ratio_2to1 CHECK (top_rank_target = bottom_rank_target * 2)
);
COMMENT ON TABLE assignment_daily_target_config IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행2: Daily Target 고정건수(1등=꼴등 2배=2:1, CHECK 강제). 중간 등수는 app 선형 보간. 잔여건은 다음 등수 순서 배정.';

-- ── (5) assignment_leadsource_policy — 실행2 LeadSource별 전략 ─────────────────────
-- lead_source(TM|INBOUND|WALK_IN) 별 전략: daily_target(Daily Target 미달 우선) | ranking_pointer(랭킹 포인터 순환).
-- 행 부재 = 기존 월균등 엔진 유지(회귀0, opt-in). 현장 확정: TM→daily_target / INBOUND·WALK_IN→ranking_pointer.
CREATE TABLE IF NOT EXISTS assignment_leadsource_policy (
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  lead_source TEXT NOT NULL CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN')),
  strategy    TEXT NOT NULL CHECK (strategy IN ('daily_target', 'ranking_pointer')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id),
  PRIMARY KEY (clinic_id, lead_source)
);
COMMENT ON TABLE assignment_leadsource_policy IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행2: 유입경로(TM/INBOUND/WALK_IN)별 배정전략. daily_target=Daily Target 미달 우선 / ranking_pointer=랭킹 포인터 순환(라운드로빈 금지). 행 부재=기존 월균등 유지.';

-- ── (6) assignment_pointer_state — 실행2 랭킹 포인터 커서 ──────────────────────────
-- cursor_rank = 다음 배정 시작 랭킹 인덱스(0-base). ★배정건수 저장 금지(일일건수는 assignment_actions 파생 SSOT).
-- reset_date = 커서 리셋 기준일(KST). app 이 read 시 reset_date≠today 면 cursor←0 lazy 리셋(무-잡).
CREATE TABLE IF NOT EXISTS assignment_pointer_state (
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  lead_source TEXT NOT NULL CHECK (lead_source IN ('TM', 'INBOUND', 'WALK_IN')),
  cursor_rank INTEGER NOT NULL DEFAULT 0 CHECK (cursor_rank >= 0),
  reset_date  DATE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, lead_source)
);
COMMENT ON TABLE assignment_pointer_state IS
  'T-20260726-foot-CRM-ASSIGN-V1 실행2: 랭킹 포인터 순환 커서(0-base rank index). cursor_rank≠배정건수(일일건수=assignment_actions 파생). reset_date≠today(KST) 시 app lazy 리셋.';

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- 설정 3종(weights/daily_target/leadsource_policy): SELECT=clinic active+approved, write=admin/manager (staff_attendance 동형).
-- pointer_state: 배정 엔진이 매 INBOUND/WALK_IN 배정마다 mutate → FOR ALL clinic-scoped(assignment_actions 동형).

ALTER TABLE assignment_ranking_weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arw_select ON assignment_ranking_weights;
CREATE POLICY arw_select ON assignment_ranking_weights FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_ranking_weights.clinic_id AND active = true AND approved = true));
DROP POLICY IF EXISTS arw_write ON assignment_ranking_weights;
CREATE POLICY arw_write ON assignment_ranking_weights FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_ranking_weights.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager'))) WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_ranking_weights.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager')));

ALTER TABLE assignment_daily_target_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS adtc_select ON assignment_daily_target_config;
CREATE POLICY adtc_select ON assignment_daily_target_config FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_daily_target_config.clinic_id AND active = true AND approved = true));
DROP POLICY IF EXISTS adtc_write ON assignment_daily_target_config;
CREATE POLICY adtc_write ON assignment_daily_target_config FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_daily_target_config.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager'))) WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_daily_target_config.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager')));

ALTER TABLE assignment_leadsource_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alp_select ON assignment_leadsource_policy;
CREATE POLICY alp_select ON assignment_leadsource_policy FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_leadsource_policy.clinic_id AND active = true AND approved = true));
DROP POLICY IF EXISTS alp_write ON assignment_leadsource_policy;
CREATE POLICY alp_write ON assignment_leadsource_policy FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_leadsource_policy.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager'))) WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid()
            AND clinic_id = assignment_leadsource_policy.clinic_id AND active = true AND approved = true
            AND role IN ('admin', 'manager')));

ALTER TABLE assignment_pointer_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aps_all ON assignment_pointer_state;
CREATE POLICY aps_all ON assignment_pointer_state FOR ALL USING (
  clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid())
) WITH CHECK (
  clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id = auth.uid()));

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT column_name FROM information_schema.columns WHERE table_name='staff' AND column_name IN ('auto_assign_enabled','slack_user_id');
--   SELECT table_name FROM information_schema.tables WHERE table_name IN ('assignment_ranking_weights','assignment_daily_target_config','assignment_leadsource_policy','assignment_pointer_state');
--   SELECT conname FROM pg_constraint WHERE conname='assignment_daily_target_ratio_2to1';
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'assignment_%' ORDER BY tablename;
