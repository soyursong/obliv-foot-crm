-- T-20260718-foot-DOCCALL-DOCTOR-SCHEDULE-WIRING
-- 진료콜 명단 원장 드롭다운 ↔ 근무표(duty_roster) 연동 — clinic_doctors.staff_id 브릿지 BACKFILL (DATA only, no DDL)
--
-- RC (dev-foot diagnose, 2026-07-18, 라이브 DB 실측):
--   · 근무/휴무 판정 read-join 로직·스키마는 T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC 에서 이미 배포됨
--     (useTreatingDoctorOptions: clinic_doctors.staff_id ↔ duty_roster.doctor_id(→staff) 조인).
--   · 그러나 clinic_doctors.staff_id 는 그 마이그(20260708210000)에서 "backfill 금지·레거시 NULL 허용"으로
--     신설만 되고 미채움 → foot 4원장(문지은/한동훈/김윤기/김상은) 전원 staff_id=NULL = unlinked
--     → 전원 enabled(over-disable 방지 폴백) → '휴무 자동 비활성'이 영원히 발동 안 함.
--     = 현장 김주연 총괄 보고 "휴무 반영 안 됨 / 매핑 연결 고리 미완성"의 근본원인.
--
-- FIX: 브릿지 컬럼(이미 존재)에 동일인 staff 계정 링크를 채운다 = DATA backfill. DDL 없음(신규 컬럼/테이블/enum 0).
--   → §S2.4 data-architect CONSULT 게이트(신규 스키마) 비대상. db_change=false 유지. Data-Correction backfill SOP 준수.
--
-- 매핑 근거(deterministic, 라이브 지문 교집합):
--   · 김주연 총괄 confirm: 진료콜 원장 = 근무표 동명 계정 동일인(문지은/한동훈/김윤기/김상은).
--   · 대상 staff = 같은 clinic + 같은 name + role='director' + active=true 인 유일행.
--   · ⚠ 한동훈은 staff 2행 존재(therapist/active=false + director/active=true). role='director' AND active
--     조건이 therapist/inactive 행을 배제 → duty_roster.doctor_id 가 실제로 쓰는 director 행과 일치(라이브 검증:
--     duty_roster foot clinic 의 doctor_id 4종 = 4원장의 director-active staff.id 와 정확히 일치).
--
-- 안전:
--   · ADD/DROP 없음. UPDATE only. staff_id IS NULL(미채움) 행만 채움 → 재실행 idempotent, 기존 링크 무변경.
--   · 매칭 유일(n=1)일 때만 set → 동명이인 director 다수면 skip(over-link 방지, NULL 유지 = enabled 안전측).
--   · roster 부재/변경돼도 무영향(read-side 판정은 런타임). 잘못 채워도 데이터 손상 없음(비파괴, SET NULL 폴백).
--   · 회귀(AC-5): 기존 원장 선택·저장·정렬(check_ins.treating_doctor_id write 경로)은 미접촉 — 활성/비활성 판정만 활성화.
--   · 롤백: 20260718120000_foot_clinic_doctor_staff_bridge_backfill.rollback.sql

BEGIN;

WITH candidate AS (
  SELECT
    cd.id AS cd_id,
    (SELECT s.id FROM staff s
       WHERE s.clinic_id = cd.clinic_id
         AND s.name = cd.name
         AND s.role = 'director'
         AND s.active = true
       LIMIT 1) AS matched_staff_id,
    (SELECT count(*) FROM staff s
       WHERE s.clinic_id = cd.clinic_id
         AND s.name = cd.name
         AND s.role = 'director'
         AND s.active = true) AS match_n
  FROM clinic_doctors cd
  WHERE cd.staff_id IS NULL
    AND cd.active = true
)
UPDATE clinic_doctors cd
SET staff_id = c.matched_staff_id
FROM candidate c
WHERE cd.id = c.cd_id
  AND c.match_n = 1                 -- 유일 매칭만(동명이인 director 다수 → skip, NULL 유지)
  AND c.matched_staff_id IS NOT NULL;

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260718120000', 'foot_clinic_doctor_staff_bridge_backfill')
ON CONFLICT (version) DO NOTHING;

COMMIT;
