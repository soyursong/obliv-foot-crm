-- T-20260629-foot-SERIAL-UNIQUE-HARDEN — 서류 연번호 동시발번 중복 차단 (ADDITIVE)
-- 페어: T-20260630-foot-SERIAL-RPC-FE-REWIRE (FE 발번 경로 FE-count → DB RPC 이전, 동일 릴리스 번들)
-- DA re-CONSULT GO: CONSULT-REPLY MSG-20260630-031213-s2cc (DA-20260630-FOOT-SERIAL-UNIQUE-2, 2026-06-30 03:12 KST)
--   = ADDITIVE 유지 + GO(조건부). 1차 l3a3('기존 serial 컬럼 UNIQUE' 전제) supersede — 본 회신이 게이트 근거.
--   4요소 surface(ADD COLUMN nullable / backfill 신규컬럼만 / partial unique CONCURRENTLY / 신규 RPC)
--   파괴요소0·기존행 mutation0·clean rollback. 단일 CRM(foot) 국소 → CONVENE·대표 게이트 불요(autonomy §3.1),
--   supervisor DDL-diff 게이트로 충분.
-- 게이트: supervisor DDL-diff (마지막 게이트). 본 파일 = 트랜잭션 가능한 DDL/backfill/RPC 부분.
--   ⚠ partial UNIQUE INDEX CONCURRENTLY 는 트랜잭션 밖 실행 필수 → 별도 파일:
--      20260630120001_foot_doc_serial_seq_unique_idx.sql (본 파일 COMMIT·backfill·중복0 검증 후 실행)
-- rollback: 20260630120000_foot_doc_serial_seq_harden.rollback.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ DA 의무 5건 (supervisor DDL-diff 확인 항목 — 미반영 시 NO-GO):
--   ① RPC 멱등성: 멱등 키 = form_submission_id. 이미 doc_serial_seq 있으면 기존값 반환(신규 발번 금지).
--   ② 발번 직렬화: RPC 진입부 pg_advisory_xact_lock(hashtext(clinic_id)) — clinic별 직렬화로 충돌-재시도 제거.
--      bounded loop 5회는 최종 안전망으로 유지.
--   ③ 백필 분모: 전체 form_submissions(clinic_id) WHERE 필터 없음 → MAX=현 count → 다음 발번 연속.
--      마이그 직후 MAX(doc_serial_seq)=count(*) per-clinic assert + 중복0 assert 포함.
--   ④ CONCURRENTLY 안전: 본 파일(backfill+중복0 검증) COMMIT 후 별도 파일에서 인덱스 생성 + indisvalid 검증.
--   ⑤ 권위 선언: authoritative = doc_serial_seq(INT). visit_no 문자열 = 파생·표시용(legacy 동결).
--
-- DoD(검수③): visit_no 문자열 포맷 불변(숫자 출처만 FE-count→RPC-seq 교체) + 기존 발행/인쇄분 재번호 없음.
--   → 본 마이그는 visit_no(JSONB field_data) 를 일절 건드리지 않는다(신규 INT 컬럼에만 기록).
-- 파티션: (clinic_id) 단독, 통산(never-reset). 연도 컴포넌트 없음(serial_partition_decision).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ADD COLUMN: form_submissions.doc_serial_seq (발번 권위 소스, INT) ───────────────
--  nullable = 기존 모든 행 무영향(백필 전 NULL). 발번 안 한 서류(영수증 재발급 등 비-연번호 경로)는 NULL 유지.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS doc_serial_seq integer NULL;

COMMENT ON COLUMN form_submissions.doc_serial_seq IS
  'T-20260629-foot-SERIAL-UNIQUE-HARDEN: 서류 발급순번(통산, 무리셋) authoritative 소스(INT). 발번 파티션=(clinic_id) 단독. issue_foot_doc_serial() RPC 가 MAX+1·committed 행만(gapless)·advisory lock 직렬화로 발번. NULL=미발번(비-연번호 서류). UNIQUE(clinic_id, doc_serial_seq) WHERE NOT NULL 로 동시발번 중복0 보장. visit_no(field_data JSONB) 문자열은 파생·표시용(legacy 동결) — datalake/집계는 본 컬럼을 권위 소스로 읽을 것(visit_no 파싱 의존 제거 로드맵).';

-- ── 2. backfill: per-clinic row_number (의무③ — 무필터 전체 행, MAX=현 count 연속성 보존) ──
--  ⚠ WHERE 필터 없음(visit_no 보유 행만 백필 금지). FE count()가 전체 행을 셌으므로 전체 백필 →
--    MAX=현 count → 다음 RPC 발번이 count+1 로 연속(점프/충돌 없음).
--  ⚠ ordering(created_at,id)은 과거 print 순서와 1:1일 필요 없음(검수①: legacy 문자열=동결 아티팩트).
--    per-clinic 유니크 + MAX=count 두 조건만 만족하면 정합.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY clinic_id ORDER BY created_at NULLS LAST, id) AS rn
    FROM form_submissions
)
UPDATE form_submissions fs
   SET doc_serial_seq = ranked.rn
  FROM ranked
 WHERE fs.id = ranked.id
   AND fs.doc_serial_seq IS NULL;  -- 멱등 재적용 안전(이미 발번된 행 보존)

