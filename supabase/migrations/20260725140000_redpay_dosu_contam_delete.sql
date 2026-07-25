-- T-20260724-foot-REDPAY-DOSU-CONTAM-FIX 파트B — 도수(비풋) 오염 child-first archive-first hard-DELETE
--   ★재작성 (기존 2행 DELETE mig = STALE). scope 확장: 2행 → 818행급(816 recon_log child + 2 raw parent).
--   ⚠ 판정시점(supervisor forensic816, 07-25 07:44 KST) child=816. 재작성시점(07-25 12:14 KST) 실측 child=860.
--     recon_log 는 무-idempotency 증폭 근본②로 매 poller cycle 계속 증가하는 moving-target. → planner 재보고(FOLLOWUP).
--     본 마이그는 archive 에 동결된 id 집합만 파괴(freeze) → 실측 N 이 818/816/860 무엇이든 순소실0·과삭제0 로 안전.
--
-- 배경/판정 이력:
--   부모 T-20260724-foot-REDPAY-DAY1-RECONCILE 포렌식이 redpay_raw_transactions 에 도수(body) leak
--   1건(approval_no 62071914, merchant_id 1777276003, raw 2행 = 승인 Y + 취소 N)을 확정.
--   DA 재-CONSULT(MSG-073724-mnwm) Q1 (c): 그 2 raw parent 에 FK 로 매달린 payment_reconciliation_log
--   child 다수(판정시점 816)가 실존 → de-minimis(2행) 무효화 → child-first archive-first DELETE 로 승격.
--   supervisor READ-ONLY forensic816 PASS(회계·PHI·payment 링크 0, payment_id NOT NULL=0, external_trxid 단일
--   '0723C8124555', center=body 100%, event_type=match_failed/missing_in_crm 순수 telemetry) → 순수 오염-파생.
--   CEO informed-consent A안 승인(MSG-20260725-120457-co4i): archive-first hard-DELETE 진행 + 집행 5조건.
--
-- ⚠ DESTRUCTIVE DML. supervisor DB-GATE(DATA-diff) 통과 후에만 apply. dev 자가적용 안 함.
--   archive([1단])는 apply 러너(scripts/..._apply.mjs)가 off-git _backup 에 선적재(DA §4 "archive tracked CREATE 금지"
--   준수 → 본 마이그는 archive CREATE=DDL 를 포함하지 않는다. DML only). 본 마이그는 [2단] 파괴만.
--
-- ── FK 위상 (child-first 필수 이유) ──
--   payment_reconciliation_log.raw_transaction_id → redpay_raw_transactions(id) ON DELETE SET NULL.
--   parent 를 먼저 지우면 child 의 raw_transaction_id 가 조용히 NULL 로 끊겨(silent nullify) 오염 telemetry 가
--   고아로 잔존한다. ⇒ ★child(recon_log) 先 DELETE → parent(raw) 後 DELETE (CEO조건2).
--
-- ── 순소실 0 설계 (CEO조건1) ──
--   DELETE 대상 = _backup archive 에 이미 스냅샷된 id 집합(id IN archive)뿐.
--   ⇒ 삭제된 모든 행은 archive 에 존재(순소실 0 구조적 보장). archive_count == delete_count 를 가드로 강제.
--   ⇒ archive 이후 poller 가 새로 적재한 recon_log 행(무-idempotency 증폭 근본② 잔재)은 freeze-set 밖 →
--     본 마이그가 삭제하지 않음(residual). residual 은 파트A(merchant-drop EF) 배포 + parent 제거로 소스가
--     끊긴 뒤 수렴하며, 잔재는 후속 sweep 대상. (본 마이그는 판정시점 freeze-set 만 파괴 — 단일 count 삭제 금지.)
--
-- ── freeze-set (CEO조건3, 버그경로 지문 교집합) ──
--   parent 지문: approval_no='62071914' ∧ merchant '1777276003' ∧ observe-marker 부재(_mode≠'observe').
--   판정시점 parent id: f5ca6ec5-9372-466d-9b12-39200ce6e1d0 / 60667463-e09b-4a2d-b98b-0175a7c7014c.
--   child freeze = archive 에 동결된 recon_log id 집합(raw_transaction_id ∈ parent). DELETE 직전 재검증.
--   불일치(parent 지문<>2, 명시 id 부재, archive<>delete) → 즉시 abort. 단일 count 기준 삭제 금지.
--
-- ── 원장 무접점 (CEO조건5) ──
--   recon_log child 는 전량 payment_id IS NULL(forensic816 계승) — payments/service_charges 원장 미접촉.
--   payment_id NOT NULL child 발견 시 abort(원장 접점 = change-class 상향 사유 → 재-CONSULT).
--   전 과정 단일 txn — 어느 단계든 RAISE 시 전체 롤백(무영속).
-- author: dev-foot / 2026-07-25 (재작성)

BEGIN;

DO $$
DECLARE
  v_arch_child   regclass := to_regclass('_backup.redpay_dosu_contam_reconlog_20260725');
  v_arch_parent  regclass := to_regclass('_backup.redpay_dosu_contam_raw_20260725');
  v_parent_fp    int;
  v_id1_ok       int;
  v_id2_ok       int;
  v_arch_child_n int;
  v_arch_par_n   int;
  v_paylink      int;
  v_impure       int;
  v_del_child    int;
  v_del_parent   int;
  v_resid_par    int;
  c_id1  constant uuid := 'f5ca6ec5-9372-466d-9b12-39200ce6e1d0';
  c_id2  constant uuid := '60667463-e09b-4a2d-b98b-0175a7c7014c';
