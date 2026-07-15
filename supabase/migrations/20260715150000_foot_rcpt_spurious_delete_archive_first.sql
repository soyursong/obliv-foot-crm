-- ============================================================================
-- 풋 고객DB 외부 자동등록 의심 4건 archive-first 삭제
-- Ticket : T-20260715-foot-RCPT-SPURIOUS-DELETE  (요청: 김주연 총괄 U0ATDB587PV)
-- SOP    : Cross-CRM Orphan-Row Archive-First Cleanup + FK Integrity Guard
--          (파괴적 삭제 → destructive branch. mutable-UPDATE SOP 아님.)
--          선례 템플릿: DA-20260713-foot-KJY-ASSIGNACTION-FK-DELETE
--          (FK 카탈로그 기계열거 · id VALUES freeze · 순소실0 · ADDITIVE→verify→DESTRUCTIVE)
-- 게이트 : 본 파일 = DRAFT/apply-prep. 실행은 (1) DA CONSULT-REPLY GO + (2) supervisor DB-GATE 후.
--
-- ── READ-ONLY probe 판정근거 스냅샷 (2026-07-15, scripts/..._probe{,2,3}.mjs) ──
--   대상 4행 (id VALUES freeze — 술어 재평가 금지):
--     a939ec01-859e-462a-8a47-eb8db90b16bf  RCPT_8142  01027518142  F-4760  2026-07-14 12:11:18.719+00
--     2db50bad-e200-4d13-ac2e-2356f8bb136a  RCPT_9095  01017969095  F-4761  2026-07-14 12:11:19.364+00
--     a22437a5-6602-4d43-a2f6-5e26b8aac727  RCPT_6086  01067746086  F-4762  2026-07-14 12:11:30.233+00
--     7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda  RCPT_1116  01094091116  F-4763  2026-07-14 12:11:30.814+00
--   spurious 지문(5): name='RCPT_<phone last4>'(비인명) · phone=bare11(정상등록 E164와 상이,
--     7/14 raw010 포맷은 이 4건이 전부) · created_by=NULL · 전 동의플래그 false·부가필드 NULL(skeleton)
--     · 12초 버스트(21:11:18~30 KST).  RCPT last4 ∩ phone last4 = 4/4 일치.
--   blast radius(순소실0 근거): 원장 접점 0 (payments/medical_charts/package_payments/service_charges/
--     prescriptions/insurance_*/payment_code_claims 전부 0) → 실환자 재판정 신호 없음.
--     임상/운영 자식 전부 0 (reservations/check_ins/checklists/consent/memo/clinical_images 등).
--     유일 접점 = aicc_crm_phone_match 4행(비FK dangling CTI 캐시, customer_id 1:1) → 함께 archive+remove.
--   freeze 유지 10건: 전원 실재(hyphenated 010-XXXX-XXXX), 대상 4 id/전화와 교집합 0. (아래 keep[] 고정)
-- ============================================================================

BEGIN;

DO $rcpt$
DECLARE
  -- 대상 4 (VALUES freeze)
  tgt uuid[] := ARRAY[
    'a939ec01-859e-462a-8a47-eb8db90b16bf',
    '2db50bad-e200-4d13-ac2e-2356f8bb136a',
    'a22437a5-6602-4d43-a2f6-5e26b8aac727',
    '7fe8dbdd-702d-4f48-abc2-3dfc0cf97fda']::uuid[];
  tgt_phones text[] := ARRAY['01027518142','01017969095','01067746086','01094091116'];
  -- freeze 유지 10건 (DELETE 절대금지 — freeze GUC)
  keep uuid[] := ARRAY[
    '40a4f761-0bb2-4650-9118-39aa16d38e02', -- 강영주 010-8181-3147
    '83ab4fe1-0bbc-4dfc-ab3b-f01378144707', -- 김민경 010-4316-0981
    '536259c2-e311-499a-af37-aadd0cc63f4b', -- 김수린 010-8780-8083
    'd2b849b3-cb3d-4d4e-88f0-1e5b5d393d7a', -- 김연희 010-9554-3858
    'e4e475f1-3a64-49a0-8169-7f191246ae62', -- 박정애 010-8609-3881
    '560feb98-926b-4136-bb76-e8d2653ce5af', -- 신도경 010-8376-0421
    '94f41fec-d4a4-4054-bff2-4ac3ac6463ff', -- 이백항 010-3990-7291
    '29743d6a-5e21-462f-92ac-ad0e84bd5c85', -- 이백향 010-3999-7291
    'c8e9049d-a4bf-4f6c-9285-0d48da982871', -- 이성수 010-8191-6245
    'ec4f77d2-159c-4833-a374-df2d9949c128'  -- 조선미 010-8301-4660
    ]::uuid[];
  n_cust int; n_fp int; n_led int; n_fk int; n_aicc_live int;
  n_arch_c int; n_arch_a int; del_c int; del_a int; overlap int;