-- ── 3. assert: MAX(doc_serial_seq)=count(*) per clinic + 중복0 (의무③·④ 전제) ─────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  -- 3-a. per-clinic MAX = count(*) (백필 분모 검증)
  FOR r IN
    SELECT clinic_id, MAX(doc_serial_seq) AS mx, COUNT(*) AS cnt
      FROM form_submissions
     GROUP BY clinic_id
  LOOP
    IF r.mx IS DISTINCT FROM r.cnt THEN
      RAISE EXCEPTION 'backfill assert FAILED: clinic % MAX(doc_serial_seq)=% != count(*)=% (백필 분모 불일치)',
        r.clinic_id, r.mx, r.cnt;
    END IF;
  END LOOP;

  -- 3-b. 중복0 검증 (CONCURRENTLY 인덱스 생성 전제 — 의무④)
  IF EXISTS (
    SELECT 1 FROM form_submissions
     WHERE doc_serial_seq IS NOT NULL
     GROUP BY clinic_id, doc_serial_seq
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'backfill assert FAILED: 중복 (clinic_id, doc_serial_seq) 존재 → 인덱스 생성 금지';
  END IF;

  RAISE NOTICE 'doc_serial_seq backfill assert PASS (MAX=count per-clinic, 중복0)';
END $$;

-- ── 4. RPC: issue_foot_doc_serial(clinic_id, form_submission_id) ──────────────────────
--  멱등(의무①) + advisory lock 직렬화(의무②) + MAX+1 committed 행만(gapless) + bounded retry(최종 안전망).
--  SECURITY DEFINER + search_path 고정(권한 상승 경로 차단). authenticated 에게만 EXECUTE.
CREATE OR REPLACE FUNCTION issue_foot_doc_serial(
  p_clinic_id          uuid,
  p_form_submission_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing   integer;
  v_row_clinic uuid;
  v_seq        integer;
  v_attempt    integer := 0;
BEGIN
  -- (의무①) 멱등 선조회: 이미 발번된 행이면 기존값 반환(신규 발번 금지).
  SELECT doc_serial_seq, clinic_id
    INTO v_existing, v_row_clinic
    FROM form_submissions
   WHERE id = p_form_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_foot_doc_serial: form_submission % 미존재', p_form_submission_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 파티션 오염 방지: 인자 clinic_id 와 행 clinic_id 불일치 거부.
  IF v_row_clinic IS DISTINCT FROM p_clinic_id THEN
    RAISE EXCEPTION 'issue_foot_doc_serial: clinic 불일치 (arg=%, row=%)', p_clinic_id, v_row_clinic
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;  -- 멱등: 기존 번호 유지(재시도·중복 인쇄 이중발번 차단)
  END IF;

  -- (의무②) clinic 단위 advisory xact lock → 동시 발번 직렬화(충돌-재시도 자체 제거). 트랜잭션 종료 시 자동 해제.
  PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text));

  -- bounded loop 5회 = 최종 안전망(advisory lock 으로 충돌은 사실상 제거되나, 폭주 시 루프 소진 위험 완화).
  LOOP
    v_attempt := v_attempt + 1;

    -- 락 획득 후 재확인(락 대기 사이 다른 트랜잭션이 이 행을 발번했을 수 있음 — 멱등 보존).
    SELECT doc_serial_seq INTO v_existing
      FROM form_submissions
     WHERE id = p_form_submission_id;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;

    -- (gapless) MAX+1, committed 행만. SEQUENCE 거부 사유(rollback gap) 회피.
    SELECT COALESCE(MAX(doc_serial_seq), 0) + 1 INTO v_seq
      FROM form_submissions
     WHERE clinic_id = p_clinic_id;

    BEGIN
      UPDATE form_submissions
         SET doc_serial_seq = v_seq
       WHERE id = p_form_submission_id;
      RETURN v_seq;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RAISE;  -- 안전망 소진 → 호출부(FE)가 발번 실패로 처리(발번대장 무결성 우선)
      END IF;
      -- 재시도: MAX 재계산 후 루프
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION issue_foot_doc_serial(uuid, uuid) IS
  'T-20260629-foot-SERIAL-UNIQUE-HARDEN: 서류 발급순번 발번 RPC. 멱등 키=form_submission_id(이미 발번 시 기존값 반환). pg_advisory_xact_lock(clinic) 직렬화 + MAX+1(committed 행만, gapless) + bounded retry 5회(최종 안전망). 발번 결과를 form_submissions.doc_serial_seq 에 기록·반환. visit_no 문자열 조립은 FE 책임(파생).';

-- authenticated(로그인 직원)만 발번. anon 차단(현장 admin 출력 경로 전용).
REVOKE ALL ON FUNCTION issue_foot_doc_serial(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION issue_foot_doc_serial(uuid, uuid) TO authenticated;

COMMIT;

-- 검증 쿼리 (apply 후 수동 확인):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='form_submissions' AND column_name='doc_serial_seq';          -- 1행
--   SELECT clinic_id, MAX(doc_serial_seq), count(*) FROM form_submissions GROUP BY clinic_id;  -- MAX=count
--   SELECT proname FROM pg_proc WHERE proname='issue_foot_doc_serial';               -- 1행
--   -- 멱등 검증(임의 form_submission_id 로 2회 호출 → 동일값):
--   --   SELECT issue_foot_doc_serial('<clinic>','<fs_id>');  -- 2회 동일 반환
--   다음: 20260630120001_foot_doc_serial_seq_unique_idx.sql (CONCURRENTLY 인덱스, 트랜잭션 밖)
