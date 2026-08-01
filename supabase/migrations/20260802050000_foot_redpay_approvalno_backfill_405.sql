-- T-20260730-foot-REDPAY-APPROVALNO-BACKFILL-405 — 레드페이 기저장분 payments.external_approval_no 소급 백필
--   author: dev-foot / 2026-08-02 (ticket created 2026-07-30 14:36)
--
-- 배경(supervisor TRIAGE MSG-20260730-142315-hppk, ★이관1):
--   부모 T-20260730-foot-REDPAY-APPROVALNO-WRITEBACK-PAYMENTS(forward-fix, deployed 07-30 14:20, commit 5a5ebbe2,
--   redpay-reconcile v34 ACTIVE)는 "매처가 신규 매칭을 확정하는 순간"에만 external_approval_no 를 payments 로
--   writeback → 오늘 이후 신규 결제분만 채운다. 기저장 405건은 이미 매칭 완료(reconciled_at+external_trxid≠NULL)
--   → isUnmatchedCrm·Tier0 pool 에서 영구 제외 → matcher 재통과 불가 → forward-fix 로는 영원히 NULL.
--   ∴ 대표/총괄 결제내역 화면 '승인번호 없음' 완전해소 = 본 backfill 필수(DA §4-3 C3, MANDATORY, 선택 아님).
--
-- ★AC-0 실행게이트(hard, prod UPDATE 한정): 부모 WRITEBACK AC-3(신규 결제분 external_approval_no 채움
--   = 다음 reconcile run 후 표본 실측) field-soak GO 선행. planner 가 block_dependency RESOLVED 전환 후
--   dev-foot 착수 GO. 실측 전에는 freeze 스냅샷 설계·SQL 리뷰·dry-run(.dryrun.sql, 무영속) 까지만 허용.
--   ⚠ 본 .sql = supervisor DB-gate 통과 + AC-0 GO 후에만 apply. dev 자가적용 안 함.
--
-- 게이트: supervisor DB-gate(db_change=false·ADDITIVE·1회성 데이터 정정). 대표게이트 면제(autonomy §3.1).
--
-- ── 성격(risk_verdict=GO_WARN) ──
--   ADDITIVE(NULL→value populate, 파괴 아님·no-DDL). 매칭 predicate 무접촉 — matched_payment_id 명시 1:1 링크
--   기준(matcher 재run 아님). 매출 무접점(external_approval_no 승인번호 메타만; amount/method/pg_provider/split/
--   flag/row 수 전부 불변). 원장(service_charges·payments.amount) 무접촉.
--
-- ── data_correction_backfill_sop 준수 7항 ──
--   ① 조인키 = redpay_raw_transactions.matched_payment_id = payments.id (매처가 확정 시 write 한 명시 1:1 링크,
--      redpay-reconcile/index.ts L782). ★bare external_trxid 재조인 절대 금지(trxid non-unique → 오 raw 유입,
--      NONUNIQUE-GUARD v27+ composite 불변식 계승).
--   ② source 권위 = raw.approval_no 만. now()·합성값·추정값 대입 HARD-BLOCK(코드 경로 없음).
--   ③ 1:1 assert(ambiguous 분리): 한 payment 에 매핑된 raw 들이 ≥2개의 서로 다른 approval_no 를 들고 있으면
--      (guess-risk) → leave NULL + manual 큐(_backup.*_ambiguous)로 분리, backfill 대상에서 제외.
--      ※ 승인 Y + 취소 N 짝처럼 동일 approval_no 를 공유하는 다중 raw 는 결정적(비-ambiguous) → 정상 채움.
--   ④ target-set freeze: 대상 payment id·확정 approval_no 를 임시테이블에 먼저 고정 → 그 집합에만 UPDATE.
--      freeze 재검증 불일치(count drift) 시 abort.
--   ⑤ rows-affected 검증: freeze 스냅샷 count == 실제 UPDATE ROW_COUNT. 불일치 시 RAISE(전체 롤백).
--      silent write-failure(0-row+error=null) 금지(cross_crm_write_rowcheck_standard INV-W2/W4/W5).
--   ⑥ 원장 무접촉: SET external_approval_no 만. service_charges·payments.amount·pg_provider·매칭 flag 무접촉.
--   ⑦ forward-only + 판정근거 스냅샷: 파괴 前 대상 id + 사전 상태(uniformly NULL) + 채운 값을 _backup 에 적재
--      (rollback = 20260802050000_..._backfill_405.rollback.sql 에서 재-NULL). 멱등(WHERE external_approval_no IS NULL).
--
-- ── _backup 네임스페이스(SOP §4: tracked CREATE 금지 → _backup/CSV 허용) ──
--   판정근거·롤백원천 스냅샷을 _backup 스키마에 동일 txn 내 적재(schema_migrations 무관, 원장 무접점).
-- =====================================================