BEGIN
  -- ── G1 freeze 재검증 abort: keep ∩ tgt = 0 ─────────────────────────────
  SELECT count(*) INTO overlap
    FROM unnest(tgt) t(id) WHERE t.id = ANY(keep);
  IF overlap <> 0 THEN
    RAISE EXCEPTION 'ABORT G1(freeze): target∩keep overlap=% (실고객 포함 위험)', overlap;
  END IF;

  -- ── 멱등 분기: 대상이 이미 제거됨 + 아카이브 존재 → no-op ─────────────
  SELECT count(*) INTO n_cust FROM customers WHERE id = ANY(tgt);
  IF n_cust = 0 THEN
    IF to_regclass('public._archive_rcpt_spurious_customers_20260715') IS NOT NULL THEN
      SELECT count(*) INTO n_arch_c FROM _archive_rcpt_spurious_customers_20260715 WHERE id = ANY(tgt);
      IF n_arch_c = 4 THEN
        RAISE NOTICE 'IDEMPOTENT no-op: 대상 4건 이미 제거·아카이브 완료(archived=%)', n_arch_c;
        RETURN;
      END IF;
    END IF;
    RAISE EXCEPTION 'ABORT: 대상 customers 0건인데 아카이브 미완 — 상태 불일치, 수동 조사 필요';
  END IF;

  -- ── G2 지문 재검증: 정확히 4행 + name/phone/시각창 일치 ────────────────
  SELECT count(*) INTO n_fp FROM customers c
    WHERE c.id = ANY(tgt)
      AND c.phone = ANY(tgt_phones)
      AND c.name LIKE 'RCPT\_%'
      AND c.created_at >= '2026-07-14 12:11:00+00'
      AND c.created_at <  '2026-07-14 12:12:00+00';
  IF n_fp <> 4 THEN
    RAISE EXCEPTION 'ABORT G2(fingerprint): 일치 %건 (기대 4). 지문 불일치 — 실행중단', n_fp;
  END IF;

  -- ── G3 원장 접점 재검증 = 0 (>0이면 실환자 재판정 → abort) ──────────────
  SELECT
      (SELECT count(*) FROM payments            WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM medical_charts      WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM package_payments    WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM service_charges     WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM prescriptions       WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM insurance_claims    WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM insurance_documents WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM insurance_receipts  WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM payment_code_claims WHERE customer_id = ANY(tgt))
    INTO n_led;
  IF n_led <> 0 THEN
    RAISE EXCEPTION 'ABORT G3(ledger): 원장 접점 %건 — 실환자 신호. planner FOLLOWUP + DA 재판정 필요', n_led;
  END IF;

  -- ── G4 FK-선언/비FK 자식 재검증 = 0 (aicc 제외). probe 이후 신규 유입 차단 ─
  SELECT
      (SELECT count(*) FROM chart_treatment_requests   WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM check_ins                  WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM checklists                 WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM clinical_images            WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM consent_forms              WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM customer_consult_memos     WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM customer_reservation_memos WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM customer_special_notes     WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM customer_treatment_memos   WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM customers                  WHERE referrer_id = ANY(tgt))
    + (SELECT count(*) FROM form_submissions           WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM health_q_results           WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM health_q_tokens            WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM message_logs               WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM notification_logs          WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM notification_opt_outs      WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM packages                   WHERE customer_id = ANY(tgt) OR transferred_to = ANY(tgt))
    + (SELECT count(*) FROM patient_file_records       WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM patient_past_history       WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM patient_room_daily_log     WHERE patient_id  = ANY(tgt))
    + (SELECT count(*) FROM reservation_memo_history   WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM reservations               WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM treatment_photos           WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM chart_doctor_memos         WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM consultation_notes         WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM leads                      WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM nhis_idor_audit_logs       WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM phi_access_log             WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM rrn_decrypt_fallback_log   WHERE customer_id = ANY(tgt))
    + (SELECT count(*) FROM tm_call_logs               WHERE customer_id = ANY(tgt))
    INTO n_fk;
  IF n_fk <> 0 THEN
    RAISE EXCEPTION 'ABORT G4(child): aicc 외 자식 %건 유입 — 실환자화 신호. abort→재판정', n_fk;
  END IF;

  -- ==================== ARCHIVE (ADDITIVE, 순소실0 선결) ====================
  -- 제약/PK/CHECK 미복제(LIKE INCLUDING DEFAULTS) — bare-format phone·PK충돌 회피
  CREATE TABLE IF NOT EXISTS _archive_rcpt_spurious_customers_20260715
    (LIKE customers INCLUDING DEFAULTS);
  CREATE TABLE IF NOT EXISTS _archive_rcpt_spurious_aicc_20260715
    (LIKE aicc_crm_phone_match INCLUDING DEFAULTS);
  -- 아카이브 메타
  ALTER TABLE _archive_rcpt_spurious_customers_20260715
    ADD COLUMN IF NOT EXISTS _archived_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS _ticket text DEFAULT 'T-20260715-foot-RCPT-SPURIOUS-DELETE';
  ALTER TABLE _archive_rcpt_spurious_aicc_20260715
    ADD COLUMN IF NOT EXISTS _archived_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS _ticket text DEFAULT 'T-20260715-foot-RCPT-SPURIOUS-DELETE';

  -- full-fidelity 복사 (멱등: 이미 아카이브된 id 제외)
  INSERT INTO _archive_rcpt_spurious_customers_20260715
    SELECT c.*, now(), 'T-20260715-foot-RCPT-SPURIOUS-DELETE'
    FROM customers c
    WHERE c.id = ANY(tgt)
      AND NOT EXISTS (SELECT 1 FROM _archive_rcpt_spurious_customers_20260715 a WHERE a.id = c.id);
  INSERT INTO _archive_rcpt_spurious_aicc_20260715
    SELECT m.*, now(), 'T-20260715-foot-RCPT-SPURIOUS-DELETE'
    FROM aicc_crm_phone_match m
    WHERE m.customer_id = ANY(tgt)
      AND NOT EXISTS (SELECT 1 FROM _archive_rcpt_spurious_aicc_20260715 a
                      WHERE a.customer_id = m.customer_id AND a.phone IS NOT DISTINCT FROM m.phone);

  -- ── VERIFY 순소실0: 삭제예정 전량이 아카이브에 존재 ─────────────────────
  SELECT count(*) INTO n_aicc_live FROM aicc_crm_phone_match WHERE customer_id = ANY(tgt);
  SELECT count(*) INTO n_arch_c FROM _archive_rcpt_spurious_customers_20260715 WHERE id = ANY(tgt);
  SELECT count(*) INTO n_arch_a FROM _archive_rcpt_spurious_aicc_20260715 WHERE customer_id = ANY(tgt);
  IF n_arch_c <> 4 THEN
    RAISE EXCEPTION 'ABORT archive: customers 아카이브 %건 (기대 4)', n_arch_c;
  END IF;
  IF n_arch_a < n_aicc_live THEN
    RAISE EXCEPTION 'ABORT archive: aicc 아카이브 % < live % — 순소실0 위반', n_arch_a, n_aicc_live;
  END IF;

  -- ==================== REMOVE (DESTRUCTIVE, children-first) ================
  DELETE FROM aicc_crm_phone_match WHERE customer_id = ANY(tgt);
  GET DIAGNOSTICS del_a = ROW_COUNT;

  DELETE FROM customers WHERE id = ANY(tgt) AND id <> ALL(keep);  -- keep 이중가드
  GET DIAGNOSTICS del_c = ROW_COUNT;
  IF del_c <> 4 THEN
    RAISE EXCEPTION 'ABORT remove: customers 삭제 %건 (기대 4) — 롤백', del_c;
  END IF;

  -- ── FINAL: 잔존 0 ──────────────────────────────────────────────────────
  SELECT count(*) INTO n_cust FROM customers WHERE id = ANY(tgt);
  IF n_cust <> 0 THEN
    RAISE EXCEPTION 'ABORT final: customers 잔존 %건 — 롤백', n_cust;
  END IF;

  RAISE NOTICE 'DONE: archived customers=% aicc=%, removed customers=% aicc=%',
    n_arch_c, n_arch_a, del_c, del_a;
END
$rcpt$;

COMMIT;