BEGIN
  -- ── [pre] archive 선적재 존재 검증 (archive-first 1단이 러너에서 완료됐어야 함) ──
  IF v_arch_child IS NULL OR v_arch_parent IS NULL THEN
    RAISE EXCEPTION
      'DOSU-CONTAM-FIX ABORT: _backup archive 부재 (reconlog=% raw=%) — archive-first 1단(apply 러너) 미실행. 파괴 금지.',
      v_arch_child, v_arch_parent;
  END IF;

  -- ── [freeze] parent 지문 재검증 = 2 + 판정시점 명시 id 존재 (CEO조건3) ──
  SELECT count(*) INTO v_parent_fp
  FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  IF v_parent_fp <> 2 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: parent 지문 % 행(기대=2) — 대상 드리프트, 재-freeze 필요', v_parent_fp;
  END IF;

  SELECT count(*) INTO v_id1_ok FROM public.redpay_raw_transactions WHERE id = c_id1;
  SELECT count(*) INTO v_id2_ok FROM public.redpay_raw_transactions WHERE id = c_id2;
  IF (v_id1_ok + v_id2_ok) <> 2 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: 판정시점 명시 parent id 부재(id1=% id2=%) — freeze-set 불일치', v_id1_ok, v_id2_ok;
  END IF;

  -- ── archive 카운트 산출 (순소실0 대조 기준) ──
  EXECUTE 'SELECT count(*) FROM _backup.redpay_dosu_contam_reconlog_20260725' INTO v_arch_child_n;
  EXECUTE 'SELECT count(*) FROM _backup.redpay_dosu_contam_raw_20260725'      INTO v_arch_par_n;
  IF v_arch_par_n <> 2 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: parent archive % 행(기대=2) — archive 부실', v_arch_par_n;
  END IF;
  IF v_arch_child_n < 1 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: child archive % 행(<1) — archive 부실', v_arch_child_n;
  END IF;

  -- ── [CEO조건5] 원장 무접점: archive 된 child 전량 payment_id NULL ──
  EXECUTE 'SELECT count(*) FROM _backup.redpay_dosu_contam_reconlog_20260725 WHERE payment_id IS NOT NULL'
    INTO v_paylink;
  IF v_paylink <> 0 THEN
    RAISE EXCEPTION
      'DOSU-CONTAM-FIX ABORT: child archive payment_id NOT NULL=% — 원장(payments) 접점 발견, change-class 상향 → 재-CONSULT', v_paylink;
  END IF;

  -- ── scope 순도: archive 된 child 전량 external_trxid='0723C8124555' (타 trxid 혼입 0) ──
  EXECUTE $q$SELECT count(*) FROM _backup.redpay_dosu_contam_reconlog_20260725
             WHERE external_trxid IS DISTINCT FROM '0723C8124555'$q$ INTO v_impure;
  IF v_impure <> 0 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: child archive 타 external_trxid=% — scope 오염, 재-freeze', v_impure;
  END IF;

  RAISE NOTICE 'DOSU-CONTAM-FIX freeze OK: parent 지문=2 · 명시id 2/2 · child archive=% (payment_id NULL 전량, trxid 단일)',
    v_arch_child_n;

  -- ══ [2단·파괴] child-first: recon_log(child) 先 DELETE (archive id 집합만 = 순소실0) ══
  EXECUTE $q$
    DELETE FROM public.payment_reconciliation_log
     WHERE id IN (SELECT id FROM _backup.redpay_dosu_contam_reconlog_20260725)
  $q$;
  GET DIAGNOSTICS v_del_child = ROW_COUNT;
  IF v_del_child <> v_arch_child_n THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: child DELETE %<>archive % — 순소실 위험, 전체 롤백', v_del_child, v_arch_child_n;
  END IF;

  -- ══ parent(raw) 後 DELETE (archive id 집합 = 판정시점 2행) ══
  DELETE FROM public.redpay_raw_transactions
   WHERE id IN (c_id1, c_id2)
     AND approval_no = '62071914'
     AND (raw_payload->'merchant'->>'id') = '1777276003'
     AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  GET DIAGNOSTICS v_del_parent = ROW_COUNT;
  IF v_del_parent <> 2 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: parent DELETE % 행(기대=2) — 초과/미달, 전체 롤백', v_del_parent;
  END IF;

  -- ── [post] parent 잔여=0 (지문 재조회) ──
  SELECT count(*) INTO v_resid_par
  FROM public.redpay_raw_transactions
  WHERE approval_no = '62071914'
    AND (raw_payload->'merchant'->>'id') = '1777276003'
    AND (raw_payload->>'_mode') IS DISTINCT FROM 'observe';
  IF v_resid_par <> 0 THEN
    RAISE EXCEPTION 'DOSU-CONTAM-FIX ABORT: parent 잔여 % 행(기대=0) — 삭제 미완, 전체 롤백', v_resid_par;
  END IF;

  RAISE NOTICE 'DOSU-CONTAM-FIX OK: child(recon_log) % 행 + parent(raw) % 행 hard-DELETE (child-first, 순소실0). '
    'parent 잔여 0. residual child(archive後 신규 적재분)은 파트A merchant-drop 배포 후 소스 차단으로 수렴 — 후속 sweep 대상.',
    v_del_child, v_del_parent;
END $$;

COMMIT;