BEGIN;

-- 판정근거/롤백원천 스냅샷 목적지 (_backup, idempotent)
CREATE SCHEMA IF NOT EXISTS _backup;

CREATE TABLE IF NOT EXISTS _backup.foot_redpay_approvalno_backfill_405_20260802 (
  payment_id                 uuid        NOT NULL,
  prior_external_approval_no text,        -- 사전 상태(대상 predicate 상 uniformly NULL)
  filled_approval_no         text        NOT NULL,
  snapshotted_at             timestamptz NOT NULL DEFAULT now()
);

-- ambiguous(1:N distinct approval_no) 분리 목적지 — manual 큐 (guess 금지 대상)
CREATE TABLE IF NOT EXISTS _backup.foot_redpay_approvalno_ambiguous_20260802 (
  payment_id             uuid        NOT NULL,
  distinct_approval_cnt  int         NOT NULL,
  distinct_approval_nos  text,        -- 서로 다른 approval_no 목록(사람 검토용)
  snapshotted_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_ambiguous_cnt int;
  v_freeze_cnt    int;
  v_updated       int;
BEGIN
  -- ── (A) ambiguous 분리: 한 payment 에 매핑된 raw 가 ≥2 distinct non-null approval_no → manual 큐 ──
  INSERT INTO _backup.foot_redpay_approvalno_ambiguous_20260802
    (payment_id, distinct_approval_cnt, distinct_approval_nos)
  SELECT r.matched_payment_id,
         count(DISTINCT r.approval_no),
         string_agg(DISTINCT r.approval_no, ',' ORDER BY r.approval_no)
  FROM public.redpay_raw_transactions r
  JOIN public.payments p ON p.id = r.matched_payment_id
  WHERE r.matched_payment_id IS NOT NULL
    AND r.approval_no IS NOT NULL
    AND p.external_approval_no IS NULL
  GROUP BY r.matched_payment_id
  HAVING count(DISTINCT r.approval_no) >= 2;
  GET DIAGNOSTICS v_ambiguous_cnt = ROW_COUNT;
  RAISE NOTICE 'BACKFILL-405 ambiguous(1:N distinct approval_no) 분리=% 건 → manual 큐(leave NULL, guess 금지)', v_ambiguous_cnt;

  -- ── (B) target-set freeze: NULL ∧ 명시링크 ∧ 비-ambiguous, 확정 approval_no 를 임시테이블에 고정 ──
  --    비-ambiguous → 매핑 raw 들의 approval_no distinct=1 → max()=그 유일값(결정적, guess 아님).
  CREATE TEMP TABLE _bf_target ON COMMIT DROP AS
  SELECT p.id AS payment_id,
         (SELECT max(r.approval_no)
            FROM public.redpay_raw_transactions r
           WHERE r.matched_payment_id = p.id
             AND r.approval_no IS NOT NULL) AS approval_no
  FROM public.payments p
  WHERE p.external_approval_no IS NULL
    AND EXISTS (
      SELECT 1 FROM public.redpay_raw_transactions r
       WHERE r.matched_payment_id = p.id
         AND r.approval_no IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM _backup.foot_redpay_approvalno_ambiguous_20260802 a
       WHERE a.payment_id = p.id);

  SELECT count(*) INTO v_freeze_cnt FROM _bf_target;
  RAISE NOTICE 'BACKFILL-405 freeze-set(대상 payment) 카운트=% (기대 ≈405; prod 실측 기준. 잔여 NULL = ambiguous + raw.approval_no NULL)', v_freeze_cnt;

  IF v_freeze_cnt = 0 THEN
    RAISE NOTICE 'BACKFILL-405 대상 0건 — 채울 것 없음(benign no-op). 커밋(무변경).';
  END IF;

  -- freeze 무결성 재검증: temp 에 approval_no NULL 이 섞이면 abort(예상 밖 상태 — guess 대입 차단).
  IF EXISTS (SELECT 1 FROM _bf_target WHERE approval_no IS NULL) THEN
    RAISE EXCEPTION 'BACKFILL-405 ABORT: freeze-set 에 approval_no NULL 혼입 — 대상 드리프트, 재-freeze 필요';
  END IF;

  -- ── (C) 판정근거/롤백원천 스냅샷(파괴 前, 동일 txn) — 사전 상태 uniformly NULL ──
  INSERT INTO _backup.foot_redpay_approvalno_backfill_405_20260802
    (payment_id, prior_external_approval_no, filled_approval_no)
  SELECT t.payment_id, NULL, t.approval_no FROM _bf_target t;

  -- ── (D) UPDATE: frozen 집합에만, external_approval_no 단일필드. 멱등 guard(IS NULL). ──
  UPDATE public.payments p
  SET external_approval_no = t.approval_no
  FROM _bf_target t
  WHERE p.id = t.payment_id
    AND p.external_approval_no IS NULL;   -- 멱등 + silent-overwrite 방지
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- ── (E) rows-affected 검증: freeze count == UPDATE ROW_COUNT ──
  IF v_updated <> v_freeze_cnt THEN
    RAISE EXCEPTION
      'BACKFILL-405 ABORT: UPDATE % 행 ≠ freeze % 행 — target-set drift/사일런트 write-failure, 전체 롤백',
      v_updated, v_freeze_cnt;
  END IF;

  RAISE NOTICE 'BACKFILL-405 OK: payments.external_approval_no % 행 소급 채움(=freeze). ambiguous % 건 제외(manual). 원장 무접점.',
    v_updated, v_ambiguous_cnt;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 사후 검증 (AC-2, supervisor DB-gate / SQL Editor) — 판정근거 스냅샷
-- ════════════════════════════════════════════════════════════════════
-- (1) NULL 비율 개선 실측: 백필 후 잔여 NULL = ambiguous + raw.approval_no NULL 만 남아야.
--   SELECT count(*) FILTER (WHERE external_approval_no IS NULL)  AS null_remaining,
--          count(*) FILTER (WHERE external_approval_no IS NOT NULL) AS filled,
--          count(*) AS total
--     FROM public.payments;
-- (2) 잔여 NULL 사유 분류(ambiguous vs raw.approval_no NULL vs 매핑 raw 부재):
--   SELECT
--     count(*) FILTER (WHERE a.payment_id IS NOT NULL) AS due_ambiguous,
--     count(*) FILTER (WHERE a.payment_id IS NULL AND EXISTS (
--       SELECT 1 FROM public.redpay_raw_transactions r WHERE r.matched_payment_id = p.id AND r.approval_no IS NOT NULL))
--       AS unexpected_should_have_filled,   -- 기대 0
--     count(*) FILTER (WHERE NOT EXISTS (
--       SELECT 1 FROM public.redpay_raw_transactions r WHERE r.matched_payment_id = p.id AND r.approval_no IS NOT NULL))
--       AS due_no_source   -- 매핑 raw 부재 or raw.approval_no NULL
--   FROM public.payments p
--   LEFT JOIN _backup.foot_redpay_approvalno_ambiguous_20260802 a ON a.payment_id = p.id
--   WHERE p.external_approval_no IS NULL;
-- (3) 매출·매칭 정합 무변(원장 무접점 재확인):
--   - payments row 수 불변(본 UPDATE 는 INSERT/DELETE 0).
--   - SELECT sum(amount) FROM public.payments;                        -- 백필 전후 동일해야.
--   - auto-matched 링크 drop 0: SELECT count(*) FROM public.redpay_raw_transactions WHERE matched_payment_id IS NOT NULL;  -- 불변.
--   - 235 취소짝·external_trxid/reconciled_at 무변(본 마이그 SET 대상 아님).
-- (4) 백필 근거 스냅샷:
--   SELECT count(*) FROM _backup.foot_redpay_approvalno_backfill_405_20260802;   -- = UPDATE 건수.
--   SELECT * FROM _backup.foot_redpay_approvalno_ambiguous_20260802;             -- manual 큐 목록.
