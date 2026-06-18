-- staff_attendance — 일자별 직원 출근 SSOT (신설, ADDITIVE)
-- T-20260618-foot-STAFF-ATTENDANCE-SSOT-CRM
--
-- ── 범위 ──
--   data-architect CONSULT-REPLY (MSG-20260618-173142-dajh) 판정:
--     Q1 = S2(staff_attendance 신설) GO · S1(duty_roster 재사용) NO_GO.
--     Q2 = 단일 sync EF로 통합 GO (본 마이그는 테이블만; sync EF·read 전환은 별도 게이트).
--   배정화면 '출근 N명' + AUTOASSIGN-SERVERSIDE 옵션 B/C trigger 가 동일 테이블을 read 하는
--   단일 출근 SSOT. duty_roster(원장 고용 roster_type)와 의미축이 달라 재사용 불가(semantic overload 방지).
--
-- ── 모델 (DA 권고 컬럼 반영) ──
--   clinic_id  — foot=단일클리닉이나 cross-CRM parity·계약 일관성 위해 유지.
--   date       — 출근 일자(grain).
--   staff_id   — FK→staff(id). 자유텍스트 금지(시트 직원명→staff_id 매핑은 sync EF의 결정적 책임).
--   source     — 동기 출처(google_sheet|manual|crm), CHECK 강제.
--   synced_at  — 마지막 동기 시각(freshness 모니터 기준).
--   status     — 'present'(출근, 기본)|'off'(휴무)|'leave'(연차). 출근 N명 = WHERE status='present' 카운트.
--                휴무 명시 기록이 필요한 현장 결정에 대비한 1급 컬럼. 단순 카운트는 status='present' 행 존재로 충분.
--
-- UNIQUE(clinic_id, date, staff_id) — 일/직원당 1행(중복 sync 멱등).
--
-- 멱등(idempotent): CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS 후 재생성.
-- 파괴적 변경·RENAME·기존 테이블 접촉 0. 순수 ADDITIVE → 대표 게이트 면제(autonomy §3.1).
-- Rollback: 20260618200000_staff_attendance_ssot.rollback.sql
-- dry-run: scripts/T-20260618-foot-STAFF-ATTENDANCE-SSOT_dryrun.mjs (READ-ONLY + TX ROLLBACK)
-- 운영 적용: dev-foot 직접 pg 적용(메모리 'dev-foot DB 마이그레이션 직접 실행') + supervisor DDL-diff QA 게이트.

BEGIN;

CREATE TABLE IF NOT EXISTS staff_attendance (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID        NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  date        DATE        NOT NULL,
  staff_id    UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  source      TEXT        NOT NULL DEFAULT 'google_sheet'
                          CHECK (source IN ('google_sheet', 'manual', 'crm')),
  status      TEXT        NOT NULL DEFAULT 'present'
                          CHECK (status IN ('present', 'off', 'leave')),
  synced_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (clinic_id, date, staff_id)
);

-- '출근 N명' / 배정 후보 풀 조회(일자별 clinic-scoped) 인덱스
CREATE INDEX IF NOT EXISTS staff_attendance_clinic_date_idx
  ON staff_attendance(clinic_id, date);

COMMENT ON TABLE staff_attendance IS
  'T-20260618-foot-STAFF-ATTENDANCE-SSOT: 일자별 직원 출근 정본(SSOT). 배정화면 ''출근 N명''(status=present 카운트) + AUTOASSIGN-SERVERSIDE 옵션 B/C trigger 가 read 하는 단일 출근 원천. duty_roster(원장 고용 roster_type, T-20260502)와 의미축 분리. 적재=단일 sheet→table sync EF(별 게이트). UNIQUE(clinic_id,date,staff_id)로 멱등.';
COMMENT ON COLUMN staff_attendance.staff_id IS '출근 직원 FK→staff(id). 시트 직원명→staff_id 결정적 매핑은 sync EF 책임(자유텍스트 금지).';
COMMENT ON COLUMN staff_attendance.source IS '동기 출처: google_sheet(자동 sync) | manual(현장 수기) | crm.';
COMMENT ON COLUMN staff_attendance.status IS 'present(출근,기본) | off(휴무) | leave(연차). 출근 N명 = status=present 카운트.';
COMMENT ON COLUMN staff_attendance.synced_at IS '마지막 sync 시각. freshness/stale 모니터 기준(미가동 시 stale 회귀 알람).';

-- RLS — duty_roster(가장 가까운 의미 형제) 동형: select=clinic 전체 active+approved, write=admin/manager.
-- sync EF 는 service_role 로 동작 → RLS bypass(자동 적재). 수기 입력은 admin/manager 게이트.
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_attendance_select ON staff_attendance;
CREATE POLICY staff_attendance_select ON staff_attendance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = staff_attendance.clinic_id
        AND active    = true
        AND approved  = true
    )
  );

DROP POLICY IF EXISTS staff_attendance_insert ON staff_attendance;
CREATE POLICY staff_attendance_insert ON staff_attendance
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = staff_attendance.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS staff_attendance_update ON staff_attendance;
CREATE POLICY staff_attendance_update ON staff_attendance
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = staff_attendance.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS staff_attendance_delete ON staff_attendance;
CREATE POLICY staff_attendance_delete ON staff_attendance
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id        = auth.uid()
        AND clinic_id = staff_attendance.clinic_id
        AND active    = true
        AND approved  = true
        AND role      IN ('admin', 'manager')
    )
  );

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인용):
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name='staff_attendance' ORDER BY ordinal_position;
--   SELECT policyname, cmd FROM pg_policies WHERE tablename='staff_attendance';
--   SELECT indexname FROM pg_indexes WHERE tablename='staff_attendance';
