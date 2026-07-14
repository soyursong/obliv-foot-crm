-- T-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME
-- Part A (receive) — ADDITIVE only. 도파민→풋 '내원콜 방문확인' push 착지 canonical 저장 컬럼.
-- DA CONSULT-REPLY DA-20260714-dopamine-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME (GO_WARN, supervisor DDL-diff only, PHI 아님).
--
-- 계약(DA Q2): canonical governed enum `reachable`/`absent` 저장(T-20260703 선례 = 롱레 reservations.visit_call_result 미러).
--   '내원예정'/'부재'는 FE 표시라벨 매핑(DB 저장 아님). nullable ADD + named CHECK → contract_optional 재사용, divergence 방지.
--   key = crm_reservation_id(풋 예약 바인딩), 충돌해소 = result_at LWW, 멱등 = event_id(수신부에서 판정).
--
-- introspection 결과(2026-07-15): 풋 reservations 에 visit_call* 동명 컬럼 부재(중복 없음),
--   기존 '내원콜 방문확인'('방문예정'/'방문안함')은 reservation_memo_history 자유텍스트('[방문확인] ...')로만 저장
--   → CHECK/enum 한글 리터럴 없음 = rename 분기 A(FE-only, 비파괴). 본 마이그는 receive canonical 저장만 신설.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS visit_call_result text,
  ADD COLUMN IF NOT EXISTS visit_call_result_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_call_result_event_id text;

COMMENT ON COLUMN public.reservations.visit_call_result IS
  '도파민TM 내원콜 방문확인 canonical 결과. reachable(FE:내원예정)/absent(FE:부재). 도파민→풋 push write, 풋 read-only. T-20260714-FOOT-PREVCALL-VISITCONFIRM-SYNC-RENAME';
COMMENT ON COLUMN public.reservations.visit_call_result_at IS
  '내원콜 방문확인 결과 확정 시각(도파민 result_at). 충돌해소 LWW 기준.';
COMMENT ON COLUMN public.reservations.visit_call_result_event_id IS
  '수신 멱등 키(도파민 결정적 event_id). 동일 event_id 재수신 시 skip.';

-- canonical governed enum 강제 (제3의 값 신설 금지 — reachable/absent 만)
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_visit_call_result_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_visit_call_result_check
  CHECK (visit_call_result IS NULL OR visit_call_result = ANY (ARRAY['reachable'::text, 'absent'::text]));

-- 멱등 판정 인덱스 (동일 event_id 재수신 lookup)
CREATE INDEX IF NOT EXISTS idx_reservations_visit_call_event_id
  ON public.reservations (visit_call_result_event_id)
  WHERE visit_call_result_event_id IS NOT NULL;
