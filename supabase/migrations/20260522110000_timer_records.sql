-- T-20260522-foot-LASER-TIMER AC-4: timer_records 신규 테이블
-- 비가열 레이저 타이머 기록. 기존 테이블 무변경.
-- GO_WARN: DB 신규 테이블 (기존 테이블 무변경)

CREATE TABLE public.timer_records (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  check_in_id   uuid        NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,
  clinic_id     text        NOT NULL,
  duration_minutes int      NOT NULL CHECK (duration_minutes IN (5, 15, 20)),
  started_at    timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NOT NULL,
  stopped_at    timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 인덱스: check_in_id 조회 (활성 타이머 로드)
CREATE INDEX idx_timer_records_check_in_id ON public.timer_records (check_in_id);
-- 인덱스: clinic_id + stopped_at IS NULL (대시보드 활성 타이머 로드)
CREATE INDEX idx_timer_records_clinic_active ON public.timer_records (clinic_id, stopped_at) WHERE stopped_at IS NULL;

-- RLS
ALTER TABLE public.timer_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "timer_records_authenticated_select"
  ON public.timer_records FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "timer_records_authenticated_insert"
  ON public.timer_records FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "timer_records_authenticated_update"
  ON public.timer_records FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
