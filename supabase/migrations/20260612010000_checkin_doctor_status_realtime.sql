-- T-20260611-foot-DOCTORCALL-SORT-INTREATMENT-BADGE WS-2
-- "진료 중" 실시간 표시(방법B) — 원장이 명단 행을 '진료 중'으로 전환하면 직원/간호사 화면에
--   supabase realtime로 "🟢 진료 중 [환자명]" 뱃지가 실시간 표시되고, 진료콜 명단 최상단에 고정.
--
-- ⚠️⚠️ DRAFT — prod 적용 보류. supervisor DB 게이트 경유 + data-architect CONSULT 선행 필수.
--      (agent_collaboration_rules §S2.4 데이터 정책 자문 게이트: 신규 컬럼 추가 = CONSULT 미선행 시 적용 금지.)
--      rollback: 20260612010000_checkin_doctor_status_realtime.rollback.sql
--
-- 설계 원칙:
--   · 신규 테이블 없음 — check_ins 에 컬럼 2개 가산(additive). 기존 status/status_flag 상태머신 미변경.
--     doctor_status 는 "진료실 안에서 원장이 실제로 보는 중" 신호로, status_flag(콜대상 색)와 직교한다.
--     (status_flag purple/pink = 콜/완료 큐 상태 / doctor_status = 진료 세션 진행 표지.)
--   · CHECK constraint 허용값을 컬럼 추가와 동시에 정의(티켓 요구). NULL 허용 = 진료중 아님/해당없음.
--   · doctor_started_at: '진료중' 전환 시각(완료 전환·정렬 보조). started_at 단독 명명은 타 테이블과
--     혼동 → check_ins 네임스페이스에 doctor_ prefix 부여(doctor_ack_at/doctor_call_memo 패턴 일관).
--   · realtime: check_ins 는 이미 DoctorCallListBar/Dashboard 에서 postgres_changes 구독 중 →
--     컬럼 UPDATE 가 그대로 브로드캐스트(신규 publication/패키지 불필요). FE 는 컬럼 read 만 추가.

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS doctor_status     text,
  ADD COLUMN IF NOT EXISTS doctor_started_at timestamptz;

-- 허용값 동시 정의(티켓): 진료중 | 완료 | NULL(미시작/해당없음). 멱등 — 이미 있으면 skip.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_ins_doctor_status_chk'
  ) THEN
    ALTER TABLE public.check_ins
      ADD CONSTRAINT check_ins_doctor_status_chk
      CHECK (doctor_status IS NULL OR doctor_status IN ('진료중', '완료'));
  END IF;
END$$;

COMMENT ON COLUMN public.check_ins.doctor_status IS
  'T-20260611 WS-2 진료 세션 표지: 진료중|완료|NULL. status_flag(콜 큐 색)와 직교. 원장이 명단 행에서 전환.';
COMMENT ON COLUMN public.check_ins.doctor_started_at IS
  'T-20260611 WS-2 doctor_status=진료중 전환 시각. 직원 realtime 뱃지·진료중 최상단 고정 정렬 보조.';
