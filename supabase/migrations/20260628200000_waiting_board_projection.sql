-- T-20260628-foot-WAITING-REALTIME — Realtime 현황판 sanitized projection (옵션 a 확정)
-- SSOT: cross_crm_data_contract.md §16-3a (DA CONSULT-REPLY MSG-20260628-203318-lz5d).
-- foot=레퍼런스, body/derm/scalp 포크 동일·divergence 금지.
--
-- 목적: 공개 대기현황판(Waiting.tsx)의 anon check_ins 직접 SELECT + postgres_changes
--   Realtime 의존을, zero-PII sanitized projection 테이블(waiting_board)로 대체한다.
--   마스킹은 서버측 sync 트리거(SECURITY DEFINER) 내부에서 1회 적용 → base PII 가
--   projection 에 물리적으로 미착지(=감사는 projection 컬럼 introspection 만으로 종결).
--
-- ★ 순수 ADDITIVE: 신규 테이블 + 트리거 + RLS + publication. base check_ins 구조 무접촉.
--   check_ins anon REVOKE 는 본 마이그에 포함하지 않는다(§16-3a base REVOKE = projection
--   라이브 + FE 전환 + 동기검증 확정 후 parent 2b sub-gate #2 에서 batch). 무대체 삭제 금지(§16-7).
-- ★ supervisor DDL-diff DB-GATE 필수(check_ins = PHI 인접 테이블 DDL, INVARIANT §16-4b.2/16-7).
--   대표 게이트는 면제(autonomy §3.1 ADDITIVE = anon 노출 축소·PHI 컬럼 무접촉·롤백 SQL 제공).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 성함 마스킹 함수 (§16-3a codify — AC2 "현황판 PII 노출 0" 판정 근거)
--    grapheme(글자수) 기준: len1 그대로 / len2 첫+* / len3 첫+*+끝 / len4+ 첫+(*×(len-2))+끝
--    char_length() = 문자(코드포인트) 수 → 한글·영문 동일 규칙. 마스킹 산출만 적재.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mask_display_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v text := btrim(coalesce(p_name, ''));
  n int;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  n := char_length(v);
  IF n = 1 THEN
    RETURN v;
  ELSIF n = 2 THEN
    RETURN left(v, 1) || '*';
  ELSIF n = 3 THEN
    RETURN left(v, 1) || '*' || right(v, 1);
  ELSE
    RETURN left(v, 1) || repeat('*', n - 2) || right(v, 1);
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) waiting_board — anon-facing sanitized projection (zero-PII)
--    노출 컬럼 = board-needed zero-PII 만. phone·실명(full)·legal_name·RRN·DOB·주소·
--    email·차트번호 컬럼 자체를 두지 않는다(존재 0 = 노출 0, AC2 판정 근거).
--    id = check_ins.id 를 opaque surrogate 로 재사용(Realtime/React key, customer/PII UUID 아님).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.waiting_board (
  id            uuid PRIMARY KEY,                 -- opaque surrogate (= check_ins.id)
  clinic_id     uuid NOT NULL,                    -- 테넌트 스코프 (FE clinic_id param 으로 쿼리)
  queue_number  integer,                          -- 대기번호
  room          text,                             -- 현재 status 대응 방 라벨 (값만, 라벨 prefix 는 FE)
  status        text NOT NULL,                    -- §4-7 canonical enum
  display_name  text,                             -- 마스킹 성함 (DB 에서 마스킹된 값만 적재)
  checked_in_at timestamptz,                      -- 경과시간 표시용 (비-PII)
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waiting_board_clinic_queue
  ON public.waiting_board (clinic_id, queue_number);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) sync 트리거 함수 — check_ins AFTER INSERT/UPDATE/DELETE → waiting_board upsert/delete
