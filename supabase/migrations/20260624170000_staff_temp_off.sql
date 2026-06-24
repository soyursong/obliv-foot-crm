-- ============================================================
-- T-20260624-foot-ASSIGN-STAFF-TEMP-OFF
-- 배정화면 직원 '임시 off' — 출근 유지(녹색 동그라미 유지)하되 자동배정 후보풀에서 잠시 제외
-- ============================================================
-- reporter 김주연 총괄: "녹색 동그라미 옆 임시 off 버튼 — 담당자가 화장실/자리비움 등으로 자동배정에서 잠시 제외".
--
-- DA CONSULT-REPLY 조건부 GO (DA-20260624-FOOT-STAFF-TEMP-OFF, MSG-20260624-165216-1lpf):
--   ADDITIVE 순수신설·PHI 비포함·파괴변경 0·cross-CRM blast 0(foot-local) → 대표게이트 면제, supervisor DDL-diff만.
--   body daily_room_inactive 와 동형 패턴 = "time-scoped daily exclusion"(부모엔티티 + work_date PK +
--   '오늘 row 존재?' 판정 + 익일 0시 자연복귀, cron 불요).
--
-- ★ '임시 off'(본 테이블) ≠ '휴무/연차(off/leave)'. 후자는 staff_attendance SSOT enum 영역(T-20260618 blocked).
--   본 테이블은 완전 독립 신설 — 출근 동그라미(workingIds=구글시트 read)는 건드리지 않는다.
--
-- 정련 반영:
--   ① KST 캐스트: work_date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date — UTC 자정 drift 방어.
--      앱측 upsert/판정도 KST date(todaySeoulISODate())로 산출.
--   ② PK = (staff_id, work_date). staff_id(uuid) 전역유니크 → clinic_id 는 PK 유일성에 redundant.
--      denorm clinic_id 컬럼 제거 → 부모(staff) FK 경유 격리(계약 §16-2 join-via-parent, staff 지점이동 drift 회피).
--   ③ created_by → auth.users(id) (foot patient_past_history.confirmed_by 와 동형).
--
-- row 존재 = 오늘 임시제외, delete = 복귀. 익일 0시(KST) work_date 경계로 자연복귀(별도 cron/배치 불요).
-- 롤백: 20260624170000_staff_temp_off.rollback.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS staff_temp_off (
  staff_id    uuid        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date   date        NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, work_date)
);

COMMENT ON TABLE staff_temp_off IS
  '배정 임시제외(time-scoped daily exclusion). row 존재=해당 work_date(KST) 자동배정 후보풀 제외, delete=복귀. '
  '출근(staff_attendance)·휴무와 무관한 독립 transient 마커. 익일 work_date 경계로 자연복귀(cron 불요). '
  '격리=부모 staff FK 경유(계약 §16-2 join-via-parent). (T-20260624-foot-ASSIGN-STAFF-TEMP-OFF)';

-- 오늘(KST) 제외 셋 조회 가속 (work_date 선두 → 날짜 스캔)
CREATE INDEX IF NOT EXISTS idx_staff_temp_off_workdate ON staff_temp_off(work_date);

ALTER TABLE staff_temp_off ENABLE ROW LEVEL SECURITY;

-- 계약 §16-2 canonical: 부모 staff 경유 clinic 격리 + 승인 사용자.
--   전제: ① 부모 staff §16 격리 완료(신뢰조인) ② staff_id 인덱스(PK 선두 = 자동 충족) ③ orphan 0(FK CASCADE).
CREATE POLICY "approved_clinic_staff_temp_off_all" ON staff_temp_off
  FOR ALL TO authenticated
  USING (
    is_approved_user()
    AND EXISTS (
      SELECT 1 FROM staff s
       WHERE s.id = staff_temp_off.staff_id
         AND s.clinic_id = current_user_clinic_id()
    )
  )
  WITH CHECK (
    is_approved_user()
    AND EXISTS (
      SELECT 1 FROM staff s
       WHERE s.id = staff_temp_off.staff_id
         AND s.clinic_id = current_user_clinic_id()
    )
  );

-- ── 검증 ──
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='staff_temp_off'
  ) THEN RAISE EXCEPTION 'staff_temp_off 테이블 생성 실패'; END IF;

  -- denorm clinic_id 컬럼이 없어야 함(join-via-parent 격리)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff_temp_off' AND column_name='clinic_id'
  ) THEN RAISE EXCEPTION 'staff_temp_off 에 denorm clinic_id 컬럼이 존재(정련② join-via-parent 위반)'; END IF;

  -- RLS 활성 확인
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='staff_temp_off' AND c.relrowsecurity=true
  ) THEN RAISE EXCEPTION 'staff_temp_off RLS 미활성'; END IF;

  RAISE NOTICE 'T-20260624-foot-ASSIGN-STAFF-TEMP-OFF: staff_temp_off 테이블+RLS+인덱스 검증 통과';
END
$verify$;

COMMIT;
