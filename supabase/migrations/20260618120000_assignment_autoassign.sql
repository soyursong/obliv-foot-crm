-- T-20260617-foot-AUTOASSIGN-BALANCE-TOSS — 상담/치료 자동배정·균등분배·토스(handoff)·당김(pull)
--
-- ── 범위 ──
--   data-architect CONSULT-REPLY GO(조건부) MSG-20260617-172721-dfd8 의 ADDITIVE 4항목 중 코어 2건 적재:
--     #1 customers.assigned_consultant_id (담당 실장 FK)           → 순수 ADDITIVE GO
--     #2 assignment_actions (신규 audit 테이블)                    → 순수 ADDITIVE GO
--   #3 재진 축 = customers.visit_type='returning'(기존 컬럼) 재사용 → 신규 컬럼 0
--   #4 치료유형 축 = package_sessions.session_type(기존) 재사용     → 신규 enum 0
--   #6 배정 결과 = check_ins.consultant_id/therapist_id(기존 UUID FK)→ 신규 컬럼 0
--   ※ #5 출근 캘린더 일반화/추가출근(ad-hoc) = GO_WARN, 본 마이그 제외(DA supplement 회신 후 별도 sub-task).
--      당일 출근 후보 풀은 기존 [직원 근무 캘린더] 구글시트 read(lib/dutySheet.ts)로 클라이언트에서 해소(o2k7 ③ 확정).
--
-- ── 카운터 정책(o2k7/DA dfd8 #2) ──
--   토스 N건·당김 N건·월 균등 카운트는 별도 카운터 컬럼 신설 금지 → assignment_actions count(*) 집계가 단일 SSOT.
--
-- 멱등(idempotent): ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS 후 재생성.
-- 파괴적 변경·RENAME·cross-product 충돌 0. 권한 축소 회귀 0.
-- Rollback: 20260618120000_assignment_autoassign.rollback.sql
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff QA 게이트.

BEGIN;

-- ── #1 담당 실장(지정 상담사) FK — customers ADDITIVE ────────────────────────────
-- designated_therapist_id(T-20260522, 지정 치료사)와 동형. 상담사축 분리이므로 재사용 불가(별도 컬럼).
-- NULL = 균등 fallback. ON DELETE SET NULL (직원 삭제 시 배정만 해제, 고객 row 보존).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_consultant_id UUID REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.assigned_consultant_id IS
  'T-20260617-foot-AUTOASSIGN: 담당 실장(지정 상담사) FK→staff(id). 자동배정 시 designated_therapist_id(치료) 와 동형으로 0순위 우선. NULL이면 월 균등 fallback.';

-- ── #2 assignment_actions — 자동배정/토스/당김/수동 audit (append-only SSOT) ──────
CREATE TABLE IF NOT EXISTS assignment_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- 앵커 = check_in (DA dfd8 #2: 배정 현재상태=check_ins / 이력=assignment_actions clean separation)
  check_in_id   UUID REFERENCES check_ins(id) ON DELETE CASCADE,
  -- auto_assign(자동) | toss(재배정·push) | pull_in(당김·pull) | manual(수동 override)
  action_type   TEXT NOT NULL CHECK (action_type IN ('auto_assign', 'toss', 'pull_in', 'manual')),
  -- consult(상담사 축) | therapy(치료사 축)
  role          TEXT NOT NULL CHECK (role IN ('consult', 'therapy')),
  -- 분류 축 스냅샷: 상담=TM|인바운드|워크인|재진(returning) / 치료=본치료|포돌로게|체험 (TEXT, 집계 그룹키)
  axis          TEXT,
  from_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,  -- 토스 넘긴 사람 / 재배정 이전 담당
  to_staff_id   UUID REFERENCES staff(id) ON DELETE SET NULL,  -- 배정/당김/토스 받은 사람
  reason        TEXT,                                          -- 토스 사유(toss 시 NOT NULL 강제 — FE 게이트, 시나리오4)
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 월 균등 카운트(역할·축·to_staff 별, KST 월) 집계용
CREATE INDEX IF NOT EXISTS idx_assignment_actions_balance
  ON assignment_actions(clinic_id, role, to_staff_id, ((created_at AT TIME ZONE 'Asia/Seoul')::date));
-- 토스/당김 카운터(from/to 별, 월) 집계용
CREATE INDEX IF NOT EXISTS idx_assignment_actions_from
  ON assignment_actions(clinic_id, from_staff_id, action_type);
-- check_in 별 현재 배정 추적(멱등 가드: auto_assign 중복 방지)
CREATE INDEX IF NOT EXISTS idx_assignment_actions_checkin
  ON assignment_actions(check_in_id, role, created_at);

COMMENT ON TABLE assignment_actions IS
  'T-20260617-foot-AUTOASSIGN: 상담/치료 자동배정·토스(push)·당김(pull)·수동 배정의 append-only audit SSOT. 월 균등 카운트·토스 N건·당김 N건 전부 본 테이블 count(*) 파생(별도 카운터 컬럼 금지, DA dfd8 #2). 앵커=check_in_id.';

-- RLS — check_in_room_logs 패턴 동형(clinic-scoped). FOR ALL USING = INSERT WITH CHECK 겸용.
ALTER TABLE assignment_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_actions_clinic_access ON assignment_actions;
-- user_profiles.id = auth.uid() (canonical, T-20260529 room_logs RLS fix 참조 — user_id 컬럼 비존재).
CREATE POLICY assignment_actions_clinic_access ON assignment_actions
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM user_profiles WHERE id = auth.uid()
    )
  );

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND column_name='assigned_consultant_id';
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='assignment_actions';
--   \d assignment_actions