--    SECURITY DEFINER + search_path 고정. 활성 대기/진행 status 만 투영(terminal 제외).
--    INVARIANT(§16-4b.2/16-7): sync 실패가 check_ins 본체 쓰기를 break 하지 않게 EXCEPTION 격리.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_waiting_board()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.waiting_board WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- terminal(done/cancelled/checklist[deprecated]) 로 전이 → 보드에서 제거(현재 큐만 유지)
  IF NEW.status IN ('done', 'cancelled', 'checklist') THEN
    DELETE FROM public.waiting_board WHERE id = NEW.id;
    RETURN NEW;
  END IF;

  -- 현재 status 에 대응하는 방 값만 투영(roomGuidance 와 동일 매핑, prefix 는 FE)
  v_room := CASE
    WHEN NEW.status IN ('examination', 'exam_waiting')      THEN NEW.examination_room
    WHEN NEW.status IN ('consultation', 'consult_waiting')  THEN NEW.consultation_room
    WHEN NEW.status IN ('preconditioning', 'treatment_waiting') THEN NEW.treatment_room
    WHEN NEW.status = 'laser'                                THEN NEW.laser_room
    ELSE NULL
  END;

  INSERT INTO public.waiting_board
    (id, clinic_id, queue_number, room, status, display_name, checked_in_at, updated_at)
  VALUES
    (NEW.id, NEW.clinic_id, NEW.queue_number, v_room, NEW.status,
     public.mask_display_name(NEW.customer_name), NEW.checked_in_at, now())
  ON CONFLICT (id) DO UPDATE SET
    clinic_id     = EXCLUDED.clinic_id,
    queue_number  = EXCLUDED.queue_number,
    room          = EXCLUDED.room,
    status        = EXCLUDED.status,
    display_name  = EXCLUDED.display_name,
    checked_in_at = EXCLUDED.checked_in_at,
    updated_at    = now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 동기화 실패가 진료 동선(check_ins 쓰기)을 막지 않게 격리. 보드는 다음 이벤트에 수렴.
    RAISE WARNING 'sync_waiting_board 실패(무시): %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_waiting_board ON public.check_ins;
CREATE TRIGGER trg_sync_waiting_board
  AFTER INSERT OR UPDATE OR DELETE ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.sync_waiting_board();

-- ─────────────────────────────────────────────────────────────────────────
-- 4) RLS — projection 이 zero-PII 이므로 anon SELECT USING(true) 정당(§16-3a).
--    base check_ins 는 §16 clinic 격리 + anon REVOKE 그대로 유지(본 마이그 무접촉).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.waiting_board ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waiting_board_select ON public.waiting_board;
CREATE POLICY waiting_board_select
  ON public.waiting_board
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.waiting_board TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Realtime publication — REPLICA IDENTITY DEFAULT(PK 존재 → DELETE 는 PK 로 충분)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.waiting_board REPLICA IDENTITY DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'waiting_board'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.waiting_board;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) backfill — 현재 활성 check_ins 를 보드에 즉시 투영(초기 로드 스냅샷 즉시 가용)
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.waiting_board
  (id, clinic_id, queue_number, room, status, display_name, checked_in_at, updated_at)
SELECT
  c.id,
  c.clinic_id,
  c.queue_number,
  CASE
    WHEN c.status IN ('examination', 'exam_waiting')      THEN c.examination_room
    WHEN c.status IN ('consultation', 'consult_waiting')  THEN c.consultation_room
    WHEN c.status IN ('preconditioning', 'treatment_waiting') THEN c.treatment_room
    WHEN c.status = 'laser'                                THEN c.laser_room
    ELSE NULL
  END,
  c.status,
  public.mask_display_name(c.customer_name),
  c.checked_in_at,
  now()
FROM public.check_ins c
WHERE c.status NOT IN ('done', 'cancelled', 'checklist')
ON CONFLICT (id) DO UPDATE SET
  clinic_id     = EXCLUDED.clinic_id,
  queue_number  = EXCLUDED.queue_number,
  room          = EXCLUDED.room,
  status        = EXCLUDED.status,
  display_name  = EXCLUDED.display_name,
  checked_in_at = EXCLUDED.checked_in_at,
  updated_at    = now();

COMMIT;
