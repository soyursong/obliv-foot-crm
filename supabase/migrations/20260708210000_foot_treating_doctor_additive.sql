-- T-20260708-foot-TREATING-DOCTOR-SELECT-SYNC
-- 진료의 동선 배정(treating_doctor) 가변 축 + duty_roster canonical 조인 브릿지 — 전량 ADDITIVE
--
-- DA CONSULT-REPLY GO_ADDITIVE (DA-20260708-foot-TREATING-DOCTOR-SELECT-SYNC + ADDENDUM).
--   · grain 실측(dev-foot, 2026-07-08) = check_ins. 진료콜 명단(DoctorCallListBar←Dashboard.fetchCheckIns)
--     + 진료환자이력 탭(DoctorHistorySection)이 둘 다 check_ins를 row 앵커로 조회. visits 테이블 prod 부재(REST 404).
--     → treating_doctor_id는 check_ins 단일 grain에만(single-field-share로 AC3 실시간 연동 자동충족, 중복컬럼 0).
--   · FK = clinic_doctors(id) (staff(id) 반려 — §2-5 signing_doctor_id·서류 발행자와 동일 엔티티라야 값 정렬).
--   · clinic_doctors.staff_id = duty_roster.doctor_id(→staff) canonical 조인 브릿지(이름조인 useDutyRoster 폐기 경로).
--     addendum: clinic_doctors.staff_id 컬럼은 prod에 부재하여 신규 신설. duty_roster.doctor_id = clinic_doctors.id
--     직접조인은 다른 엔티티 공간 = 항상 공집합이라 금지.
--
-- 전량 ADDITIVE: nullable FK 2개. backfill 금지·레거시 NULL 허용. NOT NULL 강제·파괴변경·데이터유실 0.
-- 축 경계: treating_doctor(가변 라이브) ≠ signing_doctor(medical_charts, §2-5 불변 서명) — 커플링/자동덮어쓰기 금지.
-- 멱등: ADD COLUMN IF NOT EXISTS. 재실행 안전.

-- 1) check_ins.treating_doctor_id — 가변 라이브 진료의 배정(단일 grain, A/B single-field-share)
ALTER TABLE check_ins
  ADD COLUMN IF NOT EXISTS treating_doctor_id uuid
  REFERENCES clinic_doctors(id) ON DELETE SET NULL;

COMMENT ON COLUMN check_ins.treating_doctor_id IS
  'T-20260708 treating_doctor(가변 라이브 진료의 배정). 진료콜 명단·진료환자이력 탭 공통 grain(single-field-share). FK clinic_doctors(id) ON DELETE SET NULL. signing_doctor(medical_charts §2-5)와 별 축 — 커플링 금지. NULL=레거시/미선택 허용.';

-- 2) clinic_doctors.staff_id — clinic_doctors → staff canonical 브릿지(duty_roster 근무판정 조인 키)
ALTER TABLE clinic_doctors
  ADD COLUMN IF NOT EXISTS staff_id uuid
  REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN clinic_doctors.staff_id IS
  'T-20260708 clinic_doctors→staff canonical 브릿지. duty_roster.doctor_id(→staff)와 조인해 당일 근무/휴무 판정. NULL=미연결(근무판정 skip → disabled 아님·enabled+advisory, over-disable 방지). 이름조인(useDutyRoster) 대체.';

-- 원장 기록 (schema_migrations ledger — 재실행 시 충돌 무시)
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260708210000', 'foot_treating_doctor_additive')
ON CONFLICT (version) DO NOTHING;
